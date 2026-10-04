# Devflow — security guide

How Devflow is protected, and the one-time settings an admin needs to
apply in GitHub, Firebase and Google Cloud. Work through the checklist
top to bottom; each step says where to click.

## How the protection works

| Layer | What it protects | Where it lives |
|---|---|---|
| **Firestore rules** | All data: who can read/write what, and what shape the data must have | `firestore.rules` |
| **Verified email** | Stops someone registering a teammate's address before they do | Rules + `public/js/auth.js` |
| **Private repo** | Your code and its history | GitHub settings |
| **Firebase Hosting headers** | Limits which scripts/connections the page can use; blocks framing; asks search engines not to index | `firebase.json` |
| **Pinned scripts (SRI)** | If a CDN is ever tampered with, the browser refuses the changed script | `public/index.html` |
| **API key restriction + App Check** | Only your site can call your Firebase project | Google Cloud / Firebase console |

The Firebase config in `public/js/firebase-init.js` (API key, project id)
is **not a secret** — every Firebase web app sends it to the browser.
Security comes from the rules and the restrictions below, not from hiding it.

What a non-member can see: the login page at your site's address. Nothing
else — no tickets, names, comments or team list.

---

## Checklist

### 1. Rotate the Discord webhook (urgent)

The old webhook URL is in this repo's git history, which was public.

1. Discord → your channel → **Edit Channel → Integrations → Webhooks** → delete the old webhook.
2. Create a new one and copy its URL.
3. After deploying (step 5), sign in as an admin → **Team → Board settings** → paste it → **Send test** → **Save settings**.

The new URL is stored in Firestore, never in the code.

### 2. Make the GitHub repo private

1. GitHub → the repo → **Settings → General** → scroll to **Danger Zone → Change repository visibility → Make private**.
2. **Settings → Pages** → under *Build and deployment*, set **Source** to **None** (or delete the Pages site) — the app moves to Firebase Hosting.
3. **Settings → Branches → Add branch ruleset** (or *branch protection rule*) for `main`:
   - Require a pull request before merging
   - Block force pushes
   - Restrict deletions
4. **Settings → Code security**: turn on **Dependabot alerts** and **Dependabot security updates**. Turn on **Secret scanning / push protection** if your plan offers it.
5. **Settings → Collaborators**: check only the people who should see the code are listed.

> Making the repo private hides the history going forward, but anyone who
> already cloned it keeps a copy. That's why step 1 (rotating the webhook)
> matters even after the repo is private.

### 3. Require verified emails — and verify your own account

The rules now only let **verified** email addresses in. Accounts created
before this change are probably unverified, **including yours**.

1. Open the site and sign in. You'll see **"Confirm your email"**.
2. Click **Resend email**, open the link in your inbox, then click **I've confirmed it — continue**.
3. Tell your teammates they'll see the same screen once.

### 4. Firebase Authentication settings

Firebase console → **Authentication → Settings**:

1. **Password policy** → enable **Require enforcement**; set minimum length **10** (matches `MIN_PASSWORD_LENGTH` in `public/js/utils.js`). Optionally require upper/lower case and a number.
2. **User actions** → keep **Email enumeration protection** **on** (stops attackers checking which emails have accounts).
3. **Authorized domains** → keep `devflow-board-11146.web.app`, `devflow-board-11146.firebaseapp.com` and `localhost`. **Remove** `nenikolaidis.github.io` once the move is done.

### 5. Host on Firebase Hosting (deploys from the private repo)

One-time setup on your computer (needs [Node.js](https://nodejs.org)):

```bash
npm install -g firebase-tools
firebase login
cd devflow
firebase deploy --only hosting,firestore:rules
```

Your site is now at **https://devflow-board-11146.web.app**.

Automatic deploys on every push to `main` (`.github/workflows/deploy.yml`):

1. Run `firebase init hosting:github` in the repo folder and follow the prompts for **nenikolaidis/devflow.github.io**. It creates a deploy-only service account and saves it as a GitHub secret. Say **No** when it offers to overwrite `firebase.json` or the workflow files.
2. In GitHub → **Settings → Secrets and variables → Actions**, check the secret's name. If it isn't `FIREBASE_SERVICE_ACCOUNT`, rename it, or update the name in `.github/workflows/deploy.yml`.
3. Push to `main` → GitHub → **Actions** tab shows the deploy.

Firestore **rules are not deployed automatically**, on purpose. After
changing `firestore.rules`, run:

```bash
firebase deploy --only firestore:rules
```

(Or paste the file into Firebase console → Firestore → Rules → Publish.)

### 6. Restrict the API key to your site

Google Cloud console → select project **devflow-board-11146** →
**APIs & Services → Credentials** → click the **Browser key (auto created by Firebase)**:

1. **Application restrictions** → **Websites**, and add:
   - `https://devflow-board-11146.web.app/*`
   - `https://devflow-board-11146.firebaseapp.com/*`
   - `http://localhost/*` (only if you test locally)
2. **API restrictions** → **Restrict key** → tick:
   - Identity Toolkit API
   - Token Service API
   - Cloud Firestore API
   - Firebase Installations API
   - Firebase App Check API
3. **Save**. Changes take a few minutes to apply.

### 7. Turn on App Check (recommended)

App Check proves requests come from your site, so a script run against
your project with a stolen login can't use it.

1. Google Cloud console → **Security → reCAPTCHA** (or [google.com/recaptcha/admin](https://www.google.com/recaptcha/admin)) → create a **reCAPTCHA v3** key for `devflow-board-11146.web.app` and `devflow-board-11146.firebaseapp.com`.
2. Firebase console → **App Check → Apps** → your web app → **reCAPTCHA v3** → paste the **secret key** → Save.
3. Paste the **site key** into `APP_CHECK_RECAPTCHA_SITE_KEY` in `public/js/firebase-init.js`, commit, and let it deploy.
4. Firebase console → **App Check → APIs** → watch **Cloud Firestore** metrics for a day or two. When nearly all requests show as *verified*, click **Enforce**. (Enforcing earlier would lock out anyone still on the old page.)

### 8. Budget alert (cheap insurance)

Google Cloud console → **Billing → Budgets & alerts** → create a budget of
e.g. $1 with email alerts. On the free Spark plan nothing is charged, but
the alert tells you if usage ever spikes.

---

## Ongoing habits

- **Review the Team tab monthly.** Remove people who've left (Team → Remove). Removing them from the allowlist cuts their access immediately, even if they're still signed in.
- **Never commit credentials** (service account keys, `.env` files). `.gitignore` blocks the common names.
- **Changing `firestore.rules`?** Deploy it right after the matching code, and test with a developer account, not just admin.
- **Upgrading a CDN script** (Firebase SDK or EmailJS) in `public/index.html`: change the version in the URL, then regenerate its integrity hash:

  ```bash
  curl -s <script-url> | openssl dgst -sha384 -binary | openssl base64 -A
  ```

  and put `sha384-<output>` in the script's `integrity` attribute. A wrong hash means the script is blocked and the app won't load, so check the browser console after deploying.
- **Adding a new external service** (another CDN, API or webhook domain)? Add its domain to the `Content-Security-Policy` header in `firebase.json`, or the browser will block it.

## What the rules enforce (summary)

- Only **verified, approved** users can read or write anything (except their own access request).
- **Tickets:** fields are type- and size-checked; links must be `http(s)`; ids come from a shared counter checked by the rules; `id`, `number`, `createdBy` and `createdAt` can't change.
- **Workflow:** In review needs a reviewer; Done can only be set by a PM/admin, or by the reviewer if they aren't also the owner.
- **Archive:** only admins/PMs archive or restore; only admins permanently delete, and only archived tickets.
- **Comments and activity:** posted as yourself only; activity can't be edited or deleted; comments are capped at 5,000 characters.
- **Team and settings:** only admins change roles, the allowlist or board settings; profiles are self-only and size-limited.
