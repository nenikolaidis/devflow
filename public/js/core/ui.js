/* =========================================================
   core/ui.js — shared UI building blocks: toasts and dialogs.

   openModal()     a dialog with title, body, Esc/backdrop to close,
                   keyboard focus kept inside, focus restored on close
   confirmDialog() "Are you sure?" → Promise<boolean>
   promptDialog()  ask for a line/paragraph of text → Promise<string|null>
   showToast()     a short message at the bottom of the screen

   Use these instead of the browser's alert/confirm/prompt.
========================================================= */
import { html } from './html.js';
import { icon } from './icons.js';

/* ---------------- TOAST ---------------- */
const toastEl = document.getElementById('toast');
let toastTimer = null;

export function showToast(message){
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  // Longer messages stay up a little longer.
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), Math.min(6000, 2200 + message.length * 25));
}

/* ---------------- MODAL ---------------- */
const openModals = []; // stack, so Esc closes only the top one
let modalCount = 0;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

document.addEventListener('keydown', (e) => {
  const top = openModals[openModals.length - 1];
  if(!top) return;
  if(e.key === 'Escape'){ e.preventDefault(); top.close(); return; }
  if(e.key === 'Tab') trapFocus(e, top.overlay);
});

function trapFocus(e, container){
  const items = Array.from(container.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null);
  if(items.length === 0) return;
  const first = items[0], last = items[items.length - 1];
  if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  else if(!container.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
}

/**
 * Opens a dialog.
 * @param {object} opts
 * @param {string|SafeHtml} opts.title    plain text, or html`` for a custom header
 * @param {SafeHtml} opts.body            the dialog content (html``)
 * @param {string} [opts.size]            '' | 'narrow'
 * @param {boolean} [opts.drawer]         slide in from the right as a side panel (tickets)
 * @param {SafeHtml} [opts.headerActions] buttons shown in the header, before Close
 * @param {string} [opts.label]           accessible name when the title isn't plain text
 * @param {string} [opts.initialFocus]    selector to focus first (default: first field)
 * @param {Function} [opts.onClose]       runs once when the dialog closes (e.g. stop listeners)
 * @returns {{ el: HTMLElement, $: Function, $$: Function, close: Function }}
 */
export function openModal({ title, body, size = '', drawer = false, headerActions = '', label = '', initialFocus = '', onClose }){
  const titleId = `modal-title-${++modalCount}`;
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay' + (drawer ? ' drawer-overlay' : '');
  overlay.innerHTML = html`
    <div class="modal ${size} ${drawer ? 'drawer' : ''}" role="dialog" aria-modal="true"
      ${label ? html`aria-label="${label}"` : html`aria-labelledby="${titleId}"`}>
      <div class="modal-head">
        ${typeof title === 'string' ? html`<h2 id="${titleId}">${title}</h2>` : html`<div id="${titleId}">${title}</div>`}
        ${headerActions ? html`<div class="modal-head-actions">${headerActions}</div>` : ''}
        <button class="ghost modal-close" type="button" aria-label="Close">${icon('x')}</button>
      </div>
      ${drawer ? html`<div class="drawer-body">${body}</div>` : body}
    </div>`;
  document.body.appendChild(overlay);

  let closed = false;
  const modal = {
    overlay,
    el: overlay.querySelector('.modal'),
    $: (sel) => overlay.querySelector(sel),
    $$: (sel) => Array.from(overlay.querySelectorAll(sel)),
    close(){
      if(closed) return;
      closed = true;
      overlay.remove();
      const i = openModals.indexOf(modal);
      if(i !== -1) openModals.splice(i, 1);
      if(onClose) onClose();
      if(previousFocus && document.contains(previousFocus)) previousFocus.focus();
    }
  };
  openModals.push(modal);

  overlay.addEventListener('mousedown', e => { if(e.target === overlay) modal.close(); });
  modal.$('.modal-close').addEventListener('click', () => modal.close());

  const focusTarget = (initialFocus && modal.$(initialFocus))
    || modal.$('.modal input:not([type=hidden]), .modal select, .modal textarea')
    || modal.$('.modal-close');
  focusTarget.focus();
  return modal;
}

/** Closes every open dialog (used on sign-out). */
export function closeAllModals(){
  openModals.slice().reverse().forEach(m => m.close());
}

/* ---------------- CONFIRM ---------------- */
/** Resolves true if confirmed, false if cancelled or closed. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }){
  return new Promise(resolve => {
    let answer = false;
    const m = openModal({
      title, size: 'narrow', initialFocus: '.dlg-cancel',
      body: html`
        <p class="dialog-message">${message}</p>
        <div class="modal-actions">
          <button type="button" class="dlg-cancel">Cancel</button>
          <button type="button" class="${danger ? 'danger-solid' : 'primary'} dlg-ok">${confirmLabel}</button>
        </div>`,
      onClose: () => resolve(answer)
    });
    m.$('.dlg-cancel').addEventListener('click', () => m.close());
    m.$('.dlg-ok').addEventListener('click', () => { answer = true; m.close(); });
  });
}

/* ---------------- PROMPT ---------------- */
/** Resolves the trimmed text, or null if cancelled. */
export function promptDialog({ title, label, value = '', placeholder = '', multiline = false, maxLength = 500, confirmLabel = 'Save', required = true }){
  return new Promise(resolve => {
    let answer = null;
    const m = openModal({
      title, size: 'narrow',
      body: html`
        <div class="field">
          <label for="dlg-input">${label}</label>
          ${multiline
            ? html`<textarea id="dlg-input" rows="4" maxlength="${maxLength}" placeholder="${placeholder}">${value}</textarea>`
            : html`<input type="text" id="dlg-input" maxlength="${maxLength}" value="${value}" placeholder="${placeholder}">`}
        </div>
        <div class="auth-error dlg-error" role="alert"></div>
        <div class="modal-actions">
          <button type="button" class="dlg-cancel">Cancel</button>
          <button type="button" class="primary dlg-ok">${confirmLabel}</button>
        </div>`,
      onClose: () => resolve(answer)
    });
    const input = m.$('#dlg-input');
    const submit = () => {
      const text = input.value.trim();
      if(required && !text){ m.$('.dlg-error').textContent = 'This can\'t be empty.'; input.focus(); return; }
      answer = text;
      m.close();
    };
    m.$('.dlg-cancel').addEventListener('click', () => m.close());
    m.$('.dlg-ok').addEventListener('click', submit);
    if(!multiline) input.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); submit(); } });
  });
}
