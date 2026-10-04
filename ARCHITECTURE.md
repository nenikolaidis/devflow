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
├── app.js                 entry point — imports auth, top bar, project switcher, notifications and shortcuts (which pull in everything)
├── config.js              every editable value: Firebase config, App Check key, EmailJS, password length
├── theme-init.js          tiny non-module script in <head>: applies a saved light/dark choice before paint
│
├── core/                  building blocks — no Firestore calls
│   ├── constants.js       permissions, default roles/types/labels/templates, statuses, collection names, limits
│   ├── state.js           the shared in-memory state object
│   ├── events.js          tiny pub/sub: on(EVENT, fn) → unsubscribe, emit(EVENT)
│   ├── html.js            html`` safe templates (auto-escaping), escapeHtml, raw
│   ├── icons.js           inline SVG icons: icon(name), statusIcon, priorityIcon, typeIcon, logo
│   ├── markdown.js        safe description formatting + checklist helpers
│   ├── theme.js           light/dark: follow the system, toggle, remember the choice
│   ├── ui.js              showToast (stacked, typed), openModal (dialog or side panel), confirmDialog, promptDialog
│   ├── format.js          dates, safeUrl, initials, friendly error messages
│   ├── permissions.js     myEmail, isMe, isAdmin, myRoleId, can(permission), canManageSomething, roleName
│   ├── people.js          displayName, avatarHtml, matchPeople (search), projectPeople, local time, availability
│   ├── settings.js        getSettings() — project settings with defaults; labels and ticket types
│   └── workflow.js        move rules (reviewers, Definition of Done), WIP limits, stale & overdue
│
├── data/                  the only code that talks to Firestore
│   ├── firebase.js        initialises Firebase (and local emulators with ?emulators)
│   ├── api.js             every one-off read/write (project-scoped refs), incl. the activity log
│   ├── sync.js            workspace listeners + the current project's listeners; switchProject()
│   └── upgrade.js         one-time "Upgrade to projects" and first-project setup
│
├── features/              one file per screen or part of a screen
│   ├── auth.js            login/signup, verify-email & pending screens, account dialog, the gate
│   ├── nav.js             tab switching; repaints the visible tab on data events
│   ├── topbar.js          account menu (avatar), theme toggle, New ticket availability
│   ├── project-switcher.js the project menu in the top bar
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
│   ├── sprints.js         sprint helpers and the sprint manager (mounted in Manage → Sprints)
│   ├── my-work.js         "My work" tab: assigned to me, waiting for my review, recently done
│   ├── dashboard.js       stats and lists
│   ├── profiles.js        profile dialog
│   └── manage/            the Manage tab
│       ├── index.js       side menu, which sections each role sees, live refresh (skipped while editing)
│       ├── common.js      section headings, save helpers
│       ├── overview.js    overview; first-project setup / "Upgrade now"
│       ├── members.js     project members & roles; access requests and workspace people (admins)
│       ├── projects.js    create / request / approve / archive projects
│       ├── roles.js       edit roles and their permissions (admins)
│       ├── content.js     labels and ticket types
│       ├── templates.js   templates list and editor (also used by "Save as template")
│       └── settings.js    workflow (DoD, WIP, stale) and integrations (Discord, weekly summary)
│
└── integrations/
    ├── discord.js         posts ticket events to a Discord webhook
    └── email.js           assignment emails via EmailJS

public/demo/               the public demo at /demo/ — the real app on sample data
├── index.html             loads only from this site (its own CSP); no Firebase SDK
├── boot.js                installs the stand-in, copies the app's markup from index.html, starts app.js
├── backend.js             in-memory stand-in for the Firebase compat API the data layer uses
├── seed.js                the sample team, projects, tickets and sprints
└── demo.css               the "Live demo · Viewing as" strip
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
tests/e2e/demo.e2e.test.js      the public demo works, and never contacts Firebase
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
| on `allowlist` | the app; `startSync()` attaches the workspace listeners and opens the last-used project (`switchProject()`) |

**Projects:** everything project-specific lives under `projects/{pid}/`.
`state.projectId` is the open project; `data/api.js` builds every
ticket/sprint/template/settings path from it, so features never pass a
project id around. Switching project detaches that project's listeners
and attaches the new one's, then emits `PROJECT_SWITCHED`.

---

## Data model (Firestore)

Email addresses used as document ids are always **lowercase**.

```
allowlist/{email}            workspace membership: role admin | member
roles/{roleId}               name, description, order, permissions {key: bool}
projects/{pid}               the project + its members
  ├── tickets/{autoId}         ├── comments/{autoId}
  │                            └── activity/{autoId}
  ├── sprints/{autoId}
  ├── templates/{autoId}
  ├── config/settings
  └── meta/counters
projectRequests/{autoId}     notifications/{autoId}     profiles/{email}
accessRequests/{email}       meta/workspace
tickets/, sprints/, config/settings, meta/counters   ← the old single board: read-only backup after the upgrade
```

### `projects/{pid}`
| Field | Type | Notes |
|---|---|---|
| `name`, `description` | string | ≤ 60 / ≤ 300 |
| `key` | string | `^[A-Z][A-Z0-9]{1,9}$`; starts every ticket id; never changes |
| `status` | string | `active` · `archived` (read-only except for admins) |
| `members` | map | `{ email: roleId }` |
| `memberEmails` | string[] | must equal the keys of `members` (used by queries and rules) |
| `migrating` | bool | only during the upgrade — lets an admin copy tickets as-is |
| `createdBy`, `createdAt`, `updatedBy`, `updatedAt` | | |

### `projects/{pid}/tickets/{autoId}`
| Field | Type | Notes |
|---|---|---|
| `id` | string | `WEB-001` (project key + number); never changes |
| `number` | int | must equal the project's `meta/counters.ticketNumber` at creation (rules check this) |
| `title` | string | 1–200 chars |
| `description` | string | ≤ 20,000; simple formatting incl. `- [ ]` checklists (`core/markdown.js`) |
| `type` | string | a key from the project's `types` setting (`^[a-z0-9_-]{1,30}$`). Missing on older tickets — `typeOf()` infers it from their labels |
| `priority` | string | `critical` · `high` · `medium` · `low` |
| `status` | string | `backlog` · `in_progress` · `in_review` · `done` (old: `todo`, `code_review`, `testing` still readable) |
| `owner` | string | usually a lowercase email; free text allowed; ≤ 200 |
| `reviewers` | string[] | up to 5, lowercase emails. Older tickets have a single `reviewer` string instead — read both with `reviewersOf()` |
| `dod` | map | Definition of Done ticks: `{ itemId: true/false }` |
| `dueDate` | string | `YYYY-MM-DD` or empty |
| `linkUrl` | string | `http(s)://…` or empty |
| `labels` | string[] | ≤ 20; names from the project's label list |
| `blocked`, `blockedReason`, `blockedBy`, `blockedAt` | | set together; `blockedBy` must be the writer |
| `archived`, `archivedBy`, `archivedAt` | | needs *archive tickets* |
| `createdBy`, `createdAt` | | never change |
| `lastActivityAt` | timestamp | bumped on any activity; drives "stale" |
| `sprintId` | string | id of one of the project's sprints, or empty |

Subcollections:

- **`comments/{autoId}`** — `text` (≤ 5,000), `author`, `createdAt`, optional `mentions` (emails, ≤ 10), `editedAt`, `hidden`, `hiddenBy`, `hiddenAt`.
- **`activity/{autoId}`** — append-only: `type` (see `ACTIVITY` in `core/constants.js`), `actor`, `createdAt`, optional `from`, `to`, `summary`, `reason`.

### Other documents
| Path | Fields | Who writes |
|---|---|---|
| `allowlist/{email}` | `role` (`admin`·`member`; old `pm`/`developer` still accepted), `addedBy`, `addedAt` | admins |
| `roles/{roleId}` | `name`, `description`, `order`, `permissions{key: bool}` (keys from `PERMISSIONS`) | admins |
| `meta/workspace` | `version` (2 once upgraded), `defaultProjectId` | admins |
| `projectRequests/{autoId}` | `name`, `key`, `description`, `requestedBy`, `fromProjectId`, `status` (`pending`·`approved`·`declined`), `decidedBy`, `projectId` | members with *request projects* create; admins decide |
| `accessRequests/{email}` | `email`, `requestedAt` | the verified user themselves; admins delete |
| `profiles/{email}` | `name`, `username`, `bio`, `title`, `availability`, `timezone`, `lastActive`, `createdAt` | the user themselves |
| `projects/{pid}/meta/counters` | `ticketNumber` (only ever increases) | members who can edit tickets, inside the create transaction |
| `projects/{pid}/config/settings` | `labels[{name, color}]`, `types[{key, label, icon, color, enabled}]` (*manage content*); `staleDays`, `wipLimits{status: n}`, `dodItems[{id, text}]`, `dodRequired[id]` (*manage workflow*); `discordWebhookUrl`, `weeklySummary` (*manage integrations*); `updatedBy`, `updatedAt` | by permission group |
| `projects/{pid}/sprints/{autoId}` | `name`, `goal`, `start`, `end`, `status` (`planned`·`active`·`closed`), `createdBy`, `createdAt` | *manage sprints* |
| `projects/{pid}/templates/{autoId}` | `name`, `type`, `priority`, `labels`, `reviewers`, `description`, `order`, `enabled`, `updatedBy`, `updatedAt`. None saved = the built-in `DEFAULT_TEMPLATES` | *manage content* |
| `notifications/{autoId}` | `to`, `by`, `type` (`mention`), `projectId`, `ticketFid`, `ticketId`, `ticketTitle`, `text`, `createdAt`, `read` | sender creates (as themselves, to a teammate); only the recipient reads, marks read or deletes. Index in `firestore.indexes.json` |

---

## Roles and permissions

Two levels:

- **Workspace role** (`allowlist`): `admin` can do everything everywhere,
  including creating projects, editing roles and permanently deleting
  archived tickets; `member` can only do what their project role allows.
- **Project role** (`projects/{pid}.members[email]` → `roles/{roleId}`):
  a set of permissions. `can(pid, permission)` in `firestore.rules` and
  `can(permission)` in `core/permissions.js` check the same thing.

| Permission | Allows | PM | Tech lead | Dev · QA · Designer | Viewer |
|---|---|:-:|:-:|:-:|:-:|
| `editTickets` | create, edit and move tickets | ✓ | ✓ | ✓ | |
| `comment` | comment and @mention | ✓ | ✓ | ✓ | ✓ |
| `closeTickets` | move any ticket to Done | ✓ | ✓ | | |
| `archiveTickets` | archive / restore | ✓ | ✓ | | |
| `moderateComments` | hide or delete others' comments | ✓ | ✓ | | |
| `manageSprints` | sprints | ✓ | ✓ | | |
| `manageContent` | labels, ticket types, templates | ✓ | ✓ | | |
| `manageWorkflow` | Definition of Done, WIP, stale | ✓ | | | |
| `manageMembers` | the project's members and their roles | ✓ | | | |
| `manageIntegrations` | Discord, weekly summary | ✓ | | | |
| `requestProjects` | ask an admin for a new project | ✓ | | | |

Workflow rules apply on top, for everyone: *In review* needs a reviewer;
*Done* needs `closeTickets` or being a reviewer who isn't the owner, and a
complete Definition of Done.

Source of truth: `firestore.rules`. UI mirror: `core/permissions.js`,
`core/workflow.js` (`moveBlockedReason`). Adding a permission means adding
it to `PERMISSIONS` (and the defaults in `DEFAULT_ROLES`) in
`core/constants.js`, using it in the rules, and testing it in
`tests/firestore.rules.test.js`.

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
- **Names, not strings:** `WORKSPACE_ROLES.ADMIN`, `STATUS.DONE`, `COLLECTIONS.TICKETS`,
  `ACTIVITY.BLOCKED` from `core/constants.js`.
- **Every file starts with a header comment** saying what it does.
- Event handlers for re-rendered lists use **one delegated listener** on
  the container (see `comments.js`, `manage/members.js`), not one per row.
- **Manage sections** render into a fresh container each time and set
  `root.dataset.dirty = '1'` when there are unsaved edits, so live updates
  never overwrite someone's work in progress (`manage/index.js`).

---

## Common changes

**Add a label, ticket type or template** — no code change: do it in
Manage (per project). `DEFAULT_LABELS`, `DEFAULT_TYPES` and
`DEFAULT_TEMPLATES` in `core/constants.js` are only the starting point for
a project that hasn't saved its own. A new type icon goes in
`TYPE_ICON_CHOICES` (and `core/icons.js`).

**Add a role** — no code change: Manage → Roles.

**Add a Manage section** — write a `render(root, goTo)` function in
`features/manage/`, then add it to `SECTIONS` in `manage/index.js` with
who can see it (`visible`) and which events should refresh it.

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
npm run test:rules     # 53 security-rules tests against the Firestore emulator
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
`allowlist` with `role: admin` in the Firestore emulator. The app then
walks you through creating the first project. Real data is never touched.

**The end-to-end test** (`tests/e2e/app.e2e.test.js`) has two parts.
Part 1 starts from an empty workspace: an admin creates the first project
and adds a project manager, developers and a viewer, and then each of them
works through the main flows in order — templates and escaping, workflow
locks, reviewers, blocking, comments and @mentions, notifications, Manage
(workflow, labels, types, integrations, sprints, templates), checklists and
the Definition of Done, viewer restrictions, editing a role, requesting
and approving a project, switching projects, archive, views, access
requests, shortcuts and sign-out. Part 2 seeds a board in the old
single-board layout and runs **Upgrade now**. When you add a feature, add
a step.

**The demo test** (`tests/e2e/demo.e2e.test.js`) opens `/demo/`, creates
and moves a ticket, switches between people with different roles, checks
that reloading starts over, and fails if the page contacts anything other
than this site and Google Fonts.

**The public demo** (`public/demo/`) is the same app with a different data
layer underneath: `demo/backend.js` defines `window.firebase` with the
small part of the compat API that `data/` uses (collections, documents,
queries, live listeners, batches, transactions, server timestamps and a
signed-in user), all in memory. The app code doesn't know the difference,
so new features appear in the demo automatically. If a feature starts using
a Firestore feature the stand-in lacks (a new query operator, say), the
demo test fails; add it to `backend.js`. Sample data lives in `demo/seed.js`.

**Continuous integration** (`.github/workflows/`):

| Workflow | When | Does |
|---|---|---|
| `deploy.yml` | push to `main` | runs both test suites; deploys hosting only if they pass |
| `firebase-hosting-pull-request.yml` | pull request | runs both test suites; posts a preview link (not for Dependabot) |
| `weekly-summary.yml` | Mondays 07:00 UTC, or manually | posts the weekly summary to Discord |

Firestore rules and indexes are deployed by hand (`npm run deploy:rules`).
Dependabot (`.github/dependabot.yml`) groups dependency updates into one
pull request a week.
