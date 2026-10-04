/* =========================================================
   core/permissions.js — "who am I and what may I do" checks.

   These only decide what the UI shows. The real enforcement is in
   firestore.rules — keep the two in step when changing permissions.
========================================================= */
import { state } from './state.js';
import { ROLES } from './constants.js';

export function normEmail(email){
  return (email || '').trim().toLowerCase();
}

export function myEmail(){
  return normEmail(state.currentUser && state.currentUser.email);
}

export function isMe(email){
  return !!email && normEmail(email) === myEmail();
}

export function isAdmin(){
  return state.currentRole === ROLES.ADMIN;
}

/** Admins and PMs: archive/restore tickets, close any ticket, moderate comments. */
export function canModerate(){
  return state.currentRole === ROLES.ADMIN || state.currentRole === ROLES.PM;
}
