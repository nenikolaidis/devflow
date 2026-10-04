/* =========================================================
   features/comments.js — a ticket's comment thread.

   - Anyone approved can post (as themselves).
   - Authors can edit their own comments (shown as "edited").
   - Admins/PMs can hide/unhide any comment; hidden text is still
     visible to them, greyed out.
   - Authors and admins/PMs can delete.
   firestore.rules enforces the same.
========================================================= */
import * as api from '../data/api.js';
import { watchComments } from '../data/sync.js';
import { LIMITS } from '../core/constants.js';
import { html } from '../core/html.js';
import { formatDateTime } from '../core/format.js';
import { canModerate, isMe } from '../core/permissions.js';
import { displayName } from '../core/people.js';
import { showToast, confirmDialog, promptDialog } from '../core/ui.js';

/**
 * Renders the comment list + "add comment" box into `container`.
 * @param {boolean} readOnly  hide posting/editing (archived ticket, non-moderator)
 * @returns {Function} unsubscribe — call when the ticket closes
 */
export function mountComments(container, fid, { readOnly = false } = {}){
  container.innerHTML = html`
    <div class="comment-list"></div>
    ${readOnly ? '' : html`
      <div class="comment-add">
        <label for="commentInput" class="sr-only">Add a comment</label>
        <textarea id="commentInput" rows="2" maxlength="${LIMITS.COMMENT}" placeholder="Add a comment..."></textarea>
        <button type="button" class="primary" id="postComment">Post</button>
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
    const post = async () => {
      const text = input.value.trim();
      if(!text) return;
      postBtn.disabled = true;
      try{ await api.addComment(fid, text); input.value = ''; }
      catch(err){ showToast('Could not post comment: ' + err.message); }
      postBtn.disabled = false;
    };
    postBtn.addEventListener('click', post);
    // Ctrl/Cmd + Enter posts.
    input.addEventListener('keydown', e => { if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); post(); } });
  }
  return unsubscribe;
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
    : html`<div class="comment-body">${c.text}</div>`;
  const actions = html`
    ${canEdit ? html`<button type="button" class="ghost small" data-action="edit" data-id="${id}">Edit</button>` : ''}
    ${moderator ? html`<button type="button" class="ghost small" data-action="hide" data-id="${id}">${c.hidden ? 'Unhide' : 'Hide'}</button>` : ''}
    ${canDelete ? html`<button type="button" class="ghost small" data-action="delete" data-id="${id}">Delete</button>` : ''}`;
  return html`
    <div class="comment${c.hidden ? ' is-hidden' : ''}">
      <div class="comment-head"><span>${displayName(c.author)}</span><span>${formatDateTime(c.createdAt)}${c.editedAt ? ' · edited' : ''}</span></div>
      ${body}
      ${(canEdit || moderator || canDelete) ? html`<div class="comment-actions">${actions}</div>` : ''}
    </div>`;
}
