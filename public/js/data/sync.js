/* =========================================================
   data/sync.js — live Firestore listeners.

   startSync() runs once an approved user signs in: it keeps `state`
   up to date and emits an event after each change, so whichever screen
   is showing can repaint (see features/nav.js). stopSync() detaches
   everything on sign-out.

   The watch*() helpers at the bottom are for short-lived listeners a
   single dialog needs (comments, activity); they return an unsubscribe
   function the dialog calls when it closes.
========================================================= */
import { refs } from './api.js';
import { state } from '../core/state.js';
import { emit, EVENTS } from '../core/events.js';
import { showToast } from '../core/ui.js';

let unsubscribers = [];

function listen(query, onSnapshot, label){
  unsubscribers.push(query.onSnapshot(onSnapshot, err => {
    console.error(`${label} sync error:`, err);
    showToast(`${label} sync error: ${err.message}`);
  }));
}

/** Attaches the app-wide listeners. Admins also get access requests. */
export function startSync({ isAdmin }){
  stopSync();

  listen(refs.tickets().orderBy('createdAt', 'desc'), snap => {
    state.tickets = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    emit(EVENTS.TICKETS_CHANGED);
  }, 'Tickets');

  listen(refs.allowlist(), snap => {
    state.allowlist = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    emit(EVENTS.TEAM_CHANGED);
  }, 'Team');

  listen(refs.profiles(), snap => {
    const map = {};
    snap.docs.forEach(d => { map[d.id] = d.data(); });
    state.profiles = map;
    emit(EVENTS.PROFILES_CHANGED);
  }, 'Profiles');

  listen(refs.settings(), doc => {
    state.settings = doc.exists ? doc.data() : {};
    emit(EVENTS.SETTINGS_CHANGED);
  }, 'Settings');

  if(isAdmin){
    listen(refs.requests(), snap => {
      state.accessRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit(EVENTS.REQUESTS_CHANGED);
    }, 'Access requests');
  }
}

/** Detaches every app-wide listener and clears live data. */
export function stopSync(){
  unsubscribers.forEach(unsub => unsub());
  unsubscribers = [];
  state.tickets = [];
  state.allowlist = [];
  state.accessRequests = [];
  state.profiles = {};
  state.settings = null;
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
