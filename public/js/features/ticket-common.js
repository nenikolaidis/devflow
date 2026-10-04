/* =========================================================
   features/ticket-common.js — small pieces shared by every screen
   that shows tickets: badges, chips, filtering and sorting.
========================================================= */
import { state } from '../core/state.js';
import { STATUSES, PRIORITIES, normalizeStatus } from '../core/constants.js';
import { html } from '../core/html.js';
import { staleDays } from '../core/workflow.js';

export function findTicket(firestoreId){
  return state.tickets.find(t => t.firestoreId === firestoreId);
}

export function priorityPill(priority){
  return html`<span class="priority-pill p-${priority}">${priority}</span>`;
}

export function labelChips(labels){
  return (labels || []).map(l => html`<span class="chip">${l}</span>`);
}

/** Badges for archived / blocked / stale tickets. */
export function ticketFlags(t){
  const stale = staleDays(t);
  return html`${t.archived ? html`<span class="flag flag-archived">Archived</span>` : ''}${
    t.blocked ? html`<span class="flag flag-blocked" title="${t.blockedReason || ''}">⛔ Blocked</span>` : ''}${
    stale ? html`<span class="flag flag-stale" title="No activity for ${stale} days">Stale ${stale}d</span>` : ''}`;
}

/** True if the ticket passes the board's search / filter bar. */
export function matchesFilters(t){
  const f = state.filters;
  if(t.archived && !f.showArchived) return false;
  const q = f.search.trim().toLowerCase();
  if(q && !((t.title || '').toLowerCase().includes(q) || (t.id || '').toLowerCase().includes(q))) return false;
  if(f.priority && t.priority !== f.priority) return false;
  if(f.label && !(t.labels || []).includes(f.label)) return false;
  if(f.assignee){
    if(f.assignee === '__unassigned__'){ if(t.owner) return false; }
    else if((t.owner || '').toLowerCase() !== f.assignee.toLowerCase()) return false;
  }
  return true;
}

/** Sorts a copy of `rows` by state.tableSort-style { key, dir }. */
export function sortTickets(rows, sort){
  const dir = sort.dir === 'asc' ? 1 : -1;
  const valueOf = (t) => {
    switch(sort.key){
      case 'labels': return (t.labels || []).join(',');
      case 'status': return STATUSES.findIndex(s => s.key === normalizeStatus(t.status));
      case 'priority': return PRIORITIES.indexOf(t.priority);
      case 'createdAt': return t.createdAt && t.createdAt.toMillis ? t.createdAt.toMillis() : Number.MAX_SAFE_INTEGER;
      default: return t[sort.key];
    }
  };
  return rows.slice().sort((a, b) => {
    let av = valueOf(a), bv = valueOf(b);
    // Empty values (no due date, no owner…) always sort last.
    const aEmpty = av === null || av === undefined || av === '';
    const bEmpty = bv === null || bv === undefined || bv === '';
    if(aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : (aEmpty ? 1 : -1);
    if(typeof av === 'string') av = av.toLowerCase();
    if(typeof bv === 'string') bv = bv.toLowerCase();
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}
