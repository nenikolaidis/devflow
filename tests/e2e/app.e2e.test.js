/* =========================================================
   End-to-end test — drives the real app in headless Chrome against the
   local Firebase emulators (throwaway data, project "demo-devflow").

     npm run test:e2e        (needs Java 11+ and Google Chrome)

   It signs in as an admin, a developer, an unverified user and an
   outsider, and walks through the main flows: tickets and templates,
   workflow rules, reviewers, checklists, Definition of Done, sprints,
   @mentions and notifications, archive, team approval, settings and
   shortcuts. Steps run in order and share state, like a real session.

   Chrome: set CHROME_PATH if it isn't in the usual place.
========================================================= */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const PROJECT = 'demo-devflow';
const PORT = 5050;
const BASE = `http://localhost:${PORT}/?emulators`;
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const PASSWORD = 'correct-horse-battery';
const CHROME = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');

/* ---------------- tiny static server for public/ ---------------- */
const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(PUBLIC, path === '' ? 'index.html' : path);
  if(!file.startsWith(PUBLIC)){ res.writeHead(403).end(); return; }
  try{
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  }catch{ res.writeHead(404).end(); }
});

/* ---------------- emulator helpers ---------------- */
async function resetEmulators(){
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}
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

/* ---------------- browser helpers ---------------- */
let browser;
const errors = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function openApp(label){
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  page.on('console', m => { if(m.type() === 'error') errors.push(`[${label}] ${m.text()}`); });
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  return page;
}
async function signIn(page, email){
  await page.waitForSelector('#authEmail', { visible: true });
  await page.type('#authEmail', email);
  await page.type('#authPassword', PASSWORD);
  await page.click('#authSubmit');
}
/** Live updates re-render the board, so find and click in one step. */
async function clickWhere(page, selector, containing = ''){
  await page.waitForFunction((s, c) => [...document.querySelectorAll(s)].some(e => e.textContent.includes(c)), { timeout: 10000 }, selector, containing);
  await page.evaluate((s, c) => [...document.querySelectorAll(s)].find(e => e.textContent.includes(c)).click(), selector, containing);
}
const until = (page, fn, ...args) => page.waitForFunction(fn, { timeout: 10000 }, ...args);
const text = (page, sel) => page.$eval(sel, el => el.textContent.trim());
const isVisible = (page, sel) => page.$eval(sel, el => !el.classList.contains('hidden') && el.offsetParent !== null).catch(() => false);
const toastSays = (page, words) => until(page, w => document.querySelector('#toast').textContent.includes(w), words);
const closeDialog = async (page) => { await page.keyboard.press('Escape'); await until(page, () => !document.querySelector('.modal-overlay')); };

/* ================================================================== */
describe('devflow end to end', { concurrency: false }, () => {
  let admin, dev;
  const evil = '"><img src=x onerror="window.__xss=1">';

  before(async () => {
    await new Promise(resolve => server.listen(PORT, resolve));
    await resetEmulators();
    await createUser('admin@team.dev', { role: 'admin' });
    await createUser('dev@team.dev', { role: 'developer' });
    await createUser('dev2@team.dev', { role: 'developer' });
    await createUser('unverified@team.dev', { verified: false });
    await createUser('outsider@team.dev');
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });
  });
  after(async () => {
    if(browser) await browser.close();
    server.close();
  });

  /* ---------- sign-in gate ---------- */
  it('an admin signs in and sees the board with four columns and the Team tab', async () => {
    admin = await openApp('admin');
    await signIn(admin, 'admin@team.dev');
    await admin.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
    await until(admin, () => document.querySelectorAll('.column:not(.skeleton)').length === 4);
    assert.ok(await isVisible(admin, '#navTeam'));
  });

  it('an unverified user is asked to confirm their email', async () => {
    const page = await openApp('unverified');
    await signIn(page, 'unverified@team.dev');
    await page.waitForSelector('#verifyScreen:not(.hidden)', { timeout: 15000 });
  });

  /* ---------- tickets ---------- */
  it('a template fills the form, and a malicious title is shown as text', async () => {
    await admin.click('#newTicketBtn');
    await admin.waitForSelector('.modal #f-title');
    await admin.select('#f-template', 'business_analysis');
    await sleep(100);
    assert.match(await admin.$eval('#f-desc', el => el.value), /^## Business objective/);
    assert.equal(await admin.$eval('#f-type', el => el.value), 'analysis');
    await admin.type('#f-title', evil);
    await admin.type('#f-owner', 'dev@team.dev');
    await admin.click('.form-save');
    await until(admin, () => document.querySelectorAll('.card').length === 1);
    assert.equal(await text(admin, '.card .card-id'), 'TASK-001');
    assert.equal(await text(admin, '.card-title'), evil);
    assert.equal(await admin.evaluate(() => window.__xss), undefined);
  });

  it('In review is locked until the ticket has a reviewer', async () => {
    await clickWhere(admin, '.card');
    await admin.waitForSelector('.status-track');
    const reason = await admin.$eval('.status-track button[data-status=in_review]', el => el.classList.contains('locked') && el.title);
    assert.match(reason, /Add a reviewer/);
    await closeDialog(admin);
  });

  it('editing keeps a quoted title intact, shows the owner by name, and adds a reviewer chip', async () => {
    await clickWhere(admin, '.card');
    await admin.waitForSelector('[data-act=edit]');
    await admin.click('[data-act=edit]');
    await admin.waitForSelector('#f-title');
    assert.equal(await admin.$eval('#f-title', el => el.value), evil);
    assert.equal(await admin.$eval('#f-owner', el => el.dataset.value), 'dev@team.dev');
    await admin.type('#f-reviewers-input', 'dev2@team.dev');
    await admin.keyboard.press('Enter');
    assert.equal((await admin.$$('#f-reviewers-chips .person-chip')).length, 1);
    await admin.click('.form-save');
    await until(admin, () => !document.querySelector('.modal-overlay'));
  });

  it('a ticket with a reviewer moves to In review', async () => {
    await sleep(400);
    await clickWhere(admin, '.card');
    await admin.waitForSelector('.status-track button[data-status=in_review]:not(.locked)');
    await admin.click('.status-track button[data-status=in_review]');
    await until(admin, () => [...document.querySelectorAll('.column')][2].querySelectorAll('.card').length === 1);
    await until(admin, () => !document.querySelector('.modal-overlay')); // the panel closes after a move
  });

  it('marking blocked asks for a reason in a dialog and flags the card', async () => {
    await clickWhere(admin, '.card');
    await admin.waitForSelector('[data-act=block]');
    await admin.click('[data-act=block]');
    await admin.waitForSelector('#dlg-input');
    await admin.click('.dlg-ok');
    assert.ok((await text(admin, '.dlg-error')).length > 0, 'an empty reason is refused');
    await admin.type('#dlg-input', 'Waiting for client API keys');
    await admin.click('.dlg-ok');
    await admin.waitForSelector('.card .flag-blocked', { timeout: 10000 });
    await until(admin, () => !document.querySelector('.modal-overlay'));
  });

  /* ---------- comments & mentions ---------- */
  it('comments are shown as text, can be edited, and @mentions notify the person', async () => {
    await clickWhere(admin, '.card');
    await admin.waitForSelector('#commentInput');
    await admin.type('#commentInput', 'Please check <b>this</b> @dev');
    await admin.waitForSelector('#mentionList:not(.hidden)');
    await admin.keyboard.press('Enter'); // picks the suggestion
    assert.match(await admin.$eval('#commentInput', el => el.value), /@dev@team\.dev $/);
    await admin.click('#postComment');
    await until(admin, () => document.querySelector('.comment-body .mention'));
    assert.match(await text(admin, '.comment-body'), /<b>this<\/b>/);
    await admin.click('button[data-action=edit]');
    await admin.waitForSelector('#dlg-input');
    await admin.$eval('#dlg-input', el => { el.value = 'Edited comment'; });
    await admin.click('.dlg-ok');
    await until(admin, () => document.querySelector('.comment-head').textContent.includes('edited'));
    await admin.click('#tabActivity');
    await until(admin, () => document.querySelectorAll('.activity-entry').length >= 4);
    const log = await admin.$$eval('.activity-entry', els => els.map(e => e.textContent).join(' | '));
    for(const words of ['created', 'reviewers', 'moved status', 'marked this blocked']) assert.ok(log.includes(words), `activity mentions "${words}"`);
    await closeDialog(admin);
  });

  it('the mentioned developer sees a notification and can open the ticket from it', async () => {
    dev = await openApp('dev');
    await signIn(dev, 'dev@team.dev');
    await dev.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
    assert.equal(await isVisible(dev, '#navTeam'), false, 'developers do not see the Team tab');
    await until(dev, () => document.querySelector('#notifCount').textContent === '1');
    await dev.click('#notifBtn');
    await dev.waitForSelector('.notif-item.unread');
    await clickWhere(dev, '.notif-item'); // the list re-renders as profiles load
    await dev.waitForSelector('.modal.drawer');
    await until(dev, () => document.querySelector('#notifCount').classList.contains('hidden'));
    await closeDialog(dev);
  });

  /* ---------- settings, sprints, checklist, Definition of Done ---------- */
  it('an admin saves board settings: WIP limit, a label and a Definition of Done item', async () => {
    await admin.click('#navTeam');
    await admin.waitForSelector('#setWipLimits input');
    await admin.$eval('#setWipLimits input[data-status=in_progress]', el => { el.value = '1'; });
    await admin.click('#addLabelBtn');
    await admin.type('#setLabels .settings-row:last-child .label-name', 'mobile');
    await admin.click('#addDodBtn');
    await admin.type('#setDod .settings-row:last-child .dod-text', 'Tests added');
    await admin.$eval('#setWebhook', el => { el.value = 'https://evil.example/x'; });
    await admin.click('#saveSettingsBtn');
    await toastSays(admin, "doesn't look like");
    await admin.$eval('#setWebhook', el => { el.value = ''; });
    await admin.click('#saveSettingsBtn');
    await toastSays(admin, 'Settings saved');
  });

  it('an admin creates an active sprint', async () => {
    await admin.click('#navBoard');
    await admin.waitForSelector('#manageSprintsBtn:not(.hidden)');
    await admin.click('#manageSprintsBtn');
    await admin.waitForSelector('#sp-name');
    await admin.type('#sp-name', 'Sprint 1');
    await admin.type('#sp-goal', 'Ship the beta');
    await admin.click('#sp-save');
    await until(admin, () => document.querySelector('.sprint-row') && document.querySelector('.sprint-row').textContent.includes('Sprint 1'));
    await closeDialog(admin);
  });

  it('a new ticket can be planned into the sprint, with two reviewers and a checklist', async () => {
    await admin.click('#newTicketBtn');
    await admin.waitForSelector('#f-title');
    await admin.type('#f-title', 'Dev ticket');
    await admin.type('#f-owner', 'dev@team.dev');
    await admin.$eval('#f-desc', el => { el.value = '- [ ] Write code\n- [x] Plan it'; });
    await admin.evaluate(() => { const s = document.querySelector('#f-sprint'); s.value = [...s.options].find(o => o.textContent.includes('Sprint 1')).value; });
    for(const r of ['dev@team.dev', 'dev2@team.dev']){ await admin.type('#f-reviewers-input', r); await admin.keyboard.press('Enter'); }
    assert.equal((await admin.$$('#f-reviewers-chips .person-chip')).length, 2);
    await admin.click('.form-save');
    await until(admin, () => [...document.querySelectorAll('.card-id')].some(e => e.textContent === 'TASK-002'));
    const badge = await admin.evaluate(() => [...document.querySelectorAll('.card')].find(c => c.textContent.includes('TASK-002')).querySelector('.checklist-badge').textContent.trim());
    assert.equal(badge, '1/2');
  });

  it('the sprint filter shows only the sprint\'s tickets', async () => {
    await admin.evaluate(() => { const s = document.querySelector('#sprintFilter'); s.value = [...s.options].find(o => o.textContent.includes('Sprint 1')).value; s.dispatchEvent(new Event('change')); });
    await until(admin, () => document.querySelectorAll('.card').length === 1);
    assert.match(await text(admin, '.card .card-id'), /TASK-002/);
    await admin.select('#sprintFilter', '');
    await until(admin, () => document.querySelectorAll('.card').length === 2);
  });

  it('moving into a full column shows the WIP counter at its limit', async () => {
    await clickWhere(admin, '.card', 'TASK-002');
    await admin.waitForSelector('.status-track button[data-status=in_progress]');
    await admin.click('.status-track button[data-status=in_progress]');
    await until(admin, () => document.querySelector('.column-wip') && document.querySelector('.column-wip').textContent.trim() === '1/1');
    await until(admin, () => !document.querySelector('.modal-overlay'));
  });

  it('the developer cannot close their own ticket, and sees it in My work', async () => {
    await clickWhere(dev, '.card', 'TASK-002');
    await dev.waitForSelector('.status-track');
    assert.equal(await dev.$('[data-act=archive]'), null, 'developers cannot archive');
    const reason = await dev.$eval('.status-track button[data-status=done]', el => el.classList.contains('locked') ? el.title : '');
    assert.match(reason, /You own/);
    await closeDialog(dev);
    await dev.click('#navMyWork');
    await until(dev, () => [...document.querySelectorAll('.work-row')].some(r => r.textContent.includes('TASK-002')));
  });

  it('ticking checklist and Definition of Done items in the panel unlocks Done', async () => {
    await clickWhere(admin, '.card', 'TASK-002');
    await admin.waitForSelector('#detailDesc input[data-line]');
    await admin.evaluate(() => document.querySelector('#detailDesc input[data-line]:not(:checked)').click());
    await sleep(600);
    assert.equal(await admin.$$eval('#detailDesc input[data-line]:checked', els => els.length), 2);
    const reason = await admin.$eval('.status-track button[data-status=done]', el => el.classList.contains('locked') ? el.title : '');
    assert.match(reason, /Definition of Done/, 'even admins need the Definition of Done');
    await admin.evaluate(() => document.querySelector('#dodList input[data-dod]').click());
    await until(admin, () => !document.querySelector('.status-track button[data-status=done]').classList.contains('locked'));
    await admin.click('.status-track button[data-status=done]');
    await until(admin, () => [...document.querySelectorAll('.column')][3].textContent.includes('TASK-002'));
    await until(admin, () => !document.querySelector('.modal-overlay'));
  });

  /* ---------- archive, views, dashboard ---------- */
  it('archiving asks for confirmation, hides the ticket, and the Archived toggle shows it', async () => {
    await clickWhere(admin, '.card', 'TASK-001');
    await admin.waitForSelector('[data-act=archive]');
    await admin.click('[data-act=archive]');
    await admin.waitForSelector('.dlg-ok');
    await admin.click('.dlg-ok');
    await until(admin, () => ![...document.querySelectorAll('.card-id')].some(e => e.textContent === 'TASK-001'));
    await until(admin, () => !document.querySelector('.modal-overlay'));
    await admin.click('#archivedToggleBtn');
    await admin.waitForSelector('.card.archived');
    await admin.click('#archivedToggleBtn');
  });

  it('the table view and the dashboard render', async () => {
    await admin.click('#viewTableBtn');
    await admin.waitForSelector('#ticketTable:not(.hidden) table');
    await admin.click('#viewKanbanBtn');
    await admin.click('#navDashboard');
    await admin.waitForSelector('.stat-card');
    await admin.waitForSelector('.sprint-panel');
  });

  /* ---------- team approval ---------- */
  it('an outsider requests access and the admin approves them live', async () => {
    const outsider = await openApp('outsider');
    await signIn(outsider, 'outsider@team.dev');
    await outsider.waitForSelector('#pendingScreen:not(.hidden)', { timeout: 15000 });
    await outsider.click('#requestAccessBtn');
    await until(outsider, () => document.querySelector('#requestAccessBtn').disabled);
    await admin.click('#navTeam');
    await admin.waitForSelector('.request-row', { timeout: 10000 });
    await admin.click('.request-row button[data-action=approve]');
    await until(admin, () => document.querySelectorAll('.allow-row').length === 4);
  });

  /* ---------- shortcuts, menus, sign-out ---------- */
  it('keyboard shortcuts: ? shows help, G then B goes to the board, N opens a new ticket', async () => {
    await admin.click('body');
    await admin.keyboard.type('?');
    await admin.waitForSelector('.shortcut-list');
    await closeDialog(admin);
    await admin.keyboard.press('g');
    await admin.keyboard.press('b');
    await until(admin, () => !document.querySelector('#boardView').classList.contains('hidden'));
    await admin.keyboard.press('n');
    await admin.waitForSelector('.modal #f-title');
    await closeDialog(admin);
  });

  it('the account menu opens, closes with Esc, and signs out cleanly', async () => {
    await admin.click('#userMenuBtn');
    await admin.waitForSelector('#userMenu:not(.hidden)');
    await admin.keyboard.press('Escape');
    assert.ok(await admin.$eval('#userMenu', el => el.classList.contains('hidden')));
    await admin.click('#userMenuBtn');
    await admin.waitForSelector('#signOutBtn', { visible: true });
    await admin.click('#signOutBtn');
    await admin.waitForSelector('#authScreen:not(.hidden)', { timeout: 10000 });
    assert.equal(await admin.$('.modal-overlay'), null);
  });

  it('no JavaScript errors happened along the way', () => {
    const real = errors.filter(e => !/favicon|Failed to load resource|PERMISSION_DENIED/.test(e));
    assert.deepEqual(real, []);
  });
});
