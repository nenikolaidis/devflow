/* =========================================================
   features/notifications.js — the bell in the top bar.

   Shows "you were mentioned" notifications (written by comments.js via
   data/api.js notifyMentions, kept live by data/sync.js). Clicking one
   marks it read and opens the ticket.
========================================================= */
import { state } from '../core/state.js';
import { html } from '../core/html.js';
import { formatDateTime } from '../core/format.js';
import { displayName, avatarHtml } from '../core/people.js';
import { on, EVENTS } from '../core/events.js';
import { showToast } from '../core/ui.js';
import * as api from '../data/api.js';
import { openDetail } from './ticket-detail.js';

const $ = (id) => document.getElementById(id);
const btn = $('notifBtn');
const panel = $('notifPanel');

function render(){
  const unread = state.notifications.filter(n => !n.read).length;
  $('notifCount').textContent = unread > 9 ? '9+' : String(unread);
  $('notifCount').classList.toggle('hidden', unread === 0);
  btn.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
  $('notifMarkAll').classList.toggle('hidden', unread === 0);
  $('notifList').innerHTML = state.notifications.length === 0
    ? html`<div class="empty-note notif-empty">No notifications yet. When someone @mentions you in a comment, it shows up here.</div>`.toString()
    : html`${state.notifications.map(n => html`
        <button type="button" class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
          ${avatarHtml(n.by, 28)}
          <span class="notif-body">
            <span><strong>${displayName(n.by)}</strong> mentioned you on <strong>${n.ticketId}</strong></span>
            <span class="notif-text">${n.text}</span>
            <span class="notif-when">${n.ticketTitle} · ${formatDateTime(n.createdAt)}</span>
          </span>
          ${n.read ? '' : html`<span class="unread-dot" aria-label="Unread"></span>`}
        </button>`)}`.toString();
}

function open(){
  panel.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');
}
function close({ focusButton = false } = {}){
  if(panel.classList.contains('hidden')) return;
  panel.classList.add('hidden');
  btn.setAttribute('aria-expanded', 'false');
  if(focusButton) btn.focus();
}

btn.addEventListener('click', () => (panel.classList.contains('hidden') ? open() : close()));
document.addEventListener('mousedown', e => { if(!e.target.closest('#notifPanel, #notifBtn')) close(); });
panel.addEventListener('keydown', e => { if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close({ focusButton: true }); } });

$('notifList').addEventListener('click', e => {
  const item = e.target.closest('.notif-item');
  if(!item) return;
  const n = state.notifications.find(x => x.id === item.dataset.id);
  if(!n) return;
  close();
  if(!n.read) api.markNotificationRead(n.id).catch(err => console.error(err));
  if(state.tickets.some(t => t.firestoreId === n.ticketFid)) openDetail(n.ticketFid);
  else showToast(`${n.ticketId} is no longer on the board`);
});
$('notifMarkAll').addEventListener('click', () => {
  api.markAllNotificationsRead().catch(err => showToast('Could not update notifications: ' + err.message, 'error'));
});

on(EVENTS.NOTIFICATIONS_CHANGED, render);
on(EVENTS.PROFILES_CHANGED, render);
render();
