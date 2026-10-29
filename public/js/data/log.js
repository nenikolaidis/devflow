/* =========================================================
   data/log.js — the problem log and the admin-action log
   (shown to workspace admins in Manage → Logs).

   Problems are recorded automatically:
     js-error        a crash in devflow's code (uncaught error or promise)
     error-shown     a red error message someone saw (every error toast)
     sync-error      live updates stopped working for someone
     offline         "Can't reach devflow" — the database was unreachable
     reconnected     ...and it got through again (says how)
   Admin actions are recorded by data/api.js after they succeed:
     logAdmin('member-removed', 'ana@x.com removed from Website', 'ana@x.com')

   Every entry goes into a small queue in localStorage first and is sent
   from there, so problems that happen while offline arrive as soon as the
   connection works (even after a reload). Repeats of the same problem
   within 10 minutes are counted rather than sent again, and one browser
   sends at most DAILY_LIMIT problems a day, so a loop can't flood the log.

   Entries carry an expiresAt 30 days ahead; with Firestore's TTL policy
   switched on (SETUP.md) they delete themselves.

   Never put passwords, ticket text or webhook URLs into an entry.
========================================================= */
import { db, auth, serverTime, timestampAt } from './firebase.js';
import { state } from '../core/state.js';
import { on, EVENTS } from '../core/events.js';
import { COLLECTIONS } from '../core/constants.js';

const QUEUE_KEY = 'devflow:logQueue';
const DAY_KEY = 'devflow:logDay';
const MAX_QUEUE = 40;
const DAILY_LIMIT = 30;
const REPEAT_WINDOW = 10 * 60 * 1000;
const KEEP_DAYS = 30;

const clip = (value, max) => String(value == null ? '' : value).slice(0, max);
const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- THE QUEUE (localStorage, or memory if blocked) ---------------- */
let memoryQueue = [];
function loadQueue(){
  try{ const q = JSON.parse(localStorage.getItem(QUEUE_KEY)); if(Array.isArray(q)) return q; }catch(e){ /* blocked or corrupt */ }
  return memoryQueue;
}
function saveQueue(queue){
  memoryQueue = queue.slice(-MAX_QUEUE);
  try{ localStorage.setItem(QUEUE_KEY, JSON.stringify(memoryQueue)); }catch(e){ /* memory only */ }
}
function enqueue(entry){
  saveQueue([...loadQueue(), { id: db.collection(COLLECTIONS.LOGS).doc().id, occurredAt: new Date().toISOString(), ...entry }]);
  flushLogs();
}
function dropFromQueue(id){
  saveQueue(loadQueue().filter(e => e.id !== id));
}

/** Where the person was in the app, e.g. "manage/members". */
function currentPage(){
  if(!state.currentUser) return 'sign-in';
  return state.currentTab === 'manage' ? `manage/${state.manageSection}` : state.currentTab;
}

/* ---------------- SENDING ---------------- */
const sending = new Set();

/**
 * Sends whatever is queued. Safe to call any time: entries are written
 * with their own id, so one sent twice is simply refused the second time.
 */
export function flushLogs(){
  const user = auth.currentUser;
  if(!user || !user.emailVerified || !user.email) return;
  loadQueue().forEach(entry => {
    if(sending.has(entry.id)) return;
    sending.add(entry.id);
    const { id, ...fields } = entry;
    db.collection(COLLECTIONS.LOGS).doc(id).set({
      ...fields,
      email: user.email.toLowerCase(),
      browser: clip(navigator.userAgent, 300),
      createdAt: serverTime(),
      expiresAt: timestampAt(Date.now() + KEEP_DAYS * 86400000)
    })
      .then(() => dropFromQueue(id))
      .catch(e => {
        // Refused (already sent, or not allowed): drop it. Offline: keep it for later.
        if(e && (e.code === 'permission-denied' || e.code === 'invalid-argument')) dropFromQueue(id);
      })
      .finally(() => sending.delete(id));
  });
}

/* ---------------- RECORDING ---------------- */
const recent = new Map(); // "type|message" → { at, repeats, entry }

function underDailyLimit(){
  let day = { date: today(), n: 0 };
  try{ const saved = JSON.parse(localStorage.getItem(DAY_KEY)); if(saved && saved.date === day.date) day = saved; }catch(e){ /* fine */ }
  if(day.n >= DAILY_LIMIT) return false;
  day.n++;
  try{ localStorage.setItem(DAY_KEY, JSON.stringify(day)); }catch(e){ /* fine */ }
  return true;
}

/**
 * Records a problem. `message` is the short, human-readable part (grouped
 * on); `detail` holds anything technical (stack, codes, attempts).
 */
export function logProblem(type, message, { detail = '' } = {}){
  try{
    const entry = {
      kind: 'problem', type, message: clip(message, 500) || type, detail: clip(detail, 4000),
      page: clip(currentPage(), 100), projectId: clip(state.projectId || '', 64)
    };
    const key = `${type}|${entry.message}`;
    const seen = recent.get(key);
    const now = Date.now();
    if(seen && now - seen.at < REPEAT_WINDOW){ seen.repeats++; return; }
    const count = 1 + (seen ? seen.repeats : 0);
    recent.set(key, { at: now, repeats: 0, entry });
    if(!underDailyLimit()) return;
    enqueue({ ...entry, count });
  }catch(e){ /* logging must never break the app */ }
}

/** Records an admin action, e.g. logAdmin('member-removed', 'ana@x.com removed from Website', 'ana@x.com'). */
export function logAdmin(type, message, target = ''){
  try{
    enqueue({ kind: 'admin', type, message: clip(message, 500), target: clip(target, 200), page: clip(currentPage(), 100), projectId: clip(state.projectId || '', 64), count: 1 });
  }catch(e){ /* never break the action itself */ }
}

/** Sends counts for problems that repeated since they were last sent (when the tab is hidden or closed). */
function sendRepeats(){
  recent.forEach((seen, key) => {
    if(!seen.repeats) return;
    if(underDailyLimit()) saveQueue([...loadQueue(), { id: db.collection(COLLECTIONS.LOGS).doc().id, occurredAt: new Date().toISOString(), ...seen.entry, count: seen.repeats }]);
    recent.set(key, { ...seen, at: Date.now(), repeats: 0 });
  });
  flushLogs();
}

/* ---------------- CATCHING PROBLEMS ---------------- */
// Only errors from devflow's own files: browser extensions and other sites' scripts are not our bugs.
const ours = (file) => !file || file.startsWith(location.origin);

window.addEventListener('error', e => {
  if(!e.message || e.message === 'Script error.' || !ours(e.filename)) return;
  if(/ResizeObserver loop/.test(e.message)) return; // harmless browser notice
  logProblem('js-error', e.message, { detail: `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}\n${(e.error && e.error.stack) || ''}` });
});
window.addEventListener('unhandledrejection', e => {
  const err = e.reason;
  const message = (err && err.message) || String(err);
  if(err && err.code === 'permission-denied') return; // access ended — handled by features/auth.js
  logProblem('js-error', message, { detail: `${(err && err.code) || ''}\n${(err && err.stack) || ''}` });
});
on(EVENTS.ERROR_SHOWN, message => logProblem('error-shown', message));
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') sendRepeats(); });
