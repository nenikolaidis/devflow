# Architecture

How devflow's code is organised, where its data lives, and how to change
it safely. If you're about to make your first change, read this first.

devflow is a static site (plain HTML, CSS and JavaScript modules — no
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
├── app.js                 entry point — imports auth, top bar, notifications and shortcuts (which pull in everything)
├── config.js              every editable value: Firebase config, App Check key, EmailJS, password length
├── theme-init.js          tiny non-module script in <head>: applies a saved light/dark choice before paint
│
├── core/                  building blocks — no Firestore calls
│   ├── constants.js       roles, statuses, collection names, labels, templates, limits, defaults
│   ├── state.js           the shared in-memory state object
│   ├── events.js          tiny pub/sub: on(EVENT, fn) → unsubscribe, emit(EVENT)
│   ├── html.js            html`` safe templates (auto-escaping), escapeHtml, raw
│   ├── icons.js           inline SVG icons: icon(name), statusIcon, priorityIcon, typeIcon, logo
│   ├── markdown.js        safe description formatting + checklist helpers
│   ├── theme.js           light/dark: follow the system, toggle, remember the choice
│   ├── ui.js              showToast (stacked, typed), openModal (dialog or side panel), confirmDialog, promptDialog
│   ├── format.js          dates, safeUrl, initials, friendly error messages
│   ├── permissions.js     myEmail, isMe, isAdmin, canModerate
│   ├── people.js          displayName, avatarHtml, matchPeople (search), local time, availability
│   ├── settings.js        getSettings() — board settings with defaults
│   └── workflow.js        move rules (reviewers, Definition of Done), WIP limits, stale & overdue
│
├── data/                  the only code that talks to Firestore
│   ├── firebase.js        initialises Firebase (and local emulators with ?emulators)
│   ├── api.js             every one-off read/write, incl. the activity log
│   └── sync.js            live listeners → state → events; per-dialog watchers
│
├── features/              one file per screen or part of a screen
│   ├── auth.js            login/signup, verify-email & pending screens, account dialog, the gate
│   ├── nav.js             tab switching; repaints the visible tab on data events
│   ├── topbar.js          account menu (avatar) and the theme toggle
│   ├── notifications.js   the bell: @mention notifications
│   ├── shortcuts.js       keyboard shortcuts and the "?" help dialog
│   ├── board.js           filter bar, Kanban columns, cards, drag & drop, bulk actions
│   ├── table.js           table view
│   ├── ticket-common.js   badges, chips, filtering, sorting shared by board/table
│   ├── ticket-detail.js   the ticket side panel
│   ├── ticket-form.js     new/edit form, quick edit, teammate picker
│   ├── ticket-actions.js  move / archive / block / save — with toasts & notifications
│   ├── comments.js        comment thread with edit / hide / delete and the @mention picker
│   ├── activity-log.js    read-only audit trail
│   ├── sprints.js         sprint helpers and the "Sprints" manager dialog
│   ├── my-work.js         "My work" tab: assigned to me, waiting for my review, recently done
│   ├── dashboard.js       stats and lists
│   ├── profiles.js        profile dialog
│   ├── team.js            Team tab: members, roles, access requests
│   └── settings-panel.js  Team tab: board settings (webhook, labels, Definition of Done, WIP)
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

Outside `public/` (never deployed):

```
tests/firestore.rules.test.js   security-rules tests (Firestore emulator)
tests/e2e/app.e2e.test.js       end-to-end test: headless Chrome against the emulators
scripts/weekly-summary.mjs      the Monday Discord summary (run by GitHub Actions)
```

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
| `description` | string | ≤ 20,000; simple formatting incl. `- [ ]` checklists (`core/markdown.js`) |
| `type` | string | `task` · `bug` · `feature` · `security` · `maintenance` · `analysis` · `research`. Missing on older tickets — `typeOf()` infers it from their labels |
| `priority` | string | `critical` · `high` · `medium` · `low` |
| `status` | string | `backlog` · `in_progress` · `in_review` · `done` (old: `todo`, `code_review`, `testing` still readable) |
| `owner` | string | usually a lowercase email; free text allowed; ≤ 200 |
| `reviewers` | string[] | up to 5, lowercase emails (free text allowed). Older tickets have a single `reviewer` string instead — read both with `reviewersOf()`; saving converts to `reviewers` |
| `dod` | map | Definition of Done ticks: `{ itemId: true/false }` |
| `dueDate` | string | `YYYY-MM-DD` or empty |
| `linkUrl` | string | `http(s)://…` or empty |
| `labels` | string[] | ≤ 20; names from the board's label list |
| `blocked`, `blockedReason`, `blockedBy`, `blockedAt` | | set together; `blockedBy` must be the writer |
| `archived`, `archivedBy`, `archivedAt` | | admins/PMs only |
| `createdBy`, `createdAt` | | never change |
| `lastActivityAt` | timestamp | bumped on any activity; drives "stale" |
| `sprintId` | string | id of a `sprints` document, or empty |

Subcollections:

- **`comments/{autoId}`** — `text` (≤ 5,000), `author`, `createdAt`, optional `mentions` (emails, ≤ 10), `editedAt`, `hidden`, `hiddenBy`, `hiddenAt`.
- **`activity/{autoId}`** — append-only: `type` (see `ACTIVITY` in `core/constants.js`), `actor`, `createdAt`, optional `from`, `to`, `summary`, `reason`.

### Other collections
| Path | Fields | Who writes |
|---|---|---|
| `allowlist/{email}` | `role` (`developer`·`pm`·`admin`), `addedBy`, `addedAt` | admins |
| `accessRequests/{email}` | `email`, `requestedAt` | the verified user themselves; admins delete |
| `profiles/{email}` | `name`, `username`, `bio`, `title`, `availability` (`available`·`busy`·`away`), `timezone`, `lastActive`, `createdAt` | the user themselves |
| `meta/counters` | `ticketNumber` (only ever increases) | any approved user, inside the create transaction |
| `config/settings` | `discordWebhookUrl`, `staleDays`, `wipLimits{status: n}`, `labels[{name, color}]`, `dodItems[{id, text}]`, `dodRequired[id]` (what the rules check), `weeklySummary` (bool), `updatedBy`, `updatedAt` | admins |
| `sprints/{autoId}` | `name`, `goal`, `start`, `end` (`YYYY-MM-DD`), `status` (`planned`·`active`·`closed`), `createdBy`, `createdAt` | admins / PMs |
| `notifications/{autoId}` | `to`, `by`, `type` (`mention`), `ticketFid`, `ticketId`, `ticketTitle`, `text`, `createdAt`, `read` | sender creates (as themselves, to a teammate); only the recipient reads, marks read or deletes. Queried by `to` + `createdAt` — index in `firestore.indexes.json` |

---

## Roles and permissions

| Action | Developer | PM | Admin |
|---|:-:|:-:|:-:|
| Read everything, create & edit tickets, comment | ✓ | ✓ | ✓ |
| Move to In review (ticket needs at least one reviewer) | ✓ | ✓ | ✓ |
| Move to Done | only as one of the ticket's reviewers, and not if also its owner | ✓ | ✓ |
| …and when a Definition of Done is set | only once every item is ticked | same | same |
| Archive / restore tickets, hide comments | | ✓ | ✓ |
| Create, edit, delete sprints | | ✓ | ✓ |
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
- **Colors come from CSS variables** in `css/style.css` (section 1), defined once
  for light and once for dark. Never hard-code a hex color in JS or markup —
  use `var(--text)`, `var(--red)`, `STATUS_COLOR`, `LABEL_COLOR`, etc., so both
  themes work.
- **Icons:** `icon('name')` from `core/icons.js` (add new ones to its `STROKE`
  map). No emoji and no icon fonts.
- **No `alert` / `confirm` / `prompt`.** Use `confirmDialog` /
  `promptDialog` / `openModal` from `core/ui.js` — they handle Esc,
  focus, and screen readers.
- **Toasts:** `showToast(message, 'success' | 'error' | 'info')`. They stack
  in the bottom-left corner, clear of the ticket panel and the bulk bar.
- **Subscribing to events from a dialog?** Keep the function `on()`
  returns and call it in the dialog's `onClose` (see `sprints.js`).
- **Firestore only in `data/`.** Add a function to `data/api.js` rather
  than calling `db` from a feature.
- **Names, not strings:** `ROLES.ADMIN`, `STATUS.DONE`, `COLLECTIONS.TICKETS`,
  `ACTIVITY.BLOCKED` from `core/constants.js`.
- **Every file starts with a header comment** saying what it does.
- Event handlers for re-rendered lists use **one delegated listener** on
  the container (see `comments.js`, `team.js`), not one per row.

---

## Common changes

**Add a label** — no code change: an admin adds it in Team → Board
settings. (`DEFAULT_LABELS` in `core/constants.js` is only the starting
list before anything is saved.)

**Add a ticket type** — add it to `TICKET_TYPES` in `core/constants.js`
(with an icon from `core/icons.js`) and to the `type in [...]` list in
`validTicket()` in `firestore.rules`.

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

Needs [Node.js](https://nodejs.org) 20+, Java 11+ (for the emulators) and
Google Chrome (for the browser test; set `CHROME_PATH` if it's somewhere
unusual).

```bash
npm install            # dev tools only — nothing here is deployed
npm test               # both suites below
npm run test:rules     # 69 security-rules tests against the Firestore emulator
npm run test:e2e       # end-to-end: headless Chrome drives the real app against the emulators
npm run emulators      # local Auth + Firestore (throwaway data, project "demo-devflow")
npm run serve          # serves public/ at http://localhost:5050
npm run summary:preview  # prints the weekly Discord summary (with emulators running and
                         # FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 set)
```

Open **http://localhost:5050/?emulators** to use the app against the
local emulators. Sign up in the app (the Auth emulator accepts any
address; use its REST API to mark an email verified — see how
`tests/e2e/app.e2e.test.js` creates users), then add yourself to
`allowlist` in the Firestore emulator. Real data is never touched.

**The end-to-end test** (`tests/e2e/app.e2e.test.js`) signs in as an admin,
a developer, an unverified user and an outsider, and walks through the
main flows in order: templates and escaping, workflow locks, reviewers,
blocking, comments and @mentions, notifications, settings, sprints,
checklists and the Definition of Done, archive, views, team approval,
shortcuts and sign-out. When you add a feature, add a step.

**Continuous integration** (`.github/workflows/`):

| Workflow | When | Does |
|---|---|---|
| `deploy.yml` | push to `main` | runs both test suites; deploys hosting only if they pass |
| `firebase-hosting-pull-request.yml` | pull request | runs both test suites; posts a preview link (not for Dependabot) |
| `weekly-summary.yml` | Mondays 07:00 UTC, or manually | posts the weekly summary to Discord |

Firestore rules and indexes are deployed by hand (`npm run deploy:rules`).
Dependabot (`.github/dependabot.yml`) groups dependency updates into one
pull request a week.
