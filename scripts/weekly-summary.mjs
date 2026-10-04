#!/usr/bin/env node
/* =========================================================
   scripts/weekly-summary.mjs — posts a weekly summary of each project
   to that project's Discord channel.

   Runs every Monday from .github/workflows/weekly-summary.yml (free —
   no Firebase Blaze plan or Cloud Functions needed). It reads Firestore
   with a read-only service account and, for every active project that
   has "Weekly summary" switched on in Manage → Integrations, posts to
   the webhook saved there. A workspace that hasn't been upgraded to
   projects yet is summarised from the old single-board settings.

   Usage:
     FIREBASE_SERVICE_ACCOUNT_JSON='{…}' node scripts/weekly-summary.mjs
     node scripts/weekly-summary.mjs --dry-run      print instead of posting
     node scripts/weekly-summary.mjs --force        include projects that have it switched off
   Against the local emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
   (project "demo-devflow"), no service account needed.
========================================================= */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FORCE = args.has('--force');
const DAY = 86400000;

/* ---------------- CONNECT ---------------- */
function connect(){
  if(process.env.FIRESTORE_EMULATOR_HOST){
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-devflow' });
  }else{
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if(!json){
      // Not set up yet: succeed quietly so the scheduled workflow doesn't fail.
      console.log('Weekly summary skipped: FIREBASE_SERVICE_ACCOUNT_JSON is not set (see SETUP.md → Weekly Discord summary).');
      process.exit(0);
    }
    const account = JSON.parse(json);
    initializeApp({ credential: cert(account), projectId: account.project_id });
  }
  return getFirestore();
}

/* ---------------- HELPERS ---------------- */
const ALIASES = { todo: 'backlog', code_review: 'in_review', testing: 'in_review' };
const statusOf = (t) => ALIASES[t.status] || t.status;
const millis = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0);
const todayIso = () => new Date().toISOString().slice(0, 10);

function list(tickets, max = 8, extra = () => ''){
  if(tickets.length === 0) return '—';
  const lines = tickets.slice(0, max).map(t => `**${t.id}** ${t.title}${extra(t)}`);
  if(tickets.length > max) lines.push(`…and ${tickets.length - max} more`);
  const text = lines.join('\n');
  return text.length > 1000 ? text.slice(0, 997) + '…' : text; // Discord field limit is 1024
}

/* ---------------- BUILD THE SUMMARY ---------------- */
export function buildSummary({ tickets, sprints, profiles, settings, project = null, now = Date.now() }){
  const name = (email) => (profiles[(email || '').toLowerCase()] || {}).name || email || 'Unassigned';
  const active = tickets.filter(t => !t.archived);
  const weekAgo = now - 7 * DAY;
  const staleDays = Number.isInteger(settings.staleDays) && settings.staleDays > 0 ? settings.staleDays : 5;

  const done = active.filter(t => statusOf(t) === 'done' && millis(t.lastActivityAt) >= weekAgo);
  const created = active.filter(t => millis(t.createdAt) >= weekAgo);
  const inProgress = active.filter(t => statusOf(t) === 'in_progress');
  const inReview = active.filter(t => statusOf(t) === 'in_review');
  const blocked = active.filter(t => t.blocked && statusOf(t) !== 'done');
  const overdue = active.filter(t => t.dueDate && statusOf(t) !== 'done' && t.dueDate < todayIso());
  const stale = active.filter(t => ['in_progress', 'in_review'].includes(statusOf(t))
    && millis(t.lastActivityAt || t.createdAt) && now - millis(t.lastActivityAt || t.createdAt) >= staleDays * DAY);

  const fields = [
    { name: `✅ Done this week (${done.length})`, value: list(done, 10, t => ` — ${name(t.owner)}`), inline: false },
    { name: '🔄 In progress', value: String(inProgress.length), inline: true },
    { name: '👀 In review', value: String(inReview.length), inline: true },
    { name: '🆕 New this week', value: String(created.length), inline: true }
  ];
  if(blocked.length) fields.push({ name: `⛔ Blocked (${blocked.length})`, value: list(blocked, 6, t => (t.blockedReason ? ` — ${t.blockedReason}` : '')), inline: false });
  if(overdue.length) fields.push({ name: `📅 Overdue (${overdue.length})`, value: list(overdue, 6, t => ` — due ${t.dueDate}, ${name(t.owner)}`), inline: false });
  if(stale.length) fields.push({ name: `🕸️ Stale ${staleDays}+ days (${stale.length})`, value: list(stale, 6, t => ` — ${name(t.owner)}`), inline: false });

  const sprint = sprints.find(s => s.status === 'active');
  let description = `Here is how ${project ? project.name : 'the board'} looks this week.`;
  if(sprint){
    const inSprint = active.filter(t => t.sprintId === sprint.id);
    const sprintDone = inSprint.filter(t => statusOf(t) === 'done').length;
    const pct = inSprint.length ? Math.round(sprintDone / inSprint.length * 100) : 0;
    const left = Math.ceil((new Date(sprint.end + 'T23:59:59') - now) / DAY);
    description = `**${sprint.name}**${sprint.goal ? ` — ${sprint.goal}` : ''}\n`
      + `${sprintDone}/${inSprint.length} tickets done (${pct}%) · ${left > 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'ends today or has ended'}`;
  }

  return {
    embeds: [{
      title: project ? `📊 Weekly summary · ${project.key} ${project.name}` : '📊 Weekly summary',
      description,
      color: 0xF5A524,
      fields,
      footer: { text: 'devflow · weekly summary' },
      timestamp: new Date(now).toISOString()
    }]
  };
}

/* ---------------- MAIN ---------------- */

/** Every board to summarise: [{ label, base, project }], base = '' for the old layout. */
async function boards(db){
  const meta = await db.doc('meta/workspace').get();
  if(!meta.exists || !(meta.data().version >= 2)) return [{ label: 'board', base: '', project: null }];
  const snap = await db.collection('projects').where('status', '==', 'active').get();
  return snap.docs.map(d => ({ label: d.data().key, base: `projects/${d.id}/`, project: d.data() }));
}

async function summarise(db, { label, base, project }, profiles){
  const settingsDoc = await db.doc(`${base}config/settings`).get();
  const settings = settingsDoc.exists ? settingsDoc.data() : {};
  if(!settings.weeklySummary && !FORCE){ console.log(`${label}: weekly summary is switched off — skipped.`); return; }
  const webhook = settings.discordWebhookUrl;
  if(!webhook && !DRY_RUN){ console.log(`${label}: no Discord webhook saved — skipped.`); return; }

  const [ticketSnap, sprintSnap] = await Promise.all([db.collection(`${base}tickets`).get(), db.collection(`${base}sprints`).get()]);
  const payload = buildSummary({
    tickets: ticketSnap.docs.map(d => d.data()),
    sprints: sprintSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    profiles, settings, project
  });

  if(DRY_RUN){ console.log(`--- ${label} ---\n${JSON.stringify(payload, null, 2)}`); return; }
  const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if(!res.ok) throw new Error(`${label}: Discord answered ${res.status}: ${await res.text()}`);
  console.log(`${label}: weekly summary posted.`);
}

async function main(){
  const db = connect();
  const profileSnap = await db.collection('profiles').get();
  const profiles = {};
  profileSnap.docs.forEach(d => { profiles[d.id] = d.data(); });

  // One project failing (e.g. a deleted webhook) shouldn't stop the others.
  let failed = 0;
  for(const board of await boards(db)){
    try{ await summarise(db, board, profiles); }
    catch(err){ failed++; console.error(err.message || err); }
  }
  if(failed) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
