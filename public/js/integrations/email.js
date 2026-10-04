/* =========================================================
   integrations/email.js — emails a ticket's owner when they're
   assigned, via EmailJS (no server needed). Keys live in config.js;
   with the placeholders left in, this quietly does nothing.
========================================================= */
import { EMAILJS } from '../config.js';
import { isMe } from '../core/permissions.js';
import { state } from '../core/state.js';

const configured = Object.values(EMAILJS).every(v => v && !v.startsWith('YOUR_'));

if(configured && window.emailjs){
  emailjs.init({ publicKey: EMAILJS.publicKey });
}else if(!configured){
  console.info('Devflow: EmailJS is not configured, so assignment emails are off. See SETUP.md step 9.');
}

/** Emails the ticket's owner. Skips unconfigured setups, non-email owners, and self-assignment. */
export function notifyAssignment(ticket){
  if(!configured || !window.emailjs) return;
  const to = (ticket.owner || '').trim();
  if(!to || !to.includes('@') || isMe(to)) return;

  emailjs.send(EMAILJS.serviceId, EMAILJS.templateId, {
    to_email: to,
    ticket_id: ticket.id,
    ticket_title: ticket.title,
    actor_email: state.currentUser ? state.currentUser.email : '',
    board_url: window.location.origin + window.location.pathname
  }).catch(err => console.error('Assignment email failed to send:', err));
}
