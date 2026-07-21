# Devflow — setup guide

This turns the board into a real multi-user app: your team logs in with
email + password, and only people you approve can see or edit tickets.
Changes sync to everyone instantly.

It has two parts:
1. **Firebase** (free) — handles login and stores the tickets in real time.
2. **GitHub Pages** (free) — hosts the app so your team can open it in a browser.

Total setup time: about 10–15 minutes, one time only.

## Project structure

```
devflow/
├── index.html          ← markup only
├── firestore.rules      ← paste into Firebase's Rules tab (step 3)
├── css/
│   └── style.css        ← all styling
└── js/
    ├── app.js            ← entry point, just loads the other modules
    ├── firebase-init.js  ← your Firebase config goes here (step 5)
    ├── notify.js         ← your EmailJS config goes here (step 9, optional)
    ├── discord.js        ← your Discord webhook goes here (step 10, optional)
    ├── state.js          ← shared app state
    ├── constants.js      ← statuses, priorities, labels
    ├── utils.js          ← small helper functions
    ├── auth.js           ← login/signup/password/access requests
    ├── profiles.js       ← user profiles (name, username, bio, time zone)
    ├── tickets.js         ← board, table view, ticket form, comments
    ├── dashboard.js      ← stats view
    └── team.js           ← allow list + access request management
```

Keep this exact folder structure when you upload to GitHub — the files
reference each other by relative path (e.g. `js/app.js` imports
`./tickets.js`), so nothing should be flattened into one folder.

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
3. Go to the **Rules** tab and replace the contents with everything in `firestore.rules` (included alongside this guide). Click **Publish**.

## 4. Add yourself as the first admin

Rules only let admins add other people — so you need to add yourself directly, once:

1. In Firestore, click **Start collection**, name it `allowlist`.
2. For the **document ID**, enter your own email address, all lowercase (e.g. `you@company.com`).
3. Add a field: name `role`, type `string`, value `admin`. Save.

## 5. Get your web app config

1. Left sidebar: click the gear icon → **Project settings**.
2. Under **Your apps**, click the `</>` (web) icon to register a new web app. Any nickname is fine — you don't need Firebase Hosting.
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
4. Open `js/firebase-init.js`, find the `firebaseConfig` block near the top, and replace the placeholder values with your real ones.

## 6. Put it on GitHub

1. Create a new GitHub repository (public or private both work).
2. Upload the **entire `devflow` folder contents** — `index.html`, `firestore.rules`, the `css/` folder, and the `js/` folder — keeping the same structure. On github.com you can drag the whole folder onto the "Add file → Upload files" screen and it will preserve subfolders; with `git`, just `git add .` from inside the folder and push.
3. Go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to `Deploy from a branch`, branch `main`, folder `/ (root)`. Save.
5. GitHub gives you a URL like `https://yourusername.github.io/your-repo-name/` — that's your live board.

## 7. Allow that domain in Firebase

1. Back in Firebase: **Authentication → Settings → Authorized domains**.
2. Click **Add domain** and add `yourusername.github.io` (no `https://`, no trailing path).

## 8. Try it

1. Open your GitHub Pages URL.
2. Sign up with your own email (the one you added to `allowlist`) — you'll land straight in the board.
3. Have a teammate sign up with their email — they'll see a "pending approval" screen, where they can click **Request access**.
4. As an admin, open the **Team** tab — you'll see their request under "Pending requests." Pick a role and click **Approve** (or **Deny**).
5. They reload the page and they're in. From then on, everyone sees ticket changes, comments, and status moves in real time.

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
6. Open `js/notify.js` and fill in `EMAILJS_PUBLIC_KEY`, `EMAILJS_SERVICE_ID`, and `EMAILJS_TEMPLATE_ID` with the three values above.
7. Re-upload `js/notify.js` to GitHub. Assigning someone to a ticket (via the new-ticket form, the Edit button, or the ✏️ quick-edit on a card) now emails them — as long as their account email looks like a real email address (it always will, since assignees come from your team's actual login emails).

If you skip this step, the app quietly does nothing when a ticket is assigned — no errors, no broken UI, just no email.

---

## 10. (Optional) Turn on Discord notifications

This posts to a Discord channel whenever a ticket is **created**, **assigned**, or **deleted**, with an `@here` ping if the ticket is Critical priority. No account or API key needed beyond your own Discord server.

1. In Discord, go to your server → the channel you want notifications in → **Edit Channel** (gear icon) → **Integrations** → **Webhooks** → **New Webhook**.
2. Give it a name/avatar if you like, then click **Copy Webhook URL**.
3. Open `js/discord.js` and paste that URL into `DISCORD_WEBHOOK_URL`.
4. Re-upload `js/discord.js` to GitHub. Try creating a test ticket — it should show up in the channel within a second or two.

**Security note**: this webhook URL lives in your site's public source code (anyone who views your page source can see it), and anyone who has it can post messages to that channel — there's no way to restrict it to your app the way EmailJS's public key can be domain-restricted. If that's a concern:
- Keep the GitHub repo **private** (GitHub Pages still works from a private repo on paid plans; on free plans, private repos can't publish Pages sites, so weigh this against how sensitive the channel is).
- Or accept the small risk for an internal tool — if it's ever abused, delete the webhook in Discord and create a new one (old URL immediately stops working).

If you skip this step, the app quietly does nothing on ticket create/assign/delete — no errors, no broken UI, just no Discord message.

---

## What's included

- **Board** — kanban view with **4 stages**: Backlog → In progress → In review → Done. (Simplified from the earlier 6-stage version — old tickets in Todo/Code review/Testing display correctly under their new stage automatically; nothing needs migrating by hand.) Also a sortable **Table** view, both respecting the same filters.
- **Ticket templates** — starting a new ticket, pick "Bug report," "Feature request," "Security issue," "Maintenance task," or blank; each pre-fills a structured description and sensible default priority/labels, fully editable afterward.
- **Activity log** — every ticket has a read-only audit trail: created, status moves, (re)assignments, and edits, each with who and when. Nobody — not even admins — can edit or delete an entry; it's meant to be a trustworthy record.
- **Kanban upgrades**: drag cards between columns, quick-edit (✏️ on a card) for priority/owner/labels without opening the full ticket, multi-select for bulk status changes or deletes (**Select** button), collapsible columns, sort-by dropdown (newest, oldest, priority, due date, title), and an assignee filter — on top of the live sync, per-column counts, priority colors, avatars, due-date flags, and labels that were already there.
- **User profiles** — each teammate has a profile: name, username, bio, time zone, and auto-tracked last-active time, plus lists of tickets they're assigned to or created. Open your own via the **Profile** button (editable); view a teammate's from the Team tab (read-only). Avatars are initials with a consistent per-person color — no image uploads needed.
- **Assignment emails** — optional, see step 9 above.
- **Discord notifications** — optional, see step 10 above. Posts to a channel on ticket create/assign/delete, with an `@here` ping for Critical-priority tickets.
- **Labels** — bug, feature, security, maintenance, documentation, testing, frontend, backend, database. Multi-select on any ticket.
- **Assignee search** — Owner and Reviewer are a searchable dropdown pulled from your approved team roster (type to filter); you can still type a free-text name if someone doesn't have an account yet.
- **Merge request / issue link** — an optional URL field on each ticket, shown as a clickable link above the comments section.
- **Comments** — with delete (your own comments, or any comment if you're an Admin/PM), with a confirmation prompt first.
- **Dashboard** — total/open/overdue ticket counts, completion rate, breakdowns by status and priority, and a per-owner table.
- **Team tab** (admins only) — approve or deny access requests, add people directly, change anyone's role, remove them, or view their profile.
- **Account menu** — change your password in-app, or use "Forgot password?" on the login screen for a reset email.

## Notes

- **Costs**: Firebase's free "Spark" plan comfortably covers a small team's ticket board — no credit card required.
- **Roles**: Administrator and Project manager can delete tickets; everyone approved can create, view, edit, comment on, and move tickets, matching the access rules in your process doc.
- **File structure**: the app was split from one big `index.html` into `css/style.css` plus focused JS modules under `js/` (see "Project structure" above) purely to make it easier to navigate and edit — the app's behavior is unchanged, plus one small bug fix: switching back to the Board tab now always shows the latest tickets, even if changes came in while you were on Dashboard or Team.
- **If you already deployed an earlier (single-file) version**: this replaces `index.html` entirely and adds the `css/` and `js/` folders — delete the old single-file `index.html` from your repo first, or make sure the new one overwrites it, then re-upload everything together so no file is left stale.
- **If you already deployed an earlier version**: re-publish `firestore.rules` (it now also adds a `profiles` collection and a per-ticket `activity` subcollection — both readable by any approved user, write rules as described in the file's comments), then replace every file in `js/`, `css/style.css`, and `index.html` together so nothing is left stale. Your tickets, allow list, and comments all carry over untouched — including tickets sitting in the old Todo/Code review/Testing stages, which will just display under their new stage without any manual fix-up.
- **Emails and Discord messages are both optional and safe to skip**: if `js/notify.js` or `js/discord.js` are left with placeholder values, the app just quietly does nothing for that channel — nothing else breaks.
- **Losing admin access**: you can always fix roles directly in the Firestore console under the `allowlist` collection.
- **This is not the same as a real Jira/GitHub Issues setup** — there's no audit log, webhooks, or Git integration. It's a lightweight tool matching your documented process.