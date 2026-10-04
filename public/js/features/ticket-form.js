/* =========================================================
   features/ticket-form.js — the New/Edit ticket form, the Quick edit
   dialog (priority/owner/labels from a card), and the searchable
   teammate picker both use.

   Saving goes through ticket-actions.js, which logs activity and
   sends notifications.
========================================================= */
import { state } from '../core/state.js';
import { PRIORITIES, ALL_LABELS, TICKET_TEMPLATES, LIMITS, ROLE_LABELS } from '../core/constants.js';
import { html } from '../core/html.js';
import { safeUrl, capitalize } from '../core/format.js';
import { displayName } from '../core/people.js';
import { openModal, showToast, confirmDialog } from '../core/ui.js';
import { createTicket, saveTicketChanges } from './ticket-actions.js';

/* ---------------- TEAMMATE PICKER (owner / reviewer) ---------------- */

function teammateField(id, label, value){
  return html`
    <div class="field">
      <label for="${id}">${label}</label>
      <div class="combo">
        <input type="text" class="combo-input" id="${id}" autocomplete="off" maxlength="200"
          value="${value || ''}" placeholder="Search teammate..." role="combobox"
          aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list">
        <div class="combo-list hidden" id="${id}-list" role="listbox"></div>
      </div>
    </div>`;
}

/** Wires up a teammateField(): typing filters the team; free text is still allowed. */
function wireTeammateField(modal, id){
  const input = modal.$('#' + id);
  const list = modal.$('#' + id + '-list');

  const show = (open) => {
    list.classList.toggle('hidden', !open);
    input.setAttribute('aria-expanded', String(open));
  };
  const renderList = () => {
    const q = input.value.toLowerCase();
    const matches = state.allowlist.filter(u => u.id.includes(q) || displayName(u.id).toLowerCase().includes(q));
    list.innerHTML = html`
      <div class="combo-item" role="option" data-val="">— Unassigned —</div>
      ${matches.map(u => html`<div class="combo-item" role="option" data-val="${u.id}"><span>${displayName(u.id)}</span><span class="chip">${ROLE_LABELS[u.role] || u.role}</span></div>`)}
      ${matches.length === 0 ? html`<div class="combo-empty">No teammate matches — you can still type a free-text name</div>` : ''}`;
    list.querySelectorAll('.combo-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = item.dataset.val;
        show(false);
      });
    });
    show(true);
  };
  input.addEventListener('focus', renderList);
  input.addEventListener('input', renderList);
  input.addEventListener('blur', () => setTimeout(() => show(false), 120));
  input.addEventListener('keydown', e => { if(e.key === 'Escape' && !list.classList.contains('hidden')){ e.stopPropagation(); show(false); } });
}

function priorityOptions(selected){
  return PRIORITIES.map(p => html`<option value="${p}" ${p === selected ? 'selected' : ''}>${capitalize(p)}</option>`);
}

function labelCheckboxes(selected){
  return ALL_LABELS.map(l => html`<label class="label-check"><input type="checkbox" value="${l}" ${(selected || []).includes(l) ? 'checked' : ''}> ${l}</label>`);
}

const checkedLabels = (modal, groupId) => modal.$$(`#${groupId} input:checked`).map(i => i.value);

/* ---------------- NEW / EDIT TICKET ---------------- */

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
      <div class="field"><label for="f-desc">Description — what, why, expected result</label>
        <textarea id="f-desc" rows="5" maxlength="${LIMITS.DESCRIPTION}" placeholder="What needs to be done, why it's needed, expected result...">${t.description || ''}</textarea></div>
      <div class="row2">
        <div class="field"><label for="f-priority">Priority</label>
          <select id="f-priority">${priorityOptions(t.priority || 'medium')}</select></div>
        <div class="field"><label for="f-due">Due date</label>
          <input type="date" id="f-due" value="${t.dueDate || ''}"></div>
      </div>
      <div class="row2">
        ${teammateField('f-owner', 'Owner', t.owner)}
        ${teammateField('f-reviewer', 'Reviewer', t.reviewer)}
      </div>
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
  wireTeammateField(m, 'f-reviewer');

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
      if(tp.priority) m.$('#f-priority').value = tp.priority;
      m.$$('#f-labels input').forEach(cb => { cb.checked = tp.labels.includes(cb.value); });
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
      priority: m.$('#f-priority').value,
      dueDate: m.$('#f-due').value,
      owner: m.$('#f-owner').value.trim(),
      reviewer: m.$('#f-reviewer').value.trim(),
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

/** Small dialog to change priority, owner and labels without opening the full form. */
export function openQuickEdit(t){
  const m = openModal({
    title: `Quick edit · ${t.id}`,
    size: 'narrow',
    body: html`
      <div class="field"><label for="qe-priority">Priority</label>
        <select id="qe-priority">${priorityOptions(t.priority)}</select></div>
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
      priority: m.$('#qe-priority').value,
      owner: m.$('#qe-owner').value.trim(),
      labels: checkedLabels(m, 'qe-labels')
    });
    if(ok) m.close();
  });
}
