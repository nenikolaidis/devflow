/* =========================================================
   features/ticket-detail.js — the ticket side panel: status steps,
   details, description, link, actions (edit / block / archive /
   restore / delete), and a Comments | Activity switcher.

   It closes after an action that changes the ticket; reopening shows
   fresh data from state.
========================================================= */
import { STATUSES, normalizeStatus, reviewersOf } from '../core/constants.js';
import { html } from '../core/html.js';
import { renderMarkdown, checklistProgress, toggleChecklistLine } from '../core/markdown.js';
import { getSettings } from '../core/settings.js';
import { icon, statusIcon } from '../core/icons.js';
import { formatDateTime, safeUrl } from '../core/format.js';
import { can, isAdmin } from '../core/permissions.js';
import { displayName, avatarHtml } from '../core/people.js';
import { moveBlockedReason, isOverdue, dodMissing } from '../core/workflow.js';
import { openModal, showToast } from '../core/ui.js';
import { findTicket, priorityWithLabel, labelList, dueBadge, typeWithLabel, visibleLabels } from './ticket-common.js';
import { openTicketForm } from './ticket-form.js';
import { openTemplateEditor } from './manage/templates.js';
import { typeOf } from '../core/settings.js';
import { sprintById, sprintLabel } from './sprints.js';
import { mountComments } from './comments.js';
import { mountActivityLog } from './activity-log.js';
import { moveTicket, toggleBlocked, archiveTickets, restoreTicket, deleteTicketPermanently, toggleChecklistItem, toggleDodItem } from './ticket-actions.js';

export function openDetail(firestoreId){
  const t = findTicket(firestoreId);
  if(!t){ showToast('That ticket no longer exists'); return; }
  const moderator = can('archiveTickets');
  const canEdit = can('editTickets');
  // Archived tickets are read-only for everyone except admins/PMs (who can restore them).
  const readOnly = (t.archived && !moderator) || !canEdit;
  const link = safeUrl(t.linkUrl);
  const reviewers = reviewersOf(t);
  const checklist = checklistProgress(t.description);
  const dodItems = getSettings().dodItems;
  const dodTicked = t.dod || {};
  const unsubscribers = [];

  const headerActions = t.archived
    ? html`${moderator ? html`<button type="button" data-act="restore">${icon('restore', 14)}Restore</button>` : ''}
           ${isAdmin() ? html`<button type="button" class="danger" data-act="delete">${icon('trash', 14)}Delete</button>` : ''}`
    : html`${canEdit ? html`<button type="button" data-act="block">${icon('blocked', 14)}${t.blocked ? 'Unblock' : 'Mark blocked'}</button>
           <button type="button" data-act="edit">${icon('edit', 14)}Edit</button>` : ''}
           ${can('manageContent') ? html`<button type="button" class="ghost" data-act="template" title="Save as template" aria-label="Save as template">${icon('file', 14)}</button>` : ''}
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
        <dt>Type</dt><dd>${typeWithLabel(t)}</dd>
        <dt>Priority</dt><dd>${priorityWithLabel(t.priority)}</dd>
        <dt>Owner</dt><dd>${avatarHtml(t.owner, 22)}${t.owner ? displayName(t.owner) : html`<span class="muted">Unassigned</span>`}</dd>
        <dt>Reviewers</dt><dd>${reviewers.length
          ? reviewers.map(r => html`<span class="person-chip static">${avatarHtml(r, 20)}${displayName(r)}</span>`)
          : html`<span class="muted">No reviewers yet</span>`}</dd>
        <dt>Due date</dt><dd>${t.dueDate ? html`${dueBadge(t)}${isOverdue(t) ? html`<span class="flag flag-overdue">Overdue</span>` : ''}` : html`<span class="muted">No due date</span>`}</dd>
        <dt>Sprint</dt><dd>${sprintById(t.sprintId) ? sprintLabel(sprintById(t.sprintId)) : html`<span class="muted">Not planned</span>`}</dd>
        <dt>Labels</dt><dd>${visibleLabels(t).length ? labelList(t.labels, { boxed: true }) : html`<span class="muted">None</span>`}</dd>
        <dt>Created</dt><dd>${t.createdBy ? displayName(t.createdBy) : '—'}${t.createdAt ? html`<span class="muted">· ${formatDateTime(t.createdAt)}</span>` : ''}</dd>
      </dl>

      <div class="detail-section">
        <div class="section-head">
          <h3 class="section-label">Description</h3>
          ${checklist.total ? html`<span class="checklist-badge ${checklist.done === checklist.total ? 'complete' : ''}">${icon('listCheck', 12)}${checklist.done}/${checklist.total} done</span>` : ''}
        </div>
        ${t.description
          ? html`<div class="markdown" id="detailDesc">${renderMarkdown(t.description, { interactive: !readOnly })}</div>`
          : html`<p class="detail-desc empty">No description yet.</p>`}
      </div>

      ${dodItems.length ? html`
        <div class="detail-section dod-box ${dodMissing(t).length ? '' : 'complete'}">
          <div class="section-head">
            <h3 class="section-label">Definition of Done</h3>
            <span class="checklist-badge ${dodMissing(t).length ? '' : 'complete'}">${dodItems.length - dodMissing(t).length}/${dodItems.length}</span>
          </div>
          <ul class="md-checklist" id="dodList">
            ${dodItems.map(item => html`<li class="${dodTicked[item.id] === true ? 'done' : ''}"><label>
              <input type="checkbox" data-dod="${item.id}" ${dodTicked[item.id] === true ? 'checked' : ''} ${readOnly ? 'disabled' : ''}><span>${item.text}</span></label></li>`)}
          </ul>
          <p class="field-hint">Every item must be ticked before this ticket can move to Done.</p>
        </div>` : ''}

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

  unsubscribers.push(mountComments(m.$('#detailComments'), t, { readOnly: (t.archived && !moderator) || !can('comment') }));
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

  // Ticking a checklist item in the description or the Definition of Done saves it right away.
  // (The panel then reflects the click; the board updates live.)
  const desc = m.$('#detailDesc');
  if(desc){
    desc.addEventListener('change', async e => {
      const box = e.target.closest('input[data-line]');
      if(!box) return;
      box.disabled = true;
      const ok = await toggleChecklistItem(t, Number(box.dataset.line));
      if(ok) t.description = toggleChecklistLine(t.description, Number(box.dataset.line));
      else box.checked = !box.checked;
      box.disabled = false;
      box.closest('li').classList.toggle('done', box.checked);
    });
  }
  const dodList = m.$('#dodList');
  if(dodList){
    dodList.addEventListener('change', async e => {
      const box = e.target.closest('input[data-dod]');
      if(!box) return;
      const item = dodItems.find(i => i.id === box.dataset.dod);
      box.disabled = true;
      const ok = await toggleDodItem(t, item, box.checked);
      if(ok){ t.dod = { ...(t.dod || {}), [item.id]: box.checked }; refreshStatusLocks(); }
      else box.checked = !box.checked;
      box.disabled = false;
      box.closest('li').classList.toggle('done', box.checked);
    });
  }

  /** Re-checks which status moves are allowed (e.g. Done unlocks once the Definition of Done is ticked). */
  function refreshStatusLocks(){
    m.$$('.status-track button').forEach(btn => {
      if(btn.classList.contains('active')) return;
      const reason = moveBlockedReason(t, btn.dataset.status);
      btn.classList.toggle('locked', !!reason);
      btn.title = reason || `Move to ${btn.textContent.trim()}`;
    });
  }

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
    delete: async () => { if(await deleteTicketPermanently(t)) m.close(); },
    template: () => {
      m.close();
      openTemplateEditor({ id: null, name: t.title.slice(0, 60), type: typeOf(t), priority: t.priority, labels: t.labels || [],
        reviewers: reviewersOf(t), description: t.description || '', enabled: true });
    }
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
