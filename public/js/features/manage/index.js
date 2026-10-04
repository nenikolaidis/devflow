/* =========================================================
   features/manage/index.js — the Manage tab: a side menu of sections,
   each shown only to people whose role allows it.

   Sections re-render live when the data they show changes — except
   while you're typing in them or have unsaved edits (root.dataset.dirty),
   so a teammate's change never wipes your work in progress.
========================================================= */
import { state } from '../../core/state.js';
import { html } from '../../core/html.js';
import { icon } from '../../core/icons.js';
import { on, EVENTS } from '../../core/events.js';
import { isAdmin, can } from '../../core/permissions.js';
import { renderOverview } from './overview.js';
import { renderMembers } from './members.js';
import { renderProjects } from './projects.js';
import { renderRoles } from './roles.js';
import { renderLabels, renderTypes } from './content.js';
import { renderTemplates } from './templates.js';
import { renderWorkflow, renderIntegrations } from './settings.js';
import { mountSprintManager } from '../sprints.js';
import { sectionHead, noProject } from './common.js';

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'home', visible: () => true, render: renderOverview,
    events: [EVENTS.WORKSPACE_CHANGED, EVENTS.PROJECTS_CHANGED, EVENTS.REQUESTS_CHANGED, EVENTS.PROJECT_REQUESTS_CHANGED, EVENTS.TICKETS_CHANGED] },
  { id: 'members', label: 'Members', icon: 'users', visible: () => isAdmin() || can('manageMembers'), render: renderMembers,
    events: [EVENTS.PROJECTS_CHANGED, EVENTS.TEAM_CHANGED, EVENTS.REQUESTS_CHANGED, EVENTS.ROLES_CHANGED, EVENTS.PROFILES_CHANGED] },
  { id: 'projects', label: 'Projects', icon: 'folder', visible: () => isAdmin() || can('requestProjects'), render: renderProjects,
    events: [EVENTS.PROJECTS_CHANGED, EVENTS.PROJECT_REQUESTS_CHANGED] },
  { id: 'roles', label: 'Roles', icon: 'key', visible: () => isAdmin(), render: renderRoles,
    events: [EVENTS.ROLES_CHANGED, EVENTS.PROJECTS_CHANGED] },
  { divider: 'This project' },
  { id: 'labels', label: 'Labels', icon: 'tag', visible: () => can('manageContent'), render: renderLabels, events: [EVENTS.SETTINGS_CHANGED] },
  { id: 'types', label: 'Ticket types', icon: 'layers', visible: () => can('manageContent'), render: renderTypes, events: [EVENTS.SETTINGS_CHANGED] },
  { id: 'templates', label: 'Templates', icon: 'file', visible: () => can('manageContent'), render: renderTemplates, events: [EVENTS.TEMPLATES_CHANGED, EVENTS.SETTINGS_CHANGED] },
  { id: 'sprints', label: 'Sprints', icon: 'calendar', visible: () => can('manageSprints'), render: renderSprints, events: [] },
  { id: 'workflow', label: 'Workflow', icon: 'listCheck', visible: () => can('manageWorkflow'), render: renderWorkflow, events: [EVENTS.SETTINGS_CHANGED] },
  { id: 'integrations', label: 'Integrations', icon: 'plug', visible: () => can('manageIntegrations'), render: renderIntegrations, events: [EVENTS.SETTINGS_CHANGED] }
];

const navEl = document.getElementById('manageNav');
const contentEl = document.getElementById('manageContent');
let root = null;      // the current section's container (fresh each render, so old listeners go with it)
let cleanup = null;   // stops a section's own live updates (Sprints)

function renderSprints(container){
  container.innerHTML = html`${sectionHead('Sprints', 'Time-boxed iterations tickets can be planned into. Only one is usually active at a time.')}<div id="sprintMount"></div>`.toString();
  if(!state.project){ container.querySelector('#sprintMount').innerHTML = noProject().toString(); return null; }
  return mountSprintManager(container.querySelector('#sprintMount'));
}

function visibleSections(){
  return SECTIONS.filter(s => s.divider || s.visible());
}

/** Draws the side menu and the current section. */
export function renderManage(){
  const sections = visibleSections();
  if(!sections.some(s => s.id === state.manageSection)) state.manageSection = 'overview';
  // Drop a trailing/duplicate divider when none of its sections are visible.
  const items = sections.filter((s, i) => !s.divider || (sections[i + 1] && !sections[i + 1].divider));
  navEl.innerHTML = html`${items.map(s => s.divider
    ? html`<div class="manage-nav-divider">${s.divider}${state.project ? html`<span>${state.project.key}</span>` : ''}</div>`
    : html`<button type="button" data-section="${s.id}" class="${s.id === state.manageSection ? 'active' : ''}" ${s.id === state.manageSection ? html`aria-current="page"` : ''}>
        ${icon(s.icon, 16)}<span>${s.label}</span>${badge(s.id)}</button>`)}`.toString();
  renderSection();
}

function badge(id){
  const n = id === 'members' && isAdmin() ? state.accessRequests.length : id === 'projects' && isAdmin() ? state.projectRequests.length : 0;
  return n ? html`<span class="nav-badge">${n}</span>` : '';
}

function renderSection(){
  if(cleanup){ cleanup(); cleanup = null; }
  const section = SECTIONS.find(s => s.id === state.manageSection);
  contentEl.innerHTML = '';
  root = document.createElement('div');
  root.className = 'manage-section';
  contentEl.appendChild(root);
  const result = section.render(root, goTo);
  if(typeof result === 'function') cleanup = result;
}

export function goTo(id){
  state.manageSection = id;
  renderManage();
  contentEl.scrollTop = 0;
  const btn = navEl.querySelector(`[data-section="${id}"]`);
  if(btn) btn.focus();
}

navEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-section]');
  if(btn) goTo(btn.dataset.section);
});

/** Repaint on live changes, unless someone is editing this section. */
function maybeRefresh(event){
  if(state.currentTab !== 'manage') return;
  const section = SECTIONS.find(s => s.id === state.manageSection);
  const editing = root && (root.dataset.dirty === '1' || (root.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)));
  if(event === EVENTS.PROJECT_SWITCHED || event === EVENTS.ROLES_CHANGED || event === EVENTS.PROJECTS_CHANGED){
    // Which sections I can see may have changed.
    if(!editing) return renderManage();
  }
  if(section && section.events.includes(event) && !editing) renderManage();
  else if(!editing) navEl.querySelectorAll('[data-section]').forEach(b => { /* keep badges fresh */ b.querySelector('.nav-badge')?.remove(); b.insertAdjacentHTML('beforeend', badge(b.dataset.section).toString()); });
}
Object.values(EVENTS).forEach(ev => on(ev, () => maybeRefresh(ev)));

/** Leaving a section with unsaved edits forgets them (the next visit shows saved values). */
export function leaveManage(){
  if(cleanup){ cleanup(); cleanup = null; }
  if(root) delete root.dataset.dirty;
}
