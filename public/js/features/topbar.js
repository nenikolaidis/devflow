/* =========================================================
   features/topbar.js — the account menu (avatar button) and the
   light/dark theme toggle in the top bar.

   Menu items: My profile, Account & password (dialog in auth.js),
   Use system theme, Sign out. The menu closes on Esc, on a click
   outside, or after choosing an item.
========================================================= */
import { auth } from '../data/firebase.js';
import { state } from '../core/state.js';
import { on, EVENTS } from '../core/events.js';
import { WORKSPACE_ROLE_LABELS } from '../core/constants.js';
import { icon } from '../core/icons.js';
import { myEmail, myRoleId, roleName, isAdmin, can } from '../core/permissions.js';
import { displayName, avatarHtml } from '../core/people.js';
import { toggleTheme, followSystem, onThemeChange, isFollowingSystem } from '../core/theme.js';
import { openProfileModal } from './profiles.js';

const $ = (id) => document.getElementById(id);
const menuBtn = $('userMenuBtn');
const menu = $('userMenu');

/* ---------------- THEME TOGGLE ---------------- */
$('themeToggle').addEventListener('click', toggleTheme);
$('systemThemeBtn').addEventListener('click', followSystem);

onThemeChange(theme => {
  const next = theme === 'dark' ? 'light' : 'dark';
  $('themeToggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 17).toString();
  $('themeToggle').setAttribute('aria-label', `Switch to ${next} theme`);
  $('themeToggle').title = `Switch to ${next} theme`;
  // "Use system theme" only makes sense once someone has picked a theme by hand.
  $('systemThemeBtn').classList.toggle('hidden', isFollowingSystem());
});

/* ---------------- ACCOUNT MENU ---------------- */
const items = () => Array.from(menu.querySelectorAll('[role=menuitem]:not(.hidden)'));

function openMenu(){
  menu.classList.remove('hidden');
  menuBtn.setAttribute('aria-expanded', 'true');
  items()[0].focus();
}
function closeMenu({ focusButton = false } = {}){
  if(menu.classList.contains('hidden')) return;
  menu.classList.add('hidden');
  menuBtn.setAttribute('aria-expanded', 'false');
  if(focusButton) menuBtn.focus();
}

menuBtn.addEventListener('click', () => (menu.classList.contains('hidden') ? openMenu() : closeMenu()));
document.addEventListener('mousedown', e => { if(!e.target.closest('.menu-wrap')) closeMenu(); });
menu.addEventListener('keydown', e => {
  const list = items();
  const i = list.indexOf(document.activeElement);
  if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeMenu({ focusButton: true }); }
  if(e.key === 'ArrowDown'){ e.preventDefault(); list[(i + 1) % list.length].focus(); }
  if(e.key === 'ArrowUp'){ e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
  if(e.key === 'Tab') closeMenu();
});
// Any item closes the menu (its own handler does the rest).
menu.addEventListener('click', e => { if(e.target.closest('[role=menuitem]')) closeMenu(); });

$('profileBtn').addEventListener('click', () => openProfileModal());
$('signOutBtn').addEventListener('click', () => auth.signOut());

/** Shows the signed-in person's avatar, name, email and role in the top bar. */
export function refreshUserBadge(){
  if(!state.currentUser) return;
  const email = myEmail();
  $('userAvatar').innerHTML = avatarHtml(email, 28).toString();
  $('menuName').textContent = displayName(email);
  // "Workspace admin", or my role in the current project.
  const role = isAdmin() ? WORKSPACE_ROLE_LABELS.admin : (myRoleId() ? roleName(myRoleId()) : WORKSPACE_ROLE_LABELS.member);
  $('whoami').textContent = `${email} · ${role}`;
  menuBtn.setAttribute('aria-label', `Account menu for ${displayName(email)}`);
  // New ticket needs an open project and a role that can edit tickets.
  const canCreate = !!state.projectId && can('editTickets');
  $('newTicketBtn').disabled = !canCreate;
  $('newTicketBtn').title = canCreate ? '' : (state.projectId ? 'Your role in this project can\'t create tickets' : 'Open a project first');
}
on(EVENTS.PROFILES_CHANGED, refreshUserBadge);
on(EVENTS.PROJECTS_CHANGED, refreshUserBadge);
on(EVENTS.PROJECT_SWITCHED, refreshUserBadge);
on(EVENTS.ROLES_CHANGED, refreshUserBadge);
