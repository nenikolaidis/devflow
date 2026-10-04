/* =========================================================
   data/sync.js — live Firestore listeners, in two layers.

   Workspace (startSync, once an approved user signs in):
     people (allowlist), profiles, roles, my projects, my notifications,
     project requests, meta/workspace, and access requests for admins.
   Current project (switchProject, whenever a project is opened):
     its tickets, sprints, templates and settings.

   Each listener updates `state` and emits an event, so whichever screen
   is showing repaints (see features/nav.js). stopSync() detaches
   everything on sign-out.

   The watch*() helpers at the bottom are for short-lived listeners a
   single dialog needs (comments, activity); they return an unsubscribe
   function the dialog calls when it closes.
========================================================= */
import { refs } from './api.js';
import { state } from '../core/state.js';
import { emit, EVENTS } from '../core/events.js';
import { showToast } from '../core/ui.js';
import { normEmail } from '../core/permissions.js';

const LAST_PROJECT_KEY = 'devflow:lastProject';
let workspaceUnsubs = [];
let projectUnsubs = [];

function listen(list, query, onSnapshot, label, { quiet = false } = {}){
  list.push(query.onSnapshot(onSnapshot, err => {
    console.error(`${label} sync error:`, err);
    if(!quiet) showToast(`${label} sync error: ${err.message}`, 'error');
  }));
}

/* ---------------- WORKSPACE ---------------- */

/** Attaches the workspace listeners. Admins also get access requests and every project. */
export function startSync({ isAdmin }){
  stopSync();
  const me = normEmail(state.currentUser.email);
  const W = workspaceUnsubs;

  listen(W, refs.allowlist(), snap => {
    state.allowlist = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    emit(EVENTS.TEAM_CHANGED);
  }, 'Team');

  listen(W, refs.profiles(), snap => {
    const map = {};
    snap.docs.forEach(d => { map[d.id] = d.data(); });
    state.profiles = map;
    emit(EVENTS.PROFILES_CHANGED);
  }, 'Profiles');

  listen(W, refs.roles(), snap => {
    const map = {};
    snap.docs.forEach(d => { map[d.id] = d.data(); });
    state.roles = map;
    emit(EVENTS.ROLES_CHANGED);
  }, 'Roles');

  // Admins see every project; everyone else, the ones they're a member of.
  const projectsQuery = isAdmin ? refs.projects() : refs.projects().where('memberEmails', 'array-contains', me);
  listen(W, projectsQuery, snap => {
    state.projects = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.status === 'archived') - (b.status === 'archived') || a.name.localeCompare(b.name));
    // Keep the current project's doc fresh (members/roles can change live).
    if(state.projectId){
      const current = state.projects.find(p => p.id === state.projectId);
      if(current) state.project = current;
      else switchProject(pickDefaultProject()); // removed from it, or it vanished
    }else if(state.projects.length){
      switchProject(pickDefaultProject());
    }
    emit(EVENTS.PROJECTS_CHANGED);
  }, 'Projects');

  // Needs the composite index in firestore.indexes.json (to + createdAt).
  listen(W, refs.notifications().where('to', '==', me).orderBy('createdAt', 'desc').limit(30), snap => {
    state.notifications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    emit(EVENTS.NOTIFICATIONS_CHANGED);
  }, 'Notifications', { quiet: true });

  const requestsQuery = isAdmin ? refs.projectRequests().where('status', '==', 'pending') : refs.projectRequests().where('requestedBy', '==', me);
  listen(W, requestsQuery, snap => {
    state.projectRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    emit(EVENTS.PROJECT_REQUESTS_CHANGED);
  }, 'Project requests', { quiet: true });

  listen(W, refs.workspace(), doc => {
    state.workspaceMeta = doc.exists ? doc.data() : null;
    emit(EVENTS.WORKSPACE_CHANGED);
  }, 'Workspace', { quiet: true });

  if(isAdmin){
    listen(W, refs.requests(), snap => {
      state.accessRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit(EVENTS.REQUESTS_CHANGED);
    }, 'Access requests');
  }
}

/** The project to open: last used (if still visible), else the workspace default, else the first. */
function pickDefaultProject(){
  const visible = state.projects.filter(p => p.status !== 'archived');
  let last = null;
  try{ last = localStorage.getItem(LAST_PROJECT_KEY); }catch(e){ /* storage blocked */ }
  return (visible.find(p => p.id === last)
    || visible.find(p => state.workspaceMeta && p.id === state.workspaceMeta.defaultProjectId)
    || visible[0] || state.projects[0] || {}).id || null;
}

/* ---------------- CURRENT PROJECT ---------------- */

/** Opens a project: detaches the old project's listeners and attaches the new one's. */
export function switchProject(pid){
  projectUnsubs.forEach(unsub => unsub());
  projectUnsubs = [];
  Object.assign(state, { projectId: pid, project: state.projects.find(p => p.id === pid) || null,
    tickets: [], settings: null, sprints: [], templates: null, ticketsLoaded: false });
  state.filters.sprint = '';
  state.selectedIds.clear();
  if(pid){ try{ localStorage.setItem(LAST_PROJECT_KEY, pid); }catch(e){ /* ignore */ } }
  emit(EVENTS.PROJECT_SWITCHED);
  if(!pid) return;

  const L = projectUnsubs;
  listen(L, refs.tickets(pid).orderBy('createdAt', 'desc'), snap => {
    state.tickets = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    state.ticketsLoaded = true;
    emit(EVENTS.TICKETS_CHANGED);
  }, 'Tickets');

  listen(L, refs.sprints(pid), snap => {
    state.sprints = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.start).localeCompare(String(b.start)));
    emit(EVENTS.SPRINTS_CHANGED);
  }, 'Sprints');

  listen(L, refs.templates(pid), snap => {
    state.templates = snap.empty ? null : snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    emit(EVENTS.TEMPLATES_CHANGED);
  }, 'Templates', { quiet: true });

  listen(L, refs.settings(pid), doc => {
    state.settings = doc.exists ? doc.data() : {};
    emit(EVENTS.SETTINGS_CHANGED);
  }, 'Settings');
}

/** Detaches every listener and clears live data. */
export function stopSync(){
  [...workspaceUnsubs, ...projectUnsubs].forEach(unsub => unsub());
  workspaceUnsubs = [];
  projectUnsubs = [];
  Object.assign(state, {
    allowlist: [], accessRequests: [], profiles: {}, roles: {}, projects: [], projectRequests: [],
    notifications: [], workspaceMeta: null,
    projectId: null, project: null, tickets: [], settings: null, sprints: [], templates: null, ticketsLoaded: false
  });
}

/* ---------------- SHORT-LIVED LISTENERS ---------------- */

/** Calls onChange(exists) whenever the user's own access request appears/disappears. */
export function watchOwnRequest(email, onChange){
  return refs.request(email).onSnapshot(doc => onChange(doc.exists), err => console.error('Request watch error:', err));
}

/** Calls onChange(docs) with a ticket's comments, oldest first. */
export function watchComments(fid, onChange, onError){
  return refs.comments(fid).orderBy('createdAt', 'asc').onSnapshot(snap => onChange(snap.docs), onError);
}

/** Calls onChange(entries) with a ticket's activity log, oldest first. */
export function watchActivity(fid, onChange, onError){
  return refs.activity(fid).orderBy('createdAt', 'asc').onSnapshot(snap => onChange(snap.docs.map(d => d.data())), onError);
}
