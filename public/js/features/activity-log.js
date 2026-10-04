/* =========================================================
   features/activity-log.js — the read-only audit trail shown at the
   bottom of a ticket. Entries are written by data/api.js and can never
   be edited or deleted (firestore.rules forbids it).
========================================================= */
import { ACTIVITY, statusLabel } from '../core/constants.js';
import { html } from '../core/html.js';
import { formatDateTime } from '../core/format.js';
import { displayName } from '../core/people.js';
import { watchActivity } from '../data/sync.js';

/** One plain-English sentence for an activity entry. */
export function describeActivity(entry){
  const who = displayName(entry.actor);
  switch(entry.type){
    case ACTIVITY.CREATED: return `${who} created this ticket`;
    case ACTIVITY.STATUS_CHANGE: return `${who} moved status: ${statusLabel(entry.from)} → ${statusLabel(entry.to)}`;
    case ACTIVITY.ASSIGNMENT: return `${who} assigned this to ${displayName(entry.to)}`;
    case ACTIVITY.REVIEWER: return entry.to ? `${who} set the reviewer to ${displayName(entry.to)}` : `${who} removed the reviewer`;
    case ACTIVITY.EDIT: return `${who} updated ${entry.summary}`;
    case ACTIVITY.BLOCKED: return `${who} marked this blocked: ${entry.reason}`;
    case ACTIVITY.UNBLOCKED: return `${who} cleared the blocked flag`;
    case ACTIVITY.ARCHIVED: return `${who} archived this ticket`;
    case ACTIVITY.RESTORED: return `${who} restored this ticket from the archive`;
    default: return `${who} made a change`;
  }
}

/** Shows a ticket's live activity log in `container`. Returns an unsubscribe function. */
export function mountActivityLog(container, fid){
  return watchActivity(fid, entries => {
    container.innerHTML = entries.length === 0
      ? html`<div class="comment-empty">No activity recorded yet.</div>`
      : html`${entries.map(a => html`
          <div class="comment activity-entry">
            <div class="comment-head"><span>${describeActivity(a)}</span><span>${formatDateTime(a.createdAt)}</span></div>
          </div>`)}`;
  }, () => { container.innerHTML = html`<div class="comment-empty">Could not load activity.</div>`; });
}
