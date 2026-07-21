import { db } from './firebase-init.js';
import { state } from './state.js';
import { STATUSES, PRIORITIES, PRIORITY_COLOR, ALL_LABELS, TABLE_COLUMNS, normalizeStatus, TICKET_TEMPLATES } from './constants.js';
import { showToast, escapeHtml, formatDate, formatDateTime, isOverdue, matchesFilters } from './utils.js';
import { renderDashboard } from './dashboard.js';
import { avatarHtml, displayName } from './profiles.js';
import { notifyAssignment } from './notify.js';
import { notifyTicketCreated, notifyTicketAssigned, notifyTicketsDeleted } from './discord.js';

const board = document.getElementById('board');

/* ---------------- COLLAPSED COLUMN PERSISTENCE (per-browser UI preference) ---------------- */
try{ state.collapsedColumns = JSON.parse(localStorage.getItem('devflow:collapsedColumns') || '{}'); }
catch(e){ state.collapsedColumns = {}; }
function saveCollapsedColumns(){
  try{ localStorage.setItem('devflow:collapsedColumns', JSON.stringify(state.collapsedColumns)); }catch(e){ /* ignore */ }
}

/* ---------------- REAL-TIME LISTENER ---------------- */
export function attachTicketsListener(){
  state.unsub.tickets = db.collection('tickets').orderBy('createdAt', 'desc').onSnapshot(snap => {
    state.tickets = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    if(state.currentTab === 'board') renderBoardView();
    if(state.currentTab === 'dashboard') renderDashboard();
  }, err => showToast('Sync error: ' + err.message));
}

export function renderBoardView(){
  populateAssigneeFilter();
  if(state.boardViewMode === 'kanban') renderBoard(); else renderTable();
}

function nextTicketNumber(){
  let max = 0;
  state.tickets.forEach(t => { const m = /TASK-(\d+)/.exec(t.id || ''); if(m) max = Math.max(max, parseInt(m[1], 10)); });
  return max + 1;
}
function ticketId(num){ return 'TASK-' + String(num).padStart(3,'0'); }

/* ---------------- ACTIVITY LOG (audit trail per ticket) ---------------- */
async function logActivity(firestoreId, entry){
  try{
    await db.collection('tickets').doc(firestoreId).collection('activity').add({
      ...entry,
      actor: state.currentUser.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }catch(e){ console.error('Could not log activity:', e); }
}

function describeActivity(entry){
  const who = displayName(entry.actor);
  const statusLabel = (key) => (STATUSES.find(s => s.key === key) || {}).label || key;
  switch(entry.type){
    case 'created': return `${who} created this ticket`;
    case 'status_change': return `${who} moved status: ${statusLabel(entry.from)} → ${statusLabel(entry.to)}`;
    case 'assignment': return `${who} assigned this to ${displayName(entry.to)}`;
    case 'edit': return `${who} updated ${entry.summary}`;
    default: return `${who} made a change`;
  }
}

/* ---------------- SORT (shared by kanban card order and table rows) ---------------- */
function sortTickets(rows, sort){
  const dir = sort.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    let av = a[sort.key], bv = b[sort.key];
    if(sort.key === 'labels'){ av = (a.labels||[]).join(','); bv = (b.labels||[]).join(','); }
    if(sort.key === 'status'){ av = STATUSES.findIndex(s => s.key === normalizeStatus(a.status)); bv = STATUSES.findIndex(s => s.key === normalizeStatus(b.status)); }
    if(sort.key === 'priority'){ av = PRIORITIES.indexOf(a.priority); bv = PRIORITIES.indexOf(b.priority); }
    if(av == null || av === '') av = sort.key === 'dueDate' || sort.key === 'createdAt' ? '9999' : '';
    if(bv == null || bv === '') bv = sort.key === 'dueDate' || sort.key === 'createdAt' ? '9999' : '';
    if(typeof av === 'string') av = av.toLowerCase();
    if(typeof bv === 'string') bv = bv.toLowerCase();
    if(av < bv) return -1 * dir;
    if(av > bv) return 1 * dir;
    return 0;
  });
}

document.getElementById('sortSelect').addEventListener('change', e => {
  const [key, dir] = e.target.value.split(':');
  state.tableSort = { key, dir };
  renderBoardView();
});

/* ---------------- ASSIGNEE FILTER ---------------- */
function populateAssigneeFilter(){
  const sel = document.getElementById('assigneeFilter');
  const current = sel.value;
  const emails = state.allowlistCache.map(u => u.id).sort();
  sel.innerHTML = `<option value="">All assignees</option><option value="__unassigned__">Unassigned</option>` +
    emails.map(e => `<option value="${e}">${displayName(e)}</option>`).join('');
  if(Array.from(sel.options).some(o => o.value === current)) sel.value = current;
}
document.getElementById('assigneeFilter').addEventListener('change', e => { state.filters.assignee = e.target.value; renderBoardView(); });

/* ---------------- MULTI-SELECT ---------------- */
document.getElementById('selectModeBtn').addEventListener('click', () => {
  state.selectMode = !state.selectMode;
  state.selectedIds.clear();
  document.getElementById('selectModeBtn').classList.toggle('active', state.selectMode);
  updateBulkBar();
  renderBoardView();
});

function updateBulkBar(){
  let bar = document.getElementById('bulkBar');
  if(!state.selectMode || state.selectedIds.size === 0){
    if(bar) bar.remove();
    return;
  }
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'bulkBar';
    bar.className = 'bulk-bar';
    document.body.appendChild(bar);
  }
  const canDelete = state.currentRole === 'admin' || state.currentRole === 'pm';
  bar.innerHTML = `
    <span>${state.selectedIds.size} selected</span>
    <select id="bulkStatus"><option value="">Move to…</option>${STATUSES.map(s => `<option value="${s.key}">${s.label}</option>`).join('')}</select>
    ${canDelete ? `<button class="danger small" id="bulkDelete">Delete</button>` : ''}
    <button class="ghost small" id="bulkCancel">Clear</button>
  `;
  bar.querySelector('#bulkStatus').addEventListener('change', async (e) => {
    const status = e.target.value;
    if(!status) return;
    const ids = Array.from(state.selectedIds);
    const movedTickets = ids.map(id => state.tickets.find(t => t.firestoreId === id)).filter(Boolean);
    try{
      const batch = db.batch();
      ids.forEach(id => batch.update(db.collection('tickets').doc(id), { status }));
      await batch.commit();
      movedTickets.forEach(t => logActivity(t.firestoreId, { type: 'status_change', from: normalizeStatus(t.status), to: status }));
      showToast(`${ids.length} ticket(s) moved`);
      state.selectedIds.clear(); updateBulkBar(); renderBoardView();
    }catch(err){ showToast('Bulk move failed: ' + err.message); }
  });
  const delBtn = bar.querySelector('#bulkDelete');
  if(delBtn){
    delBtn.addEventListener('click', async () => {
      if(!confirm(`Delete ${state.selectedIds.size} ticket(s)? This cannot be undone.`)) return;
      const ids = Array.from(state.selectedIds);
      const deletedTickets = ids.map(id => state.tickets.find(t => t.firestoreId === id)).filter(Boolean);
      try{
        const batch = db.batch();
        ids.forEach(id => batch.delete(db.collection('tickets').doc(id)));
        await batch.commit();
        notifyTicketsDeleted(deletedTickets);
        showToast(`${ids.length} ticket(s) deleted`);
        state.selectedIds.clear(); updateBulkBar(); renderBoardView();
      }catch(err){ showToast('Bulk delete failed: ' + err.message); }
    });
  }
  bar.querySelector('#bulkCancel').addEventListener('click', () => {
    state.selectedIds.clear(); updateBulkBar(); renderBoardView();
  });
}

/* ---------------- KANBAN ---------------- */
function renderBoard(){
  board.innerHTML = '';
  STATUSES.forEach(status => {
    const collapsed = !!state.collapsedColumns[status.key];
    const col = document.createElement('div');
    col.className = 'column' + (collapsed ? ' collapsed' : '');
    const colTickets = sortTickets(state.tickets.filter(t => normalizeStatus(t.status) === status.key && matchesFilters(t)), state.tableSort);

    const head = document.createElement('div');
    head.className = 'column-head';
    head.innerHTML = `
      <span class="column-title">${status.label}</span>
      <div style="display:flex; align-items:center; gap:6px;">
        <span class="column-count">${colTickets.length}</span>
        <button class="ghost collapse-btn" title="${collapsed ? 'Expand' : 'Collapse'}">${collapsed ? '▸' : '▾'}</button>
      </div>`;
    head.querySelector('.collapse-btn').addEventListener('click', () => {
      state.collapsedColumns[status.key] = !collapsed;
      saveCollapsedColumns();
      renderBoard();
    });
    col.appendChild(head);

    if(!collapsed){
      const body = document.createElement('div');
      body.className = 'column-body';
      if(colTickets.length === 0){
        const empty = document.createElement('div');
        empty.className = 'column-empty'; empty.textContent = 'No tickets';
        body.appendChild(empty);
      }
      colTickets.forEach(t => body.appendChild(renderCard(t)));

      body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('drag-over'); });
      body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
      body.addEventListener('drop', async (e) => {
        e.preventDefault();
        body.classList.remove('drag-over');
        const fid = e.dataTransfer.getData('text/plain');
        const ticket = state.tickets.find(x => x.firestoreId === fid);
        if(!ticket || normalizeStatus(ticket.status) === status.key) return;
        try{
          await db.collection('tickets').doc(fid).update({ status: status.key });
          logActivity(fid, { type: 'status_change', from: normalizeStatus(ticket.status), to: status.key });
          showToast(`${ticket.id} moved to ${status.label}`);
        }catch(err){ showToast('Could not move ticket: ' + err.message); }
      });

      col.appendChild(body);
    }
    board.appendChild(col);
  });
}

function renderCard(t){
  const card = document.createElement('div');
  const selected = state.selectedIds.has(t.firestoreId);
  card.className = 'card' + (state.selectMode ? ' selectable' : '') + (selected ? ' selected' : '');
  card.style.borderLeftColor = PRIORITY_COLOR[t.priority] || 'var(--gray-chip)';
  const labelsHtml = (t.labels || []).map(l => `<span class="chip">${l}</span>`).join('');
  const overdue = isOverdue(t.dueDate, t.status);

  card.innerHTML = `
    <div class="card-top">
      <div style="display:flex; align-items:center; gap:6px;">
        ${state.selectMode ? `<span class="card-select-box${selected ? ' checked' : ''}"></span>` : ''}
        <span class="card-id">${t.id}</span>
      </div>
      <div style="display:flex; align-items:center; gap:4px;">
        <span class="priority-pill p-${t.priority}">${t.priority}</span>
        ${!state.selectMode ? `<button class="ghost quick-edit-btn" title="Quick edit">✏️</button>` : ''}
      </div>
    </div>
    <p class="card-title">${escapeHtml(t.title)}</p>
    <div class="card-labels">${labelsHtml}</div>
    <div class="card-foot">
      ${avatarHtml(t.owner, 20)}
      <span class="due ${overdue ? 'overdue' : ''}">${t.dueDate ? formatDate(t.dueDate) : 'No due date'}</span>
    </div>`;

  if(!state.selectMode){
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', t.firestoreId);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));

    const qeBtn = card.querySelector('.quick-edit-btn');
    if(qeBtn){
      qeBtn.addEventListener('click', (e) => { e.stopPropagation(); openQuickEdit(t); });
    }
    card.addEventListener('click', () => openDetail(t.firestoreId));
  }else{
    card.addEventListener('click', () => {
      if(state.selectedIds.has(t.firestoreId)) state.selectedIds.delete(t.firestoreId);
      else state.selectedIds.add(t.firestoreId);
      renderBoardView();
      updateBulkBar();
    });
  }
  return card;
}

/* ---------------- QUICK EDIT (priority / owner / labels without the full form) ---------------- */
function openQuickEdit(t){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal narrow">
      <div class="modal-head"><h2>Quick edit · ${t.id}</h2><button class="ghost" id="closeQE">✕</button></div>
      <div class="field"><label>Priority</label>
        <select id="qe-priority">${PRIORITIES.map(p => `<option value="${p}" ${t.priority===p?'selected':''}>${p[0].toUpperCase()+p.slice(1)}</option>`).join('')}</select>
      </div>
      ${comboHtml('qe-owner', 'Owner', t.owner, 'Search teammate...')}
      <div class="field"><label>Labels</label>
        <div class="label-check-group" id="qe-labels">
          ${ALL_LABELS.map(l => `<label class="label-check"><input type="checkbox" value="${l}" ${(t.labels||[]).includes(l)?'checked':''}> ${l}</label>`).join('')}
        </div>
      </div>
      <div class="modal-actions"><button id="cancelQE">Cancel</button><button class="primary" id="saveQE">Save</button></div>
    </div>`;
  document.body.appendChild(overlay);
  wireCombo('qe-owner');
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  overlay.querySelector('#closeQE').addEventListener('click', close);
  overlay.querySelector('#cancelQE').addEventListener('click', close);
  overlay.querySelector('#saveQE').addEventListener('click', async () => {
    const priority = overlay.querySelector('#qe-priority').value;
    const owner = overlay.querySelector('#qe-owner').value.trim();
    const labels = Array.from(overlay.querySelectorAll('#qe-labels input:checked')).map(i => i.value);
    const ownerChanged = owner && owner !== (t.owner || '');
    const priorityChanged = priority !== t.priority;
    const labelsChanged = JSON.stringify(labels) !== JSON.stringify(t.labels || []);
    try{
      await db.collection('tickets').doc(t.firestoreId).update({ priority, owner, labels });
      if(ownerChanged){
        notifyAssignment({ ...t, owner });
        notifyTicketAssigned({ ...t, owner, priority });
        logActivity(t.firestoreId, { type: 'assignment', from: t.owner || 'Unassigned', to: owner });
      }
      if(priorityChanged || labelsChanged){
        const parts = [];
        if(priorityChanged) parts.push(`priority (${t.priority} → ${priority})`);
        if(labelsChanged) parts.push('labels');
        logActivity(t.firestoreId, { type: 'edit', summary: parts.join(' and ') });
      }
      showToast(`${t.id} updated`);
      close();
    }catch(e){ showToast('Could not save: ' + e.message); }
  });
}

/* ---------------- TABLE VIEW ---------------- */
function renderTable(){
  const container = document.getElementById('ticketTable');
  const rows = sortTickets(state.tickets.filter(matchesFilters), state.tableSort);
  if(rows.length === 0){
    container.innerHTML = '<div class="dash-empty">No tickets match your filters.</div>';
    return;
  }
  container.innerHTML = `
    <table class="ticket-table">
      <thead><tr>${TABLE_COLUMNS.map(c => `<th data-key="${c.key}">${c.label}${state.tableSort.key===c.key ? (state.tableSort.dir==='asc' ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(tableRowHtml).join('')}</tbody>
    </table>`;
  container.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
    const key = th.dataset.key;
    if(state.tableSort.key === key) state.tableSort.dir = state.tableSort.dir === 'asc' ? 'desc' : 'asc';
    else { state.tableSort.key = key; state.tableSort.dir = 'asc'; }
    renderTable();
  }));
  container.querySelectorAll('tr[data-fid]').forEach(tr => tr.addEventListener('click', () => openDetail(tr.dataset.fid)));
}

function tableRowHtml(t){
  const statusLabel = (STATUSES.find(s => s.key === normalizeStatus(t.status)) || {}).label || t.status;
  const overdue = isOverdue(t.dueDate, t.status);
  return `<tr data-fid="${t.firestoreId}">
    <td class="mono">${t.id}</td>
    <td>${escapeHtml(t.title)}</td>
    <td>${statusLabel}</td>
    <td><span class="priority-pill p-${t.priority}">${t.priority}</span></td>
    <td><span class="table-assignee">${avatarHtml(t.owner, 16)} ${escapeHtml(displayName(t.owner))}</span></td>
    <td>${t.reviewer ? escapeHtml(displayName(t.reviewer)) : '—'}</td>
    <td>${(t.labels||[]).map(l => `<span class="chip">${l}</span>`).join(' ') || '—'}</td>
    <td class="${overdue ? 'due overdue' : 'due'}">${t.dueDate ? formatDate(t.dueDate) : '—'}</td>
  </tr>`;
}

document.getElementById('viewKanbanBtn').addEventListener('click', () => {
  state.boardViewMode = 'kanban';
  document.getElementById('viewKanbanBtn').classList.add('active');
  document.getElementById('viewTableBtn').classList.remove('active');
  document.getElementById('board').classList.remove('hidden');
  document.getElementById('ticketTable').classList.add('hidden');
  renderBoard();
});
document.getElementById('viewTableBtn').addEventListener('click', () => {
  state.boardViewMode = 'table';
  document.getElementById('viewTableBtn').classList.add('active');
  document.getElementById('viewKanbanBtn').classList.remove('active');
  document.getElementById('board').classList.add('hidden');
  document.getElementById('ticketTable').classList.remove('hidden');
  renderTable();
});

/* ---------------- ASSIGNEE SEARCH COMBOBOX ---------------- */
function comboHtml(fieldId, label, currentValue, placeholder){
  return `
    <div class="field">
      <label>${label}</label>
      <div class="combo">
        <input type="text" class="combo-input" id="${fieldId}-input" autocomplete="off" value="${currentValue ? escapeHtml(currentValue) : ''}" placeholder="${placeholder}">
        <input type="hidden" id="${fieldId}" value="${currentValue ? escapeHtml(currentValue) : ''}">
        <div class="combo-list hidden" id="${fieldId}-list"></div>
      </div>
    </div>`;
}

function wireCombo(fieldId){
  const input = document.getElementById(fieldId + '-input');
  const hidden = document.getElementById(fieldId);
  const list = document.getElementById(fieldId + '-list');

  function renderList(query){
    const q = (query || '').toLowerCase();
    const matches = state.allowlistCache.filter(u => u.id.toLowerCase().includes(q));
    let html = `<div class="combo-item" data-val="">— Unassigned —</div>`;
    matches.forEach(u => { html += `<div class="combo-item" data-val="${u.id}"><span>${escapeHtml(displayName(u.id))}</span><span class="chip">${u.role}</span></div>`; });
    if(matches.length === 0) html += '<div class="combo-empty">No teammate matches — you can still type a free-text name</div>';
    list.innerHTML = html;
    list.classList.remove('hidden');
    list.querySelectorAll('.combo-item[data-val]').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const val = item.getAttribute('data-val');
        hidden.value = val; input.value = val;
        list.classList.add('hidden');
      });
    });
  }
  input.addEventListener('focus', () => renderList(input.value));
  input.addEventListener('input', () => { hidden.value = input.value; renderList(input.value); });
  input.addEventListener('blur', () => { setTimeout(() => list.classList.add('hidden'), 120); });
}

/* ---------------- NEW / EDIT TICKET FORM ---------------- */
document.getElementById('newTicketBtn').addEventListener('click', () => openTicketForm(null));

function ticketFormHtml(t){
  const labels = (t && t.labels) || [];
  return `
    ${!t ? `
    <div class="field"><label>Start from a template</label>
      <select id="f-template">
        ${TICKET_TEMPLATES.map(tp => `<option value="${tp.id}">${tp.name}</option>`).join('')}
      </select>
    </div>` : ''}
    <div class="field"><label>Title</label><input type="text" id="f-title" value="${t ? escapeHtml(t.title) : ''}" placeholder="Fix login page validation error"></div>
    <div class="field"><label>Description — what, why, expected result</label><textarea id="f-desc" rows="4" placeholder="What needs to be done, why it's needed, expected result...">${t ? escapeHtml(t.description) : ''}</textarea></div>
    <div class="row2">
      <div class="field"><label>Priority</label>
        <select id="f-priority">
          ${PRIORITIES.map(p => `<option value="${p}" ${t && t.priority===p ? 'selected' : (!t && p==='medium' ? 'selected':'')}>${p[0].toUpperCase()+p.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Due date</label><input type="date" id="f-due" value="${t && t.dueDate ? t.dueDate : ''}"></div>
    </div>
    <div class="row2">
      ${comboHtml('f-owner', 'Owner', t ? t.owner : '', 'Search teammate...')}
      ${comboHtml('f-reviewer', 'Reviewer', t ? t.reviewer : '', 'Search teammate...')}
    </div>
    <div class="field"><label>Merge request / issue link (optional)</label><input type="text" id="f-link" value="${t && t.linkUrl ? escapeHtml(t.linkUrl) : ''}" placeholder="https://github.com/org/repo/pull/123"></div>
    <div class="field"><label>Labels</label>
      <div class="label-check-group" id="f-labels">
        ${ALL_LABELS.map(l => `<label class="label-check"><input type="checkbox" value="${l}" ${labels.includes(l) ? 'checked':''}> ${l}</label>`).join('')}
      </div>
    </div>`;
}

export function openTicketForm(existing){
  const isEdit = !!existing;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h2>${isEdit ? 'Edit ' + existing.id : 'New ticket'}</h2><button class="ghost" id="closeForm">✕</button></div>
      ${ticketFormHtml(existing)}
      <div class="modal-actions"><button id="cancelForm">Cancel</button><button class="primary" id="saveForm">${isEdit ? 'Save changes' : 'Create ticket'}</button></div>
    </div>`;
  document.body.appendChild(overlay);
  wireCombo('f-owner');
  wireCombo('f-reviewer');

  const templateSelect = overlay.querySelector('#f-template');
  if(templateSelect){
    templateSelect.addEventListener('change', () => {
      const tp = TICKET_TEMPLATES.find(x => x.id === templateSelect.value);
      if(!tp) return;
      const descField = overlay.querySelector('#f-desc');
      if(descField.value.trim() && !confirm(`Replace the description with the "${tp.name}" template?`)){
        templateSelect.value = 'blank';
        return;
      }
      descField.value = tp.description;
      if(tp.priority) overlay.querySelector('#f-priority').value = tp.priority;
      overlay.querySelectorAll('#f-labels input').forEach(cb => { cb.checked = tp.labels.includes(cb.value); });
    });
  }

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  overlay.querySelector('#closeForm').addEventListener('click', close);
  overlay.querySelector('#cancelForm').addEventListener('click', close);

  overlay.querySelector('#saveForm').addEventListener('click', async () => {
    const title = overlay.querySelector('#f-title').value.trim();
    if(!title){ showToast('Title is required'); return; }
    const labels = Array.from(overlay.querySelectorAll('#f-labels input:checked')).map(i => i.value);
    const data = {
      title,
      description: overlay.querySelector('#f-desc').value.trim(),
      priority: overlay.querySelector('#f-priority').value,
      dueDate: overlay.querySelector('#f-due').value,
      owner: overlay.querySelector('#f-owner').value.trim(),
      reviewer: overlay.querySelector('#f-reviewer').value.trim(),
      linkUrl: overlay.querySelector('#f-link').value.trim(),
      labels
    };
    try{
      if(isEdit){
        const ownerChanged = data.owner && data.owner !== (existing.owner || '');
        const otherFieldsChanged = ['title','description','priority','dueDate','reviewer','linkUrl'].some(k => (data[k] || '') !== (existing[k] || ''))
          || JSON.stringify(data.labels) !== JSON.stringify(existing.labels || []);
        await db.collection('tickets').doc(existing.firestoreId).update(data);
        if(ownerChanged){
          notifyAssignment({ ...existing, ...data });
          notifyTicketAssigned({ ...existing, ...data });
          logActivity(existing.firestoreId, { type: 'assignment', from: existing.owner || 'Unassigned', to: data.owner });
        }
        if(otherFieldsChanged){
          logActivity(existing.firestoreId, { type: 'edit', summary: 'ticket details' });
        }
        showToast(`${existing.id} updated`);
      }else{
        data.id = ticketId(nextTicketNumber());
        data.status = 'backlog';
        data.createdBy = state.currentUser.email;
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        const ref = await db.collection('tickets').add(data);
        logActivity(ref.id, { type: 'created' });
        notifyTicketCreated(data);
        if(data.owner) notifyAssignment(data);
        showToast(`${data.id} created`);
      }
      close();
    }catch(e){ showToast('Could not save: ' + e.message); }
  });
}

/* ---------------- DETAIL / STATUS / DELETE / COMMENTS ---------------- */
export function openDetail(firestoreId){
  const t = state.tickets.find(x => x.firestoreId === firestoreId);
  if(!t) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div><span class="card-id">${t.id}</span><h2 style="margin-top:4px;">${escapeHtml(t.title)}</h2></div>
        <button class="ghost" id="closeDetail">✕</button>
      </div>
      <div class="status-track" id="statusTrack"></div>
      <div class="detail-desc">${escapeHtml(t.description) || 'No description provided.'}</div>
      <div class="detail-meta">
        <div><span>Priority</span><span class="priority-pill p-${t.priority}">${t.priority}</span></div>
        <div><span>Due date</span>${t.dueDate ? formatDate(t.dueDate) : '—'}</div>
        <div><span>Owner</span>${t.owner ? escapeHtml(displayName(t.owner)) : 'Unassigned'}</div>
        <div><span>Reviewer</span>${t.reviewer ? escapeHtml(displayName(t.reviewer)) : 'Unassigned'}</div>
        <div><span>Labels</span>${(t.labels||[]).join(', ') || '—'}</div>
        <div><span>Created by</span>${t.createdBy ? escapeHtml(displayName(t.createdBy)) : '—'}</div>
      </div>
      <div class="commit-box"><span>[${t.id}] ${escapeHtml(t.title)}</span><button class="ghost" id="copyCommit">Copy</button></div>
      <div class="modal-actions" style="margin-top:0;">
        <button class="danger" id="deleteTicket">Delete</button>
        <button id="editTicket">Edit</button>
      </div>
      ${t.linkUrl ? `<div class="link-box"><a href="${escapeHtml(t.linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t.linkUrl)}</a><span style="font-size:11px; color:var(--text-muted);">open ↗</span></div>` : ''}
      <div class="comments">
        <h4>Comments</h4>
        <div id="commentList"></div>
        <div class="comment-add">
          <textarea id="commentInput" rows="2" placeholder="Add a comment..."></textarea>
          <button class="primary" id="postComment">Post</button>
        </div>
      </div>
      <div class="comments">
        <h4>Activity</h4>
        <div id="activityList"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const track = overlay.querySelector('#statusTrack');
  STATUSES.forEach(s => {
    const btn = document.createElement('button');
    btn.textContent = s.label;
    if(s.key === normalizeStatus(t.status)) btn.classList.add('active');
    btn.addEventListener('click', async () => {
      try{
        await db.collection('tickets').doc(firestoreId).update({ status: s.key });
        logActivity(firestoreId, { type: 'status_change', from: normalizeStatus(t.status), to: s.key });
        showToast(`${t.id} moved to ${s.label}`);
      }catch(e){ showToast('Could not update: ' + e.message); }
    });
    track.appendChild(btn);
  });

  const close = () => {
    if(state.unsub.comments){ state.unsub.comments(); state.unsub.comments = null; }
    if(state.unsub.activity){ state.unsub.activity(); state.unsub.activity = null; }
    overlay.remove();
  };
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  overlay.querySelector('#closeDetail').addEventListener('click', close);

  overlay.querySelector('#copyCommit').addEventListener('click', () => {
    const text = `[${t.id}] ${t.title}`;
    navigator.clipboard.writeText(text).then(() => showToast('Commit message copied')).catch(() => showToast(text));
  });

  overlay.querySelector('#editTicket').addEventListener('click', () => { close(); openTicketForm(t); });

  const deleteBtn = overlay.querySelector('#deleteTicket');
  if(state.currentRole !== 'admin' && state.currentRole !== 'pm') deleteBtn.disabled = true;
  deleteBtn.addEventListener('click', async () => {
    try{ await db.collection('tickets').doc(firestoreId).delete(); notifyTicketsDeleted([t]); close(); showToast(`${t.id} deleted`); }
    catch(e){ showToast('Only admins or PMs can delete tickets'); }
  });

  // comments
  const commentList = overlay.querySelector('#commentList');
  state.unsub.comments = db.collection('tickets').doc(firestoreId).collection('comments')
    .orderBy('createdAt', 'asc').onSnapshot(snap => {
      if(snap.empty){
        commentList.innerHTML = '<div class="comment-empty">No comments yet.</div>';
        return;
      }
      const myEmail = (state.currentUser.email || '').toLowerCase();
      commentList.innerHTML = snap.docs.map(d => {
        const c = d.data();
        const canDelete = state.currentRole === 'admin' || state.currentRole === 'pm' || (c.author && c.author.toLowerCase() === myEmail);
        return `<div class="comment">
          <div class="comment-head"><span>${escapeHtml(displayName(c.author))}</span><span>${formatDateTime(c.createdAt)}</span></div>
          <div class="comment-body">${escapeHtml(c.text)}</div>
          ${canDelete ? `<button class="ghost small comment-delete" data-id="${d.id}">Delete</button>` : ''}
        </div>`;
      }).join('');
      commentList.querySelectorAll('.comment-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if(!confirm('Delete this comment? This cannot be undone.')) return;
          try{ await db.collection('tickets').doc(firestoreId).collection('comments').doc(btn.dataset.id).delete(); }
          catch(e){ showToast('Could not delete comment: ' + e.message); }
        });
      });
    }, err => { commentList.innerHTML = '<div class="comment-empty">Could not load comments.</div>'; });

  overlay.querySelector('#postComment').addEventListener('click', async () => {
    const input = overlay.querySelector('#commentInput');
    const text = input.value.trim();
    if(!text) return;
    try{
      await db.collection('tickets').doc(firestoreId).collection('comments').add({
        text, author: state.currentUser.email, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      input.value = '';
    }catch(e){ showToast('Could not post comment: ' + e.message); }
  });

  // activity log (read-only audit trail — no delete/edit, by design)
  const activityList = overlay.querySelector('#activityList');
  state.unsub.activity = db.collection('tickets').doc(firestoreId).collection('activity')
    .orderBy('createdAt', 'asc').onSnapshot(snap => {
      if(snap.empty){
        activityList.innerHTML = '<div class="comment-empty">No activity recorded yet.</div>';
        return;
      }
      activityList.innerHTML = snap.docs.map(d => {
        const a = d.data();
        return `<div class="comment activity-entry">
          <div class="comment-head"><span>${escapeHtml(describeActivity(a))}</span><span>${formatDateTime(a.createdAt)}</span></div>
        </div>`;
      }).join('');
    }, err => { activityList.innerHTML = '<div class="comment-empty">Could not load activity.</div>'; });
}

/* ---------------- FILTERS ---------------- */
document.getElementById('searchInput').addEventListener('input', e => { state.filters.search = e.target.value; renderBoardView(); });
document.getElementById('priorityFilter').addEventListener('change', e => { state.filters.priority = e.target.value; renderBoardView(); });
document.getElementById('labelFilter').addEventListener('change', e => { state.filters.label = e.target.value; renderBoardView(); });