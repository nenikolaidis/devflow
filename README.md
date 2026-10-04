# Devflow

A lightweight real-time team Kanban board with authentication, role-based access control, live collaboration, dashboards, and ticket discussions.

Devflow turns a simple board into a multi-user project management app:

- Team members log in with email and password
- Only approved users can access the workspace
- Tickets sync instantly between users
- Admins control team access and roles
- Everyone can collaborate through comments and updates

Built with:

- **Firebase** — authentication, database, and real-time synchronization
- **GitHub Pages** — free hosting for the web application

Setup takes approximately **10–15 minutes**.

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

- Register with email/password
- Sign in securely
- Change their password
- Reset forgotten passwords through email

---

## Requirements

You need:

- A Google account
- A GitHub account
- A Firebase account

No credit card is required.
