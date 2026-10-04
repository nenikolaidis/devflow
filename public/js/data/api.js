/* =========================================================
   data/api.js — every one-off Firestore read and write.

   If it touches the database and isn't a live listener, it lives here
   (live listeners are in data/sync.js). Functions throw Firestore errors
   to the caller; the caller decides what to show the user.

   Collections (see ARCHITECTURE.md for every field):
     tickets/{id}                 + /comments/{id}, /activity/{id}
     allowlist/{email}            who is approved, and their role
     accessRequests/{email}       "let me in" requests
     profiles/{email}             name, bio, time zone…
     meta/counters                next TASK-### number
     config/settings              Discord webhook, WIP limits, stale days
========================================================= */
import { db, serverTime, deleteField } from './firebase.js';
import { state } from '../core/state.js';
import { COLLECTIONS, DOCS, STATUS, ACTIVITY, normalizeStatus } from '../core/constants.js';
import { normEmail } from '../core/permissions.js';
import { cleanDod } from '../core/workflow.js';

/* ---------------- REFERENCES ---------------- */
export const refs = {
  tickets: () => db.collection(COLLECTIONS.TICKETS),
  ticket: (fid) => db.collection(COLLECTIONS.TICKETS).doc(fid),
  comments: (fid) => db.collection(COLLECTIONS.TICKETS).doc(fid).collection(COLLECTIONS.COMMENTS),
  activity: (fid) => db.collection(COLLECTIONS.TICKETS).doc(fid).collection(COLLECTIONS.ACTIVITY),
  allowlist: () => db.collection(COLLECTIONS.ALLOWLIST),
  member: (email) => db.collection(COLLECTIONS.ALLOWLIST).doc(normEmail(email)),
  requests: () => db.collection(COLLECTIONS.ACCESS_REQUESTS),
  request: (email) => db.collection(COLLECTIONS.ACCESS_REQUESTS).doc(normEmail(email)),
  profiles: () => db.collection(COLLECTIONS.PROFILES),
  profile: (email) => db.collection(COLLECTIONS.PROFILES).doc(normEmail(email)),
  counters: () => db.collection(COLLECTIONS.META).doc(DOCS.COUNTERS),
  sprints: () => db.collection(COLLECTIONS.SPRINTS),
  sprint: (id) => db.collection(COLLECTIONS.SPRINTS).doc(id),
  notifications: () => db.collection(COLLECTIONS.NOTIFICATIONS),
  notification: (id) => db.collection(COLLECTIONS.NOTIFICATIONS).doc(id),
  settings: () => db.collection(COLLECTIONS.CONFIG).doc(DOCS.SETTINGS)
};

const me = () => state.currentUser.email;

/* ---------------- ACTIVITY LOG ---------------- */

/** Appends an audit-trail entry (as the signed-in user) and marks the ticket as recently active. */
export async function logActivity(fid, entry){
  try{
    await refs.activity(fid).add({ ...entry, actor: me(), createdAt: serverTime() });
  }catch(e){ console.error('Could not log activity:', e); }
  touchTicket(fid);
}

/** Records that a ticket was just worked on, so it isn't flagged as stale. */
export async function touchTicket(fid){
  try{ await refs.ticket(fid).update({ lastActivityAt: serverTime() }); }
  catch(e){ /* e.g. an archived ticket a developer can't update — harmless */ }
}

/* ---------------- TICKETS ---------------- */

const ticketId = (num) => 'TASK-' + String(num).padStart(3, '0');

function highestTicketNumber(){
  let max = 0;
  state.tickets.forEach(t => { const m = /TASK-(\d+)/.exec(t.id || ''); if(m) max = Math.max(max, parseInt(m[1], 10)); });
  return max;
}

/**
 * Creates a ticket in Backlog with the next TASK-### id.
 * The number comes from meta/counters, bumped in the same transaction,
 * so two people creating tickets at once never share an id (the rules
 * check this too). Returns { firestoreId, id }.
 */
export async function createTicket(fields){
  const counterRef = refs.counters();
  const ticketRef = refs.tickets().doc();
  const highestExisting = highestTicketNumber();
  const number = await db.runTransaction(async tx => {
    const snap = await tx.get(counterRef);
    const next = Math.max(snap.exists ? (snap.data().ticketNumber || 0) : 0, highestExisting) + 1;
    tx.set(counterRef, { ticketNumber: next });
    tx.set(ticketRef, {
      ...fields,
      id: ticketId(next),
      number: next,
      status: STATUS.BACKLOG,
      archived: false,
      createdBy: me(),
      createdAt: serverTime(),
      lastActivityAt: serverTime()
    });
    return next;
  });
  logActivity(ticketRef.id, { type: ACTIVITY.CREATED });
  return { firestoreId: ticketRef.id, id: ticketId(number) };
}

/** Plain field update (title, owner, labels…). Callers log what changed. */
export function updateTicket(fid, fields){
  return refs.ticket(fid).update(fields);
}

/**
 * Moves tickets to a status in one batch and logs each move. Moving to
 * Done also sends the ticket's Definition of Done trimmed to the current
 * items, which firestore.rules checks.
 */
export async function setStatus(tickets, status){
  const batch = db.batch();
  tickets.forEach(t => batch.update(refs.ticket(t.firestoreId), status === STATUS.DONE ? { status, dod: cleanDod(t) } : { status }));
  await batch.commit();
  tickets.forEach(t => logActivity(t.firestoreId, { type: ACTIVITY.STATUS_CHANGE, from: normalizeStatus(t.status), to: status }));
}

/** Archives (or restores) tickets in one batch and logs each. Admins/PMs only. */
export async function setArchived(tickets, archived){
  const fields = archived
    ? { archived: true, archivedBy: me(), archivedAt: serverTime() }
    : { archived: false, archivedBy: deleteField(), archivedAt: deleteField() };
  const batch = db.batch();
  tickets.forEach(t => batch.update(refs.ticket(t.firestoreId), fields));
  await batch.commit();
  tickets.forEach(t => logActivity(t.firestoreId, { type: archived ? ACTIVITY.ARCHIVED : ACTIVITY.RESTORED }));
}

/** Marks a ticket blocked with a reason, or clears it when reason is null. */
export async function setBlocked(fid, reason){
  if(reason){
    await refs.ticket(fid).update({ blocked: true, blockedReason: reason, blockedBy: me(), blockedAt: serverTime() });
    logActivity(fid, { type: ACTIVITY.BLOCKED, reason });
  }else{
    await refs.ticket(fid).update({ blocked: false, blockedReason: deleteField(), blockedBy: deleteField(), blockedAt: deleteField() });
    logActivity(fid, { type: ACTIVITY.UNBLOCKED });
  }
}

/** Ticks or unticks one Definition of Done item and logs it. */
export async function setDodItem(t, item, done){
  await refs.ticket(t.firestoreId).update({ [`dod.${item.id}`]: done });
  logActivity(t.firestoreId, { type: ACTIVITY.EDIT, summary: `definition of done: ${done ? '✓' : '✗'} ${item.text}`.slice(0, 200) });
}

/** Permanently deletes an archived ticket. Admins only. */
export function deleteTicket(fid){
  return refs.ticket(fid).delete();
}

/* ---------------- COMMENTS ---------------- */

/** Posts a comment. `mentions` = emails of teammates @mentioned in it. */
export async function addComment(fid, text, mentions = []){
  const comment = { text, author: me(), createdAt: serverTime() };
  if(mentions.length) comment.mentions = mentions;
  await refs.comments(fid).add(comment);
  touchTicket(fid);
}

export function editComment(fid, commentId, text){
  return refs.comments(fid).doc(commentId).update({ text, editedAt: serverTime() });
}

/** Admins/PMs: hide or unhide a comment (the text is kept, just not shown to the team). */
export function setCommentHidden(fid, commentId, hidden){
  return refs.comments(fid).doc(commentId).update(hidden
    ? { hidden: true, hiddenBy: me(), hiddenAt: serverTime() }
    : { hidden: false, hiddenBy: deleteField(), hiddenAt: deleteField() });
}

export function deleteComment(fid, commentId){
  return refs.comments(fid).doc(commentId).delete();
}

/* ---------------- SPRINTS ---------------- */

/** Creates (no id) or updates a sprint. Admins/PMs only. */
export function saveSprint(id, fields){
  if(id) return refs.sprint(id).update(fields);
  return refs.sprints().add({ ...fields, createdBy: me(), createdAt: serverTime() });
}

/** Deletes a sprint and takes its tickets out of it (one batch). */
export async function deleteSprint(id){
  const batch = db.batch();
  state.tickets.filter(t => t.sprintId === id).forEach(t => batch.update(refs.ticket(t.firestoreId), { sprintId: deleteField() }));
  batch.delete(refs.sprint(id));
  await batch.commit();
}

/* ---------------- NOTIFICATIONS ---------------- */

/** One "you were mentioned" notification per teammate (never to yourself). */
export async function notifyMentions(t, emails, text){
  const batch = db.batch();
  emails.filter(e => normEmail(e) !== normEmail(me())).forEach(to => {
    batch.set(refs.notifications().doc(), {
      to: normEmail(to), by: me(), type: 'mention',
      ticketFid: t.firestoreId, ticketId: t.id, ticketTitle: String(t.title || '').slice(0, 200),
      text: text.slice(0, 300), createdAt: serverTime(), read: false
    });
  });
  await batch.commit();
}

export function markNotificationRead(id){
  return refs.notification(id).update({ read: true });
}

export async function markAllNotificationsRead(){
  const batch = db.batch();
  state.notifications.filter(n => !n.read).forEach(n => batch.update(refs.notification(n.id), { read: true }));
  await batch.commit();
}

/* ---------------- TEAM & ACCESS ---------------- */

/** The role on someone's allowlist entry, or null if they aren't approved. */
export async function getRole(email){
  const doc = await refs.member(email).get();
  return doc.exists ? (doc.data().role || null) : null;
}

/** Approves someone (adds them to the allowlist) and clears any pending request. */
export async function addMember(email, role){
  await refs.member(email).set({ role, addedBy: me(), addedAt: serverTime() });
  await refs.request(email).delete().catch(() => {});
}

export function setRole(email, role){
  return refs.member(email).update({ role });
}

export function removeMember(email){
  return refs.member(email).delete();
}

export function requestAccess(email){
  return refs.request(email).set({ email: normEmail(email), requestedAt: serverTime() });
}

/** Denies (deletes) an access request. */
export function deleteRequest(email){
  return refs.request(email).delete();
}

/* ---------------- PROFILES ---------------- */

/** Creates a blank profile on first login, or bumps lastActive on later logins. */
export async function ensureOwnProfile(){
  const ref = refs.profile(me());
  try{
    const doc = await ref.get();
    if(!doc.exists){
      await ref.set({
        name: '', username: '', bio: '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        lastActive: serverTime(),
        createdAt: serverTime()
      });
    }else{
      await ref.update({ lastActive: serverTime() });
    }
  }catch(e){ console.error('Could not initialize profile:', e); }
}

/** Saves the signed-in user's own profile fields. */
export function saveOwnProfile(fields){
  return refs.profile(me()).set(fields, { merge: true });
}

/* ---------------- BOARD SETTINGS ---------------- */

export function saveSettings(fields){
  return refs.settings().set({ ...fields, updatedBy: me(), updatedAt: serverTime() }, { merge: true });
}
