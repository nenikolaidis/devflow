/* =========================================================
   End-to-end test — drives the real app in headless Chrome against the
   local Firebase emulators (throwaway data, project "demo-devflow").

     npm run test:e2e        (needs Java 11+ and Google Chrome)

   Part 1 starts from an empty workspace: an admin creates the first
   project, adds people with different roles, and everyone works through
   the main flows — tickets and templates, workflow rules, reviewers,
   checklists, Definition of Done, sprints, @mentions and notifications,
   archive, role permissions, project requests and switching, access
   requests and shortcuts. Steps run in order and share state, like a
   real session.
   Part 2 seeds a board in the old single-board layout and runs the
   in-app "Upgrade to projects".

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
/** Writes a document as the emulator owner (bypasses the rules). */
async function seed(path, fields){
  const r = await fetch(`${FIRESTORE}/${path}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  assert.ok(r.ok, `could not seed ${path}: ${await r.text()}`);
}
const str = (v) => ({ stringValue: v });
const int = (v) => ({ integerValue: String(v) });
const arr = (...v) => ({ arrayValue: { values: v } });
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
const contexts = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function openApp(label){
  const ctx = await browser.createBrowserContext();
  contexts.push(ctx);
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

/** Opens Manage and one of its sections. */
async function manage(page, section){
  await page.click('#navManage');
  await clickWhere(page, `#manageNav [data-section=${section}]`);
  await until(page, s => document.querySelector(`#manageNav [data-section=${s}].active`), section);
}
const navSections = (page) => page.$$eval('#manageNav [data-section]', els => els.map(e => e.dataset.section));
const cardIds = (page) => page.$$eval('.card .card-id', els => els.map(e => e.textContent.trim()));
async function signedIn(label, email){
  const page = await openApp(label);
  await signIn(page, email);
  await page.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
  return page;
}

/* ================================================================== */
describe('devflow end to end — projects', { concurrency: false }, () => {
  let admin, pm, dev, viewer;
  const evil = '"><img src=x onerror="window.__xss=1">';

  before(async () => {
    await new Promise(resolve => server.listen(PORT, resolve));
    await resetEmulators();
    await createUser('admin@team.dev', { role: 'admin' });
    for(const who of ['pm', 'dev', 'dev2', 'viewer']) await createUser(`${who}@team.dev`, { role: 'member' });
    await createUser('unverified@team.dev', { verified: false });
    await createUser('outsider@team.dev');
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });
  });

  /* ---------- first project ---------- */
  it('an admin of an empty workspace is asked to create the first project', async () => {
    admin = await signedIn('admin', 'admin@team.dev');
    await admin.waitForSelector('.no-project-card');
    assert.ok(await admin.$eval('#newTicketBtn', el => el.disabled), 'no project → no new ticket');
    await clickWhere(admin, '#goManage');
    await admin.waitForSelector('#setupName');
    await admin.type('#setupName', 'Website');
    assert.equal(await admin.$eval('#setupKey', el => el.value), 'WEB', 'the key is suggested from the name');
    await admin.click('#setupGo');
    await until(admin, () => document.querySelector('#projectKey').textContent.trim() === 'WEB');
    await until(admin, () => !document.querySelector('#newTicketBtn').disabled);
  });

  it('an unverified user is asked to confirm their email', async () => {
    const page = await openApp('unverified');
    await signIn(page, 'unverified@team.dev');
    await page.waitForSelector('#verifyScreen:not(.hidden)', { timeout: 15000 });
  });

  it('the admin adds people to the project with different roles', async () => {
    await manage(admin, 'members');
    for(const [email, role] of [['pm@team.dev', 'pm'], ['dev@team.dev', 'developer'], ['dev2@team.dev', 'developer'], ['viewer@team.dev', 'viewer']]){
      await admin.waitForSelector(`#addMemberEmail option[value="${email}"]`);
      await admin.select('#addMemberEmail', email);
      await admin.select('#addMemberRole', role);
      await admin.click('#addMemberBtn');
      await until(admin, e => document.querySelector(`#projectMembers [data-email="${e}"]`), email);
    }
    assert.equal((await admin.$$('#projectMembers .allow-row')).length, 5);
    assert.equal(await admin.$eval('#projectMembers [data-email="viewer@team.dev"] select', el => el.value), 'viewer');
  });

  /* ---------- tickets ---------- */
  it('a template fills the form, the ID uses the project key, and a malicious title is shown as text', async () => {
    await admin.click('#navBoard');
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
    assert.equal(await text(admin, '.card .card-id'), 'WEB-001');
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
    await until(admin, () => !document.querySelector('.modal-overlay'));
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
  it('comments are shown as text, can be edited, and @mentions suggest project members', async () => {
    await clickWhere(admin, '.card');
    await admin.waitForSelector('#commentInput');
    await admin.type('#commentInput', 'Please check <b>this</b> @dev');
    await admin.waitForSelector('#mentionList:not(.hidden)');
    await admin.keyboard.press('Enter');
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

  it('the mentioned developer sees a notification, opens the ticket, and has no Manage tab', async () => {
    dev = await signedIn('dev', 'dev@team.dev');
    assert.equal(await isVisible(dev, '#navManage'), false, 'developers manage nothing');
    await until(dev, () => document.querySelector('#projectKey').textContent.trim() === 'WEB');
    await until(dev, () => document.querySelector('#notifCount').textContent === '1');
    await dev.click('#notifBtn');
    await dev.waitForSelector('.notif-item.unread');
    await clickWhere(dev, '.notif-item');
    await dev.waitForSelector('.modal.drawer');
    await until(dev, () => document.querySelector('#notifCount').classList.contains('hidden'));
    await closeDialog(dev);
  });

  /* ---------- project manager: workflow, labels, integrations, sprints, templates ---------- */
  it('the project manager sees the project sections of Manage, but not Roles', async () => {
    pm = await signedIn('pm', 'pm@team.dev');
    await until(pm, () => !document.querySelector('#navManage').classList.contains('hidden'));
    await pm.click('#navManage');
    await pm.waitForSelector('#manageNav [data-section=workflow]');
    const sections = await navSections(pm);
    for(const s of ['overview', 'members', 'projects', 'labels', 'types', 'templates', 'sprints', 'workflow', 'integrations']) assert.ok(sections.includes(s), `PM sees ${s}`);
    assert.ok(!sections.includes('roles'), 'only admins edit roles');
  });

  it('the project manager saves a WIP limit and a Definition of Done item', async () => {
    await manage(pm, 'workflow');
    await pm.$eval('.wip-input [data-status=in_progress]', el => { el.value = '1'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await pm.click('#addDod');
    await pm.type('#dodRows .settings-row:last-child .dod-text', 'Tests added');
    await pm.click('#saveWorkflow');
    await toastSays(pm, 'Workflow saved');
  });

  it('the project manager adds a label and a ticket type', async () => {
    await manage(pm, 'labels');
    await pm.click('#addLabel');
    await pm.type('#labelRows .settings-row:last-child .label-name', 'mobile');
    await pm.click('#saveLabels');
    await toastSays(pm, 'Labels saved');
    await manage(pm, 'types');
    await pm.click('#addType');
    await pm.type('.type-row:last-child .type-label', 'Chore');
    await pm.click('#saveTypes');
    await toastSays(pm, 'Ticket types saved');
    await until(admin, () => [...document.querySelectorAll('#typeFilter option')].some(o => o.textContent === 'Chore'));
  });

  it('the webhook is masked, and a non-Discord URL is refused', async () => {
    await manage(pm, 'integrations');
    assert.equal(await pm.$eval('#webhook', el => el.type), 'password');
    await pm.click('#toggleWebhook');
    assert.equal(await pm.$eval('#webhook', el => el.type), 'text');
    await pm.$eval('#webhook', el => { el.value = 'https://evil.example/x'; });
    await pm.click('#saveIntegrations');
    await toastSays(pm, "doesn't look like");
  });

  it('the project manager creates an active sprint', async () => {
    await manage(pm, 'sprints');
    await pm.waitForSelector('#sp-name');
    await pm.type('#sp-name', 'Sprint 1');
    await pm.type('#sp-goal', 'Ship the beta');
    await pm.click('#sp-save');
    await until(pm, () => document.querySelector('.sprint-row') && document.querySelector('.sprint-row').textContent.includes('Sprint 1'));
  });

  it('the project manager creates a template, and it is offered in the new-ticket form', async () => {
    await manage(pm, 'templates');
    await pm.click('#newTemplate');
    await pm.waitForSelector('#tp-name');
    await pm.type('#tp-name', 'Release checklist');
    await pm.select('#tp-priority', 'high');
    await pm.type('#tp-desc', '## Release\n- [ ] Changelog');
    await until(pm, () => document.querySelector('#tp-preview input[type=checkbox]'));
    await pm.click('.tp-save');
    await toastSays(pm, 'Release checklist');
    await until(pm, () => [...document.querySelectorAll('#templateRows .member-name')].some(e => e.textContent === 'Release checklist'));
    await pm.click('#navBoard');
    await pm.click('#newTicketBtn');
    await pm.waitForSelector('#f-template');
    const id = await pm.$$eval('#f-template option', os => os.find(o => o.textContent.includes('Release checklist')).value);
    await pm.select('#f-template', id);
    assert.equal(await pm.$eval('#f-priority', el => el.value), 'high');
    await closeDialog(pm);
  });

  /* ---------- sprints, checklist, Definition of Done ---------- */
  it('a new ticket can be planned into the sprint, with two reviewers and a checklist', async () => {
    await admin.click('#navBoard');
    await admin.click('#newTicketBtn');
    await admin.waitForSelector('#f-title');
    await admin.type('#f-title', 'Dev ticket');
    await admin.type('#f-owner', 'dev@team.dev');
    await admin.$eval('#f-desc', el => { el.value = '- [ ] Write code\n- [x] Plan it'; });
    await admin.evaluate(() => { const s = document.querySelector('#f-sprint'); s.value = [...s.options].find(o => o.textContent.includes('Sprint 1')).value; });
    for(const r of ['dev@team.dev', 'dev2@team.dev']){ await admin.type('#f-reviewers-input', r); await admin.keyboard.press('Enter'); }
    assert.equal((await admin.$$('#f-reviewers-chips .person-chip')).length, 2);
    await admin.click('.form-save');
    await until(admin, () => [...document.querySelectorAll('.card-id')].some(e => e.textContent === 'WEB-002'));
    const badge = await admin.evaluate(() => [...document.querySelectorAll('.card')].find(c => c.textContent.includes('WEB-002')).querySelector('.checklist-badge').textContent.trim());
    assert.equal(badge, '1/2');
  });

  it('the sprint filter shows only the sprint\'s tickets', async () => {
    await admin.evaluate(() => { const s = document.querySelector('#sprintFilter'); s.value = [...s.options].find(o => o.textContent.includes('Sprint 1')).value; s.dispatchEvent(new Event('change')); });
    await until(admin, () => document.querySelectorAll('.card').length === 1);
    assert.deepEqual(await cardIds(admin), ['WEB-002']);
    await admin.select('#sprintFilter', '');
    await until(admin, () => document.querySelectorAll('.card').length === 2);
  });

  it('moving into a full column shows the WIP counter at its limit', async () => {
    await clickWhere(admin, '.card', 'WEB-002');
    await admin.waitForSelector('.status-track button[data-status=in_progress]');
    await admin.click('.status-track button[data-status=in_progress]');
    await until(admin, () => document.querySelector('.column-wip') && document.querySelector('.column-wip').textContent.trim() === '1/1');
    await until(admin, () => !document.querySelector('.modal-overlay'));
  });

  it('the developer cannot close or archive their own ticket, and sees it in My work', async () => {
    await clickWhere(dev, '.card', 'WEB-002');
    await dev.waitForSelector('.status-track');
    assert.equal(await dev.$('[data-act=archive]'), null, 'developers cannot archive');
    const reason = await dev.$eval('.status-track button[data-status=done]', el => el.classList.contains('locked') ? el.title : '');
    assert.match(reason, /You own|role/);
    await closeDialog(dev);
    await dev.click('#navMyWork');
    await until(dev, () => [...document.querySelectorAll('.work-row')].some(r => r.textContent.includes('WEB-002')));
  });

  it('ticking checklist and Definition of Done items in the panel unlocks Done', async () => {
    await clickWhere(admin, '.card', 'WEB-002');
    await admin.waitForSelector('#detailDesc input[data-line]');
    await admin.evaluate(() => document.querySelector('#detailDesc input[data-line]:not(:checked)').click());
    await sleep(600);
    assert.equal(await admin.$$eval('#detailDesc input[data-line]:checked', els => els.length), 2);
    const reason = await admin.$eval('.status-track button[data-status=done]', el => el.classList.contains('locked') ? el.title : '');
    assert.match(reason, /Definition of Done/, 'even admins need the Definition of Done');
    await admin.evaluate(() => document.querySelector('#dodList input[data-dod]').click());
    await until(admin, () => !document.querySelector('.status-track button[data-status=done]').classList.contains('locked'));
    await admin.click('.status-track button[data-status=done]');
    await until(admin, () => [...document.querySelectorAll('.column')][3].textContent.includes('WEB-002'));
    await until(admin, () => !document.querySelector('.modal-overlay'));
  });

  /* ---------- viewer & editable roles ---------- */
  it('a viewer can read and comment, but not create, edit or move tickets', async () => {
    viewer = await signedIn('viewer', 'viewer@team.dev');
    await until(viewer, () => document.querySelectorAll('.card').length === 2);
    assert.ok(await viewer.$eval('#newTicketBtn', el => el.disabled));
    assert.equal(await isVisible(viewer, '#navManage'), false);
    await clickWhere(viewer, '.card', 'WEB-001');
    await viewer.waitForSelector('.modal.drawer');
    assert.equal(await viewer.$('[data-act=edit]'), null, 'no Edit button');
    assert.ok(await viewer.$('#commentInput'), 'viewers can comment by default');
    const locked = await viewer.$$eval('.status-track button', els => els.every(b => b.classList.contains('locked') || b.classList.contains('active')));
    assert.ok(locked, 'every status step is locked');
    await closeDialog(viewer);
  });

  it('an admin edits the Viewer role, and the viewer loses commenting straight away', async () => {
    await manage(admin, 'roles');
    await admin.evaluate(() => { document.querySelector('.role-card[data-id=viewer]').open = true; });
    await admin.$eval('.role-card[data-id=viewer] [data-perm=comment]', el => { el.checked = false; });
    await admin.click('.role-card[data-id=viewer] [data-action=save]');
    await toastSays(admin, 'Viewer saved');
    await sleep(500);
    await clickWhere(viewer, '.card', 'WEB-001');
    await viewer.waitForSelector('.modal.drawer');
    await sleep(300);
    assert.equal(await viewer.$('#commentInput'), null, 'no comment box any more');
    await closeDialog(viewer);
  });

  /* ---------- more projects ---------- */
  it('a project manager requests a new project, and an admin approves it', async () => {
    await manage(pm, 'projects');
    await pm.waitForSelector('#np-name');
    await pm.type('#np-name', 'Mobile app');
    assert.equal(await pm.$eval('#np-key', el => el.value), 'MA');
    await pm.$eval('#np-key', el => { el.value = 'MOB'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await pm.click('#newProjectForm button[type=submit]');
    await toastSays(pm, 'Request sent');
    await until(pm, () => document.querySelector('#myRequests .request-row'));
    await until(admin, () => document.querySelector('#manageNav [data-section=projects] .nav-badge'));
    await manage(admin, 'projects');
    await admin.waitForSelector('#projectRequests .request-row');
    await admin.click('#projectRequests [data-action=approve]');
    await toastSays(admin, 'Mobile app created');
  });

  it('the project manager switches to the new project, which has its own board and ticket IDs', async () => {
    await pm.click('#navBoard');
    await pm.click('#projectBtn');
    await clickWhere(pm, '#projectMenu [data-pid]', 'Mobile app');
    await until(pm, () => document.querySelector('#projectKey').textContent.trim() === 'MOB');
    await until(pm, () => document.querySelectorAll('.column:not(.skeleton)').length === 4 && document.querySelectorAll('.card').length === 0);
    await pm.click('#newTicketBtn');
    await pm.waitForSelector('#f-title');
    await pm.type('#f-title', 'App store listing');
    await pm.click('.form-save');
    await until(pm, () => [...document.querySelectorAll('.card-id')].some(e => e.textContent === 'MOB-001'));
    // The Website board didn't change.
    assert.deepEqual((await cardIds(admin)).sort(), ['WEB-001', 'WEB-002']);
    // Keyboard: P opens the project switcher.
    await pm.click('body');
    await pm.keyboard.press('p');
    await pm.waitForSelector('#projectMenu:not(.hidden)');
    await pm.keyboard.press('Escape');
  });

  it('people outside a project can\'t see it', async () => {
    await dev.click('#projectBtn');
    await dev.waitForSelector('#projectMenu:not(.hidden)');
    const names = await dev.$$eval('#projectMenu [data-pid]', els => els.map(e => e.textContent));
    assert.equal(names.length, 1, 'dev only sees Website');
    await dev.keyboard.press('Escape');
  });

  /* ---------- archive, views, dashboard ---------- */
  it('archiving asks for confirmation, hides the ticket, and the Archived toggle shows it', async () => {
    await admin.click('#navBoard');
    await clickWhere(admin, '.card', 'WEB-001');
    await admin.waitForSelector('[data-act=archive]');
    await admin.click('[data-act=archive]');
    await admin.waitForSelector('.dlg-ok');
    await admin.click('.dlg-ok');
    await until(admin, () => ![...document.querySelectorAll('.card-id')].some(e => e.textContent === 'WEB-001'));
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

  /* ---------- access requests ---------- */
  it('an outsider requests access and the admin approves them into the project', async () => {
    const outsider = await openApp('outsider');
    await signIn(outsider, 'outsider@team.dev');
    await outsider.waitForSelector('#pendingScreen:not(.hidden)', { timeout: 15000 });
    await outsider.click('#requestAccessBtn');
    await until(outsider, () => document.querySelector('#requestAccessBtn').disabled);
    await manage(admin, 'members');
    await admin.waitForSelector('#accessRequests .request-row', { timeout: 10000 });
    await admin.select('#accessRequests .reqRole', 'qa');
    await admin.click('#accessRequests [data-action=approve]');
    await until(admin, () => document.querySelector('#projectMembers [data-email="outsider@team.dev"]'));
    assert.equal(await admin.$eval('#projectMembers [data-email="outsider@team.dev"] select', el => el.value), 'qa');
    await outsider.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
  });

  /* ---------- shortcuts, menus, sign-out ---------- */
  it('keyboard shortcuts: ? shows help, G then S opens Manage, G then B the board, N a new ticket', async () => {
    await admin.click('body');
    await admin.keyboard.type('?');
    await admin.waitForSelector('.shortcut-list');
    await closeDialog(admin);
    await admin.keyboard.press('g');
    await admin.keyboard.press('s');
    await until(admin, () => !document.querySelector('#manageView').classList.contains('hidden'));
    await admin.click('body');
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

  after(async () => {
    // Close every session before part 2 wipes the emulators under them.
    for(const ctx of contexts.splice(0)) await ctx.close();
  });

  it('no JavaScript errors happened along the way', () => {
    const real = errors.filter(e => !/favicon|Failed to load resource|PERMISSION_DENIED/.test(e));
    assert.deepEqual(real, []);
  });
});

/* ================================================================== */
describe('devflow end to end — upgrading a single-board workspace', { concurrency: false }, () => {
  before(async () => {
    errors.length = 0;
    await resetEmulators();
    await createUser('admin@team.dev', { role: 'admin' });
    await createUser('dev@team.dev', { role: 'developer' });
    // The old layout: top-level tickets, settings and counter.
    const now = { timestampValue: new Date().toISOString() };
    await seed('tickets/TASK-001', {
      id: str('TASK-001'), title: str('Old ticket'), status: str('in_progress'), priority: str('high'), type: str('bug'),
      owner: str('dev@team.dev'), reviewers: arr(), labels: arr(str('backend')), description: str(''),
      createdBy: str('admin@team.dev'), createdAt: now, updatedAt: now
    });
    await seed('tickets/TASK-001/comments/c1', { text: str('An old comment'), author: str('admin@team.dev'), createdAt: now });
    await seed('meta/counters', { ticket: int(1) });
    await seed('config/settings', { staleDays: int(5) });
  });
  after(async () => {
    if(browser) await browser.close();
    server.close();
  });

  it('an admin runs "Upgrade now", and the board comes back as the first project', async () => {
    const admin = await signedIn('admin-upgrade', 'admin@team.dev');
    await admin.waitForSelector('#goManage');
    await clickWhere(admin, '#goManage');
    await admin.waitForSelector('#setupGo');
    assert.equal(await admin.$eval('#setupKey', el => el.value), 'TASK', 'the key stays TASK');
    await admin.click('#setupGo');
    await admin.waitForSelector('.dlg-ok');
    await admin.click('.dlg-ok');
    await toastSays(admin, 'Upgrade complete: 1 tickets, 1 comments');
    await until(admin, () => document.querySelector('#projectKey').textContent.trim() === 'TASK');
    await admin.click('#navBoard');
    await until(admin, () => [...document.querySelectorAll('.card-id')].some(e => e.textContent === 'TASK-001'));
    await admin.click('#newTicketBtn');
    await admin.waitForSelector('#f-title');
    await admin.type('#f-title', 'After the upgrade');
    await admin.click('.form-save');
    await until(admin, () => [...document.querySelectorAll('.card-id')].some(e => e.textContent === 'TASK-002'));
  });

  it('the old developer is a Developer in the project', async () => {
    const dev = await signedIn('dev-upgrade', 'dev@team.dev');
    await until(dev, () => document.querySelector('#projectKey').textContent.trim() === 'TASK');
    await until(dev, () => document.querySelectorAll('.card').length === 2);
    await clickWhere(dev, '.card', 'TASK-001');
    await dev.waitForSelector('.comment-body');
    assert.match(await text(dev, '.comment-body'), /An old comment/);
    assert.equal(await dev.$('[data-act=archive]'), null);
  });

  it('no JavaScript errors happened during the upgrade', () => {
    const real = errors.filter(e => !/favicon|Failed to load resource|PERMISSION_DENIED/.test(e));
    assert.deepEqual(real, []);
  });
});
