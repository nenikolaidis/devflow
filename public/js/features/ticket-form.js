/* =========================================================
   features/ticket-form.js — the New/Edit ticket form, the Quick edit
   dialog (type/priority/owner/labels from a card), and the teammate
   pickers they use:
     - teammateField: one person (owner), free text allowed
     - reviewersField: up to MAX_REVIEWERS people, shown as removable chips

   Saving goes through ticket-actions.js, which logs activity and
   sends notifications.
========================================================= */
import { state } from '../core/state.js';
import {
  PRIORITIES, TICKET_TEMPLATES, TICKET_TYPES, TYPE_KEYS, LIMITS, ROLE_LABELS, AVAILABILITY, MAX_REVIEWERS,
  typeOf, reviewersOf
} from '../core/constants.js';
import { html } from '../core/html.js';
import { icon } from '../core/icons.js';
import { safeUrl, capitalize } from '../core/format.js';
import { normEmail } from '../core/permissions.js';
import { displayName, avatarHtml, profileOf, matchPeople } from '../core/people.js';
import { labelNames, labelColor } from '../core/settings.js';
import { openModal, showToast, confirmDialog } from '../core/ui.js';
import { createTicket, saveTicketChanges } from './ticket-actions.js';
import { sprintOptions } from './sprints.js';

/* ---------------- TEAMMATE SEARCH (shared) ---------------- */

/** "Away" / "Busy" text for the picker, '' when available. */
function availabilityNote(email){
  const a = AVAILABILITY.find(x => x.key === profileOf(email).availability);
  return a && a.key !== 'available' ? a.label : '';
}

/** Team members matching `query`, best first, excluding `skip` emails. */
function searchTeam(query, skip = []){
  return matchPeople(query, { exclude: skip });
}

function optionHtml(u){
  const note = availabilityNote(u.id);
  return html`<div class="combo-item" role="option" data-val="${u.id}">
    <span class="cell-inline">${avatarHtml(u.id, 20)}${displayName(u.id)}${note ? html`<span class="availability-note">${note}</span>` : ''}</span>
    <span class="chip">${ROLE_LABELS[u.role] || u.role}</span>
  </div>`;
}

/** Shared dropdown behaviour: show/hide, Escape, click to pick. */
function wireDropdown(input, list, render, onPick){
  const show = (open) => { list.classList.toggle('hidden', !open); input.setAttribute('aria-expanded', String(open)); };
  const refresh = () => {
    list.innerHTML = render(input.value).toString();
    list.querySelectorAll('.combo-item').forEach(item => {
      item.addEventListener('mousedown', e => { e.preventDefault(); onPick(item.dataset.val); show(false); });
    });
    show(true);
  };
  input.addEventListener('focus', refresh);
  input.addEventListener('input', refresh);
  input.addEventListener('blur', () => setTimeout(() => show(false), 120));
  input.addEventListener('keydown', e => { if(e.key === 'Escape' && !list.classList.contains('hidden')){ e.stopPropagation(); show(false); } });
  return { refresh, show };
}

/* ---------------- OWNER (one person) ---------------- */

/**
 * One-person picker. The box shows the person's name; the stored value
 * (their email, or free text) lives in data-value — read it with
 * teammateValue().
 */
function teammateField(id, label, value){
  return html`
    <div class="field">
      <label for="${id}">${label}</label>
      <div class="combo">
        <input type="text" class="combo-input" id="${id}" autocomplete="off" maxlength="200"
          value="${value ? displayName(value) : ''}" data-value="${value || ''}" placeholder="Search teammate..." role="combobox"
          aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list">
        <div class="combo-list hidden" id="${id}-list" role="listbox"></div>
      </div>
    </div>`;
}

/** Typing filters the team; free text (someone without an account) is still allowed. */
function wireTeammateField(modal, id){
  const input = modal.$('#' + id);
  // Typing replaces the stored value with what was typed (free text or an email).
  input.addEventListener('input', () => { input.dataset.value = input.value.trim(); });
  wireDropdown(input, modal.$('#' + id + '-list'), q => {
    // Showing a picked name? List everyone rather than filtering by it.
    const matches = searchTeam(q === displayName(input.dataset.value) ? '' : q);
    return html`
      <div class="combo-item" role="option" data-val="">— Unassigned —</div>
      ${matches.map(optionHtml)}
      ${matches.length === 0 ? html`<div class="combo-empty">No teammate matches — you can still type a free-text name</div>` : ''}`;
  }, val => { input.dataset.value = val; input.value = val ? displayName(val) : ''; });
}

/** The stored value of a teammateField: a lowercase email, free text, or ''. */
function teammateValue(modal, id){
  const v = (modal.$('#' + id).dataset.value || '').trim();
  return v.includes('@') ? normEmail(v) : v;
}

/* ---------------- REVIEWERS (several people) ---------------- */

function reviewersField(id){
  return html`
    <div class="field">
      <label for="${id}-input">Reviewers <span class="label-hint">up to ${MAX_REVIEWERS} · any one of them can close the ticket</span></label>
      <div class="chip-input" id="${id}">
        <div class="chip-list" id="${id}-chips"></div>
        <div class="combo">
          <input type="text" class="combo-input" id="${id}-input" autocomplete="off" maxlength="200"
            placeholder="Add a reviewer…" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list">
          <div class="combo-list hidden" id="${id}-list" role="listbox"></div>
        </div>
      </div>
    </div>`;
}

/**
 * Wires a reviewersField. Pick from the list, or type an email / name and
 * press Enter. Emails are stored lowercase (firestore.rules compares them).
 * @returns {() => string[]} reads the current list
 */
function wireReviewersField(modal, id, initial){
  let reviewers = [...initial];
  const input = modal.$(`#${id}-input`);
  const chips = modal.$(`#${id}-chips`);

  const renderChips = () => {
    chips.innerHTML = html`${reviewers.map(r => html`
      <span class="person-chip">${avatarHtml(r, 20)}${displayName(r)}
        <button type="button" data-remove="${r}" aria-label="Remove ${displayName(r)} as reviewer">${icon('x', 12)}</button>
      </span>`)}`.toString();
    input.disabled = reviewers.length >= MAX_REVIEWERS;
    input.placeholder = input.disabled ? `Maximum ${MAX_REVIEWERS} reviewers` : 'Add a reviewer…';
  };
  const add = (value) => {
    const v = value.includes('@') ? normEmail(value) : value.trim();
    if(!v || reviewers.includes(v) || reviewers.length >= MAX_REVIEWERS) return;
    reviewers.push(v);
    input.value = '';
    renderChips();
  };
  chips.addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if(!btn) return;
    reviewers = reviewers.filter(r => r !== btn.dataset.remove);
    renderChips();
    input.focus();
  });
  const dropdown = wireDropdown(input, modal.$(`#${id}-list`), q => {
    const matches = searchTeam(q, reviewers);
    return html`${matches.map(optionHtml)}
      ${matches.length === 0 ? html`<div class="combo-empty">${q ? 'Press Enter to add this name' : 'Everyone on the team is already a reviewer'}</div>` : ''}`;
  }, val => { add(val); dropdown.refresh(); });
  input.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); add(input.value); dropdown.refresh(); }
    if(e.key === 'Backspace' && !input.value && reviewers.length){ reviewers.pop(); renderChips(); }
  });
  renderChips();
  return () => reviewers;
}

/* ---------------- TYPE, PRIORITY, LABELS ---------------- */

function typeOptions(selected){
  return TICKET_TYPES.map(t => html`<option value="${t.key}" ${t.key === selected ? 'selected' : ''}>${t.label}</option>`);
}

function priorityOptions(selected){
  return PRIORITIES.map(p => html`<option value="${p}" ${p === selected ? 'selected' : ''}>${capitalize(p)}</option>`);
}

/** The board's labels, plus any older label already on this ticket (so editing never drops it). */
function labelCheckboxes(selected){
  const own = (selected || []).filter(l => !TYPE_KEYS.includes(l));
  const names = [...labelNames(), ...own.filter(l => !labelNames().includes(l))];
  if(names.length === 0) return html`<span class="field-hint">No labels yet — an admin can add them in Team → Board settings.</span>`;
  return names.map(l => html`<label class="label-check"><input type="checkbox" value="${l}" ${own.includes(l) ? 'checked' : ''}><span class="label-dot" style="background:${labelColor(l)}"></span>${l}</label>`);
}

const checkedLabels = (modal, groupId) => modal.$$(`#${groupId} input:checked`).map(i => i.value);

/* ---------------- NEW / EDIT TICKET ---------------- */

/** New tickets go into the sprint the board is filtered to, if any. */
function defaultSprint(){
  const f = state.filters.sprint;
  return f && f !== '__none__' ? f : '';
}

/** Opens the full ticket form. Pass a ticket to edit it, or null to create one. */
export function openTicketForm(existing){
  const t = existing || {};
  const isEdit = !!existing;
  const m = openModal({
    title: isEdit ? `Edit ${t.id}` : 'New ticket',
    initialFocus: '#f-title',
    body: html`
      ${!isEdit ? html`
        <div class="field"><label for="f-template">Start from a template</label>
          <select id="f-template">${TICKET_TEMPLATES.map(tp => html`<option value="${tp.id}">${tp.name}</option>`)}</select>
        </div>` : ''}
      <div class="field"><label for="f-title">Title</label>
        <input type="text" id="f-title" maxlength="${LIMITS.TITLE}" value="${t.title || ''}" placeholder="Fix login page validation error"></div>
      <div class="field"><label for="f-desc">Description</label>
        <textarea id="f-desc" rows="7" maxlength="${LIMITS.DESCRIPTION}" placeholder="What needs to be done, why it's needed, expected result...">${t.description || ''}</textarea>
        <p class="field-hint">Formatting: <code>## Heading</code> · <code>- bullet</code> · <code>1. step</code> · <code>- [ ] checklist item</code> · <code>**bold**</code> · <code>\`code\`</code></p>
      </div>
      <div class="row3">
        <div class="field"><label for="f-type">Type</label>
          <select id="f-type">${typeOptions(isEdit ? typeOf(t) : 'task')}</select></div>
        <div class="field"><label for="f-priority">Priority</label>
          <select id="f-priority">${priorityOptions(t.priority || 'medium')}</select></div>
        <div class="field"><label for="f-due">Due date</label>
          <input type="date" id="f-due" value="${t.dueDate || ''}"></div>
      </div>
      <div class="row2">
        ${teammateField('f-owner', 'Owner', t.owner)}
        <div class="field"><label for="f-sprint">Sprint</label>
          <select id="f-sprint">${sprintOptions(isEdit ? t.sprintId : defaultSprint())}</select></div>
      </div>
      ${reviewersField('f-reviewers')}
      <div class="field"><label for="f-link">Merge request / issue link (optional)</label>
        <input type="text" id="f-link" maxlength="${LIMITS.LINK}" value="${t.linkUrl || ''}" placeholder="https://github.com/org/repo/pull/123"></div>
      <fieldset class="field"><legend>Labels</legend>
        <div class="label-check-group" id="f-labels">${labelCheckboxes(t.labels)}</div>
      </fieldset>
      <div class="modal-actions">
        <button type="button" class="form-cancel">Cancel</button>
        <button type="button" class="primary form-save">${isEdit ? 'Save changes' : 'Create ticket'}</button>
      </div>`
  });
  wireTeammateField(m, 'f-owner');
  const getReviewers = wireReviewersField(m, 'f-reviewers', reviewersOf(t));

  const templateSelect = m.$('#f-template');
  if(templateSelect){
    templateSelect.addEventListener('change', async () => {
      const tp = TICKET_TEMPLATES.find(x => x.id === templateSelect.value);
      if(!tp) return;
      const desc = m.$('#f-desc');
      if(desc.value.trim()){
        const ok = await confirmDialog({ title: 'Replace description?', message: `Replace the current description with the "${tp.name}" template?`, confirmLabel: 'Replace' });
        if(!ok){ templateSelect.value = 'blank'; return; }
      }
      desc.value = tp.description;
      m.$('#f-type').value = tp.type;
      if(tp.priority) m.$('#f-priority').value = tp.priority;
    });
  }

  m.$('.form-cancel').addEventListener('click', () => m.close());
  const saveBtn = m.$('.form-save');
  saveBtn.addEventListener('click', async () => {
    const title = m.$('#f-title').value.trim();
    if(!title){ showToast('Title is required'); m.$('#f-title').focus(); return; }
    const rawLink = m.$('#f-link').value.trim();
    if(rawLink && !safeUrl(rawLink)){ showToast('The link must start with https:// or http://'); m.$('#f-link').focus(); return; }

    const fields = {
      title,
      description: m.$('#f-desc').value.trim(),
      type: m.$('#f-type').value,
      priority: m.$('#f-priority').value,
      dueDate: m.$('#f-due').value,
      owner: teammateValue(m, 'f-owner'),
      reviewers: getReviewers(),
      sprintId: m.$('#f-sprint').value,
      linkUrl: safeUrl(rawLink),
      labels: checkedLabels(m, 'f-labels')
    };
    saveBtn.disabled = true;
    const ok = isEdit ? await saveTicketChanges(existing, fields) : await createTicket(fields);
    saveBtn.disabled = false;
    if(ok) m.close();
  });
}

/* ---------------- QUICK EDIT ---------------- */

/** Small dialog to change type, priority, owner and labels without opening the full form. */
export function openQuickEdit(t){
  const m = openModal({
    title: `Quick edit · ${t.id}`,
    size: 'narrow',
    body: html`
      <div class="row2">
        <div class="field"><label for="qe-type">Type</label>
          <select id="qe-type">${typeOptions(typeOf(t))}</select></div>
        <div class="field"><label for="qe-priority">Priority</label>
          <select id="qe-priority">${priorityOptions(t.priority)}</select></div>
      </div>
      ${teammateField('qe-owner', 'Owner', t.owner)}
      <fieldset class="field"><legend>Labels</legend>
        <div class="label-check-group" id="qe-labels">${labelCheckboxes(t.labels)}</div>
      </fieldset>
      <div class="modal-actions">
        <button type="button" class="qe-cancel">Cancel</button>
        <button type="button" class="primary qe-save">Save</button>
      </div>`
  });
  wireTeammateField(m, 'qe-owner');
  m.$('.qe-cancel').addEventListener('click', () => m.close());
  m.$('.qe-save').addEventListener('click', async () => {
    const ok = await saveTicketChanges(t, {
      type: m.$('#qe-type').value,
      priority: m.$('#qe-priority').value,
      owner: teammateValue(m, 'qe-owner'),
      labels: checkedLabels(m, 'qe-labels')
    });
    if(ok) m.close();
  });
}
