import { state } from './state.js';
import { normalizeStatus } from './constants.js';

const toastEl = document.getElementById('toast');

export function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2200);
}

export function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

export function formatDate(d){
  if(!d) return '—';
  const dt = (d.toDate) ? d.toDate() : new Date(d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDateTime(d){
  if(!d) return '';
  const dt = (d.toDate) ? d.toDate() : new Date(d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function isOverdue(dateStr, status){
  if(!dateStr || normalizeStatus(status) === 'done') return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

export function matchesFilters(t){
  const q = state.filters.search.trim().toLowerCase();
  if(q && !((t.title||'').toLowerCase().includes(q) || (t.id||'').toLowerCase().includes(q))) return false;
  if(state.filters.priority && t.priority !== state.filters.priority) return false;
  if(state.filters.label && !(t.labels || []).includes(state.filters.label)) return false;
  if(state.filters.assignee){
    if(state.filters.assignee === '__unassigned__'){ if(t.owner) return false; }
    else if((t.owner || '').toLowerCase() !== state.filters.assignee.toLowerCase()) return false;
  }
  return true;
}

export function initials(name){
  if(!name) return '—';
  const local = name.includes('@') ? name.split('@')[0] : name;
  const parts = local.trim().split(/[\s._-]+/).filter(Boolean);
  if(parts.length === 0) return '—';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

export function friendlyAuthError(e){
  const code = e.code || '';
  if(code.includes('email-already-in-use')) return 'That email already has an account. Try logging in.';
  if(code.includes('wrong-password') || code.includes('invalid-credential')) return 'Wrong email or password.';
  if(code.includes('user-not-found')) return 'No account with that email. Try signing up.';
  if(code.includes('weak-password')) return 'Password should be at least 6 characters.';
  if(code.includes('invalid-email')) return 'That email address looks invalid.';
  if(code.includes('requires-recent-login')) return 'Please sign out and log back in, then try again.';
  if(code.includes('too-many-requests')) return 'Too many attempts. Try again shortly.';
  return e.message || 'Something went wrong.';
}