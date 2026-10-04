/* =========================================================
   features/nav.js — tab switching, and repainting the visible tab
   whenever live data changes.

   Data flow: Firestore → data/sync.js updates state → emits an event →
   the handlers below repaint only the tab that's currently showing.
   (The Manage tab repaints itself — see features/manage/index.js.)
========================================================= */
import { state } from '../core/state.js';
import { on, EVENTS } from '../core/events.js';
import { canManageSomething } from '../core/permissions.js';
import { renderBoardView, exitSelectMode } from './board.js';
import { renderDashboard } from './dashboard.js';
import { renderMyWork } from './my-work.js';
import { renderManage, leaveManage } from './manage/index.js';

const TABS = {
  board: { button: 'navBoard', view: 'boardView' },
  mywork: { button: 'navMyWork', view: 'myWorkView' },
  dashboard: { button: 'navDashboard', view: 'dashboardView' },
  manage: { button: 'navManage', view: 'manageView' }
};

export function switchTab(tab){
  if(tab === 'manage' && !canManageSomething()) tab = 'board';
  if(state.currentTab === 'manage' && tab !== 'manage') leaveManage();
  state.currentTab = tab;
  Object.entries(TABS).forEach(([name, ids]) => {
    const btn = document.getElementById(ids.button);
    btn.classList.toggle('active', name === tab);
    btn.setAttribute('aria-selected', String(name === tab));
    document.getElementById(ids.view).classList.toggle('hidden', name !== tab);
  });
  if(tab !== 'board') exitSelectMode();
  renderCurrentTab();
}

/** Repaints the visible tab from whatever is in state. */
export function renderCurrentTab(){
  updateManageTab();
  if(state.currentTab === 'board') renderBoardView();
  if(state.currentTab === 'mywork') renderMyWork();
  if(state.currentTab === 'dashboard') renderDashboard();
  if(state.currentTab === 'manage') renderManage();
}

/** Manage is shown to admins and to roles with any management permission in this project. */
function updateManageTab(){
  const show = canManageSomething();
  document.getElementById('navManage').classList.toggle('hidden', !show);
  if(!show && state.currentTab === 'manage') switchTab('board');
}

Object.entries(TABS).forEach(([name, ids]) => {
  document.getElementById(ids.button).addEventListener('click', () => switchTab(name));
});

// Live data changed → repaint what's visible (Manage handles its own events).
const repaintWork = () => {
  updateManageTab();
  if(state.currentTab === 'board') renderBoardView();
  if(state.currentTab === 'mywork') renderMyWork();
  if(state.currentTab === 'dashboard') renderDashboard();
};
on(EVENTS.TICKETS_CHANGED, repaintWork);
on(EVENTS.PROFILES_CHANGED, repaintWork);            // names/avatars appear everywhere
on(EVENTS.SETTINGS_CHANGED, repaintWork);            // WIP limits, stale threshold, labels, types
on(EVENTS.SPRINTS_CHANGED, repaintWork);             // sprint filter, dashboard sprint panel
on(EVENTS.TEMPLATES_CHANGED, repaintWork);
on(EVENTS.TEAM_CHANGED, repaintWork);                // owner filter
on(EVENTS.PROJECT_SWITCHED, repaintWork);            // a different project's data
on(EVENTS.PROJECTS_CHANGED, repaintWork);            // members / my role may have changed
on(EVENTS.ROLES_CHANGED, repaintWork);               // what I'm allowed to do may have changed
