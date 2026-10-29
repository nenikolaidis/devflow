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
import { db, auth, serverTime, deleteField } from './firebase.js';
import { state } from '../core/state.js';
import { COLLECTIONS, DOCS, STATUS, ACTIVITY, DEFAULT_ROLES, DEFAULT_TEMPLATES, DATA_VERSION, normalizeStatus } from '../core/constants.js';
import { normEmail, roleName } from '../core/permissions.js';
import { logAdmin } from './log.js';
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
  notification: (id) => db.collection(COLLECTIONS.NOTIFICATIONS).doc(id),
  logs: () => db.collection(COLLECTIONS.LOGS),
  log: (id) => db.collection(COLLECTIONS.LOGS).doc(id)
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
export async function deleteTicket(fid){
  const t = state.tickets.find(x => x.firestoreId === fid);
  await refs.ticket(fid).delete();
  logAdmin('ticket-deleted', `${t ? `${t.id} "${String(t.title || '').slice(0, 80)}"` : 'A ticket'} deleted permanently`, t ? t.id : fid);
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
  logAdmin('project-created', `Project ${key} · ${name} created`, key);
  return ref.id;
}

/** Name, key, description, status — workspace admins only. */
export async function updateProject(pid, fields){
  const before = state.projects.find(p => p.id === pid) || {};
  await refs.project(pid).update({ ...fields, updatedBy: me(), updatedAt: serverTime() });
  const label = `${fields.key || before.key || ''} · ${fields.name || before.name || pid}`;
  if(fields.status && fields.status !== before.status) logAdmin(fields.status === 'archived' ? 'project-archived' : 'project-restored', `Project ${label} ${fields.status === 'archived' ? 'archived' : 'restored'}`, pid);
  else logAdmin('project-updated', `Project ${label} renamed or edited`, pid);
}

/** Replaces a project's members ({ email: roleId }); keeps memberEmails in step (the rules check). */
export async function setProjectMembers(pid, members){
  const p = state.projects.find(x => x.id === pid) || { members: {} };
  const before = p.members || {};
  await refs.project(pid).update({ members, memberEmails: Object.keys(members), updatedBy: me(), updatedAt: serverTime() });
  const name = p.name || pid;
  Object.keys(members).forEach(e => {
    if(!before[e]) logAdmin('member-added', `${e} added to ${name} as ${roleName(members[e])}`, e);
    else if(before[e] !== members[e]) logAdmin('member-role', `${e} is now ${roleName(members[e])} in ${name} (was ${roleName(before[e])})`, e);
  });
  Object.keys(before).filter(e => !members[e]).forEach(e => logAdmin('member-removed', `${e} removed from ${name}`, e));
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
  logAdmin('project-request-approved', `Project request ${req.key} · ${req.name} from ${req.requestedBy} approved`, req.requestedBy);
  return pid;
}

export async function declineProjectRequest(req){
  await refs.projectRequest(req.id).update({ status: 'declined', decidedBy: me(), decidedAt: serverTime() });
  logAdmin('project-request-declined', `Project request ${req.key} · ${req.name} from ${req.requestedBy} declined`, req.requestedBy);
}

export function withdrawProjectRequest(id){
  return refs.projectRequest(id).delete();
}

/* ---------------- ROLES (workspace admins) ---------------- */

export async function saveRole(id, { name, description = '', order = 99, permissions }){
  const before = state.roles[id];
  await refs.role(id).set({ name, description, order, permissions, updatedBy: me(), updatedAt: serverTime() });
  const on = Object.keys(permissions).filter(k => permissions[k]);
  const changed = before ? Object.keys({ ...permissions, ...before.permissions }).filter(k => !!permissions[k] !== !!(before.permissions || {})[k]) : [];
  logAdmin(before ? 'role-changed' : 'role-created',
    before ? `Role "${name}" changed${changed.length ? `: ${changed.map(k => `${permissions[k] ? '+' : '−'}${k}`).join(', ')}` : ''}` : `Role "${name}" created with ${on.length} permissions`, id);
}

export async function deleteRole(id){
  const name = (state.roles[id] && state.roles[id].name) || id;
  await refs.role(id).delete();
  logAdmin('role-deleted', `Role "${name}" deleted`, id);
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
  const hadRequest = state.accessRequests.some(r => r.id === normEmail(email));
  await refs.member(email).set({ role, addedBy: me(), addedAt: serverTime() });
  await refs.request(email).delete().catch(() => {});
  logAdmin(hadRequest ? 'request-approved' : 'person-added', `${normEmail(email)} ${hadRequest ? 'approved' : 'added to the workspace'}${role === 'admin' ? ' as a workspace admin' : ''}`, normEmail(email));
}

export async function setWorkspaceRole(email, role){
  await refs.member(email).update({ role });
  logAdmin('workspace-role', `${normEmail(email)} is now ${role === 'admin' ? 'a workspace admin' : 'a member'}`, normEmail(email));
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
  logAdmin('person-removed', `${e} removed from the workspace (and every project)`, e);
}

export function requestAccess(email){
  return refs.request(email).set({ email: normEmail(email), requestedAt: serverTime() });
}

/** Denies (deletes) an access request. */
export async function deleteRequest(email){
  await refs.request(email).delete();
  logAdmin('request-denied', `Access request from ${normEmail(email)} denied`, normEmail(email));
}

/* ---------------- ACCOUNTS & CONNECTION ---------------- */

/**
 * Emails someone a link to choose a new password (the same email as
 * "Forgot password?"). Firebase doesn't say whether the address has an
 * account, so this succeeds either way.
 */
export async function sendPasswordReset(email){
  await auth.sendPasswordResetEmail(normEmail(email));
  logAdmin('password-reset', `Password reset email sent to ${normEmail(email)}`, normEmail(email));
}

/** Deletes log entries (Manage → Logs → Clear problems). Workspace admins only. */
export async function deleteLogEntries(ids){
  for(let i = 0; i < ids.length; i += 400){
    const batch = db.batch();
    ids.slice(i, i + 400).forEach(id => batch.delete(refs.log(id)));
    await batch.commit();
  }
}

/** Drops and reopens the database connection, so a retry doesn't wait for Firebase's own back-off. */
export async function reconnect(){
  try{ await db.disableNetwork(); await db.enableNetwork(); }
  catch(e){ console.warn('Reconnect failed:', e); }
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

export async function saveSettings(fields){
  await refs.settings().set({ ...fields, updatedBy: me(), updatedAt: serverTime() }, { merge: true });
  const where = state.project ? state.project.name : 'the project';
  const keys = Object.keys(fields);
  if(keys.some(k => ['discordWebhookUrl', 'weeklySummary'].includes(k))){
    const hook = 'discordWebhookUrl' in fields ? (fields.discordWebhookUrl ? 'Discord webhook set' : 'Discord webhook removed') : '';
    const weekly = 'weeklySummary' in fields ? `weekly summary ${fields.weeklySummary ? 'on' : 'off'}` : '';
    logAdmin('integrations-changed', `${where}: ${[hook, weekly].filter(Boolean).join(', ')}`, state.projectId || '');
  }
  if(keys.some(k => ['dodItems', 'dodRequired', 'wipLimits', 'staleDays'].includes(k))){
    logAdmin('workflow-changed', `${where}: workflow changed (Definition of Done, WIP limits or stale days)`, state.projectId || '');
  }
}
