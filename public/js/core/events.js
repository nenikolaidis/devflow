/* =========================================================
   core/events.js — a tiny publish/subscribe hub.

   Lets the data layer say "tickets changed" without knowing which
   screens exist, and lets screens react without importing each other.

     on(EVENTS.TICKETS_CHANGED, () => repaint());
     emit(EVENTS.TICKETS_CHANGED);
========================================================= */

export const EVENTS = {
  TICKETS_CHANGED: 'tickets-changed',
  TEAM_CHANGED: 'team-changed',          // allowlist
  REQUESTS_CHANGED: 'requests-changed',  // access requests
  PROFILES_CHANGED: 'profiles-changed',
  SETTINGS_CHANGED: 'settings-changed',
  SPRINTS_CHANGED: 'sprints-changed',
  NOTIFICATIONS_CHANGED: 'notifications-changed',
  PROJECTS_CHANGED: 'projects-changed',          // list of my projects, or the current one's doc
  PROJECT_SWITCHED: 'project-switched',          // a different project is now current
  ROLES_CHANGED: 'roles-changed',
  TEMPLATES_CHANGED: 'templates-changed',
  PROJECT_REQUESTS_CHANGED: 'project-requests-changed',
  WORKSPACE_CHANGED: 'workspace-changed'         // meta/workspace (upgrade status)
};

const listeners = {};

/** Subscribes to an event. Returns a function that unsubscribes. */
export function on(event, handler){
  (listeners[event] = listeners[event] || []).push(handler);
  return () => { listeners[event] = listeners[event].filter(h => h !== handler); };
}

export function emit(event, payload){
  (listeners[event] || []).forEach(handler => {
    try{ handler(payload); }
    catch(e){ console.error(`Error in "${event}" handler:`, e); }
  });
}
