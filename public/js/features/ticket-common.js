/* =========================================================
   features/ticket-common.js — small pieces shared by every screen
   that shows tickets: badges, chips, filtering and sorting.
========================================================= */
import { state } from '../core/state.js';
import { STATUSES, PRIORITIES, LABEL_COLOR, normalizeStatus } from '../core/constants.js';
import { html } from '../core/html.js';
import { capitalize, formatDate } from '../core/format.js';
import { icon, priorityIcon } from '../core/icons.js';
import { staleDays, isOverdue } from '../core/workflow.js';

export function findTicket(firestoreId){
  return state.tickets.find(t => t.firestoreId === firestoreId);
}

/** Priority icon, with the name as a tooltip (icon only, for cards). */
export function priorityBadge(priority){
  return html`<span class="priority-wrap" title="${capitalize(priority)} priority">${priorityIcon(priority)}<span class="sr-only">${capitalize(priority)} priority</span></span>`;
}

/** Priority icon + name (for the table and the ticket panel). */
export function priorityWithLabel(priority){
  return html`<span class="cell-inline">${priorityIcon(priority)}${capitalize(priority)}</span>`;
}

/** Labels as small colored dots + names. boxed=true draws a pill outline. */
export function labelList(labels, { boxed = false } = {}){
  return (labels || []).map(l => html`<span class="label ${boxed ? 'boxed' : ''}"><span class="label-dot" style="background:${LABEL_COLOR[l] || 'var(--muted)'}"></span>${l}</span>`);
}

/** Due date with a calendar icon; red when overdue. Empty when there's no due date. */
export function dueBadge(t){
  if(!t.dueDate) return '';
  const overdue = isOverdue(t);
  return html`<span class="due ${overdue ? 'overdue' : ''}" title="${overdue ? 'Overdue' : 'Due date'}">${icon('calendar', 12)}${formatDate(t.dueDate)}</span>`;
}

/** Badges for archived / blocked / stale tickets ('' when none apply). */
export function ticketFlags(t){
  const stale = staleDays(t);
  if(!t.archived && !t.blocked && !stale) return '';
  return html`${t.archived ? html`<span class="flag flag-archived">${icon('archive', 12)}Archived</span>` : ''}${
    t.blocked ? html`<span class="flag flag-blocked" title="${t.blockedReason || ''}">${icon('blocked', 12)}Blocked</span>` : ''}${
    stale ? html`<span class="flag flag-stale" title="No activity for ${stale} days">${icon('clock', 12)}Stale ${stale}d</span>` : ''}`;
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
