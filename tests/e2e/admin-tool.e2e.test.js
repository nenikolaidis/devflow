/* =========================================================
   Admin tool test — runs scripts/admin.mjs against the local emulators
   (as `npm run admin -- …` would against the real project) and checks
   the result in the app, in headless Chrome.

     npm run test:e2e        (needs Java 11+ and Google Chrome)

   Covers: check / list explain why someone can't get in; verify confirms
   an email; set-password gives a temporary password that the app makes
   them replace; disable / enable; delete; and that every change lands in
   Manage → Logs → Admin actions.
========================================================= */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const PROJECT = 'demo-devflow';
const PORT = 5053;
const BASE = `http://localhost:${PORT}/?emulators`;
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const PASSWORD = 'correct-horse-battery';
const CHROME = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');
const TOOL = fileURLToPath(new URL('../../scripts/admin.mjs', import.meta.url));

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
/** Runs the admin tool; resolves { code, out } (stdout + stderr). */
const tool = (...args) => new Promise(resolve => {
  execFile(process.execPath, [TOOL, ...args], { env: process.env }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr }));
});
async function createUser(email, { verified = true, role = null } = {}){
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`, {
    method: 'POST', headers: OWNER, body: JSON.stringify({ email, password: PASSWORD, emailVerified: verified })
  });
  assert.ok(r.ok, `could not create ${email}`);
  if(role){
    const a = await fetch(`${FIRESTORE}/allowlist?documentId=${encodeURIComponent(email)}`, {
      method: 'POST', headers: OWNER, body: JSON.stringify({ fields: { role: { stringValue: role } } })
    });
    assert.ok(a.ok, `could not approve ${email}`);
  }
}

let browser;
const errors = [];
async function signIn(email, password){
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${email}] ${e.message}`));
  await page.setViewport({ width: 1300, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.type('#authEmail', email);
  await page.type('#authPassword', password);
  await page.click('#authSubmit');
  return page;
}
const visible = (page, id) => page.waitForSelector(`#${id}:not(.hidden)`, { timeout: 15000 });
const authError = (page) => page.waitForFunction(() => document.querySelector('#authError').textContent, { timeout: 15000 }).then(h => h.jsonValue());

/* ================================================================== */
describe('admin tool (scripts/admin.mjs)', { concurrency: false }, () => {
  let tempPassword;

  before(async () => {
    await new Promise(resolve => server.listen(PORT, resolve));
    await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
    await createUser('stuck@team.dev', { role: 'member' });
    await createUser('unconfirmed@team.dev', { verified: false, role: 'member' });
    await createUser('gone@team.dev', { role: 'member' });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });
  });
  after(async () => {
    if(browser) await browser.close();
    server.close();
  });

  it('refuses unknown commands and missing emails', async () => {
    assert.notEqual((await tool('frobnicate')).code, 0);
    assert.notEqual((await tool('set-password')).code, 0);
  });

  it('check explains what is wrong, and what to do', async () => {
    const stuck = await tool('check', 'Stuck@Team.dev');
    assert.equal(stuck.code, 0, stuck.out);
    assert.match(stuck.out, /Sign-in account\s+exists · email confirmed · enabled/);
    assert.match(stuck.out, /devflow access\s+Member/);
    assert.match(stuck.out, /in no project/);
    const nobody = await tool('check', 'nobody@team.dev');
    assert.match(nobody.out, /NONE — they need to "Create account" first/);
    assert.match(nobody.out, /Add them in Manage → Members/);
    assert.match((await tool('check', 'unconfirmed@team.dev')).out, /npm run admin -- verify unconfirmed@team\.dev/);
  });

  it('list shows every account and whether it can get in', async () => {
    const { code, out } = await tool('list');
    assert.equal(code, 0, out);
    for(const e of ['stuck@team.dev', 'unconfirmed@team.dev', 'gone@team.dev']) assert.ok(out.includes(e), e);
    assert.match(out, /3 accounts/);
  });

  it('verify confirms an email, and the waiting "Confirm your email" page continues by itself', async () => {
    const page = await signIn('unconfirmed@team.dev', PASSWORD);
    await visible(page, 'verifyScreen');
    assert.equal((await tool('verify', 'unconfirmed@team.dev')).code, 0);
    await visible(page, 'app'); // no button press, no reload
  });

  it('check spots a look-alike address (Gmail ignores dots; devflow can\'t)', async () => {
    await createUser('jane.doe@gmail.com');
    await fetch(`${FIRESTORE}/allowlist?documentId=janedoe@gmail.com`, { method: 'POST', headers: OWNER, body: JSON.stringify({ fields: { role: { stringValue: 'member' } } }) });
    const { out } = await tool('check', 'jane.doe@gmail.com');
    assert.match(out, /Look-alike\s+you approved janedoe@gmail\.com/);
    assert.match(out, /Approve jane\.doe@gmail\.com in Manage → Members \(and remove janedoe@gmail\.com\)/);
  });

  it('an old temporary-password marker doesn\'t follow a deleted and re-created account', async () => {
    // Left behind when an account is deleted in the Firebase console instead of with the tool.
    await fetch(`${FIRESTORE}/passwordResets?documentId=recreated@team.dev`, { method: 'POST', headers: OWNER,
      body: JSON.stringify({ fields: { by: { stringValue: 'admin tool' }, requiredAt: { timestampValue: new Date(Date.now() - 86400000).toISOString() } } }) });
    await createUser('recreated@team.dev', { role: 'member' });
    await visible(await signIn('recreated@team.dev', PASSWORD), 'app');
  });

  it('set-password gives a temporary password, and the app makes them choose their own', async () => {
    const { code, out } = await tool('set-password', 'stuck@team.dev');
    assert.equal(code, 0, out);
    tempPassword = (out.match(/^\s+([A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4})\s*$/m) || [])[1];
    assert.ok(tempPassword, `a temporary password is printed:\n${out}`);
    assert.match(await authError(await signIn('stuck@team.dev', PASSWORD)), /^Wrong email or password/, 'the old password stops working');

    const page = await signIn('stuck@team.dev', tempPassword);
    await visible(page, 'newPasswordScreen');
    await page.type('#npNew', 'my own password 1');
    await page.type('#npConfirm', 'something else');
    await page.click('#npSave');
    await page.waitForFunction(() => /don't match/.test(document.querySelector('#npError').textContent));
    await page.$eval('#npConfirm', el => { el.value = ''; });
    await page.type('#npConfirm', 'my own password 1');
    await page.click('#npSave');
    await visible(page, 'app');

    const again = await signIn('stuck@team.dev', 'my own password 1');
    await visible(again, 'app'); // no second prompt
    assert.match(await authError(await signIn('stuck@team.dev', tempPassword)), /^Wrong email or password/, 'the temporary password is gone');
  });

  it('disable stops someone signing in; enable lets them back', async () => {
    assert.equal((await tool('disable', 'gone@team.dev')).code, 0);
    assert.match(await authError(await signIn('gone@team.dev', PASSWORD)), /switched off/);
    assert.equal((await tool('enable', 'gone@team.dev')).code, 0);
    await visible(await signIn('gone@team.dev', PASSWORD), 'app');
  });

  it('delete removes the sign-in account', async () => {
    assert.equal((await tool('delete', 'gone@team.dev', '--yes')).code, 0);
    assert.match((await tool('check', 'gone@team.dev')).out, /NONE/);
  });

  it('every change is in Manage → Logs → Admin actions, without the password', async () => {
    const res = await fetch(`${FIRESTORE}/logs?pageSize=50`, { headers: OWNER });
    const docs = (await res.json()).documents || [];
    const types = docs.map(d => d.fields.type.stringValue);
    for(const t of ['account-verified', 'account-temp-password', 'account-disabled', 'account-enabled', 'account-deleted']) assert.ok(types.includes(t), t);
    assert.ok(!JSON.stringify(docs).includes(tempPassword), 'the temporary password is never logged');
  });

  it('no JavaScript errors happened', () => {
    assert.deepEqual(errors, []);
  });
});
