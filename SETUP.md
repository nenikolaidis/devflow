# Devflow — setup guide

This turns the board into a real multi-user app: your team logs in with
email + password, and only people you approve can see or edit tickets.
Changes sync to everyone instantly.

It has two parts:
1. **Firebase** (free) — handles login and stores the tickets in real time.
2. **GitHub Pages** (free) — hosts the `index.html` file so your team can open it in a browser.

Total setup time: about 10–15 minutes, one time only.

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
4. Open `index.html`, find the `firebaseConfig` block near the top of the `<script>` section, and replace the placeholder values with your real ones.

## 6. Put it on GitHub

1. Create a new GitHub repository (public or private both work).
2. Upload `index.html` to the repo (drag-and-drop on github.com works fine, or `git push`).
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

## What's included

- **Board** — the kanban workflow from before (Backlog → Todo → In progress → Code review → Testing → Done), with search and filters.
- **Dashboard** — total/open/overdue ticket counts, completion rate, breakdowns by status and priority, and a per-owner table.
- **Team tab** (admins only) — approve or deny access requests, add people directly, change anyone's role, or remove them.
- **Ticket edits** — any approved user can now edit a ticket's details after creation, not just move its status.
- **Comments** — a lightweight discussion thread on each ticket.
- **Account menu** — change your password in-app (needs your current password), or use "Forgot password?" on the login screen to get a reset email.

## Notes

- **Costs**: Firebase's free "Spark" plan comfortably covers a small team's ticket board — no credit card required.
- **Roles**: Administrator and Project manager can delete tickets; everyone approved can create, view, edit, comment on, and move tickets, matching the access rules in your process doc.
- **If you already deployed the earlier version**: re-publish the updated `firestore.rules` (it now also covers `accessRequests` and ticket `comments`), then replace `index.html` with the new one — your existing tickets and allow list carry over untouched.
- **Losing admin access**: you can always fix roles directly in the Firestore console under the `allowlist` collection.
- **This is not the same as a real Jira/GitHub Issues setup** — there's no audit log, webhooks, or Git integration. It's a lightweight tool matching your documented process.
