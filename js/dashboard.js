import { state } from './state.js';
import { STATUSES, PRIORITIES, PRIORITY_COLOR, normalizeStatus } from './constants.js';
import { escapeHtml, isOverdue } from './utils.js';

export function renderDashboard(){
  const statsEl = document.getElementById('dashStats');
  const panelsEl = document.getElementById('dashPanels');
  const tickets = state.tickets;

  if(tickets.length === 0){
    statsEl.innerHTML = '';
    panelsEl.innerHTML = '<div class="dash-empty">No tickets yet — create one from the Board tab to see stats here.</div>';
    return;
  }

  const total = tickets.length;
  const done = tickets.filter(t => normalizeStatus(t.status) === 'done').length;
  const open = total - done;
  const overdue = tickets.filter(t => isOverdue(t.dueDate, t.status)).length;
  const completionRate = total ? Math.round((done/total)*100) : 0;

  statsEl.innerHTML = `
    <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">Total tickets</div></div>
    <div class="stat-card"><div class="stat-num">${open}</div><div class="stat-label">Open</div></div>
    <div class="stat-card"><div class="stat-num red">${overdue}</div><div class="stat-label">Overdue</div></div>
    <div class="stat-card"><div class="stat-num teal">${completionRate}%</div><div class="stat-label">Completion rate</div></div>
  `;

  const statusCounts = STATUSES.map(s => ({ label: s.label, count: tickets.filter(t => normalizeStatus(t.status) === s.key).length }));
  const priorityCounts = PRIORITIES.map(p => ({ label: p, count: tickets.filter(t => t.priority === p).length, color: PRIORITY_COLOR[p] }));

  const ownerMap = {};
  tickets.forEach(t => {
    const owner = t.owner || 'Unassigned';
    if(!ownerMap[owner]) ownerMap[owner] = { total: 0, done: 0 };
    ownerMap[owner].total++;
    if(normalizeStatus(t.status) === 'done') ownerMap[owner].done++;
  });
  const owners = Object.entries(ownerMap).sort((a,b) => b[1].total - a[1].total).slice(0, 8);

  panelsEl.innerHTML = `
    <div class="panel">
      <h3>Tickets by status</h3>
      ${statusCounts.map(s => `
        <div class="bar-row">
          <div class="bar-row-top"><span>${s.label}</span><span>${s.count}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${total ? (s.count/total*100) : 0}%; background:var(--accent);"></div></div>
        </div>`).join('')}
    </div>
    <div class="panel">
      <h3>Tickets by priority</h3>
      ${priorityCounts.map(p => `
        <div class="bar-row">
          <div class="bar-row-top"><span style="text-transform:capitalize;">${p.label}</span><span>${p.count}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${total ? (p.count/total*100) : 0}%; background:${p.color};"></div></div>
        </div>`).join('')}
    </div>
    <div class="panel" style="grid-column:1 / -1;">
      <h3>By owner</h3>
      <table class="owner-table">
        <tr><th>Owner</th><th>Total</th><th>Done</th><th>Open</th></tr>
        ${owners.map(([name, v]) => `<tr><td>${escapeHtml(name)}</td><td>${v.total}</td><td>${v.done}</td><td>${v.total - v.done}</td></tr>`).join('')}
      </table>
    </div>
  `;
}