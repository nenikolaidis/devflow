/* =========================================================
   features/ticket-detail.js — the ticket side panel: status steps,
   details, description, link, actions (edit / block / archive /
   restore / delete), and a Comments | Activity switcher.

   It closes after an action that changes the ticket; reopening shows
   fresh data from state.
========================================================= */
import { STATUSES, normalizeStatus } from '../core/constants.js';
import { html } from '../core/html.js';
import { icon, statusIcon } from '../core/icons.js';
import { formatDateTime, safeUrl } from '../core/format.js';
import { canModerate, isAdmin } from '../core/permissions.js';
import { displayName, avatarHtml } from '../core/people.js';
import { moveBlockedReason, isOverdue } from '../core/workflow.js';
import { openModal, showToast } from '../core/ui.js';
import { findTicket, priorityWithLabel, labelList, dueBadge } from './ticket-common.js';
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

  const headerActions = t.archived
    ? html`${moderator ? html`<button type="button" data-act="restore">${icon('restore', 14)}Restore</button>` : ''}
           ${isAdmin() ? html`<button type="button" class="danger" data-act="delete">${icon('trash', 14)}Delete</button>` : ''}`
    : html`<button type="button" data-act="block">${icon('blocked', 14)}${t.blocked ? 'Unblock' : 'Mark blocked'}</button>
           <button type="button" data-act="edit">${icon('edit', 14)}Edit</button>
           ${moderator ? html`<button type="button" class="danger" data-act="archive">${icon('archive', 14)}Archive</button>` : ''}`;

  const m = openModal({
    drawer: true,
    label: `${t.id}: ${t.title}`,
    title: html`<div class="drawer-id">
      <span class="card-id">${t.id}</span>
      <button type="button" class="ghost small" data-act="copy" aria-label="Copy commit message" title="Copy commit message: [${t.id}] ${t.title}">${icon('copy', 14)}</button>
    </div>`,
    headerActions,
    initialFocus: '.modal-close',
    onClose: () => unsubscribers.forEach(unsub => unsub()),
    body: html`
      <h2 class="detail-title">${t.title}</h2>

      ${t.archived ? html`<div class="banner banner-archived">${icon('archive')}<div class="banner-body"><strong>Archived${t.archivedBy ? ` by ${displayName(t.archivedBy)}` : ''}</strong><span>${t.archivedAt ? formatDateTime(t.archivedAt) + ' · ' : ''}Hidden from the board and dashboard.</span></div></div>` : ''}
      ${t.blocked ? html`<div class="banner banner-blocked" role="status">${icon('blocked')}<div class="banner-body"><strong>Blocked${t.blockedBy ? ` · flagged by ${displayName(t.blockedBy)}` : ''}</strong><span>${t.blockedReason || 'No reason given.'}</span></div></div>` : ''}

      ${t.archived ? '' : html`<div class="status-track" role="group" aria-label="Status">${STATUSES.map(s => statusButton(t, s))}</div>`}

      <dl class="detail-props">
        <dt>Priority</dt><dd>${priorityWithLabel(t.priority)}</dd>
        <dt>Owner</dt><dd>${avatarHtml(t.owner, 22)}${t.owner ? displayName(t.owner) : html`<span class="muted">Unassigned</span>`}</dd>
        <dt>Reviewer</dt><dd>${t.reviewer ? html`${avatarHtml(t.reviewer, 22)}${displayName(t.reviewer)}` : html`<span class="muted">No reviewer yet</span>`}</dd>
        <dt>Due date</dt><dd>${t.dueDate ? html`${dueBadge(t)}${isOverdue(t) ? html`<span class="flag flag-overdue">Overdue</span>` : ''}` : html`<span class="muted">No due date</span>`}</dd>
        <dt>Labels</dt><dd>${(t.labels || []).length ? labelList(t.labels, { boxed: true }) : html`<span class="muted">None</span>`}</dd>
        <dt>Created</dt><dd>${t.createdBy ? displayName(t.createdBy) : '—'}${t.createdAt ? html`<span class="muted">· ${formatDateTime(t.createdAt)}</span>` : ''}</dd>
      </dl>

      <div>
        <h3 class="section-label">Description</h3>
        <p class="detail-desc ${t.description ? '' : 'empty'}" style="margin-top:8px">${t.description || 'No description yet.'}</p>
      </div>

      ${link ? html`<a class="link-box" href="${link}" target="_blank" rel="noopener noreferrer">${icon('link', 14)}<span>${t.linkUrl}</span></a>` : ''}

      <div>
        <div class="history-tabs" role="tablist" aria-label="Ticket history">
          <button type="button" role="tab" id="tabComments" aria-selected="true" aria-controls="detailComments">Comments</button>
          <button type="button" role="tab" id="tabActivity" aria-selected="false" aria-controls="detailActivity">Activity</button>
        </div>
        <div id="detailComments" role="tabpanel" aria-labelledby="tabComments" style="padding-top:16px"></div>
        <div id="detailActivity" role="tabpanel" aria-labelledby="tabActivity" class="hidden" style="padding-top:8px"></div>
      </div>`
  });

  unsubscribers.push(mountComments(m.$('#detailComments'), t.firestoreId, { readOnly }));
  unsubscribers.push(mountActivityLog(m.$('#detailActivity'), t.firestoreId));

  // Comments | Activity switcher
  const tabs = { tabComments: '#detailComments', tabActivity: '#detailActivity' };
  Object.entries(tabs).forEach(([tabId, panel]) => {
    m.$('#' + tabId).addEventListener('click', () => {
      Object.entries(tabs).forEach(([otherId, otherPanel]) => {
        m.$('#' + otherId).setAttribute('aria-selected', String(otherId === tabId));
        m.$(otherPanel).classList.toggle('hidden', otherId !== tabId);
      });
    });
  });

  // Status buttons: moves the workflow doesn't allow are dimmed, with the reason as a tooltip.
  m.$$('.status-track button').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(await moveTicket(t, btn.dataset.status)) m.close();
    });
  });

  // Every other action closes the panel when it succeeds, so reopening shows fresh data.
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
    title="${current ? 'Current status' : reason || `Move to ${s.label}`}">${reason ? icon('lock', 12) : statusIcon(s.key, 14)}${s.label}</button>`;
}
