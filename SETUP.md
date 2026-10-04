# Setting up devflow

This guide takes you from nothing to a running board for your team in
about 30 minutes. Everything used here has a free tier and needs no credit
card.

**You'll need:** a Google account (for Firebase), a GitHub account,
and [Node.js](https://nodejs.org) 20+ on the computer you deploy from.

**How it fits together:**

```
GitHub repo ──push──▶ GitHub Actions ──tests pass──▶ Firebase Hosting (the site)
                                                            │
                         browsers ◀──── live sync ────▶ Firestore + Auth
```

When you've finished, work through [SECURITY.md](SECURITY.md) — it's
short, and it's what makes the deployment properly locked down.

---

## Project layout

```
devflow/
├── public/                ← the website — the only folder that gets published
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── config.js      ← every value you might edit (Firebase, App Check, EmailJS)
│   │   └── core/  data/  features/  integrations/
│   └── demo/              ← the public demo (sample data, no database)
├── firestore.rules        ← database security rules — the real security boundary
├── firestore.indexes.json ← database indexes
├── firebase.json          ← hosting, security headers, emulator ports
├── .firebaserc            ← which Firebase project to deploy to
├── tests/                 ← security-rules tests and the end-to-end browser test
├── scripts/               ← the weekly Discord summary job
├── .github/               ← CI/CD workflows and Dependabot
└── *.md                   ← documentation
```

[ARCHITECTURE.md](ARCHITECTURE.md) explains every file.

---

## 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and choose **Add project**.
2. Name it (for example `devflow-board`). Google Analytics isn't needed.

## 2. Turn on email sign-in

**Build → Authentication → Get started → Sign-in method → Email/Password →** enable → **Save**.

## 3. Create the database

**Build → Firestore Database → Create database →** *Production mode*, a region near your team → **Enable**.

(You'll publish the security rules in step 6.)

## 4. Make yourself the first admin

The rules only let admins approve people, so the first admin is added by hand:

1. In Firestore, **Start collection** → name it `allowlist`.
2. **Document ID:** your email address, all lowercase.
3. Add a field `role` (string) = `admin` → **Save**.

## 5. Connect the code to your project

1. **Project settings** (gear icon) → **Your apps** → the `</>` web icon → register an app (any nickname).
2. Copy the `firebaseConfig` values it shows into `FIREBASE_CONFIG` in **`public/js/config.js`**.
3. Put your project id in:
   - `.firebaserc`
   - `.github/workflows/deploy.yml` and `firebase-hosting-pull-request.yml` (`projectId`)
   - `firebase.json` → the `Content-Security-Policy` header → `frame-src https://<project-id>.firebaseapp.com`

These values aren't secrets — every Firebase web app sends them to the browser. The security rules are what protect your data.

## 6. Deploy

```bash
npm install
npx firebase-tools login
npx firebase-tools deploy --only hosting,firestore
```

That publishes the site, the security rules and the database indexes. Your board is now live at **`https://<project-id>.web.app`**.

> If `npm install -g firebase-tools` fails with a permission error on your machine, just use `npx firebase-tools …` as shown.

## 7. Automatic deploys from GitHub

1. Push this folder to a GitHub repository (public is fine — nothing secret is in the code).
2. Run `npx firebase-tools init hosting:github` and follow the prompts. It creates a deploy-only service account and stores it as a GitHub secret named `FIREBASE_SERVICE_ACCOUNT_<PROJECT_ID>`. Answer **No** when it offers to overwrite `firebase.json` or the workflow files.
3. Make sure both workflow files in `.github/workflows/` use that secret name.

From now on:
- **Every pull request** runs the tests (security rules + browser test) and posts a temporary preview link.
- **Every push to `main`** runs the tests and, only if they pass, deploys the site.
- **Rules and indexes are deployed by hand** with `npm run deploy:rules`, so a security change is always a deliberate step.

## 8. Try it

1. Open your site and **Create account** with the email you added in step 4.
2. Confirm your email from the link you receive, then **I've confirmed it — continue**. You're in.
3. devflow asks you to create your **first project**: give it a name and a short key (the key starts every ticket ID, e.g. `WEB-001`). The built-in roles are created at the same time, and you become the project's Project manager.
4. Ask a teammate to sign up. After confirming their email they press **Request access**; you approve them in **Manage → Members**, choosing their role in the project.
5. Look through **Manage** — labels, ticket types, templates and workflow are per project; roles are shared by all projects.

Then read [GUIDE.md](GUIDE.md) for how everything works day to day, and go through [SECURITY.md](SECURITY.md).

---

## Optional extras

### 9. Emails when someone is assigned

Uses [EmailJS](https://www.emailjs.com) (free for about 200 emails a month, no server needed).

1. Create an EmailJS account → **Email Services → Add New Service** → connect a mailbox → note the **Service ID**.
2. **Email Templates → Create New Template** using these variables:

   | Variable | Contains |
   |---|---|
   | `{{to_email}}` | the new owner — put it in the template's **To Email** field |
   | `{{ticket_id}}`, `{{ticket_title}}` | the ticket |
   | `{{actor_email}}` | who assigned it |
   | `{{board_url}}` | a link back to the board |

   For example — subject: `You've been assigned {{ticket_id}}`; body: `{{actor_email}} assigned you {{ticket_id}}: {{ticket_title}}. Open the board: {{board_url}}`. Note the **Template ID**.
3. **Account → API Keys** → copy the **Public Key**.
4. Put the three values in the `EMAILJS` block in `public/js/config.js`, commit and push.
5. In EmailJS → **Account → Security**, allow only your site's domain.

Without this, assignments simply don't send email; nothing else changes.

### 10. Discord notifications

Posts to a channel when a ticket is created, assigned, moved to review, blocked, archived or deleted, and when someone is @mentioned. Critical tickets ping `@here`.

1. In Discord: your channel → **Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL**.
2. In devflow: open the project → **Manage → Integrations → Webhook URL** → paste → **Send test** → **Save integrations**.

Each project has its own webhook, so different projects can post to different channels. The URL is stored in the database, never in the code; only the project's members can read it, and the page keeps it hidden until you press **Show**. If it ever leaks, delete it in Discord and paste a new one — no code change needed.

### 11. (Optional) Weekly Discord summary

Every Monday at 07:00 UTC a GitHub Action posts a recap of each project to that project's Discord channel: what was done this week, what's in progress and in review, what's new, anything blocked, overdue or stale, and the active sprint's progress. It runs on GitHub's free scheduler, so it doesn't need Firebase's paid plan.

1. **Create a read-only key.** Google Cloud console → select your project → **IAM & Admin → Service Accounts → Create service account**.
   - Name: `weekly-summary`
   - Role: **Cloud Datastore Viewer** (read-only access to Firestore — nothing more)
   - Open the new account → **Keys → Add key → Create new key → JSON**. A file downloads.
2. **Store it in GitHub.** Your repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `WEEKLY_SUMMARY_SERVICE_ACCOUNT`
   - Value: paste the *entire* contents of the JSON file.

   Then delete the downloaded file. Never commit it — `.gitignore` blocks common key file names, but don't rely on that.
3. **Switch it on.** In devflow, for each project that wants it: **Manage → Integrations → Weekly summary** → tick → **Save integrations**. Archived projects are skipped.
4. **Try it now.** GitHub → **Actions → Weekly Discord summary → Run workflow**.

To preview the message without posting, run `npm run summary:preview` against the local emulators (see [ARCHITECTURE.md](ARCHITECTURE.md#local-development-and-tests)).

---

## Upgrading from the single-board version

Earlier versions of devflow had one board. If you're running one of those, upgrade in this order:

1. `npm test`, then **`npm run deploy:rules`** — the new rules first. They keep the old data readable (but read-only), so nothing breaks while you upgrade.
2. Push the new code (GitHub deploys it).
3. Sign in as a workspace admin. The board asks you to open **Manage → Overview** and press **Upgrade now**.

The upgrade copies your board — tickets, comments, activity, sprints, settings and the ticket counter — into the first project, keeping the `TASK` key, every ID, author and date. Everyone keeps access: admins and project managers become **Project manager** in the project, developers become **Developer**, and admins stay workspace admins. It checks the counts before finishing, and the original data is left in place as a read-only backup. It only needs to run once, and it's safe to run again if it's interrupted.

## Updating

- **Code:** push to `main`; GitHub tests and deploys it.
- **Security rules or indexes:** `npm test`, then `npm run deploy:rules`. Deploy rules *before* code that depends on them.
- **Dependencies:** Dependabot opens one grouped pull request a week for the development tools; merge it once the tests pass. The site itself has no npm dependencies.

## Costs

The free Spark plan covers a small team comfortably. GitHub Actions minutes for public repositories are free. If you want a safety net, set a $1 budget alert in Google Cloud Billing ([SECURITY.md](SECURITY.md), step 8).
