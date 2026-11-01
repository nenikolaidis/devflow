#!/usr/bin/env node
/* =========================================================
   scripts/admin-alerts.mjs — tells workspace admins on Discord when
   something needs them:
     • someone asked for access
     • someone is stuck getting in (email not confirmed, waiting without
       asking, temporary password not replaced) — each new step once
     • new problems in Manage → Logs (crashes, "can't reach devflow"…)

   Runs every 15 minutes from .github/workflows/admin-alerts.yml (free,
   no Blaze plan). It only *reads* Firestore, with the same read-only key
   as the weekly summary, and posts to the webhook an admin saved in
   Manage → Integrations → Admin alerts. "New" means since the workflow's
   last successful run (SINCE, from GitHub), so nothing is stored.

   Usage:
     FIREBASE_SERVICE_ACCOUNT_JSON='{…}' SINCE=2026-11-01T10:00:00Z node scripts/admin-alerts.mjs
     node scripts/admin-alerts.mjs --dry-run       print instead of posting
   Against the local emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
   (project "demo-devflow"), no key needed.
========================================================= */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { pathToFileURL } from 'node:url';

const MINUTE = 60000;
const FIRST_RUN_LOOKBACK = 20 * MINUTE;   // no previous run: don't announce old history
const MAX_LOOKBACK = 24 * 60 * MINUTE;    // after a long pause, only the last day
const MAX_LINES = 20;

const STUCK = {
  'confirm-email': "is trying to get in — hasn't confirmed their email",
  'waiting-approval': 'is trying to get in — signed in, waiting, but hasn\'t asked for access',
  'choose-password': "signed in with a temporary password but hasn't chosen their own"
};
const PROBLEMS = { 'offline': "Can't reach devflow", 'js-error': 'Bug in devflow', 'error-shown': 'Error message shown', 'sync-error': 'Live updates stopped' };

/** From the last run's time (ISO, may be empty) to the window start in ms. */
export function windowStart(since, now = Date.now()){
  const t = Date.parse(since || '');
  if(!t) return now - FIRST_RUN_LOOKBACK;
  return Math.max(t, now - MAX_LOOKBACK);
}

/**
 * Builds the Discord message, or null when there's nothing to say.
 * Inputs are plain objects: requests [{email}], stuck [{email, stage}],
 * problems [{type, email, count}], approved Set of emails.
 */
export function buildAlert({ requests = [], stuck = [], problems = [], approved = new Set(), siteUrl = '' }){
  const asked = new Set(requests.map(r => r.email));
  const lines = [];
  requests.forEach(r => lines.push(`🙋 **${r.email}** asked for access`));
  stuck
    .filter(j => STUCK[j.stage])
    .filter(j => !(j.stage === 'waiting-approval' && (approved.has(j.email) || asked.has(j.email))))
    .forEach(j => lines.push(`⏳ **${j.email}** ${STUCK[j.stage]}`));
  const groups = new Map();
  problems.filter(p => PROBLEMS[p.type]).forEach(p => {
    const key = `${p.type}|${p.email}`;
    const g = groups.get(key) || { type: p.type, email: p.email, count: 0 };
    g.count += p.count || 1;
    groups.set(key, g);
  });
  groups.forEach(g => lines.push(`⚠️ ${PROBLEMS[g.type]}${g.count > 1 ? ` (${g.count}×)` : ''} — ${g.email}`));
  if(!lines.length) return null;

  const shown = lines.slice(0, MAX_LINES);
  if(lines.length > MAX_LINES) shown.push(`…and ${lines.length - MAX_LINES} more`);
  const where = [requests.length || stuck.length ? 'Manage → Members' : '', groups.size ? 'Manage → Logs' : ''].filter(Boolean).join(' and ');
  return {
    username: 'devflow',
    embeds: [{
      title: 'devflow needs an admin',
      url: siteUrl || undefined,
      description: shown.join('\n').slice(0, 4000),
      color: 0xF5A524,
      footer: { text: `See ${where}` }
    }]
  };
}

/* ---------------- RUN ---------------- */
function connect(){
  if(process.env.FIRESTORE_EMULATOR_HOST){
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-devflow' });
    return { db: getFirestore(), projectId: process.env.GCLOUD_PROJECT || 'demo-devflow' };
  }
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if(!json){
    console.log('Admin alerts skipped: FIREBASE_SERVICE_ACCOUNT_JSON is not set (SETUP.md → Admin alerts).');
    process.exit(0);
  }
  const account = JSON.parse(json);
  initializeApp({ credential: cert(account), projectId: account.project_id });
  return { db: getFirestore(), projectId: account.project_id };
}

async function main(){
  const dryRun = process.argv.includes('--dry-run');
  const { db, projectId } = connect();
  const config = await db.doc('adminConfig/alerts').get();
  const { enabled = false, discordWebhookUrl = '' } = config.exists ? config.data() : {};
  if(!dryRun && (!enabled || !discordWebhookUrl)){ console.log('Admin alerts are switched off (Manage → Integrations → Admin alerts).'); return; }

  const start = Timestamp.fromMillis(windowStart(process.env.SINCE));
  const [requests, stuck, logs, allow] = await Promise.all([
    db.collection('accessRequests').where('requestedAt', '>', start).get(),
    db.collection('joinStatus').where('since', '>', start).get(),
    db.collection('logs').where('createdAt', '>', start).get(),
    db.collection('allowlist').get()
  ]);
  const message = buildAlert({
    requests: requests.docs.map(d => ({ email: d.id })),
    stuck: stuck.docs.map(d => ({ email: d.id, stage: d.data().stage })),
    problems: logs.docs.map(d => d.data()).filter(l => l.kind === 'problem').map(l => ({ type: l.type, email: l.email, count: l.count })),
    approved: new Set(allow.docs.map(d => d.id)),
    siteUrl: `https://${projectId}.web.app`
  });
  if(!message){ console.log(`Nothing new since ${start.toDate().toISOString()}.`); return; }
  if(dryRun){ console.log(JSON.stringify(message, null, 2)); return; }

  const res = await fetch(discordWebhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
  if(!res.ok) throw new Error(`Discord answered ${res.status} — check the webhook in Manage → Integrations → Admin alerts`);
  console.log(`Admin alert posted (${message.embeds[0].description.split('\n').length} lines).`);
}

if(import.meta.url === pathToFileURL(process.argv[1] || '').href){
  main().catch(e => { console.error(`Admin alerts failed: ${e.message}`); process.exit(1); });
}
