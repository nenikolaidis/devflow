# Devflow — architecture

How the code is organised, where data lives, and how to change things
safely. Read this before your first change.

Devflow is a static site (plain HTML, CSS and JavaScript modules — no
build step) that talks directly to Firebase from the browser:

- **Firebase Authentication** — email/password sign-in, verified emails
- **Cloud Firestore** — all data, synced live to every open browser
- **Firestore security rules** (`firestore.rules`) — the only real security boundary
- **Firebase Hosting** — serves `public/` with security headers (`firebase.json`)

Because the browser code can be read and modified by anyone, **every
permission that matters is enforced in `firestore.rules`**. The UI checks
in `core/permissions.js` and `core/workflow.js` only decide what to show
and explain *why* something isn't allowed.

---

## Folder map

```
public/js/
├── app.js                 entry point — imports features/auth.js (which pulls in everything)
├── config.js              every editable value: Firebase config, App Check key, EmailJS, password length
│
├── core/                  building blocks — no Firestore calls
│   ├── constants.js       roles, statuses, collection names, labels, templates, limits, defaults
│   ├── state.js           the shared in-memory state object
│   ├── events.js          tiny pub/sub: on(EVENT, fn) / emit(EVENT)
│   ├── html.js            html`` safe templates (auto-escaping), escapeHtml, raw
│   ├── ui.js              showToast, openModal, confirmDialog, promptDialog
│   ├── format.js          dates, safeUrl, initials, friendly error messages
│   ├── permissions.js     myEmail, isMe, isAdmin, canModerate
│   ├── people.js          displayName, avatarHtml (from profiles in state)
│   ├── settings.js        getSettings() — board settings with defaults
│   └── workflow.js        move rules, WIP limits, stale & overdue detection
│
├── data/                  the only code that talks to Firestore
│   ├── firebase.js        initialises Firebase (and local emulators with ?emulators)
│   ├── api.js             every one-off read/write, incl. the activity log
│   └── sync.js            live listeners → state → events; per-dialog watchers
│
├── features/              one file per screen or part of a screen
│   ├── auth.js            login/signup, verify-email & pending screens, account dialog, the gate
│   ├── nav.js             tab switching; repaints the visible tab on data events
│   ├── board.js           filter bar, Kanban columns, cards, drag & drop, bulk actions
│   ├── table.js           table view
│   ├── ticket-common.js   badges, chips, filtering, sorting shared by board/table
│   ├── ticket-detail.js   the ticket dialog
│   ├── ticket-form.js     new/edit form, quick edit, teammate picker
│   ├── ticket-actions.js  move / archive / block / save — with toasts & notifications
│   ├── comments.js        comment thread with edit / hide / delete
│   ├── activity-log.js    read-only audit trail
│   ├── dashboard.js       stats and lists
│   ├── profiles.js        profile dialog
│   ├── team.js            Team tab: members, roles, access requests
│   └── settings-panel.js  Team tab: board settings
│
└── integrations/
    ├── discord.js         posts ticket events to a Discord webhook
    └── email.js           assignment emails via EmailJS
```

### Layering rules

```
features/  →  data/  →  core/        (arrows = "may import")
features/  →  integrations/  →  core/
```

- `core/` never imports from `data/` or `features/`.
- Only `data/` touches Firestore. Features call `data/api.js` (usually via
  `features/ticket-actions.js` for tickets).
- Features may import other features "downward" (board → ticket-detail →
  ticket-form), but **never in a circle**. For "something changed, whoever
  cares should repaint", use `core/events.js` instead of an import.

---

## How data flows

```
Firestore ──onSnapshot──▶ data/sync.js ──writes──▶ state
                                │
                                └──emit(EVENTS.X)──▶ features/nav.js ──▶ repaint visible tab

user click ──▶ feature ──▶ ticket-actions.js ──▶ data/api.js ──▶ Firestore
                                │                     └─▶ activity log entry
                                └─▶ toast, Discord, email
```

Writes don't update the screen directly. They go to Firestore, the live
listener sees the change (instantly, for the person who made it too), and
the screen repaints. That's why every open browser stays in sync.

**Sign-in gate** (`features/auth.js`):

| Situation | Screen |
|---|---|
| signed out | login |
| email not verified | "Confirm your email" |
| verified, not on `allowlist` | "pending approval" with **Request access** |
| on `allowlist` | the app; `startSync()` attaches the live listeners |

---

## Data model (Firestore)

Email addresses used as document ids are always **lowercase**.

### `tickets/{autoId}`
| Field | Type | Notes |
|---|---|---|
| `id` | string | `TASK-001`; never changes |
| `number` | int | must equal `meta/counters.ticketNumber` at creation (rules check this) |
| `title` | string | 1–200 chars |
| `description` | string | ≤ 20,000 |
| `priority` | string | `critical` · `high` · `medium` · `low` |
| `status` | string | `backlog` · `in_progress` · `in_review` · `done` (old: `todo`, `code_review`, `testing` still readable) |
| `owner`, `reviewer` | string | usually an email; free text allowed; ≤ 200 |
| `dueDate` | string | `YYYY-MM-DD` or empty |
| `linkUrl` | string | `http(s)://…` or empty |
| `labels` | string[] | ≤ 20 |
| `blocked`, `blockedReason`, `blockedBy`, `blockedAt` | | set together; `blockedBy` must be the writer |
| `archived`, `archivedBy`, `archivedAt` | | admins/PMs only |
| `createdBy`, `createdAt` | | never change |
| `lastActivityAt` | timestamp | bumped on any activity; drives "stale" |

Subcollections:

- **`comments/{autoId}`** — `text` (≤ 5,000), `author`, `createdAt`, optional `editedAt`, `hidden`, `hiddenBy`, `hiddenAt`.
- **`activity/{autoId}`** — append-only: `type` (see `ACTIVITY` in `core/constants.js`), `actor`, `createdAt`, optional `from`, `to`, `summary`, `reason`.

### Other collections
| Path | Fields | Who writes |
|---|---|---|
| `allowlist/{email}` | `role` (`developer`·`pm`·`admin`), `addedBy`, `addedAt` | admins |
| `accessRequests/{email}` | `email`, `requestedAt` | the verified user themselves; admins delete |
| `profiles/{email}` | `name`, `username`, `bio`, `timezone`, `lastActive`, `createdAt` | the user themselves |
| `meta/counters` | `ticketNumber` (only ever increases) | any approved user, inside the create transaction |
| `config/settings` | `discordWebhookUrl`, `staleDays`, `wipLimits{status: n}`, `updatedBy`, `updatedAt` | admins |

---

## Roles and permissions

| Action | Developer | PM | Admin |
|---|:-:|:-:|:-:|
| Read everything, create & edit tickets, comment | ✓ | ✓ | ✓ |
| Move to In review (ticket needs a reviewer) | ✓ | ✓ | ✓ |
| Move to Done | only as the ticket's reviewer, and not if also its owner | ✓ | ✓ |
| Archive / restore tickets, hide comments | | ✓ | ✓ |
| Permanently delete an archived ticket | | | ✓ |
| Approve people, change roles, board settings | | | ✓ |

Source of truth: `firestore.rules`. UI mirror: `core/permissions.js`,
`core/workflow.js` (`moveBlockedReason`). Change all three together, and
update `tests/firestore.rules.test.js`.

---

## Conventions

- **Build HTML only with `html```** from `core/html.js`. Values are escaped
  automatically (including quotes, so they're safe in attributes). Never
  build markup with plain template strings from user data.
- **No `alert` / `confirm` / `prompt`.** Use `confirmDialog` /
  `promptDialog` / `openModal` from `core/ui.js` — they handle Esc,
  focus, and screen readers.
- **Firestore only in `data/`.** Add a function to `data/api.js` rather
  than calling `db` from a feature.
- **Names, not strings:** `ROLES.ADMIN`, `STATUS.DONE`, `COLLECTIONS.TICKETS`,
  `ACTIVITY.BLOCKED` from `core/constants.js`.
- **Every file starts with a header comment** saying what it does.
- Event handlers for re-rendered lists use **one delegated listener** on
  the container (see `comments.js`, `team.js`), not one per row.

---

## Common changes

**Add a label** — add it to `ALL_LABELS` in `core/constants.js`. The
filter and forms pick it up automatically.

**Add a ticket template** — add an entry to `TICKET_TEMPLATES` in
`core/constants.js`.

**Add a ticket field**
1. Add it to the form in `features/ticket-form.js` and show it in
   `features/ticket-detail.js`.
2. Add it to `ticketFields()` and `validTicket()` in `firestore.rules`.
3. Add a test, run `npm test`, then `npm run deploy:rules`.
4. Document it in the data model above.

**Add an activity type** — add it to `ACTIVITY` in `core/constants.js`,
describe it in `features/activity-log.js`, and add it to the allowed list
in `firestore.rules` (activity → create).

**Add an external service** (CDN, API) — allow its domain in the
`Content-Security-Policy` header in `firebase.json`, or the browser will
block it. Pin CDN scripts with an `integrity` hash (see SECURITY.md).

---

## Local development and tests

Needs [Node.js](https://nodejs.org) 20+ and Java 11+ (for the emulators).

```bash
npm install            # dev tools only — nothing here is deployed
npm test               # security-rules tests against a local Firestore emulator
npm run emulators      # local Auth + Firestore (throwaway data, project "demo-devflow")
npm run serve          # serves public/ at http://localhost:5050
```

Open **http://localhost:5050/?emulators** to use the app against the
local emulators. Create test users in the Auth emulator and add them to
`allowlist` in the Firestore emulator; real data is never touched.

**Continuous integration** (`.github/workflows/`): every pull request and
every push to `main` runs `npm test`. Pull requests get a preview link;
pushes to `main` deploy to Firebase Hosting only if the tests pass.
Firestore rules are deployed by hand (`npm run deploy:rules`).
