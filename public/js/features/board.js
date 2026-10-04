/* =========================================================
   features/board.js — the Board tab: filter bar, Kanban columns,
   cards, drag & drop, collapsible columns, and multi-select with the
   bulk-action bar. The table view lives in table.js.

   renderBoardView() repaints whichever view (Kanban/table) is active;
   nav.js calls it whenever tickets, team, profiles or settings change.
========================================================= */
import { state } from '../core/state.js';
import { STATUS, STATUSES, STATUS_COLOR, ALL_LABELS, normalizeStatus } from '../core/constants.js';
import { html } from '../core/html.js';
import { icon, statusIcon } from '../core/icons.js';
import { canModerate } from '../core/permissions.js';
import { displayName, avatarHtml } from '../core/people.js';
import { columnCount, wipLimit } from '../core/workflow.js';
import { matchesFilters, sortTickets, priorityBadge, labelList, dueBadge, ticketFlags, findTicket } from './ticket-common.js';
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

$('labelFilter').innerHTML = html`<option value="">Label</option>${ALL_LABELS.map(l => html`<option value="${l}">${l}</option>`)}`;

function populateAssigneeFilter(){
  const sel = $('assigneeFilter');
  const current = sel.value;
  const emails = state.allowlist.map(u => u.id).sort();
  sel.innerHTML = html`<option value="">Owner</option><option value="__unassigned__">Unassigned</option>${
    emails.map(e => html`<option value="${e}">${displayName(e)}</option>`)}`;
  if(Array.from(sel.options).some(o => o.value === current)) sel.value = current;
  markActive(sel);
}

/** A filter pill with a value gets a solid accent outline, so active filters are obvious. */
function markActive(select){ select.classList.toggle('has-value', !!select.value); }

// The search box lives in the top bar; typing on another tab jumps back to the board.
$('searchInput').addEventListener('input', e => {
  state.filters.search = e.target.value;
  if(state.currentTab !== 'board') $('navBoard').click();
  else renderBoardView();
});
[['priorityFilter', 'priority'], ['labelFilter', 'label'], ['assigneeFilter', 'assignee']].forEach(([id, key]) => {
  $(id).addEventListener('change', e => { state.filters[key] = e.target.value; markActive(e.target); renderBoardView(); });
});

// "/" focuses search (unless you're typing somewhere or a dialog is open).
document.addEventListener('keydown', e => {
  if(e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
  if(typing || document.querySelector('.modal-overlay') || $('app').classList.contains('hidden')) return;
  e.preventDefault();
  $('searchInput').focus();
});
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
  $('viewKanbanBtn').setAttribute('aria-pressed', String(mode === 'kanban'));
  $('viewTableBtn').setAttribute('aria-pressed', String(mode === 'table'));
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
  const color = STATUS_COLOR[status.key];

  const col = document.createElement('section');
  col.className = 'column' + (collapsed ? ' collapsed' : '') + (overLimit ? ' over-limit' : '');
  col.setAttribute('aria-label', `${status.label}, ${tickets.length} tickets`);
  col.innerHTML = html`
    <div class="column-head">
      <div class="column-head-row">
        ${statusIcon(status.key)}
        <h2 class="column-title">${status.label}</h2>
        <span class="column-count">${tickets.length}</span>
        <div class="column-head-actions">
          ${limit ? html`<span class="column-wip" title="Work-in-progress limit${overLimit ? ' — over the limit' : ''}">${active}/${limit}</span>` : ''}
          ${status.key === STATUS.BACKLOG ? html`<button type="button" class="add-btn" aria-label="New ticket" title="New ticket">${icon('plus', 14)}</button>` : ''}
          <button type="button" class="collapse-btn" aria-expanded="${String(!collapsed)}"
            aria-label="${collapsed ? 'Expand' : 'Collapse'} ${status.label}" title="${collapsed ? 'Expand' : 'Collapse'}">${icon(collapsed ? 'chevronRight' : 'chevronDown', 14)}</button>
        </div>
      </div>
      ${limit ? html`<div class="wip-track" aria-hidden="true"><div class="wip-fill" style="width:${Math.min(100, Math.round(active / limit * 100))}%;background:${color}"></div></div>` : ''}
    </div>`;
  col.querySelector('.collapse-btn').addEventListener('click', () => toggleCollapsed(status.key));
  const addBtn = col.querySelector('.add-btn');
  if(addBtn) addBtn.addEventListener('click', () => openTicketForm(null));
  if(collapsed) return col;

  const body = document.createElement('div');
  body.className = 'column-body';
  if(tickets.length === 0) body.innerHTML = html`<div class="column-empty">${state.filters.search || state.filters.priority || state.filters.label || state.filters.assignee ? 'No matching tickets' : 'No tickets'}</div>`;
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
  const flags = ticketFlags(t);

  const card = document.createElement('article');
  card.className = 'card' + (state.selectMode ? ' selectable' : '') + (selected ? ' selected' : '') + (t.archived ? ' archived' : '');
  card.tabIndex = 0;
  card.setAttribute('aria-label', `${t.id}: ${t.title}`);
  if(state.selectMode) card.setAttribute('aria-pressed', String(selected));
  card.innerHTML = html`
    <div class="card-top">
      ${state.selectMode ? html`<span class="card-select-box${selected ? ' checked' : ''}" aria-hidden="true">${selected ? icon('check', 12) : ''}</span>` : ''}
      <span class="card-id">${t.id}</span>
      <div class="card-top-right">
        ${canQuickEdit ? html`<button type="button" class="quick-edit-btn" title="Quick edit" aria-label="Quick edit ${t.id}">${icon('edit', 14)}</button>` : ''}
        ${priorityBadge(t.priority)}
      </div>
    </div>
    <p class="card-title">${t.title}</p>
    ${flags ? html`<div class="card-flags">${flags}</div>` : ''}
    <div class="card-foot">
      <div class="card-labels">${labelList(t.labels)}</div>
      ${dueBadge(t)}
      ${avatarHtml(t.owner, 24)}
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
    <strong>${state.selectedIds.size} selected</strong>
    <select id="bulkStatus" aria-label="Move selected tickets to">
      <option value="">Move to…</option>
      ${STATUSES.map(s => html`<option value="${s.key}">${s.label}</option>`)}
    </select>
    ${canModerate() ? html`<button class="danger" type="button" id="bulkArchive">${icon('archive', 14)}Archive</button>` : ''}
    <button class="ghost" type="button" id="bulkCancel">Clear</button>`;

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
