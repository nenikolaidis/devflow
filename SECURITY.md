# Security

devflow runs entirely in the browser and talks straight to Firebase, so
its security has to hold even when someone reads — or rewrites — the
JavaScript. This document explains how that works, what you need to
configure when you deploy your own copy, and how to report a problem.

---

## Reporting a vulnerability

If you find a security issue, please **don't open a public issue**. Use
GitHub's private reporting instead: this repository → **Security** →
**Report a vulnerability**. I'll acknowledge it as soon as I can and credit
you in the fix if you'd like.

---

## How devflow is protected

### The principle

The browser code is public and can be modified by anyone, so it's never
trusted. **Every permission and every data check that matters is enforced by
Firestore security rules** (`firestore.rules`), which run on Google's
servers. The UI mirrors those rules only to explain *why* something isn't
allowed.

### The layers

| Layer | Protects against | Where |
|---|---|---|
| **Firestore security rules** | Reading or changing data you shouldn't; malformed or oversized data; skipping the workflow | `firestore.rules` — covered by 69 automated tests |
| **Verified email + allowlist** | Someone registering a teammate's address before they do; strangers signing up and reading data | Rules (`email_verified`, `allowlist`) + `features/auth.js` |
| **Escaping everywhere** | Cross-site scripting from ticket titles, comments, names, links | `core/html.js` (auto-escaping templates), `core/markdown.js` (escapes before formatting), `safeUrl()` (only `http(s)` links) |
| **Content-Security-Policy** | Injected scripts, data sent to unknown servers, the app being framed | `firebase.json` headers |
| **Subresource Integrity** | A compromised CDN serving altered Firebase/EmailJS scripts | `integrity` hashes in `public/index.html` |
| **Security headers** | Clickjacking, MIME sniffing, leaking URLs, indexing by search engines | `firebase.json` (HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `noindex`) |
| **No secrets in the repo** | Credentials leaking from a public repository | Webhook stored in Firestore; deploy and summary keys in GitHub Secrets |
| **API key restriction + App Check** | Your Firebase project being called from anywhere other than your site | Google Cloud / Firebase console (checklist below) |
| **CI gate** | A change that breaks the rules or the app reaching production | GitHub Actions run the rules tests and the browser test before every deploy |

### What the rules enforce

- **Access:** only signed-in users with a **verified** email who are on the **allowlist** can read or write anything (apart from requesting access for themselves).
- **Tickets:** every field is type- and size-checked; links must be `http(s)`; unknown fields are rejected; `id`, `number`, `createdBy` and `createdAt` never change; new tickets must take their number from a shared counter in the same transaction, so ids can't collide.
- **Workflow:** *In review* needs at least one reviewer. *Done* can only be set by a PM/admin, or by a listed reviewer who isn't the ticket's owner. If a Definition of Done is configured, every item must be ticked first — for everyone.
- **Archive and delete:** only admins/PMs archive or restore; only admins permanently delete, and only archived tickets.
- **Comments, mentions, activity:** posted as yourself only; comments are capped at 5,000 characters; the activity log can never be edited or deleted.
- **Notifications:** sent as yourself, only to approved teammates; only the recipient can read them or mark them read.
- **Sprints and settings:** sprints are managed by admins/PMs; roles, the allowlist and board settings by admins only; the Discord webhook must be a Discord URL.
- **Profiles:** you can only write your own, and every field is size-limited.

### What's public, and what isn't

The repository is public: anyone can read *how* devflow works. The
Firebase web config in `public/js/config.js` (API key, project id) is not a
secret — every Firebase web app sends it to the browser.

What a visitor who isn't on your team can see: the sign-in page. Nothing
else — no tickets, names, comments, settings or team list.

---

## Hardening checklist for your deployment

Work through this once after [SETUP.md](SETUP.md). Each step says where to
click. Replace `<project-id>` with your Firebase project id.

### 1. Keep secrets out of the repository

- Never commit Discord webhook URLs, service-account keys, `.env` files or real ticket data. The webhook belongs in **Team → Board settings**; keys belong in **GitHub → Settings → Secrets**.
- If a webhook or key was ever committed, treat it as leaked: delete it (Discord → channel → Integrations → Webhooks, or Google Cloud → the service account → Keys) and create a new one. Removing it from the code doesn't remove it from git history.
- The EmailJS public key is designed to be public. In EmailJS → **Account → Security**, allow only your site's domain.

### 2. GitHub repository settings

1. **Settings → Code security**: turn on **Dependabot alerts**, **Secret scanning**, **Push protection** and **Private vulnerability reporting**.
2. **Settings → Branches → Add branch ruleset** for `main`: require a pull request before merging, require the *Tests* status check, block force pushes, restrict deletions.
3. **Settings → Collaborators**: only people who should be able to change the code.
4. If you previously used GitHub Pages, set **Settings → Pages → Source** to **None** so an old copy isn't served.

### 3. Firebase Authentication

Firebase console → **Authentication → Settings**:

1. **Password policy** → **Require enforcement**, minimum length **10** (matches `MIN_PASSWORD_LENGTH` in `public/js/config.js`).
2. **User actions** → keep **Email enumeration protection** on.
3. **Authorized domains** → keep only `<project-id>.web.app`, `<project-id>.firebaseapp.com`, any custom domain you use, and `localhost`.

Accounts created before email verification was required must confirm their email once: they'll see a **Confirm your email** screen on their next sign-in.

### 4. Restrict the API key to your site

Google Cloud console → your project → **APIs & Services → Credentials** →
**Browser key (auto created by Firebase)**:

1. **Application restrictions → Websites**: `https://<project-id>.web.app/*`, `https://<project-id>.firebaseapp.com/*` (and `http://localhost/*` only if you develop against the real project).
2. **API restrictions → Restrict key**: Identity Toolkit API, Token Service API, Cloud Firestore API, Firebase Installations API, Firebase App Check API.
3. **Save** (changes take a few minutes).

### 5. Turn on App Check

App Check proves requests come from your site, so someone with a stolen sign-in can't script against your project.

1. Create a **reCAPTCHA v3** key for your site's domains (Google Cloud → **Security → reCAPTCHA**).
2. Firebase console → **App Check → Apps** → your web app → **reCAPTCHA v3** → paste the **secret key**.
3. Put the **site key** in `APP_CHECK_RECAPTCHA_SITE_KEY` in `public/js/config.js`; commit and push.
4. Watch **App Check → APIs → Cloud Firestore** for a day or two. When nearly all requests are verified, click **Enforce**.

### 6. Least-privilege keys

- The **deploy** key created by `firebase init hosting:github` can only deploy hosting.
- The **weekly summary** key should have only the **Cloud Datastore Viewer** role — read-only. Don't give it Editor or Owner.
- Rotate either key from Google Cloud → IAM → Service Accounts → Keys if it may have leaked, then update the GitHub secret.

### 7. Rules and indexes are deployed deliberately

CI never deploys `firestore.rules`. After changing them:

```bash
npm test               # rules tests + browser test
npm run deploy:rules   # publishes rules and indexes
```

Deploy rules **before** code that depends on them.

### 8. Budget alert

Google Cloud console → **Billing → Budgets & alerts** → a $1 budget with email alerts. The free plan doesn't charge, but you'll know if usage ever spikes.

---

## Ongoing habits

- **Review the Team tab regularly.** Removing someone from the allowlist cuts their access immediately, even if they're signed in.
- **Changing the rules?** Add a test to `tests/firestore.rules.test.js` for the new behaviour — both what's allowed and what's refused.
- **Upgrading a CDN script** in `public/index.html`: change the version, then regenerate its hash and paste `sha384-<output>` into `integrity`:

  ```bash
  curl -s <script-url> | openssl dgst -sha384 -binary | openssl base64 -A
  ```

  A wrong hash stops the app loading — check the browser console after deploying.
- **Adding an external service** (another CDN, API or webhook domain)? Allow its domain in the `Content-Security-Policy` in `firebase.json`, or the browser will block it.
- **Rendering user content?** Always through `html\`\`` (or `renderMarkdown` for descriptions). Never build markup by concatenating strings.
