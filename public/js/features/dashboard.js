/* =========================================================
   features/dashboard.js — the Dashboard tab: headline numbers,
   status and priority breakdowns, a "needs attention" list (blocked,
   overdue, stale), and workload per owner. Archived tickets excluded.
========================================================= */
import { state } from '../core/state.js';
import { STATUS, STATUSES, STATUS_COLOR, PRIORITIES, PRIORITY_COLOR, TICKET_TYPES, normalizeStatus, typeOf } from '../core/constants.js';
import { html } from '../core/html.js';
import { capitalize, formatDate } from '../core/format.js';
import { icon, typeIcon } from '../core/icons.js';
import { displayName, avatarHtml } from '../core/people.js';
import { isOverdue, staleDays } from '../core/workflow.js';
import { openDetail } from './ticket-detail.js';
import { activeSprint, sprintProgress, daysLeft } from './sprints.js';

const subEl = document.getElementById('dashSub');
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
    subEl.textContent = '';
    statsEl.innerHTML = '';
    panelsEl.innerHTML = html`<div class="panel dash-empty">No tickets yet — create one from the Board tab to see stats here.</div>`;
    return;
  }

  const isDone = (t) => normalizeStatus(t.status) === STATUS.DONE;
  const total = tickets.length;
  const done = tickets.filter(isDone).length;
  const open = tickets.filter(t => !isDone(t));
  const blocked = open.filter(t => t.blocked);
  const overdue = tickets.filter(isOverdue);
  const stale = tickets.filter(t => staleDays(t)).sort((a, b) => staleDays(b) - staleDays(a));
  const byStatus = STATUSES.map(s => ({ ...s, count: tickets.filter(t => normalizeStatus(t.status) === s.key).length }));

  subEl.textContent = `${total} active ticket${total === 1 ? '' : 's'} · archived tickets not counted`;

  statsEl.innerHTML = html`
    ${statCard('Open', open.length)}
    ${statCard('In progress', byStatus.find(s => s.key === STATUS.IN_PROGRESS).count)}
    ${statCard('Overdue', overdue.length, overdue.length ? 'red' : '')}
    ${statCard('Blocked', blocked.length, blocked.length ? 'red' : '')}
    ${statCard('Stale', stale.length, stale.length ? 'amber' : '')}
    ${statCard('Completed', `${Math.round((done / total) * 100)}%`, '', `${done} of ${total}`)}`;

  // One row per ticket that needs attention, most urgent reason first.
  const attention = [];
  const seen = new Set();
  const add = (t, flag) => { if(!seen.has(t.firestoreId)){ seen.add(t.firestoreId); attention.push({ t, flag }); } };
  blocked.forEach(t => add(t, html`<span class="flag flag-blocked" title="${t.blockedReason || ''}">${icon('blocked', 12)}Blocked</span>`));
  overdue.forEach(t => add(t, html`<span class="flag flag-overdue">${icon('calendar', 12)}Overdue · ${formatDate(t.dueDate)}</span>`));
  stale.forEach(t => add(t, html`<span class="flag flag-stale">${icon('clock', 12)}Stale ${staleDays(t)}d</span>`));

  // Workload: open and done per owner.
  const owners = {};
  tickets.forEach(t => {
    const key = t.owner || '';
    owners[key] = owners[key] || { open: 0, done: 0 };
    owners[key][isDone(t) ? 'done' : 'open']++;
  });
  const ownerRows = Object.entries(owners).sort((a, b) => b[1].open - a[1].open).slice(0, 10);
  const maxOpen = Math.max(1, ...ownerRows.map(([, v]) => v.open));

  panelsEl.innerHTML = html`
    ${sprintPanel()}
    <section class="panel">
      <h2>Tickets by status</h2>
      <div class="stacked-bar" role="img" aria-label="${byStatus.map(s => `${s.label} ${s.count}`).join(', ')}">
        ${byStatus.filter(s => s.count).map(s => html`<span style="flex:${s.count};background:${STATUS_COLOR[s.key]}"></span>`)}
      </div>
      <div class="legend">
        ${byStatus.map(s => html`<div class="legend-item"><span class="label-dot" style="background:${STATUS_COLOR[s.key]}"></span><span>${s.label}</span><strong>${s.count}</strong></div>`)}
      </div>
    </section>

    <section class="panel">
      <h2>Tickets by type</h2>
      <div class="bar-list wide-label">
        ${TICKET_TYPES.map(ty => ({ ty, count: tickets.filter(t => typeOf(t) === ty.key).length })).filter(x => x.count).map(({ ty, count }) => html`
          <span class="cell-inline">${typeIcon(ty.key, 14)}${ty.label}</span>
          <div class="bar-track" role="img" aria-label="${ty.label}: ${count} of ${total}"><div class="bar-fill" style="width:${(count / total) * 100}%;background:${ty.color}"></div></div>
          <span class="bar-num">${count}</span>`)}
      </div>
    </section>

    <section class="panel">
      <h2>Tickets by priority</h2>
      <div class="bar-list">
        ${PRIORITIES.map(p => {
          const count = tickets.filter(t => t.priority === p).length;
          return html`<span>${capitalize(p)}</span>
            <div class="bar-track" role="img" aria-label="${capitalize(p)}: ${count} of ${total}"><div class="bar-fill" style="width:${(count / total) * 100}%;background:${PRIORITY_COLOR[p]}"></div></div>
            <span class="bar-num">${count}</span>`;
        })}
      </div>
    </section>

    <section class="panel">
      <h2>Needs attention</h2>
      ${attention.length
        ? html`<div class="attention-list">${attention.slice(0, 8).map(({ t, flag }) => html`
            <button type="button" class="mini-ticket" data-fid="${t.firestoreId}">
              <span class="card-id">${t.id}</span>
              <span class="mini-title">${t.title}</span>
              ${flag}
            </button>`)}</div>`
        : html`<div class="empty-note">Nothing is blocked, overdue or stale.</div>`}
    </section>

    <section class="panel">
      <h2>Workload by owner</h2>
      <div class="table-scroll">
        <table class="owner-table">
          <thead><tr><th scope="col">Owner</th><th scope="col" class="num">Open</th><th scope="col" class="num">Done</th><th scope="col" class="load">Load</th></tr></thead>
          <tbody>${ownerRows.map(([owner, v]) => html`<tr>
            <td><span class="cell-inline">${avatarHtml(owner, 22)}${displayName(owner)}</span></td>
            <td class="num">${v.open}</td>
            <td class="num">${v.done}</td>
            <td class="load"><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${(v.open / maxOpen) * 100}%;background:var(--accent)"></div></div></td>
          </tr>`)}</tbody>
        </table>
      </div>
    </section>`;
}

/** The active sprint: goal, dates, days left, progress, and its tickets by status. */
function sprintPanel(){
  const s = activeSprint();
  if(!s) return '';
  const p = sprintProgress(s);
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const left = daysLeft(s);
  return html`
    <section class="panel panel-wide sprint-panel">
      <div class="sprint-panel-head">
        <div>
          <h2>${s.name}</h2>
          ${s.goal ? html`<p class="sprint-goal">${s.goal}</p>` : ''}
        </div>
        <div class="sprint-meta">
          <span>${formatDate(s.start)} – ${formatDate(s.end)}</span>
          <span class="${left < 0 ? 'overdue-text' : ''}">${left > 1 ? `${left} days left` : left === 1 ? '1 day left' : left === 0 ? 'Last day' : `Ended ${-left} day${left === -1 ? '' : 's'} ago`}</span>
        </div>
      </div>
      <div class="sprint-progress">
        <div class="bar-track tall" role="img" aria-label="${p.done} of ${p.total} tickets done"><div class="bar-fill" style="width:${pct}%;background:var(--green)"></div></div>
        <strong>${pct}%</strong><span class="muted-text">${p.done} of ${p.total} done</span>
      </div>
      <div class="legend legend-inline">
        ${STATUSES.map(st => html`<div class="legend-item"><span class="label-dot" style="background:${STATUS_COLOR[st.key]}"></span><span>${st.label}</span><strong>${p.tickets.filter(t => normalizeStatus(t.status) === st.key).length}</strong></div>`)}
      </div>
    </section>`;
}

function statCard(label, value, tone = '', extra = ''){
  return html`<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-num ${tone}">${value}${extra ? html`<span class="stat-extra">${extra}</span>` : ''}</div></div>`;
}
