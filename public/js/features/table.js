/* =========================================================
   features/table.js — the sortable table view of the board.
   Uses the same filters as the Kanban view (ticket-common.js).
========================================================= */
import { state } from '../core/state.js';
import { TABLE_COLUMNS, statusLabel } from '../core/constants.js';
import { html } from '../core/html.js';
import { formatDate } from '../core/format.js';
import { displayName, avatarHtml } from '../core/people.js';
import { isOverdue } from '../core/workflow.js';
import { matchesFilters, sortTickets, priorityPill, labelChips, ticketFlags } from './ticket-common.js';
import { openDetail } from './ticket-detail.js';

const container = document.getElementById('ticketTable');

export function renderTable(){
  const rows = sortTickets(state.tickets.filter(matchesFilters), state.tableSort);
  if(rows.length === 0){
    container.innerHTML = html`<div class="dash-empty">No tickets match your filters.</div>`;
    return;
  }
  const sort = state.tableSort;
  container.innerHTML = html`
    <table class="ticket-table">
      <thead><tr>${TABLE_COLUMNS.map(c => html`
        <th scope="col" data-key="${c.key}" tabindex="0"
          aria-sort="${sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
          ${c.label}${sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
        </th>`)}</tr></thead>
      <tbody>${rows.map(rowHtml)}</tbody>
    </table>`;

  container.querySelectorAll('th').forEach(th => {
    const sortBy = () => {
      const key = th.dataset.key;
      if(sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
      else { sort.key = key; sort.dir = 'asc'; }
      renderTable();
    };
    th.addEventListener('click', sortBy);
    th.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); sortBy(); } });
  });
  container.querySelectorAll('tr[data-fid]').forEach(tr => {
    tr.addEventListener('click', () => openDetail(tr.dataset.fid));
    tr.addEventListener('keydown', e => { if(e.key === 'Enter'){ openDetail(tr.dataset.fid); } });
  });
}

function rowHtml(t){
  return html`<tr data-fid="${t.firestoreId}" tabindex="0" class="${t.archived ? 'archived' : ''}">
    <td class="mono">${t.id}</td>
    <td>${t.title} ${ticketFlags(t)}</td>
    <td>${statusLabel(t.status)}</td>
    <td>${priorityPill(t.priority)}</td>
    <td><span class="table-assignee">${avatarHtml(t.owner, 16)} ${displayName(t.owner)}</span></td>
    <td>${t.reviewer ? displayName(t.reviewer) : '—'}</td>
    <td>${labelChips(t.labels).length ? labelChips(t.labels) : '—'}</td>
    <td class="due ${isOverdue(t) ? 'overdue' : ''}">${t.dueDate ? formatDate(t.dueDate) : '—'}</td>
  </tr>`;
}
