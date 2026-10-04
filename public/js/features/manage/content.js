/* =========================================================
   features/manage/content.js — Manage → Labels and Manage → Ticket
   types (both need "manage content"). Stored in the project's
   settings; edits stay local until "Save".
========================================================= */
import { state } from '../../core/state.js';
import { html } from '../../core/html.js';
import { icon } from '../../core/icons.js';
import { LABEL_PALETTE, LIMITS, TYPE_ICON_CHOICES } from '../../core/constants.js';
import { capitalize } from '../../core/format.js';
import { getSettings, typeOf } from '../../core/settings.js';
import { showToast } from '../../core/ui.js';
import { sectionHead, noProject, saveProjectSettings, slug } from './common.js';

const COLORS = Object.keys(LABEL_PALETTE);
const colorOptions = (selected) => COLORS.map(c => html`<option value="${c}" ${c === selected ? 'selected' : ''}>${capitalize(c)}</option>`);

/* ---------------- LABELS ---------------- */

export function renderLabels(root){
  if(!state.project){ root.innerHTML = html`${sectionHead('Labels', '')}${noProject()}`.toString(); return; }
  let labels = getSettings().labels.map(l => ({ ...l }));
  const usage = (name) => state.tickets.filter(t => (t.labels || []).includes(name)).length;

  const draw = () => {
    root.innerHTML = html`
      ${sectionHead('Labels', 'The topic areas people can tag tickets with. Renaming a label doesn\'t change tickets that already use the old name.')}
      <div class="card-section">
        <div class="settings-list" id="labelRows">
          ${labels.map((l, i) => html`
            <div class="settings-row" data-i="${i}">
              <span class="label-dot" style="background:${LABEL_PALETTE[l.color] || LABEL_PALETTE.gray}"></span>
              <input type="text" class="label-name" value="${l.name}" maxlength="${LIMITS.LABEL_NAME}" aria-label="Label name">
              <select class="label-color" aria-label="Color for ${l.name}">${colorOptions(l.color)}</select>
              <span class="muted-text usage">${usage(l.name)} tickets</span>
              <button type="button" class="ghost small" data-remove aria-label="Remove label ${l.name}">${icon('x', 14)}</button>
            </div>`)}
          ${labels.length === 0 ? html`<div class="empty-note">No labels — tickets can still be created without them.</div>` : ''}
        </div>
        <div class="modal-actions">
          <button type="button" id="addLabel">${icon('plus', 14)}Add label</button>
          <button type="button" class="primary" id="saveLabels">Save labels</button>
        </div>
      </div>`.toString();
  };
  draw();

  root.addEventListener('input', e => {
    const row = e.target.closest('.settings-row');
    if(!row) return;
    root.dataset.dirty = '1';
    const l = labels[Number(row.dataset.i)];
    if(e.target.classList.contains('label-name')) l.name = e.target.value;
    if(e.target.classList.contains('label-color')){ l.color = e.target.value; row.querySelector('.label-dot').style.background = LABEL_PALETTE[l.color]; }
  });
  root.addEventListener('click', async e => {
    if(e.target.closest('[data-remove]')){ labels.splice(Number(e.target.closest('.settings-row').dataset.i), 1); root.dataset.dirty = '1'; draw(); }
    if(e.target.closest('#addLabel')){
      if(labels.length >= LIMITS.MAX_LABELS){ showToast(`At most ${LIMITS.MAX_LABELS} labels`); return; }
      labels.push({ name: '', color: COLORS[labels.length % COLORS.length] });
      root.dataset.dirty = '1';
      draw();
      root.querySelector('.settings-row:last-child .label-name').focus();
    }
    if(e.target.closest('#saveLabels')){
      const clean = labels.map(l => ({ name: l.name.trim().toLowerCase(), color: COLORS.includes(l.color) ? l.color : 'gray' })).filter(l => l.name);
      const names = clean.map(l => l.name);
      if(new Set(names).size !== names.length){ showToast('Two labels have the same name'); return; }
      if(clean.some(l => !/^[a-z0-9][a-z0-9 _-]*$/.test(l.name))){ showToast('Label names can use letters, numbers, spaces, - and _'); return; }
      if(await saveProjectSettings({ labels: clean }, 'Labels')) delete root.dataset.dirty;
    }
  });
}

/* ---------------- TICKET TYPES ---------------- */

export function renderTypes(root){
  if(!state.project){ root.innerHTML = html`${sectionHead('Ticket types', '')}${noProject()}`.toString(); return; }
  let types = getSettings().types.map(t => ({ enabled: true, ...t }));
  const usage = (key) => state.tickets.filter(t => typeOf(t) === key).length;

  const draw = () => {
    root.innerHTML = html`
      ${sectionHead('Ticket types', 'What kinds of work this project tracks. Each type has an icon and a colour. Switch a type off to stop offering it without changing existing tickets.')}
      <div class="card-section">
        <div class="settings-list" id="typeRows">
          ${types.map((t, i) => html`
            <div class="settings-row type-row ${t.enabled === false ? 'is-off' : ''}" data-i="${i}">
              <span class="type-preview" style="color:${LABEL_PALETTE[t.color] || LABEL_PALETTE.gray}">${icon(t.icon || 'checkSquare', 18)}</span>
              <input type="text" class="type-label" value="${t.label}" maxlength="${LIMITS.TYPE_LABEL}" aria-label="Type name">
              <select class="type-icon-select" aria-label="Icon for ${t.label}">${TYPE_ICON_CHOICES.map(n => html`<option value="${n}" ${n === t.icon ? 'selected' : ''}>${n}</option>`)}</select>
              <select class="type-color" aria-label="Color for ${t.label}">${colorOptions(t.color)}</select>
              <label class="inline-check"><input type="checkbox" class="type-enabled" ${t.enabled !== false ? 'checked' : ''}> On</label>
              <span class="muted-text usage">${usage(t.key)} tickets</span>
              <button type="button" class="ghost small" data-remove aria-label="Remove ${t.label}" ${usage(t.key) ? 'disabled title="Tickets use this type — switch it off instead"' : ''}>${icon('x', 14)}</button>
            </div>`)}
        </div>
        <div class="modal-actions">
          <button type="button" id="addType">${icon('plus', 14)}Add type</button>
          <button type="button" class="primary" id="saveTypes">Save types</button>
        </div>
      </div>`.toString();
  };
  draw();

  root.addEventListener('input', e => {
    const row = e.target.closest('.type-row');
    if(!row) return;
    root.dataset.dirty = '1';
    const t = types[Number(row.dataset.i)];
    if(e.target.classList.contains('type-label')) t.label = e.target.value;
    if(e.target.classList.contains('type-icon-select') || e.target.classList.contains('type-color')){
      if(e.target.classList.contains('type-icon-select')) t.icon = e.target.value; else t.color = e.target.value;
      row.querySelector('.type-preview').outerHTML = html`<span class="type-preview" style="color:${LABEL_PALETTE[t.color] || LABEL_PALETTE.gray}">${icon(t.icon || 'checkSquare', 18)}</span>`.toString();
    }
    if(e.target.classList.contains('type-enabled')){ t.enabled = e.target.checked; row.classList.toggle('is-off', !t.enabled); }
  });
  root.addEventListener('click', async e => {
    if(e.target.closest('[data-remove]')){ types.splice(Number(e.target.closest('.type-row').dataset.i), 1); root.dataset.dirty = '1'; draw(); }
    if(e.target.closest('#addType')){
      if(types.length >= 20){ showToast('At most 20 types'); return; }
      types.push({ key: '', label: '', icon: 'checkSquare', color: 'gray', enabled: true });
      root.dataset.dirty = '1';
      draw();
      root.querySelector('.type-row:last-child .type-label').focus();
    }
    if(e.target.closest('#saveTypes')){
      const used = new Set();
      const clean = [];
      for(const t of types){
        const label = t.label.trim();
        if(!label) continue;
        // New types get a key from their name; existing keys never change (tickets store them).
        let key = t.key || slug(label);
        while(!t.key && used.has(key)) key = slug(label) + '-' + Math.random().toString(36).slice(2, 4);
        used.add(key);
        clean.push({ key, label, icon: TYPE_ICON_CHOICES.includes(t.icon) ? t.icon : 'checkSquare', color: COLORS.includes(t.color) ? t.color : 'gray', enabled: t.enabled !== false });
      }
      if(!clean.some(t => t.enabled)){ showToast('Keep at least one type switched on'); return; }
      if(await saveProjectSettings({ types: clean }, 'Ticket types')){ delete root.dataset.dirty; types = clean.map(t => ({ ...t })); }
    }
  });
}
