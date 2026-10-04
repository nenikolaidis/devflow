/* =========================================================
   features/ticket-actions.js — what happens when someone acts on a
   ticket: check the workflow rules, write to Firestore (data/api.js),
   log activity, send Discord/email notifications, show a toast.

   Screens (board, table, detail, forms) call these instead of talking
   to the database directly, so every path behaves the same way.
   Each function returns true on success, false otherwise.
========================================================= */
import * as api from '../data/api.js';
import { deleteField } from '../data/firebase.js';
import { ACTIVITY, LIMITS, STATUS, normalizeStatus, statusLabel, reviewersOf } from '../core/constants.js';
import { typeInfo, typeOf } from '../core/settings.js';
import { moveBlockedReason, wipWarning } from '../core/workflow.js';
import { showToast, confirmDialog, promptDialog } from '../core/ui.js';
import { isPermissionError } from '../core/format.js';
import { toggleChecklistLine } from '../core/markdown.js';
import { displayName } from '../core/people.js';
import { notifyAssignment } from '../integrations/email.js';
import {
  notifyTicketCreated, notifyTicketAssigned, notifyTicketBlocked,
  notifyTicketsArchived, notifyTicketsDeleted, notifyReviewRequested
} from '../integrations/discord.js';

function fail(what, e){
  console.error(what, e);
  showToast(isPermissionError(e) ? `${what}: you don't have permission for that.` : `${what}: ${e.message}`, 'error');
  return false;
}

/* ---------------- STATUS ---------------- */

/** Moves one ticket, enforcing workflow rules and warning about WIP limits. */
export async function moveTicket(t, status){
  if(normalizeStatus(t.status) === status) return false;
  const reason = moveBlockedReason(t, status);
  if(reason){ showToast(reason); return false; }
  const warning = wipWarning(status, 1);
  try{
    await api.setStatus([t], status);
    if(status === STATUS.IN_REVIEW) notifyReviewRequested(t, reviewersOf(t).map(displayName));
    showToast(`${t.id} moved to ${statusLabel(status)}${warning}`);
    return true;
  }catch(e){ return fail('Could not move ticket', e); }
}

/** Bulk move: tickets the workflow doesn't allow are skipped (and counted) instead of failing the batch. */
export async function moveTickets(tickets, status){
  const candidates = tickets.filter(t => !t.archived && normalizeStatus(t.status) !== status);
  const toMove = candidates.filter(t => !moveBlockedReason(t, status));
  const skipped = candidates.filter(t => moveBlockedReason(t, status));
  if(toMove.length === 0){
    showToast(skipped.length ? moveBlockedReason(skipped[0], status) : 'Nothing to move');
    return false;
  }
  const warning = wipWarning(status, toMove.length);
  try{
    await api.setStatus(toMove, status);
    const skippedNote = skipped.length ? ` · ${skipped.length} skipped (needs a reviewer, or only the reviewer/PM/admin can close it)` : '';
    showToast(`${toMove.length} ticket(s) moved${skippedNote}${warning}`);
    return true;
  }catch(e){ return fail('Bulk move failed', e); }
}

/* ---------------- ARCHIVE / RESTORE / DELETE ---------------- */

export async function archiveTickets(tickets){
  const active = tickets.filter(t => !t.archived);
  if(active.length === 0){ showToast('Already archived'); return false; }
  const label = active.length === 1 ? active[0].id : `${active.length} tickets`;
  const ok = await confirmDialog({
    title: `Archive ${label}?`,
    message: 'Archived tickets are hidden from the board and dashboard, but keep their comments and history. An admin or PM can restore them.',
    confirmLabel: 'Archive'
  });
  if(!ok) return false;
  try{
    await api.setArchived(active, true);
    notifyTicketsArchived(active);
    showToast(`${label} archived`);
    return true;
  }catch(e){ return fail('Could not archive', e); }
}

export async function restoreTicket(t){
  try{
    await api.setArchived([t], false);
    showToast(`${t.id} restored`);
    return true;
  }catch(e){ return fail('Could not restore', e); }
}

export async function deleteTicketPermanently(t){
  const ok = await confirmDialog({
    title: `Permanently delete ${t.id}?`,
    message: 'This removes the ticket for good and cannot be undone.',
    confirmLabel: 'Delete permanently',
    danger: true
  });
  if(!ok) return false;
  try{
    await api.deleteTicket(t.firestoreId);
    notifyTicketsDeleted([t]);
    showToast(`${t.id} permanently deleted`);
    return true;
  }catch(e){ return fail('Could not delete', e); }
}

/* ---------------- BLOCKED FLAG ---------------- */

/** Asks for a reason and marks the ticket blocked, or clears the flag if it's already set. */
export async function toggleBlocked(t){
  if(t.blocked){
    try{
      await api.setBlocked(t.firestoreId, null);
      showToast(`${t.id} unblocked`);
      return true;
    }catch(e){ return fail('Could not update', e); }
  }
  const reason = await promptDialog({
    title: `Mark ${t.id} blocked`,
    label: 'What is blocking it?',
    placeholder: 'Waiting on API keys from the client…',
    multiline: true,
    maxLength: LIMITS.BLOCKED_REASON,
    confirmLabel: 'Mark blocked'
  });
  if(!reason) return false;
  try{
    await api.setBlocked(t.firestoreId, reason);
    notifyTicketBlocked(t, reason);
    showToast(`${t.id} marked blocked`);
    return true;
  }catch(e){ return fail('Could not update', e); }
}

/* ---------------- CREATE / EDIT ---------------- */

export async function createTicket(fields){
  try{
    const { id } = await api.createTicket(fields);
    const ticket = { ...fields, id };
    notifyTicketCreated(ticket);
    if(ticket.owner) notifyAssignment(ticket);
    showToast(`${id} created`);
    return true;
  }catch(e){ return fail('Could not create ticket', e); }
}

const EDIT_FIELD_NAMES = {
  title: 'title', description: 'description', priority: 'priority', type: 'type',
  dueDate: 'due date', linkUrl: 'link', labels: 'labels', sprintId: 'sprint'
};

/**
 * Saves changed fields on an existing ticket and records what changed:
 * owner and reviewer changes get their own activity entries (and owner
 * changes notify the new owner); everything else is summarised in one.
 * `reviewers` is a list; tickets that still have the old single
 * `reviewer` field get it removed on save.
 */
export async function saveTicketChanges(existing, changes){
  // Compare against the effective values (older tickets have an inferred type and a single reviewer).
  const current = { ...existing, type: typeOf(existing), reviewers: reviewersOf(existing) };
  const empty = (k) => (k === 'labels' || k === 'reviewers' ? [] : '');
  const same = (k) => JSON.stringify(changes[k] ?? empty(k)) === JSON.stringify(current[k] ?? empty(k));
  const changedKeys = Object.keys(changes).filter(k => !same(k));
  if(changedKeys.length === 0){ showToast('No changes'); return true; }

  const toWrite = {};
  changedKeys.forEach(k => { toWrite[k] = changes[k]; });
  if(changedKeys.includes('reviewers') && existing.reviewer !== undefined) toWrite.reviewer = deleteField();
  try{
    await api.updateTicket(existing.firestoreId, toWrite);
  }catch(e){ return fail('Could not save', e); }

  const updated = { ...current, ...changes };
  if(changedKeys.includes('owner') && updated.owner){
    notifyAssignment(updated);
    notifyTicketAssigned(updated);
    api.logActivity(existing.firestoreId, { type: ACTIVITY.ASSIGNMENT, from: existing.owner || 'Unassigned', to: updated.owner });
  }
  if(changedKeys.includes('reviewers')){
    // Logged separately so it's visible if someone makes themselves reviewer just to close a ticket.
    api.logActivity(existing.firestoreId, {
      type: ACTIVITY.REVIEWER,
      from: current.reviewers.join(', ').slice(0, 200),
      to: updated.reviewers.join(', ').slice(0, 200)
    });
  }
  const others = changedKeys.filter(k => EDIT_FIELD_NAMES[k]).map(k =>
    k === 'priority' ? `priority (${existing.priority} → ${updated.priority})`
    : k === 'type' ? `type (${typeInfo(updated.type).label})`
    : EDIT_FIELD_NAMES[k]);
  if(others.length){
    api.logActivity(existing.firestoreId, { type: ACTIVITY.EDIT, summary: others.join(', ').slice(0, 200) });
  }
  showToast(`${existing.id} updated`);
  return true;
}

/* ---------------- CHECKLISTS & DEFINITION OF DONE ---------------- */

/** Ticks/unticks the "- [ ]" checklist line `lineIndex` in a ticket's description. */
export async function toggleChecklistItem(t, lineIndex){
  const description = toggleChecklistLine(t.description, lineIndex);
  if(description === t.description) return false;
  const line = (description.split(/\r?\n/)[lineIndex] || '').replace(/^\s*[-*]\s+\[(.)\]\s?/, (_, m) => (m === ' ' ? '✗ ' : '✓ '));
  try{
    await api.updateTicket(t.firestoreId, { description });
    api.logActivity(t.firestoreId, { type: ACTIVITY.EDIT, summary: `checklist: ${line}`.slice(0, 200) });
    return true;
  }catch(e){ return fail('Could not update the checklist', e); }
}

/** Ticks/unticks one Definition of Done item. */
export async function toggleDodItem(t, item, done){
  try{
    await api.setDodItem(t, item, done);
    return true;
  }catch(e){ return fail('Could not update the Definition of Done', e); }
}
