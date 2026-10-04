/* =========================================================
   features/sprints.js — sprints (time-boxed iterations).

   Tickets can be planned into a sprint (tickets.sprintId). Everyone can
   filter the board by sprint; admins and PMs create, edit, close and
   delete sprints from the "Sprints" dialog. The dashboard shows the
   active sprint's progress.
========================================================= */
import { state } from '../core/state.js';
import { SPRINT_STATUSES, LIMITS, STATUS, normalizeStatus } from '../core/constants.js';
import { html } from '../core/html.js';
import { icon } from '../core/icons.js';
import { formatDate } from '../core/format.js';
import { can } from '../core/permissions.js';
import { on, EVENTS } from '../core/events.js';
import { openModal, showToast, confirmDialog } from '../core/ui.js';
import * as api from '../data/api.js';

/* ---------------- HELPERS (used by board, form, table, dashboard) ---------------- */

export function sprintById(id){
  return state.sprints.find(s => s.id === id);
}

/** The sprint marked Active (the first one, if several are). */
export function activeSprint(){
  return state.sprints.find(s => s.status === 'active') || null;
}

export function sprintLabel(s){
  return s ? s.name + (s.status === 'active' ? ' · active' : s.status === 'closed' ? ' · closed' : '') : '';
}

/** <option>s for a sprint picker: planned/active sprints, plus `current` even if closed. */
export function sprintOptions(current){
  const list = state.sprints.filter(s => s.status !== 'closed' || s.id === current);
  return html`<option value="">No sprint</option>${list.map(s => html`<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${sprintLabel(s)}</option>`)}`;
}

/** Whole days left until a sprint's end date (negative once it's over). */
export function daysLeft(s){
  const end = new Date(s.end + 'T23:59:59');
  return Math.ceil((end - Date.now()) / 86400000);
}

/** { total, done } for the tickets in a sprint (archived ones excluded). */
export function sprintProgress(s){
  const tickets = state.tickets.filter(t => !t.archived && t.sprintId === s.id);
  return { total: tickets.length, done: tickets.filter(t => normalizeStatus(t.status) === STATUS.DONE).length, tickets };
}

/* ---------------- MANAGE SPRINTS DIALOG (admins / PMs) ---------------- */

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** Opens Manage → Sprints (the board's "Sprints" button). */
export function openSprintManager(){
  if(!can('manageSprints')){ showToast('Your role in this project can\'t manage sprints'); return; }
  state.manageSection = 'sprints';
  document.getElementById('navManage').click();
}

/**
 * Renders the sprint list and the create/edit form into `container`
 * (Manage → Sprints). Returns a function that stops its live updates.
 */
export function mountSprintManager(container){
  let editing = null; // sprint id being edited, or null for "new"
  const unsubscribers = [];
  container.innerHTML = html`
      <div class="card-section"><h3>Sprints in ${state.project.name}</h3><div id="sprintList" class="row-list sprint-list"></div></div>
      <form class="card-section sprint-form" id="sprintForm" novalidate>
        <h3 id="sprintFormTitle">New sprint</h3>
        <div class="row2">
          <div class="field"><label for="sp-name">Name</label>
            <input type="text" id="sp-name" maxlength="${LIMITS.SPRINT_NAME}" placeholder="Sprint 12"></div>
          <div class="field"><label for="sp-status">Status</label>
            <select id="sp-status">${SPRINT_STATUSES.map(s => html`<option value="${s.key}">${s.label}</option>`)}</select></div>
        </div>
        <div class="field"><label for="sp-goal">Goal (optional)</label>
          <input type="text" id="sp-goal" maxlength="${LIMITS.SPRINT_GOAL}" placeholder="What this sprint should achieve"></div>
        <div class="row2">
          <div class="field"><label for="sp-start">Start</label><input type="date" id="sp-start"></div>
          <div class="field"><label for="sp-end">End</label><input type="date" id="sp-end"></div>
        </div>
        <div class="modal-actions">
          <button type="button" id="sp-cancel" class="hidden">Cancel edit</button>
          <button type="submit" class="primary" id="sp-save">Create sprint</button>
        </div>
      </form>`.toString();
  const m = { $: (sel) => container.querySelector(sel) };

  const form = m.$('#sprintForm');
  const resetForm = () => {
    editing = null;
    form.reset();
    m.$('#sp-start').value = today();
    m.$('#sp-end').value = plusDays(today(), 13);
    m.$('#sp-status').value = activeSprint() ? 'planned' : 'active';
    m.$('#sprintFormTitle').textContent = 'New sprint';
    m.$('#sp-save').textContent = 'Create sprint';
    m.$('#sp-cancel').classList.add('hidden');
  };
  const renderList = () => {
    const list = m.$('#sprintList');
    if(!list) return;
    list.innerHTML = state.sprints.length === 0
      ? html`<div class="empty-note">No sprints yet — create the first one below.</div>`.toString()
      : html`${[...state.sprints].reverse().map(s => {
          const p = sprintProgress(s);
          return html`<div class="sprint-row" data-id="${s.id}">
            <div class="sprint-row-main">
              <strong>${s.name}</strong>
              <span class="sprint-status status-${s.status}">${(SPRINT_STATUSES.find(x => x.key === s.status) || {}).label}</span>
              <span class="muted-text">${formatDate(s.start)} – ${formatDate(s.end)} · ${p.done}/${p.total} done</span>
              ${s.goal ? html`<span class="sprint-goal">${s.goal}</span>` : ''}
            </div>
            <button type="button" class="ghost small" data-act="edit">${icon('edit', 14)}Edit</button>
            <button type="button" class="ghost small" data-act="delete" aria-label="Delete ${s.name}">${icon('trash', 14)}</button>
          </div>`;
        })}`.toString();
  };

  m.$('#sprintList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if(!btn) return;
    const s = sprintById(btn.closest('.sprint-row').dataset.id);
    if(!s) return;
    if(btn.dataset.act === 'edit'){
      editing = s.id;
      m.$('#sp-name').value = s.name;
      m.$('#sp-goal').value = s.goal || '';
      m.$('#sp-start').value = s.start;
      m.$('#sp-end').value = s.end;
      m.$('#sp-status').value = s.status;
      m.$('#sprintFormTitle').textContent = `Edit ${s.name}`;
      m.$('#sp-save').textContent = 'Save sprint';
      m.$('#sp-cancel').classList.remove('hidden');
      m.$('#sp-name').focus();
    }
    if(btn.dataset.act === 'delete'){
      const count = sprintProgress(s).total;
      const ok = await confirmDialog({
        title: `Delete ${s.name}?`,
        message: count ? `Its ${count} ticket(s) stay on the board, just without a sprint.` : 'This sprint has no tickets.',
        confirmLabel: 'Delete sprint', danger: true
      });
      if(!ok) return;
      try{ await api.deleteSprint(s.id); showToast(`${s.name} deleted`, 'success'); if(editing === s.id) resetForm(); }
      catch(err){ showToast('Could not delete sprint: ' + err.message, 'error'); }
    }
  });
  m.$('#sp-cancel').addEventListener('click', resetForm);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fields = {
      name: m.$('#sp-name').value.trim(),
      goal: m.$('#sp-goal').value.trim(),
      start: m.$('#sp-start').value,
      end: m.$('#sp-end').value,
      status: m.$('#sp-status').value
    };
    if(!fields.name){ showToast('Give the sprint a name'); m.$('#sp-name').focus(); return; }
    if(!fields.start || !fields.end){ showToast('Pick a start and end date'); return; }
    if(fields.end < fields.start){ showToast('The end date must be on or after the start date'); return; }
    if(fields.status === 'active'){
      const other = state.sprints.find(s => s.status === 'active' && s.id !== editing);
      if(other){
        const ok = await confirmDialog({ title: 'Two active sprints?', message: `${other.name} is already active. Usually only one sprint runs at a time — continue anyway?`, confirmLabel: 'Continue' });
        if(!ok) return;
      }
    }
    try{
      await api.saveSprint(editing, fields);
      showToast(editing ? `${fields.name} updated` : `${fields.name} created`, 'success');
      resetForm();
    }catch(err){ showToast('Could not save sprint: ' + err.message, 'error'); }
  });

  resetForm();
  renderList();
  unsubscribers.push(on(EVENTS.SPRINTS_CHANGED, renderList), on(EVENTS.TICKETS_CHANGED, renderList));
  return () => unsubscribers.forEach(unsub => unsub());
}
