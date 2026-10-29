/* =========================================================
   features/manage/logs.js — Manage → Logs (workspace admins).

   Problems: what went wrong for people, grouped — the same problem for
   the same person is one row with a count — with a plain explanation of
   what it usually means and what to do, and the technical details.
   Admin actions: who changed people, roles, projects and settings, when.

   Entries are written by data/log.js; this section only reads the
   newest 300 (state.logs, kept live by data/sync.js for admins).
========================================================= */
import { state } from '../../core/state.js';
import { html } from '../../core/html.js';
import { icon } from '../../core/icons.js';
import { formatDateTime, timeAgo } from '../../core/format.js';
import { displayName } from '../../core/people.js';
import { showToast, confirmDialog, copyText } from '../../core/ui.js';
import * as api from '../../data/api.js';
import { sectionHead, attempt } from './common.js';

const SEEN_KEY = 'devflow:logsSeen';

// What each kind of problem usually means, and what to do about it.
const PROBLEM_TYPES = {
  'offline': { label: 'Can\'t reach devflow', icon: 'alert',
    help: 'Their browser couldn\'t reach the database. Almost always something on their device or network: an ad blocker or privacy extension, iCloud Private Relay / "Limit IP address tracking", a VPN, or a company network. devflow keeps retrying and switches to a compatibility connection after 3 failures. Ask them to try another browser or network, or send them "Copy invite" from Members (it has these tips).' },
  'reconnected': { label: 'Connection came back', icon: 'check',
    help: 'Good news: after the problem above, devflow got through. If it says "after switching to the compatibility connection", their network blocks the normal connection, and devflow will keep using the compatible one on that device.' },
  'js-error': { label: 'Bug in devflow', icon: 'bug',
    help: 'A crash in devflow\'s own code. Use Copy to send the details (including the technical part) to whoever maintains devflow.' },
  'error-shown': { label: 'Error message shown', icon: 'info',
    help: 'They saw this red message. "Permission" or "your role can\'t" usually means their role doesn\'t allow that action (see Roles); anything else may be a bug or a connection problem.' },
  'sync-error': { label: 'Live updates stopped', icon: 'alert',
    help: 'Changes stopped arriving for them. Usually a connection problem; reloading the page reconnects. If it keeps happening for one person, treat it like "Can\'t reach devflow".' }
};
const typeInfo = (type) => PROBLEM_TYPES[type] || { label: type, icon: 'info', help: '' };

// Filters survive live repaints while the section is open.
let view = { tab: 'problem', search: '', person: '', open: new Set() };

const millis = (t) => (t && t.toMillis ? t.toMillis() : Date.now()); // pending server time = now
const lastSeen = () => { try{ return Number(localStorage.getItem(SEEN_KEY)) || 0; }catch(e){ return 0; } };
const markSeen = () => { try{ localStorage.setItem(SEEN_KEY, String(Date.now())); }catch(e){ /* fine */ } };

/** Problems that arrived since this admin last opened the Problems tab (for the menu badge). */
export function unseenProblems(){
  const since = lastSeen();
  return state.logs.filter(l => l.kind === 'problem' && l.type !== 'reconnected' && millis(l.createdAt) > since).length;
}

function matches(entry){
  if(view.person && entry.email !== view.person) return false;
  if(!view.search) return true;
  const q = view.search.toLowerCase();
  return [entry.message, entry.detail, entry.email, entry.type, entry.target, typeInfo(entry.type).label].some(v => String(v || '').toLowerCase().includes(q));
}

/** Same person + same kind + same message → one row. */
function groupProblems(entries){
  const groups = new Map();
  entries.forEach(e => {
    const key = `${e.email}|${e.type}|${e.message}`;
    const g = groups.get(key) || { key, email: e.email, type: e.type, message: e.message, total: 0, entries: [] };
    g.total += e.count || 1;
    g.entries.push(e);
    groups.set(key, g);
  });
  return [...groups.values()].map(g => ({ ...g, latest: Math.max(...g.entries.map(e => millis(e.createdAt))), first: Math.min(...g.entries.map(e => millis(e.createdAt))) }))
    .sort((a, b) => b.latest - a.latest);
}

function problemRow(g, seenBefore){
  const info = typeInfo(g.type);
  const last = g.entries[0];
  return html`
    <details class="log-row ${g.latest > seenBefore ? 'is-new' : ''} log-${g.type}" data-key="${g.key}" ${view.open.has(g.key) ? 'open' : ''}>
      <summary>
        <span class="log-icon">${icon(info.icon, 16)}</span>
        <span class="log-main">
          <span class="log-title">${info.label}${g.total > 1 ? html` <span class="count-pill">${g.total}×</span>` : ''}</span>
          <span class="log-message">${g.message}</span>
          <span class="member-meta">${displayName(g.email)} · ${g.email} · last ${timeAgo(g.latest)}${g.entries.length > 1 ? ` · first ${timeAgo(g.first)}` : ''}${last.page ? ` · in ${last.page}` : ''}</span>
        </span>
      </summary>
      <div class="log-body">
        ${info.help ? html`<p class="log-help">${info.help}</p>` : ''}
        <div class="log-entries">
          ${g.entries.slice(0, 10).map(e => html`<div class="log-entry">
            <div class="member-meta">${formatDateTime(e.createdAt) || 'just now'}${(e.count || 1) > 1 ? ` · ${e.count} times` : ''}${e.page ? ` · ${e.page}` : ''}${e.projectId ? ` · project ${e.projectId}` : ''}</div>
            ${e.detail ? html`<pre class="log-detail">${e.detail}</pre>` : ''}
            ${e.browser ? html`<div class="member-meta log-browser">${e.browser}</div>` : ''}
          </div>`)}
        </div>
      </div>
    </details>`;
}

function adminRow(e){
  return html`<div class="log-row log-admin-row">
    <span class="log-icon">${icon('edit', 15)}</span>
    <span class="log-main">
      <span class="log-message">${e.message}</span>
      <span class="member-meta">${displayName(e.email)} · ${formatDateTime(e.createdAt) || 'just now'}</span>
    </span>
  </div>`;
}

/** Plain-text version of what's on screen, for Copy. */
function asText(problems, actions){
  if(view.tab === 'problem'){
    return problems.map(g => [
      `${typeInfo(g.type).label} — ${g.message} (${g.total}×)`,
      `  ${g.email} · last ${new Date(g.latest).toISOString()} · first ${new Date(g.first).toISOString()}`,
      ...g.entries.slice(0, 3).map(e => `  · ${e.page || ''} ${e.detail ? e.detail.split('\n').slice(0, 6).join(' | ') : ''} ${e.browser ? `[${e.browser}]` : ''}`)
    ].join('\n')).join('\n\n') || 'No problems.';
  }
  return actions.map(e => `${new Date(millis(e.createdAt)).toISOString()}  ${e.email}  ${e.message}`).join('\n') || 'No admin actions.';
}

export function renderLogs(root){
  const seenBefore = lastSeen();
  const all = state.logs;
  const problems = groupProblems(all.filter(e => e.kind === 'problem' && matches(e)));
  const actions = all.filter(e => e.kind === 'admin' && matches(e));
  const people = [...new Set(all.map(e => e.email))].sort();
  const problemCount = all.filter(e => e.kind === 'problem').length;
  const actionCount = all.filter(e => e.kind === 'admin').length;

  root.innerHTML = html`
    ${sectionHead('Logs', 'Problems people ran into, and changes made by admins and project managers. Entries are kept for 30 days.', 'workspace')}
    <div class="card-section">
      <div class="log-toolbar">
        <div class="segmented" role="tablist" aria-label="Log">
          <button type="button" role="tab" data-tab="problem" class="${view.tab === 'problem' ? 'active' : ''}" aria-selected="${view.tab === 'problem'}">Problems <span class="count-pill">${problemCount}</span></button>
          <button type="button" role="tab" data-tab="admin" class="${view.tab === 'admin' ? 'active' : ''}" aria-selected="${view.tab === 'admin'}">Admin actions <span class="count-pill">${actionCount}</span></button>
        </div>
        <input type="search" id="logSearch" placeholder="Search messages, people, details…" value="${view.search}" aria-label="Search the log">
        <select id="logPerson" aria-label="Person">
          <option value="">Everyone</option>
          ${people.map(p => html`<option value="${p}" ${p === view.person ? 'selected' : ''}>${displayName(p)}</option>`)}
        </select>
        <button type="button" class="ghost small" id="logCopy">${icon('copy', 14)}Copy</button>
        ${view.tab === 'problem' && problemCount ? html`<button type="button" class="ghost small" id="logClear">${icon('trash', 14)}Clear problems</button>` : ''}
      </div>
      <div class="log-list" id="logList">
        ${view.tab === 'problem'
          ? (problems.length ? problems.map(g => problemRow(g, seenBefore)) : html`<div class="empty-note">${problemCount ? 'Nothing matches.' : 'No problems recorded. 🎉'}</div>`)
          : (actions.length ? actions.map(adminRow) : html`<div class="empty-note">${actionCount ? 'Nothing matches.' : 'No admin actions recorded yet.'}</div>`)}
      </div>
    </div>`.toString();

  if(view.tab === 'problem'){
    markSeen();
    const navBadge = document.querySelector('#manageNav [data-section=logs] .nav-badge');
    if(navBadge) navBadge.remove();
    const tab = document.getElementById('navManage'); // the dot on the Manage tab (features/nav.js)
    tab.classList.remove('has-alert');
    tab.title = '';
  }
  root.querySelectorAll('details[data-key]').forEach(d => d.addEventListener('toggle', () => { if(d.open) view.open.add(d.dataset.key); else view.open.delete(d.dataset.key); }));

  root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { view.tab = b.dataset.tab; renderLogs(root); }));
  const search = root.querySelector('#logSearch');
  search.addEventListener('input', () => {
    view.search = search.value.trim();
    const pos = search.selectionStart;
    renderLogs(root);
    const again = root.querySelector('#logSearch');
    again.focus();
    again.setSelectionRange(pos, pos);
  });
  root.querySelector('#logPerson').addEventListener('change', e => { view.person = e.target.value; renderLogs(root); });
  root.querySelector('#logCopy').addEventListener('click', () => copyText(asText(problems, actions), { done: 'Log copied', title: 'Log' }));
  const clear = root.querySelector('#logClear');
  if(clear) clear.addEventListener('click', async () => {
    const ids = state.logs.filter(e => e.kind === 'problem').map(e => e.id);
    const ok = await confirmDialog({ title: `Clear ${ids.length} problem entr${ids.length === 1 ? 'y' : 'ies'}?`, message: 'Admin actions are kept. This can\'t be undone.', confirmLabel: 'Clear', danger: true });
    if(!ok) return;
    await attempt('Could not clear the log', async () => { await api.deleteLogEntries(ids); showToast('Problems cleared', 'success'); });
  });
}
