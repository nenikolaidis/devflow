/* =========================================================
   features/shortcuts.js — keyboard shortcuts.

     /        search            N        new ticket
     G then B / M / D / S       go to Board / My work / Dashboard / Manage
     P        switch project
     ?        this help         Esc      close a dialog or menu

   Shortcuts are ignored while typing in a field, while a dialog is open,
   and before sign-in.
========================================================= */
import { html } from '../core/html.js';
import { openModal } from '../core/ui.js';
import { can } from '../core/permissions.js';
import { state } from '../core/state.js';
import { openTicketForm } from './ticket-form.js';
import { switchTab } from './nav.js';

const SHORTCUTS = [
  ['/', 'Search tickets'],
  ['N', 'New ticket'],
  ['G then B', 'Go to Board'],
  ['G then M', 'Go to My work'],
  ['G then D', 'Go to Dashboard'],
  ['G then S', 'Go to Manage (settings)'],
  ['P', 'Switch project'],
  ['Esc', 'Close a panel, dialog or menu'],
  ['⌘/Ctrl + Enter', 'Post a comment'],
  ['?', 'Show these shortcuts']
];

let waitingForG = false;
let gTimer = null;

function isTyping(target){
  return !!(target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function openShortcutHelp(){
  openModal({
    title: 'Keyboard shortcuts',
    size: 'narrow',
    body: html`<dl class="shortcut-list">${SHORTCUTS.map(([keys, what]) => html`
      <dt>${keys.split(' then ').map((k, i) => html`${i ? html`<span class="then">then</span>` : ''}<kbd>${k}</kbd>`)}</dt><dd>${what}</dd>`)}</dl>`
  });
}

document.addEventListener('keydown', e => {
  if(e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
  if(document.getElementById('app').classList.contains('hidden')) return;
  if(document.querySelector('.modal-overlay')) return;
  const key = e.key.toLowerCase();

  if(waitingForG){
    waitingForG = false;
    clearTimeout(gTimer);
    const tab = { b: 'board', m: 'mywork', d: 'dashboard', s: 'manage' }[key];
    if(tab){ e.preventDefault(); switchTab(tab); }
    return;
  }
  if(key === '/'){ e.preventDefault(); document.getElementById('searchInput').focus(); }
  else if(key === 'n'){ e.preventDefault(); if(state.projectId && can('editTickets')) openTicketForm(null); }
  else if(key === 'p'){ e.preventDefault(); document.getElementById('projectBtn').click(); }
  else if(key === 'g'){ waitingForG = true; gTimer = setTimeout(() => { waitingForG = false; }, 1200); }
  else if(e.key === '?'){ e.preventDefault(); openShortcutHelp(); }
});
