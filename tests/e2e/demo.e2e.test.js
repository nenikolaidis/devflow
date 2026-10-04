/* =========================================================
   Public demo test — drives demo/index.html in headless Chrome.

     npm run test:e2e        (needs Google Chrome)

   The demo runs the real app on an in-memory stand-in for Firebase
   (public/demo/backend.js). These steps check that it works, that every
   role in "Viewing as" behaves like the real thing, that reloading
   starts over, and — most importantly — that the page never contacts
   Firebase or any Google database.

   Chrome: set CHROME_PATH if it isn't in the usual place.
========================================================= */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const PORT = 5052;
const DEMO = `http://localhost:${PORT}/demo/`;
const CHROME = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');
// The only places the demo may load anything from.
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, 'fonts.googleapis.com', 'fonts.gstatic.com']);

/* ---------------- tiny static server for public/ ---------------- */
const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if(path === '' || path.endsWith('/')) path += 'index.html';
  const file = join(PUBLIC, path);
  if(!file.startsWith(PUBLIC)){ res.writeHead(403).end(); return; }
  try{
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  }catch{ res.writeHead(404).end(); }
});

/* ---------------- browser helpers ---------------- */
let browser, page;
const errors = [];
const hosts = new Set();
const until = (fn, ...args) => page.waitForFunction(fn, { timeout: 10000 }, ...args);
const text = (sel) => page.$eval(sel, el => el.textContent.trim());
const cardIds = () => page.$$eval('.card .card-id', els => els.map(e => e.textContent.trim()));
const columnCount = (i) => page.$$eval('.column', (cols, i) => cols[i].querySelectorAll('.card').length, i);
async function clickWhere(selector, containing = ''){
  await page.waitForFunction((s, c) => [...document.querySelectorAll(s)].some(e => e.textContent.includes(c)), { timeout: 10000 }, selector, containing);
  await page.evaluate((s, c) => [...document.querySelectorAll(s)].find(e => e.textContent.includes(c)).click(), selector, containing);
}
async function viewAs(email){
  await page.select('#demoPerson', email);
  await until(e => document.querySelector('#whoami').textContent.startsWith(e), email);
}
async function openDemo(){
  await page.goto(DEMO, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#app:not(.hidden) .card', { timeout: 15000 });
}

/* ================================================================== */
describe('public demo', { concurrency: false }, () => {
  before(async () => {
    await new Promise(resolve => server.listen(PORT, resolve));
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });
    page = await browser.newPage();
    page.on('request', r => hosts.add(new URL(r.url()).host));
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if(m.type() === 'error') errors.push(m.text()); });
    await page.setViewport({ width: 1400, height: 900 });
  });
  after(async () => {
    if(browser) await browser.close();
    server.close();
  });

  it('opens straight into the sample project as the workspace admin', async () => {
    await openDemo();
    assert.equal(await text('#projectKey'), 'WEB');
    assert.equal((await cardIds()).length, 12);
    assert.match(await text('#whoami'), /alex@example\.com · Workspace admin/);
    assert.ok(await page.$('.demo-bar'), 'the demo bar is shown');
    assert.equal(await page.$eval('#navManage', el => el.classList.contains('hidden')), false);
  });

  it('can\'t reach Firebase: its own CSP blocks it and the real SDK is never loaded', async () => {
    const csp = await page.$eval('meta[http-equiv="Content-Security-Policy"]', el => el.content);
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.equal(await page.evaluate(() => typeof window.firebase.apps), 'undefined', 'window.firebase is the demo stand-in');
    assert.equal(await page.$('script[src*="gstatic"]'), null);
  });

  it('a new ticket gets the next WEB number and can be moved along the board', async () => {
    await page.click('#newTicketBtn');
    await page.waitForSelector('.modal #f-title');
    await page.type('#f-title', 'Tried in the demo');
    await page.click('.form-save');
    await until(() => [...document.querySelectorAll('.card-id')].some(e => e.textContent.trim() === 'WEB-013'));
    const before = await columnCount(1);
    await clickWhere('.card', 'Tried in the demo');
    await page.waitForSelector('.status-track button[data-status=in_progress]');
    await page.click('.status-track button[data-status=in_progress]');
    await until(n => document.querySelectorAll('.column')[1].querySelectorAll('.card').length === n, before + 1);
  });

  it('switching to the client (Viewer) shows a read-only board with one project', async () => {
    await page.keyboard.press('Escape');
    await viewAs('taylor@client.example.com');
    await page.waitForSelector('#app:not(.hidden) .card');
    assert.ok(await page.$eval('#newTicketBtn', el => el.disabled), 'a viewer can\'t create tickets');
    assert.ok(await page.$eval('#navManage', el => el.classList.contains('hidden')), 'a viewer has no Manage tab');
    assert.equal(await text('#projectKey'), 'WEB');
  });

  it('the developer has their mention waiting under the bell, and no Manage tab', async () => {
    await viewAs('jordan@example.com');
    await until(() => /1/.test(document.querySelector('#notifCount:not(.hidden)')?.textContent || ''));
    assert.ok(await page.$eval('#navManage', el => el.classList.contains('hidden')));
  });

  it('the project manager sees Manage, but not Roles; the admin sees Roles', async () => {
    await viewAs('maria@example.com');
    await page.click('#navManage');
    await page.waitForSelector('#manageNav [data-section=workflow]');
    assert.equal(await page.$('#manageNav [data-section=roles]'), null);
    await viewAs('alex@example.com');
    await page.click('#navManage');
    await page.waitForSelector('#manageNav [data-section=roles]');
  });

  it('reloading starts the demo over', async () => {
    await openDemo();
    assert.equal((await cardIds()).includes('WEB-013'), false);
    assert.equal((await cardIds()).length, 12);
  });

  it('only this site and Google Fonts were contacted', () => {
    const others = [...hosts].filter(h => h && !ALLOWED_HOSTS.has(h));
    assert.deepEqual(others, []);
  });

  it('no JavaScript errors happened', () => {
    const real = errors.filter(e => !/favicon|Failed to load resource/.test(e));
    assert.deepEqual(real, []);
  });
});
