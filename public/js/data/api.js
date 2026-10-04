/* =========================================================
   data/api.js — every one-off Firestore read and write.

   If it touches the database and isn't a live listener, it lives here
   (live listeners are in data/sync.js). Functions throw Firestore errors
   to the caller; the caller decides what to show the user.

   Collections (see ARCHITECTURE.md for every field):
     Workspace
       allowlist/{email}            who is in the workspace (admin | member)
       accessRequests/{email}       "let me in" requests
       profiles/{email}             name, title, status, time zone…
       roles/{roleId}               project roles and their permissions
       projectRequests/{id}         "please create a project" requests
       notifications/{id}           @mentions
     Current project (state.projectId)
       projects/{pid}                       name, key, members {email: roleId}
       projects/{pid}/tickets/{id}          + /comments/{id}, /activity/{id}
       projects/{pid}/sprints/{id}
       projects/{pid}/templates/{id}
       projects/{pid}/config/settings       labels, types, workflow, integrations
       projects/{pid}/meta/counters         next ticket number
========================================================= */
import { db, serverTime, deleteField } from './firebase.js';
import { state } from '../core/state.js';
import { COLLECTIONS, DOCS, STATUS, ACTIVITY, DEFAULT_ROLES, DEFAULT_TEMPLATES, DATA_VERSION, normalizeStatus } from '../core/constants.js';
import { normEmail } from '../core/permissions.js';
import { cleanDod } from '../core/workflow.js';

/* ---------------- REFERENCES ---------------- */
// Project-scoped paths use the current project unless one is given.
const P = (pid = state.projectId) => db.collection(COLLECTIONS.PROJECTS).doc(pid);

export const refs = {
  /* project */
  projects: () => db.collection(COLLECTIONS.PROJECTS),
  project: (pid) => P(pid),
  tickets: (pid) => P(pid).collection(COLLECTIONS.TICKETS),
  ticket: (fid, pid) => P(pid).collection(COLLECTIONS.TICKETS).doc(fid),
  comments: (fid, pid) => P(pid).collection(COLLECTIONS.TICKETS).doc(fid).collection(COLLECTIONS.COMMENTS),
  activity: (fid, pid) => P(pid).collection(COLLECTIONS.TICKETS).doc(fid).collection(COLLECTIONS.ACTIVITY),
  counters: (pid) => P(pid).collection(COLLECTIONS.META).doc(DOCS.COUNTERS),
  sprints: (pid) => P(pid).collection(COLLECTIONS.SPRINTS),
  sprint: (id, pid) => P(pid).collection(COLLECTIONS.SPRINTS).doc(id),
  templates: (pid) => P(pid).collection(COLLECTIONS.TEMPLATES),
  template: (id, pid) => P(pid).collection(COLLECTIONS.TEMPLATES).doc(id),
  settings: (pid) => P(pid).collection(COLLECTIONS.CONFIG).doc(DOCS.SETTINGS),
  /* workspace */
  roles: () => db.collection(COLLECTIONS.ROLES),
  role: (id) => db.collection(COLLECTIONS.ROLES).doc(id),
  projectRequests: () => db.collection(COLLECTIONS.PROJECT_REQUESTS),
  projectRequest: (id) => db.collection(COLLECTIONS.PROJECT_REQUESTS).doc(id),
  workspace: () => db.collection(COLLECTIONS.META).doc(DOCS.WORKSPACE),
  /* single-board data from before projects (read-only; used by data/upgrade.js) */
  legacy: {
    tickets: () => db.collection(COLLECTIONS.TICKETS),
    sub: (fid, name) => db.collection(COLLECTIONS.TICKETS).doc(fid).collection(name),
    sprints: () => db.collection(COLLECTIONS.SPRINTS),
    settings: () => db.collection(COLLECTIONS.CONFIG).doc(DOCS.SETTINGS),
    counters: () => db.collection(COLLECTIONS.META).doc(DOCS.COUNTERS)
  },
  allowlist: () => db.collection(COLLECTIONS.ALLOWLIST),
  member: (email) => db.collection(COLLECTIONS.ALLOWLIST).doc(normEmail(email)),
  requests: () => db.collection(COLLECTIONS.ACCESS_REQUESTS),
  request: (email) => db.collection(COLLECTIONS.ACCESS_REQUESTS).doc(normEmail(email)),
  profiles: () => db.collection(COLLECTIONS.PROFILES),
  profile: (email) => db.collection(COLLECTIONS.PROFILES).doc(normEmail(email)),
  notifications: () => db.collection(COLLECTIONS.NOTIFICATIONS),
  notification: (id) => db.collection(COLLECTIONS.NOTIFICATIONS).doc(id)
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

/** "WEB-007": the project's key plus a zero-padded number. */
const projectKey = () => (state.project && state.project.key) || 'TASK';
const ticketId = (num) => projectKey() + '-' + String(num).padStart(3, '0');

function highestTicketNumber(){
  let max = 0;
  state.tickets.forEach(t => { if(Number.isInteger(t.number)) max = Math.max(max, t.number); });
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
      to: normEmail(to), by: me(), type: 'mention', projectId: state.projectId,
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

/* ---------------- TEMPLATES (current project) ---------------- */

/** Creates (no id) or updates a template. */
export function saveTemplate(id, fields){
  const data = { ...fields, updatedBy: me(), updatedAt: serverTime() };
  return id ? refs.template(id).set(data) : refs.templates().add(data);
}

export function deleteTemplate(id){
  return refs.template(id).delete();
}

/** Writes the built-in templates into the project (replacing what's there). */
export async function resetTemplates(existingIds = []){
  const batch = db.batch();
  existingIds.forEach(id => batch.delete(refs.template(id)));
  DEFAULT_TEMPLATES.forEach((t, i) => batch.set(refs.template(t.id), {
    name: t.name, type: t.type, priority: t.priority || '', labels: t.labels || [], reviewers: [],
    description: t.description, order: i + 1, enabled: true, updatedBy: me(), updatedAt: serverTime()
  }));
  await batch.commit();
}

/* ---------------- PROJECTS ---------------- */

/** Creates a project; `members` = { email: roleId }. Workspace admins only. Returns its id. */
export async function createProject({ name, key, description = '', members = {} }){
  const ref = refs.projects().doc();
  const batch = db.batch();
  batch.set(ref, {
    name, key, description, status: 'active', members, memberEmails: Object.keys(members),
    createdBy: me(), createdAt: serverTime()
  });
  batch.set(refs.counters(ref.id), { ticketNumber: 0 });
  await batch.commit();
  return ref.id;
}

/** Name, key, description, status — workspace admins only. */
export function updateProject(pid, fields){
  return refs.project(pid).update({ ...fields, updatedBy: me(), updatedAt: serverTime() });
}

/** Replaces a project's members ({ email: roleId }); keeps memberEmails in step (the rules check). */
export function setProjectMembers(pid, members){
  return refs.project(pid).update({ members, memberEmails: Object.keys(members), updatedBy: me(), updatedAt: serverTime() });
}

/* ---------------- PROJECT REQUESTS ---------------- */

export function requestProject({ name, key, description }){
  return refs.projectRequests().add({
    name, key, description, fromProjectId: state.projectId,
    requestedBy: normEmail(me()), createdAt: serverTime(), status: 'pending'
  });
}

/** Approves a request: creates the project with the requester as its Project manager. */
export async function approveProjectRequest(req){
  const pid = await createProject({ name: req.name, key: req.key, description: req.description || '', members: { [req.requestedBy]: 'pm' } });
  await refs.projectRequest(req.id).update({ status: 'approved', decidedBy: me(), decidedAt: serverTime(), projectId: pid });
  return pid;
}

export function declineProjectRequest(req){
  return refs.projectRequest(req.id).update({ status: 'declined', decidedBy: me(), decidedAt: serverTime() });
}

export function withdrawProjectRequest(id){
  return refs.projectRequest(id).delete();
}

/* ---------------- ROLES (workspace admins) ---------------- */

export function saveRole(id, { name, description = '', order = 99, permissions }){
  return refs.role(id).set({ name, description, order, permissions, updatedBy: me(), updatedAt: serverTime() });
}

export function deleteRole(id){
  return refs.role(id).delete();
}

/** Creates any built-in role that doesn't exist yet (never overwrites edits). */
export async function ensureDefaultRoles(){
  const existing = new Set((await refs.roles().get()).docs.map(d => d.id));
  const missing = DEFAULT_ROLES.filter(r => !existing.has(r.id));
  if(!missing.length) return 0;
  const batch = db.batch();
  missing.forEach(r => batch.set(refs.role(r.id), {
    name: r.name, description: r.description, order: r.order, permissions: r.permissions, updatedBy: me(), updatedAt: serverTime()
  }));
  await batch.commit();
  return missing.length;
}

/** Marks the workspace as using the projects data layout. */
export function setWorkspaceMeta(fields){
  return refs.workspace().set({ version: DATA_VERSION, ...fields, updatedAt: serverTime() }, { merge: true });
}

/* ---------------- WORKSPACE PEOPLE & ACCESS ---------------- */

/** The role on someone's allowlist entry, or null if they aren't approved. */
export async function getRole(email){
  const doc = await refs.member(email).get();
  return doc.exists ? (doc.data().role || null) : null;
}

/**
 * Lets someone into the workspace (workspace role 'admin' or 'member')
 * and clears any pending access request. Adding them to projects is
 * separate (setProjectMembers).
 */
export async function addWorkspaceMember(email, role = 'member'){
  await refs.member(email).set({ role, addedBy: me(), addedAt: serverTime() });
  await refs.request(email).delete().catch(() => {});
}

export function setWorkspaceRole(email, role){
  return refs.member(email).update({ role });
}

/** Removes someone from the workspace and from every project I can see. */
export async function removeWorkspaceMember(email){
  const e = normEmail(email);
  const batch = db.batch();
  state.projects.filter(p => p.members && p.members[e]).forEach(p => {
    const members = { ...p.members };
    delete members[e];
    batch.update(refs.project(p.id), { members, memberEmails: Object.keys(members), updatedBy: me(), updatedAt: serverTime() });
  });
  batch.delete(refs.member(e));
  await batch.commit();
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
