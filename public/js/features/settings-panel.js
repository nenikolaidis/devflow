/* =========================================================
   features/settings-panel.js — "Board settings" on the Team tab
   (admins only): Discord webhook URL, stale threshold, labels,
   Definition of Done items, and WIP limits.

   Saved to Firestore config/settings; read everywhere via
   core/settings.js getSettings(). Edits to the label and Definition of
   Done lists stay local until "Save settings".
========================================================= */
import { STATUSES, DEFAULT_SETTINGS, LABEL_PALETTE, LIMITS } from '../core/constants.js';
import { capitalize } from '../core/format.js';
import { html } from '../core/html.js';
import { icon } from '../core/icons.js';
import { getSettings } from '../core/settings.js';
import { showToast } from '../core/ui.js';
import { saveSettings } from '../data/api.js';
import { sendTestMessage, isValidWebhookUrl } from '../integrations/discord.js';

const $ = (id) => document.getElementById(id);
const COLORS = Object.keys(LABEL_PALETTE);

// Working copies while an admin edits (null = not editing; show saved values).
let labels = null;
let dodItems = null;

/** Fills the form from saved settings. Skipped while an admin is typing in it. */
export function renderSettings({ force = false } = {}){
  if(!force && $('settingsBox').contains(document.activeElement)) return;
  const s = getSettings();
  $('setWebhook').value = s.discordWebhookUrl;
  $('setStaleDays').value = s.staleDays;
  $('setWipLimits').innerHTML = html`${STATUSES.map(st => html`
    <label class="wip-input">${st.label}
      <input type="number" min="0" step="1" data-status="${st.key}" value="${s.wipLimits[st.key] || 0}">
    </label>`)}`;
  labels = s.labels.map(l => ({ ...l }));
  dodItems = s.dodItems.map(d => ({ ...d }));
  renderLabels();
  renderDod();
}

/* ---------------- LABELS ---------------- */

function renderLabels(){
  $('setLabels').innerHTML = html`${labels.map((l, i) => html`
    <div class="settings-row" data-i="${i}">
      <span class="label-dot" style="background:${LABEL_PALETTE[l.color] || LABEL_PALETTE.gray}"></span>
      <input type="text" class="label-name" value="${l.name}" maxlength="${LIMITS.LABEL_NAME}" aria-label="Label name">
      <select class="label-color" aria-label="Color for ${l.name}">
        ${COLORS.map(c => html`<option value="${c}" ${c === l.color ? 'selected' : ''}>${capitalize(c)}</option>`)}
      </select>
      <button type="button" class="ghost small" data-remove aria-label="Remove label ${l.name}">${icon('x', 14)}</button>
    </div>`)}
    ${labels.length === 0 ? html`<div class="empty-note">No labels — tickets can still be created without them.</div>` : ''}`;
}

$('setLabels').addEventListener('input', e => {
  const row = e.target.closest('.settings-row');
  if(!row) return;
  const l = labels[Number(row.dataset.i)];
  if(e.target.classList.contains('label-name')) l.name = e.target.value;
  if(e.target.classList.contains('label-color')){
    l.color = e.target.value;
    row.querySelector('.label-dot').style.background = LABEL_PALETTE[l.color];
  }
});
$('setLabels').addEventListener('click', e => {
  if(!e.target.closest('[data-remove]')) return;
  labels.splice(Number(e.target.closest('.settings-row').dataset.i), 1);
  renderLabels();
});
$('addLabelBtn').addEventListener('click', () => {
  if(labels.length >= LIMITS.MAX_LABELS){ showToast(`At most ${LIMITS.MAX_LABELS} labels`); return; }
  labels.push({ name: '', color: COLORS[labels.length % COLORS.length] });
  renderLabels();
  $('setLabels').querySelector('.settings-row:last-child .label-name').focus();
});

/* ---------------- DEFINITION OF DONE ---------------- */

function renderDod(){
  $('setDod').innerHTML = html`${dodItems.map((d, i) => html`
    <div class="settings-row" data-i="${i}">
      ${icon('checkSquare', 16)}
      <input type="text" class="dod-text" value="${d.text}" maxlength="${LIMITS.DOD_ITEM}" placeholder="e.g. Tests added" aria-label="Definition of Done item">
      <button type="button" class="ghost small" data-remove aria-label="Remove item">${icon('x', 14)}</button>
    </div>`)}
    ${dodItems.length === 0 ? html`<div class="empty-note">Off — tickets can move to Done without a checklist.</div>` : ''}`;
}

$('setDod').addEventListener('input', e => {
  const row = e.target.closest('.settings-row');
  if(row && e.target.classList.contains('dod-text')) dodItems[Number(row.dataset.i)].text = e.target.value;
});
$('setDod').addEventListener('click', e => {
  if(!e.target.closest('[data-remove]')) return;
  dodItems.splice(Number(e.target.closest('.settings-row').dataset.i), 1);
  renderDod();
});
$('addDodBtn').addEventListener('click', () => {
  if(dodItems.length >= LIMITS.MAX_DOD_ITEMS){ showToast(`At most ${LIMITS.MAX_DOD_ITEMS} items`); return; }
  // A stable id, so renaming an item later keeps tickets' ticks.
  dodItems.push({ id: 'd' + Date.now().toString(36), text: '' });
  renderDod();
  $('setDod').querySelector('.settings-row:last-child .dod-text').focus();
});

/* ---------------- SAVE ---------------- */

$('saveSettingsBtn').addEventListener('click', async () => {
  const webhook = $('setWebhook').value.trim();
  if(webhook && !isValidWebhookUrl(webhook)){
    showToast('That doesn\'t look like a Discord webhook URL (https://discord.com/api/webhooks/…)');
    return;
  }

  const cleanLabels = labels
    .map(l => ({ name: l.name.trim().toLowerCase(), color: COLORS.includes(l.color) ? l.color : 'gray' }))
    .filter(l => l.name);
  const names = cleanLabels.map(l => l.name);
  if(new Set(names).size !== names.length){ showToast('Two labels have the same name'); return; }
  if(cleanLabels.some(l => !/^[a-z0-9][a-z0-9 _-]*$/.test(l.name))){
    showToast('Label names can use letters, numbers, spaces, - and _');
    return;
  }
  const cleanDod = dodItems.map(d => ({ id: d.id, text: d.text.trim() })).filter(d => d.text);

  const staleDays = parseInt($('setStaleDays').value, 10);
  const wipLimits = {};
  document.querySelectorAll('#setWipLimits input').forEach(inp => {
    const n = parseInt(inp.value, 10);
    wipLimits[inp.dataset.status] = Number.isFinite(n) && n > 0 ? n : 0;
  });
  try{
    await saveSettings({
      discordWebhookUrl: webhook,
      staleDays: Number.isFinite(staleDays) && staleDays > 0 && staleDays <= 365 ? staleDays : DEFAULT_SETTINGS.staleDays,
      wipLimits,
      labels: cleanLabels,
      dodItems: cleanDod,
      // The ids firestore.rules checks before a ticket can move to Done.
      dodRequired: cleanDod.map(d => d.id)
    });
    showToast('Settings saved');
    document.activeElement.blur();
    renderSettings({ force: true });
  }catch(e){ showToast('Could not save settings: ' + e.message); }
});

$('testWebhookBtn').addEventListener('click', async () => {
  const url = $('setWebhook').value.trim();
  if(!isValidWebhookUrl(url)){ showToast('Paste a Discord webhook URL first'); return; }
  const ok = await sendTestMessage(url);
  showToast(ok ? 'Test message sent — check your Discord channel' : 'Discord rejected the test message — check the URL');
});
