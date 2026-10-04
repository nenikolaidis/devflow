/* =========================================================
   core/permissions.js — "who am I and what may I do" checks.

   Two levels:
   - Workspace admins (allowlist role 'admin') may do everything, in
     every project.
   - Everyone else gets the permissions of their role in the current
     project (projects/{pid}.members[email] → roles/{roleId}.permissions).

   These only decide what the UI shows. firestore.rules enforces the same
   checks (its can(pid, perm)) — keep the two in step.
========================================================= */
import { state } from './state.js';
import { WORKSPACE_ROLES } from './constants.js';

export function normEmail(email){
  return (email || '').trim().toLowerCase();
}

export function myEmail(){
  return normEmail(state.currentUser && state.currentUser.email);
}

export function isMe(email){
  return !!email && normEmail(email) === myEmail();
}

/** Workspace admin: every permission in every project, plus projects, roles and people. */
export function isAdmin(){
  return state.workspaceRole === WORKSPACE_ROLES.ADMIN;
}

/** My role id in a project (default: the current one), or '' if I'm not a member. */
export function myRoleId(project = state.project){
  return (project && project.members && project.members[myEmail()]) || '';
}

/** True if I may do `perm` (a PERMISSIONS key) in a project (default: the current one). */
export function can(perm, project = state.project){
  if(isAdmin()) return true;
  const role = state.roles[myRoleId(project)];
  return !!(role && role.permissions && role.permissions[perm] === true);
}

/** True if I can open the Manage tab at all (any management permission, or admin). */
export function canManageSomething(){
  return isAdmin() || ['manageSprints', 'manageContent', 'manageWorkflow', 'manageMembers', 'manageIntegrations', 'requestProjects'].some(p => can(p));
}

/** Display name of a project role id. */
export function roleName(roleId){
  return (state.roles[roleId] && state.roles[roleId].name) || roleId || '—';
}
