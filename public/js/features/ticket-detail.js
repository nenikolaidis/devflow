/* =========================================================
   features/ticket-detail.js — the ticket dialog: status track,
   description, details, actions (edit / block / archive / restore /
   delete), comments and the activity log.

   It closes after an action that changes the ticket; reopening shows
   fresh data from state.
========================================================= */
import { STATUSES, normalizeStatus } from '../core/constants.js';
import { html } from '../core/html.js';
import { formatDate, formatDateTime, safeUrl } from '../core/format.js';
import { canModerate, isAdmin } from '../core/permissions.js';
import { displayName } from '../core/people.js';
import { moveBlockedReason } from '../core/workflow.js';
import { openModal, showToast } from '../core/ui.js';
import { findTicket, priorityPill } from './ticket-common.js';
import { openTicketForm } from './ticket-form.js';
import { mountComments } from './comments.js';
import { mountActivityLog } from './activity-log.js';
import { moveTicket, toggleBlocked, archiveTickets, restoreTicket, deleteTicketPermanently } from './ticket-actions.js';

export function openDetail(firestoreId){
  const t = findTicket(firestoreId);
  if(!t){ showToast('That ticket no longer exists'); return; }
  const moderator = canModerate();
  // Archived tickets are read-only for everyone except admins/PMs (who can restore them).
  const readOnly = t.archived && !moderator;
  const link = safeUrl(t.linkUrl);
  const unsubscribers = [];

  const m = openModal({
    title: html`<span class="card-id">${t.id}</span><h2 class="detail-title">${t.title}</h2>`,
    onClose: () => unsubscribers.forEach(unsub => unsub()),
    body: html`
      ${t.archived ? html`<div class="banner banner-archived">Archived${t.archivedBy ? ` by ${displayName(t.archivedBy)}` : ''}${t.archivedAt ? ` · ${formatDateTime(t.archivedAt)}` : ''}. Hidden from the board and dashboard.</div>` : ''}
      ${t.blocked ? html`<div class="banner banner-blocked" role="status"><strong>⛔ Blocked</strong>${t.blockedBy ? ` · flagged by ${displayName(t.blockedBy)}` : ''}<div>${t.blockedReason || 'No reason given.'}</div></div>` : ''}
      ${t.archived ? '' : html`<div class="status-track" role="group" aria-label="Status">${STATUSES.map(s => statusButton(t, s))}</div>`}
      <div class="detail-desc">${t.description || 'No description provided.'}</div>
      <div class="detail-meta">
        <div><span>Priority</span>${priorityPill(t.priority)}</div>
        <div><span>Due date</span>${t.dueDate ? formatDate(t.dueDate) : '—'}</div>
        <div><span>Owner</span>${t.owner ? displayName(t.owner) : 'Unassigned'}</div>
        <div><span>Reviewer</span>${t.reviewer ? displayName(t.reviewer) : 'Unassigned'}</div>
        <div><span>Labels</span>${(t.labels || []).join(', ') || '—'}</div>
        <div><span>Created by</span>${t.createdBy ? displayName(t.createdBy) : '—'}</div>
      </div>
      <div class="commit-box"><span>[${t.id}] ${t.title}</span><button type="button" class="ghost" data-act="copy">Copy</button></div>
      <div class="modal-actions detail-actions">
        ${t.archived
          ? html`${moderator ? html`<button type="button" data-act="restore">Restore</button>` : ''}
                 ${isAdmin() ? html`<button type="button" class="danger" data-act="delete">Delete permanently</button>` : ''}`
          : html`${moderator ? html`<button type="button" class="danger" data-act="archive">Archive</button>` : ''}
                 <button type="button" data-act="block">${t.blocked ? 'Unblock' : 'Mark blocked'}</button>
                 <button type="button" data-act="edit">Edit</button>`}
      </div>
      ${link ? html`<div class="link-box"><a href="${link}" target="_blank" rel="noopener noreferrer">${t.linkUrl}</a><span class="link-hint">open ↗</span></div>` : ''}
      <section class="comments" aria-label="Comments"><h4>Comments</h4><div id="detailComments"></div></section>
      <section class="comments" aria-label="Activity"><h4>Activity</h4><div id="detailActivity"></div></section>`
  });

  unsubscribers.push(mountComments(m.$('#detailComments'), t.firestoreId, { readOnly }));
  unsubscribers.push(mountActivityLog(m.$('#detailActivity'), t.firestoreId));

  // Status buttons: moves that the workflow doesn't allow are dimmed, with the reason as a tooltip.
  m.$$('.status-track button').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(await moveTicket(t, btn.dataset.status)) m.close();
    });
  });

  // Every other action closes the dialog when it succeeds, so reopening shows fresh data.
  const actions = {
    copy: () => {
      const text = `[${t.id}] ${t.title}`;
      navigator.clipboard.writeText(text).then(() => showToast('Commit message copied')).catch(() => showToast(text));
    },
    edit: () => { m.close(); openTicketForm(t); },
    block: async () => { if(await toggleBlocked(t)) m.close(); },
    archive: async () => { if(await archiveTickets([t])) m.close(); },
    restore: async () => { if(await restoreTicket(t)) m.close(); },
    delete: async () => { if(await deleteTicketPermanently(t)) m.close(); }
  };
  m.$$('[data-act]').forEach(btn => btn.addEventListener('click', () => actions[btn.dataset.act]()));
}

function statusButton(t, s){
  const current = s.key === normalizeStatus(t.status);
  const reason = current ? null : moveBlockedReason(t, s.key);
  return html`<button type="button" data-status="${s.key}"
    class="${current ? 'active' : reason ? 'locked' : ''}"
    ${current ? html`aria-current="step"` : ''}
    title="${reason || ''}">${s.label}</button>`;
}
