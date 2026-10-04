/* =========================================================
   features/project-switcher.js — the project menu in the top bar.

   Lists the projects you belong to (workspace admins see all, with
   archived ones at the bottom). Picking one switches every screen to it
   (data/sync.js switchProject). Links to Manage → Projects for creating
   or requesting a project.
========================================================= */
import { state } from '../core/state.js';
import { html } from '../core/html.js';
import { icon } from '../core/icons.js';
import { on, EVENTS } from '../core/events.js';
import { isAdmin, can, myRoleId, roleName } from '../core/permissions.js';
import { switchProject } from '../data/sync.js';

const $ = (id) => document.getElementById(id);
const btn = $('projectBtn');
const menu = $('projectMenu');

function render(){
  const p = state.project;
  $('projectKey').textContent = p ? p.key : '—';
  $('projectName').textContent = p ? p.name : (state.projects.length ? 'Choose a project' : 'No project yet');
  btn.setAttribute('aria-label', p ? `Project: ${p.name}. Switch project` : 'Switch project');
  btn.classList.toggle('archived', !!(p && p.status === 'archived'));

  const items = state.projects.map(proj => html`
    <button type="button" role="menuitemradio" aria-checked="${String(proj.id === state.projectId)}" data-pid="${proj.id}" class="${proj.status === 'archived' ? 'is-archived' : ''}">
      <span class="project-key">${proj.key}</span>
      <span class="project-menu-name">${proj.name}</span>
      <span class="project-menu-role">${proj.status === 'archived' ? 'Archived' : (myRoleId(proj) ? roleName(myRoleId(proj)) : (isAdmin() ? 'Admin' : ''))}</span>
      ${proj.id === state.projectId ? icon('check', 14) : ''}
    </button>`);
  const canRequest = !isAdmin() && state.project && can('requestProjects');
  menu.innerHTML = html`
    <div class="menu-head"><div class="menu-name">Projects</div><div class="menu-sub">${state.projects.length} ${state.projects.length === 1 ? 'project' : 'projects'}</div></div>
    ${items.length ? items : html`<div class="empty-note project-menu-empty">You're not in any project yet. Ask an admin to add you.</div>`}
    ${isAdmin() || canRequest ? html`<div class="menu-sep" role="separator"></div>
      <button type="button" role="menuitem" data-manage="projects">${icon('plus', 14)}${isAdmin() ? 'New project…' : 'Request a project…'}</button>` : ''}`.toString();
}

function open(){
  menu.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');
  const current = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
  if(current) current.focus();
}
function close({ focusButton = false } = {}){
  if(menu.classList.contains('hidden')) return;
  menu.classList.add('hidden');
  btn.setAttribute('aria-expanded', 'false');
  if(focusButton) btn.focus();
}

btn.addEventListener('click', () => (menu.classList.contains('hidden') ? open() : close()));
document.addEventListener('mousedown', e => { if(!e.target.closest('.project-switcher')) close(); });
menu.addEventListener('keydown', e => {
  const list = Array.from(menu.querySelectorAll('button'));
  const i = list.indexOf(document.activeElement);
  if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close({ focusButton: true }); }
  if(e.key === 'ArrowDown'){ e.preventDefault(); list[(i + 1) % list.length].focus(); }
  if(e.key === 'ArrowUp'){ e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
  if(e.key === 'Tab') close();
});
menu.addEventListener('click', e => {
  const item = e.target.closest('button');
  if(!item) return;
  close();
  if(item.dataset.pid && item.dataset.pid !== state.projectId) switchProject(item.dataset.pid);
  if(item.dataset.manage){
    state.manageSection = item.dataset.manage;
    $('navManage').classList.remove('hidden');
    $('navManage').click();
  }
});

on(EVENTS.PROJECTS_CHANGED, render);
on(EVENTS.PROJECT_SWITCHED, render);
on(EVENTS.ROLES_CHANGED, render);
render();
