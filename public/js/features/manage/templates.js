/* =========================================================
   features/manage/templates.js — Manage → Templates (needs "manage
   content"), and the template editor also used by "Save as template"
   on a ticket.

   Until a project edits its templates it uses the built-in ones
   (DEFAULT_TEMPLATES). The first edit copies them into the project
   (projects/{pid}/templates), so every template becomes editable.
========================================================= */
import { state } from '../../core/state.js';
import { html } from '../../core/html.js';
import { icon, typeIcon } from '../../core/icons.js';
import { PRIORITIES, DEFAULT_TEMPLATES, LIMITS } from '../../core/constants.js';
import { capitalize } from '../../core/format.js';
import { activeTypes, typeInfo, labelNames, labelColor } from '../../core/settings.js';
import { renderMarkdown } from '../../core/markdown.js';
import { can } from '../../core/permissions.js';
import { displayName } from '../../core/people.js';
import { openModal, showToast, confirmDialog } from '../../core/ui.js';
import * as api from '../../data/api.js';
import { reviewersField, wireReviewersField } from '../ticket-form.js';
import { sectionHead, noProject, attempt } from './common.js';

/** The project's templates, or the built-in ones (flag tells which). */
function current(){
  return state.templates
    ? { list: state.templates, custom: true }
    : { list: DEFAULT_TEMPLATES.map((t, i) => ({ ...t, order: i + 1, enabled: true, labels: [], reviewers: [] })), custom: false };
}

/** Copies the built-in templates into the project, so they can be edited. */
async function makeEditable(){
  if(state.templates) return true;
  return attempt('Could not prepare templates', async () => { await api.resetTemplates(); return true; });
}

export function renderTemplates(root){
  if(!state.project){ root.innerHTML = html`${sectionHead('Templates', '')}${noProject()}`.toString(); return; }
  const { list, custom } = current();
  root.innerHTML = html`
    ${sectionHead('Templates', 'Starting points for new tickets. A template sets the type, priority, default labels and reviewers, and a description scaffold — everything stays editable on the ticket.')}
    ${!custom ? html`<div class="card-section info-note">${icon('info')}<p>This project uses the built-in templates. Any change below makes a copy for this project that you can edit freely.</p></div>` : ''}
    <div class="card-section">
      <div class="row-list" id="templateRows">
        ${list.map((t, i) => html`
          <div class="allow-row ${t.enabled === false ? 'is-archived' : ''}" data-id="${t.id}">
            ${typeIcon(t.type, 18)}
            <span class="em"><span class="member-name">${t.name}</span>
              <span class="member-meta">${typeInfo(t.type).label}${t.priority ? ` · ${capitalize(t.priority)}` : ''}${(t.labels || []).length ? ` · ${t.labels.join(', ')}` : ''}${(t.reviewers || []).length ? ` · reviewers: ${t.reviewers.map(displayName).join(', ')}` : ''}</span></span>
            <label class="inline-check"><input type="checkbox" class="tpl-enabled" ${t.enabled !== false ? 'checked' : ''}> On</label>
            <button type="button" class="ghost small" data-action="up" aria-label="Move ${t.name} up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="ghost small" data-action="down" aria-label="Move ${t.name} down" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="ghost small" data-action="edit">${icon('edit', 14)}Edit</button>
            <button type="button" class="ghost small" data-action="duplicate" aria-label="Duplicate ${t.name}">${icon('copy', 14)}</button>
            <button type="button" class="ghost small" data-action="delete" aria-label="Delete ${t.name}">${icon('trash', 14)}</button>
          </div>`)}
      </div>
      <div class="modal-actions">
        ${custom ? html`<button type="button" class="ghost" id="resetTemplates">Reset to built-in templates</button>` : ''}
        <button type="button" class="primary" id="newTemplate">${icon('plus', 14)}New template</button>
      </div>
    </div>`.toString();

  const byId = (id) => current().list.find(t => t.id === id);

  root.querySelector('#templateRows').addEventListener('change', async e => {
    if(!e.target.classList.contains('tpl-enabled')) return;
    const id = e.target.closest('.allow-row').dataset.id;
    if(!(await makeEditable())) return;
    const t = state.templates ? state.templates.find(x => x.id === id) : null;
    const base = t || DEFAULT_TEMPLATES.find(x => x.id === id);
    if(base) attempt('Could not update', () => api.saveTemplate(id, templateFields({ ...base, enabled: e.target.checked })));
  });

  root.querySelector('#templateRows').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const id = btn.closest('.allow-row').dataset.id;
    const t = byId(id);
    if(btn.dataset.action === 'edit') return openTemplateEditor(t);
    if(btn.dataset.action === 'duplicate') return openTemplateEditor({ ...t, id: null, name: `${t.name} (copy)` });
    if(!(await makeEditable())) return;
    const list = state.templates || [];
    if(btn.dataset.action === 'delete'){
      const ok = await confirmDialog({ title: `Delete "${t.name}"?`, message: 'Tickets created from it are not affected.', confirmLabel: 'Delete', danger: true });
      if(ok) attempt('Could not delete', async () => { await api.deleteTemplate(id); showToast('Template deleted'); });
    }
    if(btn.dataset.action === 'up' || btn.dataset.action === 'down'){
      const i = list.findIndex(x => x.id === id);
      const j = btn.dataset.action === 'up' ? i - 1 : i + 1;
      if(i < 0 || j < 0 || j >= list.length) return;
      const a = list[i], b = list[j];
      attempt('Could not reorder', async () => {
        await api.saveTemplate(a.id, templateFields({ ...a, order: b.order || j + 1 }));
        await api.saveTemplate(b.id, templateFields({ ...b, order: a.order || i + 1 }));
      });
    }
  });

  root.querySelector('#newTemplate').addEventListener('click', () => openTemplateEditor({ id: null, name: '', type: (activeTypes()[0] || {}).key || 'task', priority: '', labels: [], reviewers: [], description: '', enabled: true }));
  const reset = root.querySelector('#resetTemplates');
  if(reset) reset.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Reset templates?', message: 'This replaces this project\'s templates with the built-in ones. Your custom templates will be deleted.', confirmLabel: 'Reset', danger: true });
    if(ok) attempt('Could not reset', async () => { await api.resetTemplates(state.templates.map(t => t.id)); showToast('Templates reset', 'success'); });
  });
}

/** Only the fields the rules accept. */
function templateFields(t){
  return {
    name: t.name, type: t.type, priority: t.priority || '', labels: t.labels || [], reviewers: t.reviewers || [],
    description: t.description || '', order: Number.isInteger(t.order) ? t.order : 99, enabled: t.enabled !== false
  };
}

/**
 * Opens the template editor. `t.id` null = new template.
 * Exported for "Save as template" on a ticket.
 */
export function openTemplateEditor(t){
  if(!can('manageContent')){ showToast('Your role can\'t edit templates in this project'); return; }
  const types = activeTypes();
  const m = openModal({
    title: t.id ? `Edit template · ${t.name}` : 'New template',
    initialFocus: '#tp-name',
    body: html`
      <div class="row3">
        <div class="field"><label for="tp-name">Name</label><input type="text" id="tp-name" maxlength="${LIMITS.TEMPLATE_NAME}" value="${t.name || ''}" placeholder="Bug report"></div>
        <div class="field"><label for="tp-type">Type</label><select id="tp-type">${types.map(x => html`<option value="${x.key}" ${x.key === t.type ? 'selected' : ''}>${x.label}</option>`)}</select></div>
        <div class="field"><label for="tp-priority">Priority</label><select id="tp-priority">
          <option value="">Keep the form's default</option>
          ${PRIORITIES.map(p => html`<option value="${p}" ${p === t.priority ? 'selected' : ''}>${capitalize(p)}</option>`)}</select></div>
      </div>
      <fieldset class="field"><legend>Default labels</legend>
        <div class="label-check-group" id="tp-labels">${labelNames().map(l => html`<label class="label-check"><input type="checkbox" value="${l}" ${(t.labels || []).includes(l) ? 'checked' : ''}><span class="label-dot" style="background:${labelColor(l)}"></span>${l}</label>`)}</div>
      </fieldset>
      ${reviewersField('tp-reviewers')}
      <div class="template-editor">
        <div class="field"><label for="tp-desc">Description</label>
          <textarea id="tp-desc" rows="12" maxlength="${LIMITS.DESCRIPTION}" placeholder="## Steps to reproduce\n1. \n\n## Expected result\n\n- [ ] Test added">${t.description || ''}</textarea>
          <p class="field-hint">Formatting: <code>## Heading</code> · <code>- bullet</code> · <code>1. step</code> · <code>- [ ] checklist</code> · <code>**bold**</code></p></div>
        <div class="field"><span class="field-label">Preview</span><div class="markdown template-preview" id="tp-preview" aria-live="polite"></div></div>
      </div>
      <label class="toggle-row"><input type="checkbox" id="tp-enabled" ${t.enabled !== false ? 'checked' : ''}><span>Offer this template when creating tickets</span></label>
      <div class="modal-actions"><button type="button" class="tp-cancel">Cancel</button><button type="button" class="primary tp-save">${t.id ? 'Save template' : 'Create template'}</button></div>`
  });
  const reviewers = wireReviewersField(m, 'tp-reviewers', t.reviewers || []);
  const preview = () => { m.$('#tp-preview').innerHTML = (m.$('#tp-desc').value.trim() ? renderMarkdown(m.$('#tp-desc').value) : html`<p class="muted-text">Nothing yet.</p>`).toString(); };
  m.$('#tp-desc').addEventListener('input', preview);
  preview();

  m.$('.tp-cancel').addEventListener('click', () => m.close());
  m.$('.tp-save').addEventListener('click', async () => {
    const name = m.$('#tp-name').value.trim();
    if(!name){ showToast('Give the template a name'); m.$('#tp-name').focus(); return; }
    if(!(await makeEditable())) return;
    const order = t.id ? t.order : Math.max(0, ...(state.templates || []).map(x => x.order || 0)) + 1;
    const fields = templateFields({
      name, type: m.$('#tp-type').value, priority: m.$('#tp-priority').value,
      labels: m.$$('#tp-labels input:checked').map(i => i.value), reviewers: reviewers.get(),
      description: m.$('#tp-desc').value, order, enabled: m.$('#tp-enabled').checked
    });
    const ok = await attempt('Could not save the template', () => api.saveTemplate(t.id || null, fields));
    if(ok !== false){ showToast(`Template "${name}" saved`, 'success'); m.close(); }
  });
}
