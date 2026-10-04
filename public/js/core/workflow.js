/* =========================================================
   core/workflow.js — the board's process rules, as plain functions.

   - Which status moves are allowed (mirrors firestore.rules, so the UI
     can explain *why* before the database refuses)
   - Work-in-progress (WIP) limits per column
   - Stale and overdue detection
   No DOM and no Firestore here — just decisions.
========================================================= */
import { state } from './state.js';
import { STATUS, STALE_STATUSES, normalizeStatus, statusLabel, reviewersOf } from './constants.js';
import { getSettings } from './settings.js';
import { canModerate, isMe } from './permissions.js';
import { daysSince } from './format.js';

/**
 * Why ticket `t` can't move to `statusKey`, or null if the move is allowed.
 * Keep in step with statusMoveAllowed() in firestore.rules.
 */
export function moveBlockedReason(t, statusKey){
  const reviewers = reviewersOf(t);
  if(statusKey === STATUS.IN_REVIEW && reviewers.length === 0){
    return `Add a reviewer to ${t.id} before moving it to In review`;
  }
  if(statusKey === STATUS.DONE){
    if(!canModerate()){
      if(!reviewers.some(isMe)) return `Only one of ${t.id}'s reviewers, a PM, or an admin can move it to Done`;
      if(isMe(t.owner)) return `You own ${t.id}, so another reviewer (or a PM/admin) has to close it`;
    }
    const missing = dodMissing(t);
    if(missing.length) return `Tick the Definition of Done first: ${missing.map(i => i.text).join(', ')}`;
  }
  return null;
}

/* ---------------- DEFINITION OF DONE ---------------- */

/** The board's Definition of Done items not yet ticked on this ticket. */
export function dodMissing(t){
  const ticked = t.dod || {};
  return getSettings().dodItems.filter(item => ticked[item.id] !== true);
}

/**
 * The ticket's `dod` map trimmed to the current items (all true when
 * complete). Sent when moving to Done, so items an admin has since
 * removed don't block the move in firestore.rules.
 */
export function cleanDod(t){
  const ticked = t.dod || {};
  const out = {};
  getSettings().dodItems.forEach(item => { out[item.id] = ticked[item.id] === true; });
  return out;
}

/** True if I'm one of the ticket's reviewers. */
export function isMyReview(t){
  return reviewersOf(t).some(isMe);
}

/** Active (non-archived) tickets in a column, ignoring filters — what WIP limits count. */
export function columnCount(statusKey){
  return state.tickets.filter(t => !t.archived && normalizeStatus(t.status) === statusKey).length;
}

/** The WIP limit for a column (0 = no limit). */
export function wipLimit(statusKey){
  return getSettings().wipLimits[statusKey] || 0;
}

/** A short warning if adding `adding` tickets to a column would exceed its limit, else ''. */
export function wipWarning(statusKey, adding){
  const limit = wipLimit(statusKey);
  const count = columnCount(statusKey) + adding;
  if(!limit || count <= limit) return '';
  return ` · ${statusLabel(statusKey)} is over its WIP limit (${count}/${limit})`;
}

/** Days a ticket has sat untouched in In progress / In review, or 0 if it isn't stale. */
export function staleDays(t){
  if(t.archived || !STALE_STATUSES.includes(normalizeStatus(t.status))) return 0;
  const days = daysSince(t.lastActivityAt || t.createdAt);
  return days !== null && days >= getSettings().staleDays ? days : 0;
}

/** Past its due date and not done. */
export function isOverdue(t){
  if(!t.dueDate || normalizeStatus(t.status) === STATUS.DONE) return false;
  return new Date(t.dueDate) < new Date(new Date().toDateString());
}
