/* =========================================================
   features/board.js — the Board tab: filter bar, Kanban columns,
   cards, drag & drop, collapsible columns, and multi-select with the
   bulk-action bar. The table view lives in table.js.

   renderBoardView() repaints whichever view (Kanban/table) is active;
   nav.js calls it whenever tickets, team, profiles or settings change.
========================================================= */
import { state } from '../core/state.js';
import { STATUSES, PRIORITY_COLOR, ALL_LABELS, normalizeStatus } from '../core/constants.js';
import { html } from '../core/html.js';
import { formatDate } from '../core/format.js';
import { canModerate } from '../core/permissions.js';
import { displayName, avatarHtml } from '../core/people.js';
import { columnCount, wipLimit, isOverdue } from '../core/workflow.js';
import { matchesFilters, sortTickets, priorityPill, labelChips, ticketFlags, findTicket } from './ticket-common.js';
import { renderTable } from './table.js';
import { openDetail } from './ticket-detail.js';
import { openTicketForm, openQuickEdit } from './ticket-form.js';
import { moveTicket, moveTickets, archiveTickets } from './ticket-actions.js';

const $ = (id) => document.getElementById(id);
const boardEl = $('board');

/** Repaints the active board view (Kanban or table). */
export function renderBoardView(){
  populateAssigneeFilter();
  if(state.boardViewMode === 'kanban') renderKanban(); else renderTable();
}

/* ---------------- FILTER BAR ---------------- */

$('labelFilter').innerHTML = html`<option value="">All labels</option>${ALL_LABELS.map(l => html`<option value="${l}">${l}</option>`)}`;

function populateAssigneeFilter(){
  const sel = $('assigneeFilter');
  const current = sel.value;
  const emails = state.allowlist.map(u => u.id).sort();
  sel.innerHTML = html`<option value="">All assignees</option><option value="__unassigned__">Unassigned</option>${
    emails.map(e => html`<option value="${e}">${displayName(e)}</option>`)}`;
  if(Array.from(sel.options).some(o => o.value === current)) sel.value = current;
}

$('searchInput').addEventListener('input', e => { state.filters.search = e.target.value; renderBoardView(); });
$('priorityFilter').addEventListener('change', e => { state.filters.priority = e.target.value; renderBoardView(); });
$('labelFilter').addEventListener('change', e => { state.filters.label = e.target.value; renderBoardView(); });
$('assigneeFilter').addEventListener('change', e => { state.filters.assignee = e.target.value; renderBoardView(); });
$('sortSelect').addEventListener('change', e => {
  const [key, dir] = e.target.value.split(':');
  state.tableSort = { key, dir };
  renderBoardView();
});
$('archivedToggleBtn').addEventListener('click', e => {
  state.filters.showArchived = !state.filters.showArchived;
  e.currentTarget.classList.toggle('active', state.filters.showArchived);
  e.currentTarget.setAttribute('aria-pressed', String(state.filters.showArchived));
  renderBoardView();
});
$('newTicketBtn').addEventListener('click', () => openTicketForm(null));

function setViewMode(mode){
  state.boardViewMode = mode;
  $('viewKanbanBtn').classList.toggle('active', mode === 'kanban');
  $('viewTableBtn').classList.toggle('active', mode === 'table');
  $('board').classList.toggle('hidden', mode !== 'kanban');
  $('ticketTable').classList.toggle('hidden', mode !== 'table');
  renderBoardView();
}
$('viewKanbanBtn').addEventListener('click', () => setViewMode('kanban'));
$('viewTableBtn').addEventListener('click', () => setViewMode('table'));

/* ---------------- COLLAPSED COLUMNS (remembered per browser) ---------------- */
const COLLAPSED_KEY = 'devflow:collapsedColumns';
try{ state.collapsedColumns = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}'); }
catch(e){ state.collapsedColumns = {}; }

function toggleCollapsed(statusKey){
  state.collapsedColumns[statusKey] = !state.collapsedColumns[statusKey];
  try{ localStorage.setItem(COLLAPSED_KEY, JSON.stringify(state.collapsedColumns)); }catch(e){ /* storage blocked */ }
  renderKanban();
}

/* ---------------- KANBAN ---------------- */

function renderKanban(){
  boardEl.innerHTML = '';
  STATUSES.forEach(status => boardEl.appendChild(renderColumn(status)));
}

function renderColumn(status){
  const collapsed = !!state.collapsedColumns[status.key];
  const tickets = sortTickets(state.tickets.filter(t => normalizeStatus(t.status) === status.key && matchesFilters(t)), state.tableSort);
  const limit = wipLimit(status.key);
  const active = columnCount(status.key);
  const overLimit = limit && active > limit;

  const col = document.createElement('section');
  col.className = 'column' + (collapsed ? ' collapsed' : '') + (overLimit ? ' over-limit' : '');
  col.setAttribute('aria-label', status.label);
  col.innerHTML = html`
    <div class="column-head">
      <h3 class="column-title">${status.label}</h3>
      <div class="column-head-actions">
        ${limit
          ? html`<span class="column-count wip${overLimit ? ' over' : ''}" title="Work-in-progress limit">${active} / ${limit}</span>`
          : html`<span class="column-count">${tickets.length}</span>`}
        <button class="ghost collapse-btn" type="button" aria-expanded="${String(!collapsed)}"
          aria-label="${collapsed ? 'Expand' : 'Collapse'} ${status.label}">${collapsed ? '▸' : '▾'}</button>
      </div>
    </div>`;
  col.querySelector('.collapse-btn').addEventListener('click', () => toggleCollapsed(status.key));
  if(collapsed) return col;

  const body = document.createElement('div');
  body.className = 'column-body';
  if(tickets.length === 0) body.innerHTML = html`<div class="column-empty">No tickets</div>`;
  tickets.forEach(t => body.appendChild(renderCard(t)));

  body.addEventListener('dragover', e => { e.preventDefault(); body.classList.add('drag-over'); });
  body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
  body.addEventListener('drop', e => {
    e.preventDefault();
    body.classList.remove('drag-over');
    const ticket = findTicket(e.dataTransfer.getData('text/plain'));
    if(ticket && !ticket.archived) moveTicket(ticket, status.key);
  });
  col.appendChild(body);
  return col;
}

function renderCard(t){
  const selected = state.selectedIds.has(t.firestoreId);
  const canQuickEdit = !state.selectMode && (!t.archived || canModerate());
  const flags = ticketFlags(t).toString();

  const card = document.createElement('article');
  card.className = 'card' + (state.selectMode ? ' selectable' : '') + (selected ? ' selected' : '') + (t.archived ? ' archived' : '');
  card.style.borderLeftColor = PRIORITY_COLOR[t.priority] || 'var(--gray-chip)';
  card.tabIndex = 0;
  card.setAttribute('aria-label', `${t.id}: ${t.title}`);
  card.innerHTML = html`
    <div class="card-top">
      <div class="card-top-left">
        ${state.selectMode ? html`<span class="card-select-box${selected ? ' checked' : ''}" aria-hidden="true"></span>` : ''}
        <span class="card-id">${t.id}</span>
      </div>
      <div class="card-top-right">
        ${priorityPill(t.priority)}
        ${canQuickEdit ? html`<button class="ghost quick-edit-btn" type="button" title="Quick edit" aria-label="Quick edit ${t.id}">✏️</button>` : ''}
      </div>
    </div>
    <p class="card-title">${t.title}</p>
    ${flags ? html`<div class="card-flags">${ticketFlags(t)}</div>` : ''}
    <div class="card-labels">${labelChips(t.labels)}</div>
    <div class="card-foot">
      ${avatarHtml(t.owner, 20)}
      <span class="due ${isOverdue(t) ? 'overdue' : ''}">${t.dueDate ? formatDate(t.dueDate) : 'No due date'}</span>
    </div>`;

  const activate = state.selectMode ? () => toggleSelected(t) : () => openDetail(t.firestoreId);
  card.addEventListener('click', activate);
  card.addEventListener('keydown', e => { if(e.target === card && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); activate(); } });

  if(!state.selectMode){
    card.draggable = !t.archived;
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', t.firestoreId);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    const qe = card.querySelector('.quick-edit-btn');
    if(qe) qe.addEventListener('click', e => { e.stopPropagation(); openQuickEdit(t); });
  }
  return card;
}

/* ---------------- MULTI-SELECT & BULK BAR ---------------- */

$('selectModeBtn').addEventListener('click', () => {
  state.selectMode = !state.selectMode;
  state.selectedIds.clear();
  $('selectModeBtn').classList.toggle('active', state.selectMode);
  $('selectModeBtn').setAttribute('aria-pressed', String(state.selectMode));
  updateBulkBar();
  renderBoardView();
});

function toggleSelected(t){
  if(state.selectedIds.has(t.firestoreId)) state.selectedIds.delete(t.firestoreId);
  else state.selectedIds.add(t.firestoreId);
  renderBoardView();
  updateBulkBar();
}

/** Leaves multi-select mode (used when switching tabs). */
export function exitSelectMode(){
  if(!state.selectMode) return;
  state.selectMode = false;
  state.selectedIds.clear();
  $('selectModeBtn').classList.remove('active');
  $('selectModeBtn').setAttribute('aria-pressed', 'false');
  updateBulkBar();
}

function clearSelection(){
  state.selectedIds.clear();
  updateBulkBar();
  renderBoardView();
}

function updateBulkBar(){
  let bar = $('bulkBar');
  if(!state.selectMode || state.selectedIds.size === 0){
    if(bar) bar.remove();
    return;
  }
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'bulkBar';
    bar.className = 'bulk-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Bulk actions');
    document.body.appendChild(bar);
  }
  bar.innerHTML = html`
    <span>${state.selectedIds.size} selected</span>
    <select id="bulkStatus" aria-label="Move selected tickets to">
      <option value="">Move to…</option>
      ${STATUSES.map(s => html`<option value="${s.key}">${s.label}</option>`)}
    </select>
    ${canModerate() ? html`<button class="danger small" type="button" id="bulkArchive">Archive</button>` : ''}
    <button class="ghost small" type="button" id="bulkCancel">Clear</button>`;

  const selected = () => Array.from(state.selectedIds).map(findTicket).filter(Boolean);
  bar.querySelector('#bulkStatus').addEventListener('change', async e => {
    if(!e.target.value) return;
    if(await moveTickets(selected(), e.target.value)) clearSelection();
    else e.target.value = '';
  });
  const archiveBtn = bar.querySelector('#bulkArchive');
  if(archiveBtn) archiveBtn.addEventListener('click', async () => { if(await archiveTickets(selected())) clearSelection(); });
  bar.querySelector('#bulkCancel').addEventListener('click', clearSelection);
}
