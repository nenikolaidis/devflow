/* =========================================================
   "Continue with Google" test — headless Chrome against the local
   emulators.

     npm run test:e2e        (needs Java 11+ and Google Chrome)

   The Auth emulator's own pretend-Google window doesn't respond in
   headless Chrome, so after checking that the button really opens it,
   these steps stand in for that window: they give the app an
   (unsigned, emulator-only) Google account. Everything after that —
   devflow's sign-in code, linking, error messages, the gate — is real.
========================================================= */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const PROJECT = 'demo-devflow';
const PORT = 5054;
const BASE = `http://localhost:${PORT}/?emulators`;
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const PASSWORD = 'correct-horse-battery';
const CHROME = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');

/* ---------------- tiny static server for public/ ---------------- */
const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(PUBLIC, path === '' ? 'index.html' : path);
  if(!file.startsWith(PUBLIC)){ res.writeHead(403).end(); return; }
  try{
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  }catch{ res.writeHead(404).end(); }
});

/* ---------------- helpers ---------------- */
async function approve(email){
  const r = await fetch(`${FIRESTORE}/allowlist?documentId=${encodeURIComponent(email)}`, { method: 'POST', headers: OWNER, body: JSON.stringify({ fields: { role: { stringValue: 'member' } } }) });
  assert.ok(r.ok, `could not approve ${email}`);
}
async function passwordAccount(email){
  const r = await fetch(`${AUTH}/accounts`, { method: 'POST', headers: OWNER, body: JSON.stringify({ email, password: PASSWORD, emailVerified: true }) });
  assert.ok(r.ok, `could not create ${email}`);
}
async function providers(email){
  const res = await (await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers: OWNER, body: JSON.stringify({ email: [email] }) })).json();
  return ((res.users || [])[0]?.providerUserInfo || []).map(p => p.providerId).sort();
}
const googleToken = (email) => JSON.stringify({ sub: `google-${email}`, email, email_verified: true });

let browser;
const errors = [];
async function open(label){
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  await page.setViewport({ width: 1300, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  return page;
}
/** Presses "Continue with Google", with the Google window answered by `email` (or failing with `error`). */
async function continueWithGoogle(page, { email = '', error = null } = {}){
  await page.evaluate((token, err) => {
    const a = firebase.auth();
    a.signInWithPopup = async () => {
      if(err){
        const e = new Error(err.code);
        Object.assign(e, err, { credential: err.withCredential ? firebase.auth.GoogleAuthProvider.credential(err.withCredential) : undefined });
        throw e;
      }
      return a.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(token));
    };
  }, googleToken(email), error);
  await page.click('#googleBtn');
}
const visible = (page, id) => page.waitForSelector(`#${id}:not(.hidden)`, { timeout: 15000 });

/* ================================================================== */
describe('Continue with Google', { concurrency: false }, () => {
  before(async () => {
    await new Promise(resolve => server.listen(PORT, resolve));
    await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });
  });
  after(async () => {
    if(browser) await browser.close();
    server.close();
  });

  it('the button opens Google\'s sign-in window', async () => {
    const page = await open('button');
    await page.click('#googleBtn');
    const popup = await browser.waitForTarget(t => t.type() === 'page' && t.url().includes('/emulator/auth/handler'), { timeout: 15000 });
    assert.match(popup.url(), /providerId=google\.com/);
    await (await popup.page()).close();
  });

  it('a new Google user skips the confirmation email and waits for approval — then gets in by themselves', async () => {
    const page = await open('newcomer');
    await continueWithGoogle(page, { email: 'newcomer@gmail.com' });
    await visible(page, 'pendingScreen');
    // Admins see them under "Trying to get in", with a confirmed email.
    let status = {};
    for(let i = 0; i < 40 && !status.fields; i++){ // written a moment after the screen shows
      status = await (await fetch(`${FIRESTORE}/joinStatus/newcomer@gmail.com`, { headers: OWNER })).json();
      if(!status.fields) await new Promise(r => setTimeout(r, 250));
    }
    assert.equal(status.fields.stage.stringValue, 'waiting-approval');
    assert.equal(status.fields.emailVerified.booleanValue, true);
    await approve('newcomer@gmail.com');
    await visible(page, 'app');
  });

  it('someone with a password account who continues with Google keeps the same account', async () => {
    await passwordAccount('has.password@team.dev');
    await approve('has.password@team.dev');
    const page = await open('has-password');
    await continueWithGoogle(page, { email: 'has.password@team.dev' });
    await visible(page, 'app');
    assert.deepEqual(await providers('has.password@team.dev'), ['google.com', 'password']);
  });

  it('if Firebase asks for proof, devflow asks for the password once and links Google', async () => {
    await passwordAccount('link.me@team.dev');
    await approve('link.me@team.dev');
    const page = await open('link');
    await continueWithGoogle(page, { error: { code: 'auth/account-exists-with-different-credential', email: 'link.me@team.dev', withCredential: googleToken('link.me@team.dev') } });
    await page.waitForSelector('#dlg-input[type=password]');
    assert.match(await page.$eval('.modal', el => el.textContent), /already have a devflow password for link\.me@team\.dev/);
    await page.type('#dlg-input', PASSWORD);
    await page.click('.dlg-ok');
    await visible(page, 'app');
    await page.waitForFunction(() => /Google is now linked/.test(document.querySelector('#toast').textContent), { timeout: 10000 });
    assert.deepEqual(await providers('link.me@team.dev'), ['google.com', 'password']);
  });

  it('closing the Google window is quiet; a switched-off Google sign-in says what to do', async () => {
    const page = await open('errors');
    await continueWithGoogle(page, { error: { code: 'auth/popup-closed-by-user' } });
    await new Promise(r => setTimeout(r, 300));
    assert.equal(await page.$eval('#authError', el => el.textContent), '');
    await continueWithGoogle(page, { error: { code: 'auth/operation-not-allowed' } });
    await page.waitForFunction(() => /isn't switched on/.test(document.querySelector('#authError').textContent));
    await continueWithGoogle(page, { error: { code: 'auth/popup-blocked' } });
    await page.waitForFunction(() => /Allow pop-ups/.test(document.querySelector('#authError').textContent));
  });

  it('a Google-only account has no devflow password to change', async () => {
    const page = await open('google-only');
    await approve('only.google@gmail.com');
    await continueWithGoogle(page, { email: 'only.google@gmail.com' });
    await visible(page, 'app');
    await page.evaluate(() => document.querySelector('#accountBtn').click());
    await page.waitForSelector('.modal #acc-who');
    assert.match(await page.$eval('#acc-who', el => el.value), /signs in with Google$/);
    assert.match(await page.$eval('.modal', el => el.textContent), /no devflow password to change/);
    assert.equal(await page.$('#acc-current'), null);
  });

  it('no JavaScript errors happened', () => {
    assert.deepEqual(errors, []);
  });
});
