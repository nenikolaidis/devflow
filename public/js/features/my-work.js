/* =========================================================
   features/my-work.js — the "My work" tab: everything that needs the
   signed-in person, in one place.

     Assigned to me          open tickets I own (blocked first, then priority)
     Waiting for my review   In review tickets where I'm a reviewer
     Recently completed      the last few tickets I own that reached Done
========================================================= */
import { state } from '../core/state.js';
import { STATUS, PRIORITIES, normalizeStatus, statusLabel } from '../core/constants.js';
import { html } from '../core/html.js';
import { icon, statusIcon, typeIcon, priorityIcon } from '../core/icons.js';
import { isMe } from '../core/permissions.js';
import { typeOf } from '../core/constants.js';
import { isMyReview } from '../core/workflow.js';
import { dueBadge, ticketFlags, checklistBadge } from './ticket-common.js';
import { openDetail } from './ticket-detail.js';

const panelsEl = document.getElementById('myWorkPanels');
const subEl = document.getElementById('myWorkSub');

panelsEl.addEventListener('click', e => {
  const row = e.target.closest('[data-fid]');
  if(row) openDetail(row.dataset.fid);
});

const byUrgency = (a, b) => (b.blocked ? 1 : 0) - (a.blocked ? 1 : 0)
  || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)
  || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));

export function renderMyWork(){
  const active = state.tickets.filter(t => !t.archived);
  const isDone = (t) => normalizeStatus(t.status) === STATUS.DONE;
  const assigned = active.filter(t => isMe(t.owner) && !isDone(t)).sort(byUrgency);
  const reviews = active.filter(t => isMyReview(t) && normalizeStatus(t.status) === STATUS.IN_REVIEW).sort(byUrgency);
  const millis = (t) => (t.lastActivityAt && t.lastActivityAt.toMillis ? t.lastActivityAt.toMillis() : 0);
  const completed = active.filter(t => isMe(t.owner) && isDone(t)).sort((a, b) => millis(b) - millis(a)).slice(0, 5);

  subEl.textContent = `${assigned.length} open · ${reviews.length} to review`;
  panelsEl.innerHTML = html`
    ${section('Assigned to me', icon('inbox'), assigned, 'Nothing assigned to you right now.')}
    ${section('Waiting for my review', icon('eye'), reviews, 'No reviews waiting for you.')}
    ${section('Recently completed', icon('check'), completed, 'Nothing completed yet.')}`;
}

function section(title, ic, rows, empty){
  return html`
    <section class="panel work-panel">
      <h2 class="cell-inline">${ic}${title}<span class="count-pill">${rows.length}</span></h2>
      ${rows.length ? html`<div class="work-list">${rows.map(row)}</div>` : html`<div class="empty-note">${empty}</div>`}
    </section>`;
}

function row(t){
  return html`
    <button type="button" class="work-row" data-fid="${t.firestoreId}">
      ${typeIcon(typeOf(t), 15)}
      <span class="card-id">${t.id}</span>
      <span class="work-title">${t.title}${ticketFlags(t)}</span>
      <span class="work-meta">
        ${checklistBadge(t)}
        ${dueBadge(t)}
        <span class="cell-inline muted-text" title="${statusLabel(t.status)}">${statusIcon(t.status, 14)}</span>
        ${priorityIcon(t.priority)}
      </span>
    </button>`;
}
