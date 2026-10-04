/* =========================================================
   features/dashboard.js — the Dashboard tab: headline numbers,
   status/priority breakdowns, blocked and stale lists, and a per-owner
   table. Archived tickets are excluded.
========================================================= */
import { state } from '../core/state.js';
import { STATUS, STATUSES, PRIORITIES, PRIORITY_COLOR, normalizeStatus } from '../core/constants.js';
import { html } from '../core/html.js';
import { capitalize } from '../core/format.js';
import { displayName } from '../core/people.js';
import { isOverdue, staleDays } from '../core/workflow.js';
import { openDetail } from './ticket-detail.js';

const statsEl = document.getElementById('dashStats');
const panelsEl = document.getElementById('dashPanels');

// Clicking any ticket in a list opens it (one listener, survives re-renders).
panelsEl.addEventListener('click', e => {
  const row = e.target.closest('.mini-ticket');
  if(row) openDetail(row.dataset.fid);
});

export function renderDashboard(){
  const tickets = state.tickets.filter(t => !t.archived);
  if(tickets.length === 0){
    statsEl.innerHTML = '';
    panelsEl.innerHTML = html`<div class="dash-empty">No tickets yet — create one from the Board tab to see stats here.</div>`;
    return;
  }

  const isDone = (t) => normalizeStatus(t.status) === STATUS.DONE;
  const total = tickets.length;
  const done = tickets.filter(isDone).length;
  const blocked = tickets.filter(t => t.blocked && !isDone(t));
  const stale = tickets.filter(t => staleDays(t)).sort((a, b) => staleDays(b) - staleDays(a));

  statsEl.innerHTML = html`
    ${statCard(total, 'Total tickets')}
    ${statCard(total - done, 'Open')}
    ${statCard(tickets.filter(isOverdue).length, 'Overdue', 'red')}
    ${statCard(blocked.length, 'Blocked', 'red')}
    ${statCard(stale.length, 'Stale')}
    ${statCard(`${Math.round((done / total) * 100)}%`, 'Completion rate', 'teal')}`;

  const byOwner = {};
  tickets.forEach(t => {
    const owner = t.owner || '';
    byOwner[owner] = byOwner[owner] || { total: 0, done: 0 };
    byOwner[owner].total++;
    if(isDone(t)) byOwner[owner].done++;
  });
  const owners = Object.entries(byOwner).sort((a, b) => b[1].total - a[1].total).slice(0, 8);

  panelsEl.innerHTML = html`
    <section class="panel">
      <h3>Tickets by status</h3>
      ${STATUSES.map(s => barRow(s.label, tickets.filter(t => normalizeStatus(t.status) === s.key).length, total, 'var(--accent)'))}
    </section>
    <section class="panel">
      <h3>Tickets by priority</h3>
      ${PRIORITIES.map(p => barRow(capitalize(p), tickets.filter(t => t.priority === p).length, total, PRIORITY_COLOR[p]))}
    </section>
    <section class="panel">
      <h3>Blocked tickets</h3>
      ${ticketList(blocked, 'Nothing is blocked.', t => t.blockedReason || '')}
    </section>
    <section class="panel">
      <h3>Stale tickets — no activity in a while</h3>
      ${ticketList(stale, 'No stale tickets.', t => `${staleDays(t)}d · ${displayName(t.owner)}`)}
    </section>
    <section class="panel panel-wide">
      <h3>By owner</h3>
      <table class="owner-table">
        <thead><tr><th scope="col">Owner</th><th scope="col">Total</th><th scope="col">Done</th><th scope="col">Open</th></tr></thead>
        <tbody>${owners.map(([owner, v]) => html`<tr><td>${displayName(owner)}</td><td>${v.total}</td><td>${v.done}</td><td>${v.total - v.done}</td></tr>`)}</tbody>
      </table>
    </section>`;
}

function statCard(value, label, tone = ''){
  return html`<div class="stat-card"><div class="stat-num ${tone}">${value}</div><div class="stat-label">${label}</div></div>`;
}

function barRow(label, count, total, color){
  const pct = total ? (count / total) * 100 : 0;
  return html`
    <div class="bar-row">
      <div class="bar-row-top"><span>${label}</span><span>${count}</span></div>
      <div class="bar-track" role="img" aria-label="${label}: ${count} of ${total}">
        <div class="bar-fill" style="width:${pct}%; background:${color};"></div>
      </div>
    </div>`;
}

function ticketList(rows, emptyText, detail){
  if(rows.length === 0) return html`<div class="empty-note">${emptyText}</div>`;
  return rows.map(t => html`
    <button type="button" class="mini-ticket" data-fid="${t.firestoreId}">
      <span class="card-id">${t.id}</span>
      <span class="mini-title">${t.title}</span>
      <span class="mini-detail">${detail(t)}</span>
    </button>`);
}
