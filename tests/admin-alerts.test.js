/* =========================================================
   Admin alerts tests — scripts/admin-alerts.mjs.

     npm run test:rules        (runs with the Firestore emulator)

   The message-building is tested on its own, then the whole script
   runs against the emulator with --dry-run (it prints instead of posting).
========================================================= */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { buildAlert, windowStart } from '../scripts/admin-alerts.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/admin-alerts.mjs', import.meta.url));
const run = (env) => new Promise(resolve => execFile(process.execPath, [SCRIPT, '--dry-run'], { env: { ...process.env, ...env } },
  (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr })));

describe('admin alerts: the message', () => {
  it('says nothing when nothing is new', () => {
    assert.equal(buildAlert({}), null);
  });
  it('lists access requests, people stuck getting in, and grouped problems', () => {
    const msg = buildAlert({
      requests: [{ email: 'asked@x.com' }],
      stuck: [{ email: 'unconfirmed@x.com', stage: 'confirm-email' }, { email: 'waiting@x.com', stage: 'waiting-approval' }],
      problems: [{ type: 'offline', email: 'far@x.com', count: 2 }, { type: 'offline', email: 'far@x.com', count: 1 }, { type: 'reconnected', email: 'far@x.com' }],
      siteUrl: 'https://example.web.app'
    });
    const text = msg.embeds[0].description;
    assert.match(text, /asked@x\.com\*\* asked for access/);
    assert.match(text, /unconfirmed@x\.com\*\* is trying to get in — hasn't confirmed their email/);
    assert.match(text, /waiting@x\.com\*\* is trying to get in/);
    assert.match(text, /Can't reach devflow \(3×\) — far@x\.com/);
    assert.doesNotMatch(text, /reconnected/, 'good news isn\'t an alert');
    assert.match(msg.embeds[0].footer.text, /Manage → Members and Manage → Logs/);
  });
  it('doesn\'t repeat someone who already asked, or who has been approved meanwhile', () => {
    const msg = buildAlert({
      requests: [{ email: 'a@x.com' }],
      stuck: [{ email: 'a@x.com', stage: 'waiting-approval' }, { email: 'b@x.com', stage: 'waiting-approval' }],
      approved: new Set(['b@x.com'])
    });
    assert.equal(msg.embeds[0].description.split('\n').length, 1);
  });
  it('first run looks back 20 minutes; after a long pause, at most a day', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    assert.equal(windowStart('', now), now - 20 * 60000);
    assert.equal(windowStart('2026-11-01T11:45:00Z', now), Date.parse('2026-11-01T11:45:00Z'));
    assert.equal(windowStart('2026-10-01T00:00:00Z', now), now - 24 * 3600000);
  });
});

describe('admin alerts: against the database (dry run)', () => {
  let db;
  before(async () => {
    await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT || 'demo-devflow'}/databases/(default)/documents`, { method: 'DELETE' });
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-devflow' });
    db = getFirestore();
    const old = Timestamp.fromMillis(Date.parse('2026-01-01T00:00:00Z'));
    const now = Timestamp.now();
    await db.doc('accessRequests/new@x.com').set({ email: 'new@x.com', requestedAt: now });
    await db.doc('accessRequests/old@x.com').set({ email: 'old@x.com', requestedAt: old });
    await db.doc('joinStatus/stuck@x.com').set({ stage: 'confirm-email', emailVerified: false, since: now, updatedAt: now });
    await db.doc('joinStatus/longago@x.com').set({ stage: 'confirm-email', emailVerified: false, since: old, updatedAt: now });
    await db.doc('logs/l1').set({ kind: 'problem', type: 'js-error', email: 'dev@x.com', message: 'boom', count: 1, createdAt: now });
    await db.doc('logs/l2').set({ kind: 'admin', type: 'member-added', email: 'admin@x.com', message: 'x', count: 1, createdAt: now });
  });

  it('announces only what happened since the last run', async () => {
    const { code, out } = await run({ SINCE: new Date(Date.now() - 5 * 60000).toISOString() });
    assert.equal(code, 0, out);
    assert.match(out, /new@x\.com\*\* asked for access/);
    assert.match(out, /stuck@x\.com\*\* is trying to get in/);
    assert.match(out, /Bug in devflow — dev@x\.com/);
    assert.doesNotMatch(out, /old@x\.com|longago@x\.com|member-added/);
  });

  it('stays quiet when there\'s nothing new', async () => {
    const { code, out } = await run({ SINCE: new Date(Date.now() + 60000).toISOString() });
    assert.equal(code, 0, out);
    assert.match(out, /Nothing new since/);
  });
});
