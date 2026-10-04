# Devflow

A lightweight real-time team Kanban board with authentication, role-based access control, live collaboration, dashboards, and ticket discussions.

Devflow turns a simple board into a multi-user project management app:

- Team members log in with email and password
- Only approved users can access the workspace
- Tickets sync instantly between users
- Admins control team access and roles
- Everyone can collaborate through comments and updates

Built with:

- **Firebase** — authentication, database, real-time synchronization, and hosting
- **GitHub** — source code, with automatic deploys to Firebase Hosting

Setup takes approximately **20–30 minutes** — see [SETUP.md](SETUP.md), then [SECURITY.md](SECURITY.md).

---

## Features

### Kanban Board

Manage work through a simple workflow:

### Backlog → In progress → In review → Done

Includes:

- Ticket creation, with templates (bug report, feature request, security issue, maintenance task, business analysis)
- Ticket editing
- Status changes
- Search
- Filtering
- Priority tracking

---

### Project moderation

- **Workflow rules** — a ticket needs a reviewer before it can move to In review, and only its reviewer, a PM, or an admin can move it to Done (enforced in the database rules, not just the UI)
- **Archive instead of delete** — archived tickets keep their comments and activity log; admins/PMs can restore them, and only admins can permanently delete one
- **Blocked flag** — mark a ticket blocked with a reason; it's highlighted on the board, the dashboard, and in Discord
- **Stale tickets** — tickets with no activity in In progress / In review for a configurable number of days are flagged
- **Work-in-progress limits** — set a maximum per column; the column turns red when it's over
- **Comment moderation** — authors can edit their own comments; admins/PMs can hide inappropriate ones

---

### Look and feel

- Light and dark themes — follows your computer's setting, with a toggle in the top bar
- Tickets open in a side panel, so the board stays in view
- Works on phones: columns swipe sideways, filters scroll in one row
- Keyboard friendly: `/` jumps to search, Esc closes panels, Enter opens a focused ticket

---

### Dashboard

Track project progress with:

- Total tickets
- Open tickets
- Overdue tickets
- Blocked and stale tickets
- Completion rate
- Status breakdown
- Priority breakdown
- Per-owner workload view

---

### Team Management

Admins can manage access from the Team tab.

Capabilities:

- Approve new users
- Deny access requests
- Add team members directly
- Change user roles
- Remove users
- Configure board settings (Discord webhook, WIP limits, stale threshold)

---

### Collaboration

Approved users can:

- Create tickets
- Edit ticket details
- Move tickets between stages
- Comment on tickets
- See changes instantly

---

### Authentication

Users can:

- Register with email/password (email must be verified)
- Sign in securely
- Change their password
- Reset forgotten passwords through email

---

## Requirements

You need:

- A Google account
- A GitHub account
- A Firebase account
- [Node.js](https://nodejs.org) on the computer you deploy from (for the Firebase CLI)

No credit card is required.

---

## For developers

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how the code is organised, the data model, roles and permissions, and how to make common changes.
- **[SECURITY.md](SECURITY.md)** — how the app is protected and the one-time hardening checklist.
- **[SETUP.md](SETUP.md)** — setting up your own copy from scratch.

The site is plain HTML, CSS and JavaScript modules in `public/` (no build step). Development tools are optional:

```bash
npm install          # emulators, test runner, deploy scripts (needs Node 20+, Java 11+)
npm test             # automated tests for the Firestore security rules
npm run emulators    # local throwaway Firebase
npm run serve        # then open http://localhost:5050/?emulators
```

Every pull request and push to `main` runs the tests on GitHub Actions; `main` deploys to Firebase Hosting only when they pass.
