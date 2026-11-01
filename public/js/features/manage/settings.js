/* =========================================================
   features/manage/settings.js — Manage → Workflow (needs "manage
   workflow") and Manage → Integrations (needs "manage integrations").
   Both save into the project's settings; firestore.rules checks the
   permission for each group of fields.
========================================================= */
import { state } from '../../core/state.js';
import { html } from '../../core/html.js';
import { icon } from '../../core/icons.js';
import { STATUSES, DEFAULT_SETTINGS, LIMITS } from '../../core/constants.js';
import { getSettings } from '../../core/settings.js';
import { showToast } from '../../core/ui.js';
import { sendTestMessage, isValidWebhookUrl } from '../../integrations/discord.js';
import { sectionHead, noProject, saveProjectSettings, attempt, trackDirty } from './common.js';
import { isAdmin } from '../../core/permissions.js';
import * as api from '../../data/api.js';

/* ---------------- WORKFLOW ---------------- */

export function renderWorkflow(root){
  if(!state.project){ root.innerHTML = html`${sectionHead('Workflow', '')}${noProject()}`.toString(); return; }
  const s = getSettings();
  // Local copies of every field, so redrawing (adding/removing an item) keeps unsaved edits.
  let dod = s.dodItems.map(d => ({ ...d }));
  let staleDays = s.staleDays;
  const wip = { ...s.wipLimits };

  const draw = () => {
    root.innerHTML = html`
      ${sectionHead('Workflow', 'How work moves through this project.')}
      <div class="card-section">
        <h3>Definition of Done</h3>
        <p class="field-hint">Items every ticket must have ticked before it can move to Done — enforced by the database, for everyone. Leave empty to turn it off.</p>
        <div class="settings-list" id="dodRows">
          ${dod.map((d, i) => html`
            <div class="settings-row" data-i="${i}">
              ${icon('checkSquare', 16)}
              <input type="text" class="dod-text" value="${d.text}" maxlength="${LIMITS.DOD_ITEM}" placeholder="e.g. Tests added" aria-label="Definition of Done item">
              <button type="button" class="ghost small" data-remove aria-label="Remove item">${icon('x', 14)}</button>
            </div>`)}
          ${dod.length === 0 ? html`<div class="empty-note">Off — tickets can move to Done without a checklist.</div>` : ''}
        </div>
        <button type="button" class="small" id="addDod">${icon('plus', 14)}Add item</button>
      </div>
      <div class="card-section">
        <h3>Limits</h3>
        <div class="field">
          <label for="staleDays">Stale after (days without activity)</label>
          <p class="field-hint">Tickets In progress or In review with no activity for this long are flagged.</p>
          <input type="number" id="staleDays" class="narrow-input" min="1" max="365" step="1" value="${staleDays}">
        </div>
        <fieldset class="field">
          <legend>Work-in-progress limits per column</legend>
          <p class="field-hint">0 means no limit. Columns over their limit turn red.</p>
          <div class="wip-inputs">${STATUSES.map(st => html`
            <label class="wip-input">${st.label}<input type="number" min="0" step="1" data-status="${st.key}" value="${wip[st.key] || 0}"></label>`)}</div>
        </fieldset>
      </div>
      <div class="modal-actions"><button type="button" class="primary" id="saveWorkflow">Save workflow</button></div>`.toString();
  };
  draw();

  root.addEventListener('input', e => {
    const row = e.target.closest('.settings-row');
    if(row && e.target.classList.contains('dod-text')) dod[Number(row.dataset.i)].text = e.target.value;
    if(e.target.id === 'staleDays') staleDays = e.target.value;
    if(e.target.dataset.status) wip[e.target.dataset.status] = e.target.value;
    root.dataset.dirty = '1';
  });
  root.addEventListener('click', async e => {
    if(e.target.closest('[data-remove]')){ dod.splice(Number(e.target.closest('.settings-row').dataset.i), 1); root.dataset.dirty = '1'; draw(); }
    if(e.target.closest('#addDod')){
      if(dod.length >= LIMITS.MAX_DOD_ITEMS){ showToast(`At most ${LIMITS.MAX_DOD_ITEMS} items`); return; }
      // A stable id, so renaming an item later keeps tickets' ticks.
      dod.push({ id: 'd' + Date.now().toString(36), text: '' });
      root.dataset.dirty = '1';
      draw();
      root.querySelector('#dodRows .settings-row:last-child .dod-text').focus();
    }
    if(e.target.closest('#saveWorkflow')){
      const cleanDod = dod.map(d => ({ id: d.id, text: d.text.trim() })).filter(d => d.text);
      const stale = parseInt(staleDays, 10);
      const wipLimits = {};
      STATUSES.forEach(st => { const n = parseInt(wip[st.key], 10); wipLimits[st.key] = Number.isFinite(n) && n > 0 ? n : 0; });
      const ok = await saveProjectSettings({
        dodItems: cleanDod,
        dodRequired: cleanDod.map(d => d.id), // what firestore.rules checks before Done
        staleDays: Number.isFinite(stale) && stale > 0 && stale <= 365 ? stale : DEFAULT_SETTINGS.staleDays,
        wipLimits
      }, 'Workflow');
      if(ok){ delete root.dataset.dirty; dod = cleanDod; }
    }
  });
}

/* ---------------- INTEGRATIONS ---------------- */

/** Show/Hide and "Send test" for a webhook field. */
function wireWebhook(root, input, toggle, test){
  root.querySelector(toggle).addEventListener('click', e => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-pressed', String(show));
    e.currentTarget.lastChild.textContent = show ? 'Hide' : 'Show';
  });
  root.querySelector(test).addEventListener('click', async () => {
    const url = input.value.trim();
    if(!isValidWebhookUrl(url)){ showToast('Paste a Discord webhook URL first'); return; }
    const ok = await sendTestMessage(url);
    showToast(ok ? 'Test message sent — check your Discord channel' : 'Discord rejected the test message — check the URL', ok ? 'success' : 'error');
  });
}

/* Admin alerts (workspace admins): a Discord channel for admins, posted to
   every 15 minutes by .github/workflows/admin-alerts.yml when someone asks
   for access, gets stuck getting in, or runs into a problem. */
function adminAlertsHtml(){
  return html`
    <div class="card-section" id="adminAlertsCard">
      <h3>Admin alerts <span class="scope-chip">Workspace · admins only</span></h3>
      <p class="field-hint">A message in an admins-only Discord channel when someone asks for access, gets stuck getting in, or runs into a problem — checked every 15 minutes. Needs the one-time setup in SETUP.md (Admin alerts). Use a different channel from the project's.</p>
      <div class="field">
        <label for="alertsWebhook">Webhook URL for the admins' channel</label>
        <div class="add-row flush">
          <input type="password" id="alertsWebhook" placeholder="https://discord.com/api/webhooks/…" autocomplete="off" spellcheck="false">
          <button type="button" id="toggleAlertsWebhook" aria-pressed="false">${icon('eye', 14)}Show</button>
          <button type="button" id="testAlertsWebhook">Send test</button>
        </div>
        <p class="field-hint" id="alertsSaved"></p>
      </div>
      <label class="toggle-row" for="alertsEnabled">
        <input type="checkbox" id="alertsEnabled">
        <span><strong>Send admin alerts</strong>
          <span class="field-hint">New access requests, people stuck getting in (each new step once), and new problems from Manage → Logs.</span></span>
      </label>
      <div class="modal-actions"><button type="button" class="primary" id="saveAdminAlerts">Save admin alerts</button></div>
    </div>`;
}

async function wireAdminAlerts(root){
  const card = root.querySelector('#adminAlertsCard');
  if(!card) return;
  const input = card.querySelector('#alertsWebhook');
  wireWebhook(card, input, '#toggleAlertsWebhook', '#testAlertsWebhook');
  try{
    const saved = await api.loadAdminAlerts();
    if(root.dataset.dirty) return; // they started typing before it loaded
    input.value = saved.discordWebhookUrl || '';
    card.querySelector('#alertsEnabled').checked = !!saved.enabled;
    card.querySelector('#alertsSaved').textContent = saved.discordWebhookUrl ? `Saved · ends in …${saved.discordWebhookUrl.slice(-6)}${saved.enabled ? '' : ' · switched off'}` : 'Not set up yet.';
  }catch(e){ card.querySelector('#alertsSaved').textContent = `Couldn't load: ${e.message}`; }
  card.querySelector('#saveAdminAlerts').addEventListener('click', async () => {
    const url = input.value.trim();
    const enabled = card.querySelector('#alertsEnabled').checked;
    if(url && !isValidWebhookUrl(url)){ showToast('That doesn\'t look like a Discord webhook URL (https://discord.com/api/webhooks/…)', 'error'); return; }
    if(enabled && !url){ showToast('Add the webhook first, then switch admin alerts on', 'error'); return; }
    const ok = await attempt('Could not save admin alerts', async () => { await api.saveAdminAlerts({ discordWebhookUrl: url, enabled }); return true; });
    if(ok){
      delete root.dataset.dirty;
      input.type = 'password';
      card.querySelector('#alertsSaved').textContent = url ? `Saved · ends in …${url.slice(-6)}${enabled ? '' : ' · switched off'}` : 'Not set up yet.';
      showToast(`Admin alerts ${enabled ? 'on' : 'saved (off)'}`, 'success');
    }
  });
}

export function renderIntegrations(root){
  if(!state.project){
    root.innerHTML = html`${sectionHead('Integrations', '')}${isAdmin() ? adminAlertsHtml() : ''}${noProject()}`.toString();
    trackDirty(root);
    wireAdminAlerts(root);
    return;
  }
  const s = getSettings();
  root.innerHTML = html`
    ${sectionHead('Integrations', 'Where notifications go.')}
    ${isAdmin() ? adminAlertsHtml() : ''}
    <div class="card-section">
      <h3>Discord <span class="scope-chip">${state.project.key} · ${state.project.name}</span></h3>
      <div class="field">
        <label for="webhook">Webhook URL</label>
        <p class="field-hint">Stored in the database, not in the site's code. Treat it like a password: anyone with it can post to your channel.</p>
        <div class="add-row flush">
          <input type="password" id="webhook" value="${s.discordWebhookUrl}" placeholder="https://discord.com/api/webhooks/…" autocomplete="off" spellcheck="false">
          <button type="button" id="toggleWebhook" aria-pressed="false">${icon('eye', 14)}Show</button>
          <button type="button" id="testWebhook">Send test</button>
        </div>
        ${s.discordWebhookUrl ? html`<p class="field-hint">Saved · ends in …${s.discordWebhookUrl.slice(-6)}</p>` : ''}
      </div>
      <label class="toggle-row" for="weeklySummary">
        <input type="checkbox" id="weeklySummary" ${s.weeklySummary ? 'checked' : ''}>
        <span><strong>Weekly summary</strong>
          <span class="field-hint">Every Monday morning, post this project's week — done, in progress, blocked, overdue, sprint progress — to the channel above. Needs the one-time setup in SETUP.md.</span></span>
      </label>
      <div class="modal-actions"><button type="button" class="primary" id="saveIntegrations">Save integrations</button></div>
    </div>`.toString();

  trackDirty(root); // a teammate's change never wipes a webhook you're pasting
  wireAdminAlerts(root);
  const input = root.querySelector('#webhook');
  wireWebhook(root, input, '#toggleWebhook', '#testWebhook');
  root.querySelector('#saveIntegrations').addEventListener('click', async () => {
    const url = input.value.trim();
    if(url && !isValidWebhookUrl(url)){ showToast('That doesn\'t look like a Discord webhook URL (https://discord.com/api/webhooks/…)', 'error'); return; }
    if(await saveProjectSettings({ discordWebhookUrl: url, weeklySummary: root.querySelector('#weeklySummary').checked }, 'Integrations')){
      delete root.dataset.dirty;
      input.type = 'password';
    }
  });
}
