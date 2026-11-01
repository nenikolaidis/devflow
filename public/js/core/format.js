/* =========================================================
   core/format.js — small pure helpers: dates, URLs, initials,
   friendly error messages. No DOM, no Firestore.
========================================================= */
import { MIN_PASSWORD_LENGTH } from '../config.js';

/** Accepts a Firestore Timestamp, Date, or date string. */
function toDate(d){
  if(!d) return null;
  const dt = d.toDate ? d.toDate() : new Date(d);
  return isNaN(dt) ? null : dt;
}

/** "Mar 4" */
export function formatDate(d){
  const dt = toDate(d);
  return dt ? dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
}

/** "Mar 4 14:05" */
export function formatDateTime(d){
  const dt = toDate(d);
  if(!dt) return '';
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Whole days since a date, or null if unknown (e.g. a pending server timestamp). */
export function daysSince(d){
  const dt = toDate(d);
  return dt ? Math.floor((Date.now() - dt.getTime()) / 86400000) : null;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", or a date for anything older than a month. */
export function timeAgo(d){
  const dt = toDate(d);
  if(!dt) return '';
  const minutes = Math.floor((Date.now() - dt.getTime()) / 60000);
  if(minutes < 1) return 'just now';
  if(minutes < 60) return `${minutes} min ago`;
  if(minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  const days = Math.floor(minutes / 1440);
  if(days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  return 'on ' + formatDate(dt);
}

/** Returns the URL only if it's a plain http(s) link, otherwise ''. Blocks javascript:, data:, etc. */
export function safeUrl(url){
  const value = (url || '').trim();
  if(!value) return '';
  try{
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.href : '';
  }catch(e){ return ''; }
}

/** "jane.doe@x.com" → "JD", "Jane Doe" → "JD". */
export function initials(name){
  if(!name) return '—';
  const local = name.includes('@') ? name.split('@')[0] : name;
  const parts = local.trim().split(/[\s._-]+/).filter(Boolean);
  if(parts.length === 0) return '—';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

export function capitalize(s){
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** Turns Firebase Auth error codes into plain-English messages. */
export function friendlyAuthError(e){
  const code = (e && e.code) || '';
  if(code.includes('email-already-in-use')) return 'That email already has an account. Try logging in.';
  if(code.includes('wrong-password') || code.includes('invalid-credential')) return 'Wrong email or password. Forgot it? Use "Forgot password?". If your account was removed, choose "Create account" with the same email.';
  if(code.includes('user-not-found')) return 'No account with that email. Try signing up.';
  if(code.includes('weak-password') || code.includes('password-does-not-meet-requirements')) return `Password should be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if(code.includes('invalid-email')) return 'That email address looks invalid.';
  if(code.includes('requires-recent-login')) return 'Please sign out and log back in, then try again.';
  if(code.includes('too-many-requests')) return 'Too many attempts. Try again shortly.';
  if(code.includes('user-disabled')) return 'This account has been switched off. Ask a devflow admin.';
  if(code.includes('popup-blocked')) return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
  if(code.includes('operation-not-allowed')) return 'Google sign-in isn\'t switched on for this devflow yet. Use email and password, or ask your admin (SETUP.md, step 2).';
  if(code.includes('unauthorized-domain')) return 'Google sign-in isn\'t allowed on this web address yet (Firebase console → Authentication → Settings → Authorized domains).';
  if(code.includes('network-request-failed')) return 'Couldn\'t reach Google or Firebase. Check your connection, VPN or ad blocker, and try again.';
  return (e && e.message) || 'Something went wrong.';
}

/** True for Firestore "permission-denied" errors (i.e. the security rules said no). */
export function isPermissionError(e){
  return (e && e.code === 'permission-denied') || /permission/i.test((e && e.message) || '');
}
