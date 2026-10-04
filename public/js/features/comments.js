/* =========================================================
   features/comments.js — a ticket's comment thread.

   - Anyone approved can post (as themselves).
   - Authors can edit their own comments (shown as "edited").
   - Admins/PMs can hide/unhide any comment; hidden text is still
     visible to them, greyed out.
   - Authors and admins/PMs can delete.
   - Typing "@" suggests teammates; mentioned people get an in-app
     notification (bell in the top bar) and a Discord message.
   firestore.rules enforces the permissions.
========================================================= */
import * as api from '../data/api.js';
import { watchComments } from '../data/sync.js';
import { LIMITS } from '../core/constants.js';
import { state } from '../core/state.js';
import { html, raw, escapeHtml } from '../core/html.js';
import { normEmail } from '../core/permissions.js';
import { notifyMentioned } from '../integrations/discord.js';
import { formatDateTime } from '../core/format.js';
import { canModerate, isMe } from '../core/permissions.js';
import { displayName, avatarHtml, matchPeople } from '../core/people.js';
import { showToast, confirmDialog, promptDialog } from '../core/ui.js';

/**
 * Renders the comment list + "add comment" box into `container`.
 * @param {boolean} readOnly  hide posting/editing (archived ticket, non-moderator)
 * @returns {Function} unsubscribe — call when the ticket closes
 */
export function mountComments(container, ticket, { readOnly = false } = {}){
  const fid = ticket.firestoreId;
  container.innerHTML = html`
    <div class="comment-list"></div>
    ${readOnly ? '' : html`
      <div class="comment-add">
        <label for="commentInput" class="sr-only">Add a comment</label>
        <div class="combo">
          <textarea id="commentInput" rows="2" maxlength="${LIMITS.COMMENT}" placeholder="Add a comment… type @ to mention someone"
            aria-autocomplete="list" aria-controls="mentionList"></textarea>
          <div class="combo-list mention-list hidden" id="mentionList" role="listbox" aria-label="Mention a teammate"></div>
        </div>
        <div class="comment-add-actions">
          <span>@ to mention · ⌘/Ctrl + Enter to post</span>
          <button type="button" class="primary small" id="postComment">Comment</button>
        </div>
      </div>`}`;
  const list = container.querySelector('.comment-list');
  let docs = [];

  const unsubscribe = watchComments(fid, latest => {
    docs = latest;
    list.innerHTML = docs.length === 0
      ? html`<div class="comment-empty">No comments yet.</div>`
      : html`${docs.map(d => commentHtml(d.id, d.data(), readOnly))}`;
  }, () => { list.innerHTML = html`<div class="comment-empty">Could not load comments.</div>`; });

  // One click handler for every comment button (the list re-renders on each change).
  list.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const id = btn.dataset.id;
    const doc = docs.find(d => d.id === id);
    if(!doc) return;
    try{
      if(btn.dataset.action === 'edit') await editComment(fid, id, doc.data().text);
      if(btn.dataset.action === 'hide') await api.setCommentHidden(fid, id, !doc.data().hidden);
      if(btn.dataset.action === 'delete'){
        const ok = await confirmDialog({ title: 'Delete comment?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
        if(ok) await api.deleteComment(fid, id);
      }
    }catch(err){ showToast('Could not update comment: ' + err.message); }
  });

  const postBtn = container.querySelector('#postComment');
  if(postBtn){
    const input = container.querySelector('#commentInput');
    const picker = wireMentionPicker(input, container.querySelector('#mentionList'));
    const post = async () => {
      const text = input.value.trim();
      if(!text) return;
      // Only people whose "@Name" is still in the text count as mentioned.
      const mentions = picker.picked().filter(email => text.includes('@' + displayName(email))).slice(0, LIMITS.MAX_MENTIONS);
      postBtn.disabled = true;
      try{
        await api.addComment(fid, text, mentions);
        input.value = '';
        picker.reset();
        if(mentions.length){
          api.notifyMentions(ticket, mentions, text).catch(err => console.error('Could not send mention notifications:', err));
          notifyMentioned(ticket, mentions.map(displayName), text);
        }
      }catch(err){ showToast('Could not post comment: ' + err.message, 'error'); }
      postBtn.disabled = false;
    };
    postBtn.addEventListener('click', post);
    // Ctrl/Cmd + Enter posts (plain Enter picks a suggestion when the list is open).
    input.addEventListener('keydown', e => { if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); post(); } });
  }
  return unsubscribe;
}

/* ---------------- @MENTION PICKER ---------------- */

/**
 * Watches a textarea for "@name" being typed and offers matching
 * teammates. Picking one inserts "@Display Name ". Arrow keys move,
 * Enter/Tab picks, Escape closes.
 */
function wireMentionPicker(input, list){
  const picked = new Set();
  let matches = [];
  let active = 0;
  let tokenStart = -1;

  const close = () => { list.classList.add('hidden'); matches = []; tokenStart = -1; };
  const render = () => {
    list.innerHTML = html`${matches.map((u, i) => html`<div class="combo-item ${i === active ? 'active' : ''}" role="option" aria-selected="${String(i === active)}" data-i="${i}">
      <span class="cell-inline">${avatarHtml(u.id, 20)}${displayName(u.id)}</span><span class="muted-text">${u.id}</span></div>`)}`.toString();
    list.classList.toggle('hidden', matches.length === 0);
  };
  const choose = (u) => {
    const before = input.value.slice(0, tokenStart);
    const after = input.value.slice(input.selectionStart);
    const insert = '@' + displayName(u.id) + ' ';
    input.value = before + insert + after;
    const caret = before.length + insert.length;
    input.setSelectionRange(caret, caret);
    picked.add(normEmail(u.id));
    close();
    input.focus();
  };

  input.addEventListener('input', () => {
    const upToCaret = input.value.slice(0, input.selectionStart);
    const m = upToCaret.match(/(^|\s)@([^\s@]{0,40})$/);
    if(!m){ close(); return; }
    tokenStart = upToCaret.length - m[2].length - 1;
    const q = m[2].toLowerCase();
    matches = matchPeople(q, { exclude: [state.currentUser.email] }).slice(0, 6);
    active = 0;
    render();
  });
  input.addEventListener('keydown', e => {
    if(list.classList.contains('hidden') || !matches.length) return;
    if(e.key === 'ArrowDown'){ e.preventDefault(); active = (active + 1) % matches.length; render(); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); active = (active - 1 + matches.length) % matches.length; render(); }
    else if((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab'){ e.preventDefault(); choose(matches[active]); }
    else if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
  });
  list.addEventListener('mousedown', e => {
    const item = e.target.closest('[data-i]');
    if(item){ e.preventDefault(); choose(matches[Number(item.dataset.i)]); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));

  return { picked: () => [...picked], reset: () => picked.clear() };
}

/** Comment text with "@Name" for each mentioned person highlighted (escaped first). */
function textWithMentions(text, mentions){
  let out = escapeHtml(text);
  (mentions || []).forEach(email => {
    const tag = escapeHtml('@' + displayName(email));
    const cls = isMe(email) ? 'mention mention-me' : 'mention';
    out = out.split(tag).join(`<span class="${cls}">${tag}</span>`);
  });
  return raw(out);
}

async function editComment(fid, id, current){
  const text = await promptDialog({
    title: 'Edit comment', label: 'Comment', value: current,
    multiline: true, maxLength: LIMITS.COMMENT, confirmLabel: 'Save'
  });
  if(text) await api.editComment(fid, id, text);
}

function commentHtml(id, c, readOnly){
  const moderator = canModerate();
  const author = isMe(c.author);
  const canEdit = author && !c.hidden && !readOnly;
  const canDelete = moderator || author;
  const body = c.hidden
    ? html`<div class="comment-hidden">Hidden by a moderator${c.hiddenBy ? ` (${displayName(c.hiddenBy)})` : ''}</div>
           ${moderator ? html`<div class="comment-body muted">${c.text}</div>` : ''}`
    : html`<div class="comment-body">${textWithMentions(c.text, c.mentions)}</div>`;
  const actions = html`
    ${canEdit ? html`<button type="button" data-action="edit" data-id="${id}">Edit</button>` : ''}
    ${moderator ? html`<button type="button" data-action="hide" data-id="${id}">${c.hidden ? 'Unhide' : 'Hide'}</button>` : ''}
    ${canDelete ? html`<button type="button" data-action="delete" data-id="${id}">Delete</button>` : ''}`;
  return html`
    <div class="comment${c.hidden ? ' is-hidden' : ''}">
      ${avatarHtml(c.author, 28)}
      <div class="comment-main">
        <div class="comment-head"><strong>${displayName(c.author)}</strong> <span>· ${formatDateTime(c.createdAt)}${c.editedAt ? ' · edited' : ''}</span></div>
        ${body}
        ${(canEdit || moderator || canDelete) ? html`<div class="comment-actions">${actions}</div>` : ''}
      </div>
    </div>`;
}
