# Devflow — setup guide

This turns the board into a real multi-user app: your team logs in with
email + password, and only people you approve can see or edit tickets.
Changes sync to everyone instantly.

It has three parts:
1. **Firebase** (free) — handles login, stores the tickets in real time, and hosts the app.
2. **A GitHub repo** (public or private) — holds the code; every push to `main` deploys automatically. No secrets are stored in it.
3. **SECURITY.md** — one-time hardening settings. Do these after setup.

Total setup time: about 20–30 minutes, one time only.

## Project structure

```
devflow/
├── firebase.json          ← Firebase Hosting config, security headers, emulator ports
├── .firebaserc            ← which Firebase project to deploy to
├── firestore.rules        ← database security rules (the real security boundary)
├── package.json           ← dev tools only: emulators, tests, deploy scripts
├── tests/                 ← automated tests for firestore.rules
├── .github/workflows/     ← run tests + deploy on push / pull request
├── ARCHITECTURE.md        ← how the code is organised (start here as a developer)
├── SECURITY.md            ← security checklist
└── public/                ← the website (only this folder is published)
    ├── index.html
    ├── css/style.css
    └── js/
        ├── config.js      ← every value you might edit: Firebase, App Check, EmailJS
        ├── app.js         ← entry point
        ├── core/          ← shared building blocks (no database code)
        ├── data/          ← all Firestore reads, writes and live listeners
        ├── features/      ← one file per screen or part of a screen
        └── integrations/  ← Discord and email notifications
```

ARCHITECTURE.md explains each file. Keep the folder structure — files
import each other by relative path.

---

## 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with any Google account.
2. Click **Add project**, give it a name (e.g. `devflow-board`), and finish the wizard (you can disable Google Analytics, it's not needed).

## 2. Turn on email/password login

1. In the left sidebar: **Build → Authentication → Get started**.
2. Under **Sign-in method**, click **Email/Password**, enable it, and save.

## 3. Create the database

1. Left sidebar: **Build → Firestore Database → Create database**.
2. Choose **Production mode**, pick any region close to your team, and click **Enable**.
3. Publish the rules: either run `firebase deploy --only firestore:rules` (step 6), or go to the **Rules** tab, replace the contents with everything in `firestore.rules`, and click **Publish**.

## 4. Add yourself as the first admin

Rules only let admins add other people — so you need to add yourself directly, once:

1. In Firestore, click **Start collection**, name it `allowlist`.
2. For the **document ID**, enter your own email address, all lowercase (e.g. `you@company.com`).
3. Add a field: name `role`, type `string`, value `admin`. Save.

## 5. Get your web app config

1. Left sidebar: click the gear icon → **Project settings**.
2. Under **Your apps**, click the `</>` (web) icon to register a new web app. Any nickname is fine.
3. Firebase shows a `firebaseConfig` object like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "devflow-board.firebaseapp.com",
     projectId: "devflow-board",
     storageBucket: "devflow-board.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   };
   ```
4. Open `public/js/config.js` and replace the values in `FIREBASE_CONFIG` with yours. Also put your project id in `.firebaserc`, `.github/workflows/deploy.yml`, and the `frame-src` part of the `Content-Security-Policy` in `firebase.json` (`https://<project-id>.firebaseapp.com`).

## 6. Deploy to Firebase Hosting

On your computer (needs [Node.js](https://nodejs.org)):

```bash
npm install -g firebase-tools
firebase login
cd devflow
firebase deploy --only hosting,firestore:rules
```

Your board is now live at `https://<project-id>.web.app`. That domain is
already an authorized login domain, so there's nothing to add in Firebase.

## 7. Keep the code on GitHub, with auto-deploy

1. Create a GitHub repository (public is fine — nothing secret is in the code) and push this folder to it.
2. In the folder, run `firebase init hosting:github` and follow the prompts. It creates a deploy-only service account and stores it as a GitHub secret. Say **No** when asked to overwrite `firebase.json` or the workflow files.
3. The CLI names the secret `FIREBASE_SERVICE_ACCOUNT_<PROJECT_ID>` (GitHub → **Settings → Secrets and variables → Actions**). Make sure both workflow files in `.github/workflows/` use that name.
4. From now on, every push to `main` runs the security-rules tests and, if they pass, deploys the site (watch it in the **Actions** tab). Pull requests get the same tests plus a temporary preview link. Rules changes are deployed by hand with `npm run deploy:rules`, so they're always a deliberate step.

## 8. Try it

1. Open your `https://<project-id>.web.app` URL.
2. Sign up with your own email (the one you added to `allowlist`). You'll get a **confirmation email** — click the link, then **I've confirmed it — continue**. You'll land in the board.
3. Have a teammate sign up with their email. After confirming their email they'll see a "pending approval" screen, where they can click **Request access**.
4. As an admin, open the **Team** tab — you'll see their request under "Pending requests." Pick a role and click **Approve** (or **Deny**).
5. They reload the page and they're in. From then on, everyone sees ticket changes, comments, and status moves in real time.
6. Now work through **SECURITY.md**.

---

## 9. (Optional) Turn on assignment emails

Without this step, everything else works fine — tickets just won't email anyone. This step wires up EmailJS so that whenever someone is assigned as a ticket's **Owner**, they get an email. It's free for up to ~200 emails/month and needs no backend server.

1. Go to [emailjs.com](https://www.emailjs.com) and create a free account.
2. **Email Services** → **Add New Service** → connect an email account (Gmail, Outlook, or any SMTP). Note the **Service ID** it gives you.
3. **Email Templates** → **Create New Template**. Set the template up however you like, using these variables (click to insert them, or type them as `{{variable_name}}`):
   - `{{to_email}}` — put this in the template's **To Email** field so EmailJS knows where to send it
   - `{{ticket_id}}`, `{{ticket_title}}` — which ticket
   - `{{actor_email}}` — who made the assignment
   - `{{board_url}}` — a link back to your board
   
   Example subject: `You've been assigned {{ticket_id}}`
   Example body: `{{actor_email}} assigned you to {{ticket_id}}: {{ticket_title}}. View it here: {{board_url}}`
4. Save the template and note its **Template ID**.
5. **Account → API Keys** — copy your **Public Key**.
6. Open `public/js/config.js` and fill in `publicKey`, `serviceId` and `templateId` in the `EMAILJS` block with the three values above.
7. Commit and push `public/js/config.js` (it deploys automatically). Assigning someone to a ticket (via the new-ticket form, the Edit button, or the ✏️ quick-edit on a card) now emails them — as long as their account email looks like a real email address (it always will, since assignees come from your team's actual login emails).

If you skip this step, the app quietly does nothing when a ticket is assigned — no errors, no broken UI, just no email.

---

## 10. (Optional) Turn on Discord notifications

This posts to a Discord channel whenever a ticket is **created**, **assigned**, **blocked**, **archived**, or **permanently deleted**, with an `@here` ping if the ticket is Critical priority.

1. In Discord, go to your server → the channel you want notifications in → **Edit Channel** (gear icon) → **Integrations** → **Webhooks** → **New Webhook**.
2. Give it a name/avatar if you like, then click **Copy Webhook URL**.
3. In Devflow, sign in as an admin and open **Team → Board settings**.
4. Paste the URL into **Discord webhook URL**, click **Send test** to check it, then **Save settings**.

The URL is saved in Firestore (`config/settings`), **not** in the site's code, so it isn't visible to the public. Only approved teammates can read it (their browsers need it to post messages). If it's ever leaked or abused, delete the webhook in Discord, create a new one, and paste the new URL into Board settings — no code change or re-upload needed.

If you skip this step, the app quietly does nothing on these events — no errors, no broken UI, just no Discord message.

---

## What's included

- **Board** — kanban view with **4 stages**: Backlog → In progress → In review → Done. (Simplified from the earlier 6-stage version — old tickets in Todo/Code review/Testing display correctly under their new stage automatically; nothing needs migrating by hand.) Also a sortable **Table** view, both respecting the same filters.
- **Ticket templates** — starting a new ticket, pick "Bug report," "Feature request," "Security issue," "Maintenance task," or blank; each pre-fills a structured description and sensible default priority/labels, fully editable afterward.
- **Ticket templates** also include **Business analysis** (objective, stakeholders, as-is / to-be process, requirements, acceptance criteria, KPIs, assumptions, risks), tagged with the `analysis` label.
- **Activity log** — every ticket has a read-only audit trail: created, status moves, (re)assignments, edits, blocked/unblocked, archived/restored, each with who and when. Nobody — not even admins — can edit or delete an entry; it's meant to be a trustworthy record.
- **Workflow rules** — moving to **In review** requires a reviewer; only the ticket's reviewer, a PM, or an admin can move it to **Done**. Enforced by `firestore.rules`, so it can't be bypassed from the browser console.
- **Archive instead of delete** — admins/PMs archive tickets (hidden from board and dashboard, history kept). Use the **Archived** button on the board to show them; admins/PMs can **Restore**, and only admins can **Delete permanently** an archived ticket.
- **Blocked flag** — anyone can mark a ticket blocked (a reason is required) or unblock it.
- **Stale tickets & WIP limits** — set in **Team → Board settings**. Defaults: stale after 5 days; WIP limits of 5 for In progress and 3 for In review.
- **Comment moderation** — authors can edit their own comments (shown as "edited"); admins/PMs can hide or unhide any comment.
- **Ticket numbers** come from a shared counter (`meta/counters`), so two people creating tickets at the same moment never get the same `TASK-###` id. It's created automatically the first time someone makes a ticket.

> **After updating the app**, paste the latest `firestore.rules` into Firebase (step 3) and click **Publish** — the new features depend on those rules.
- **Kanban upgrades**: drag cards between columns, quick-edit (✏️ on a card) for priority/owner/labels without opening the full ticket, multi-select for bulk status changes or archiving (**Select** button), collapsible columns, sort-by dropdown (newest, oldest, priority, due date, title), and an assignee filter — on top of the live sync, per-column counts, priority colors, avatars, due-date flags, and labels that were already there.
- **User profiles** — each teammate has a profile: name, username, bio, time zone, and auto-tracked last-active time, plus lists of tickets they're assigned to or created. Open your own via the **Profile** button (editable); view a teammate's from the Team tab (read-only). Avatars are initials with a consistent per-person color — no image uploads needed.
- **Assignment emails** — optional, see step 9 above.
- **Discord notifications** — optional, see step 10 above. Posts to a channel on ticket create/assign/block/archive/delete, with an `@here` ping for Critical-priority tickets.
- **Labels** — bug, feature, security, maintenance, documentation, testing, frontend, backend, database, analysis. Multi-select on any ticket.
- **Assignee search** — Owner and Reviewer are a searchable dropdown pulled from your approved team roster (type to filter); you can still type a free-text name if someone doesn't have an account yet.
- **Merge request / issue link** — an optional URL field on each ticket, shown as a clickable link above the comments section.
- **Comments** — edit your own; delete your own (or any comment if you're an Admin/PM), with a confirmation prompt first; Admins/PMs can also hide/unhide comments.
- **Dashboard** — total/open/overdue/blocked/stale ticket counts, completion rate, lists of blocked and stale tickets, breakdowns by status and priority, and a per-owner table.
- **Team tab** (admins only) — approve or deny access requests, add people directly, change anyone's role, remove them, view their profile, and edit **Board settings** (Discord webhook, stale threshold, WIP limits).
- **Account menu** — change your password in-app (at least 10 characters), or use "Forgot password?" on the login screen for a reset email.
- **Email verification** — new accounts must confirm their email address before they can request or get access.

## Notes

- **Costs**: Firebase's free "Spark" plan comfortably covers a small team's ticket board — no credit card required.
- **Roles**: Administrator and Project manager can archive/restore tickets, move any ticket to Done, and moderate comments; only Administrators can permanently delete an archived ticket. Everyone approved can create, view, edit, comment on, and move tickets (within the workflow rules).
- **File structure**: the app was split from one big `index.html` into `css/style.css` plus focused JS modules under `js/` (see "Project structure" above) purely to make it easier to navigate and edit — the app's behavior is unchanged, plus one small bug fix: switching back to the Board tab now always shows the latest tickets, even if changes came in while you were on Dashboard or Team.
- **If you already deployed an earlier (single-file) version**: this replaces `index.html` entirely and adds the `css/` and `js/` folders — delete the old single-file `index.html` from your repo first, or make sure the new one overwrites it, then re-upload everything together so no file is left stale.
- **If you already deployed an earlier version**: re-publish `firestore.rules` (it now also adds a `profiles` collection and a per-ticket `activity` subcollection — both readable by any approved user, write rules as described in the file's comments), then replace every file in `js/`, `css/style.css`, and `index.html` together so nothing is left stale. Your tickets, allow list, and comments all carry over untouched — including tickets sitting in the old Todo/Code review/Testing stages, which will just display under their new stage without any manual fix-up.
- **Emails and Discord messages are both optional and safe to skip**: if the EmailJS values in `public/js/config.js` are left as placeholders or no Discord webhook is saved in Board settings, the app just quietly does nothing for that channel — nothing else breaks.
- **Losing admin access**: you can always fix roles directly in the Firestore console under the `allowlist` collection.
- **This is not the same as a real Jira/GitHub Issues setup** — there's no audit log, webhooks, or Git integration. It's a lightweight tool matching your documented process.