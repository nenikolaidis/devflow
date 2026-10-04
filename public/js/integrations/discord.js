/* =========================================================
   integrations/discord.js — posts ticket events to a Discord channel.

   The webhook URL is NOT in the code: an admin pastes it into Team →
   Board settings, which saves it to Firestore (config/settings). Only
   approved teammates can read it. With no URL saved, every function
   here quietly does nothing. See SETUP.md step 10.
========================================================= */
import { state } from '../core/state.js';

const PRIORITY_HEX = { critical: 0xD9635B, high: 0xE8A33D, medium: 0x5B8DD9, low: 0x4FA98C };
const NEUTRAL_HEX = 0x6E7060;
const BLOCKED_HEX = 0xD9635B;

export function isValidWebhookUrl(url){
  return /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url || '');
}

function webhookUrl(){
  const url = state.settings && state.settings.discordWebhookUrl;
  return isValidWebhookUrl(url) ? url : '';
}

async function post(payload, url){
  url = url || webhookUrl();
  if(!url) return false;
  try{
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.ok;
  }catch(e){ console.error('Discord notification failed to send:', e); return false; }
}

function actorEmail(){ return state.currentUser ? state.currentUser.email : 'unknown'; }
function pingFor(ticket){ return ticket.priority === 'critical' ? '@here' : undefined; }

/** Sends a one-off message to check a webhook URL works. Returns true on success. */
export function sendTestMessage(url){
  return post({
    embeds: [{
      title: '✅ Devflow is connected',
      description: 'Ticket notifications will be posted to this channel.',
      color: NEUTRAL_HEX,
      fields: [{ name: 'Set up by', value: actorEmail(), inline: false }],
      timestamp: new Date().toISOString()
    }]
  }, url);
}

/** Posts a message when a new ticket is created. */
export function notifyTicketCreated(ticket){
  post({
    content: pingFor(ticket),
    embeds: [{
      title: `🆕 New ticket — ${ticket.id}: ${ticket.title}`,
      description: ticket.description || undefined,
      color: PRIORITY_HEX[ticket.priority] || NEUTRAL_HEX,
      fields: [
        { name: 'Priority', value: ticket.priority, inline: true },
        { name: 'Owner', value: ticket.owner || 'Unassigned', inline: true },
        { name: 'Labels', value: (ticket.labels||[]).join(', ') || '—', inline: true },
        { name: 'Created by', value: actorEmail(), inline: false }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/** Posts a message when a ticket is assigned (or reassigned) to someone. */
export function notifyTicketAssigned(ticket){
  post({
    content: pingFor(ticket),
    embeds: [{
      title: `👤 ${ticket.id} assigned to ${ticket.owner}`,
      description: ticket.title,
      color: PRIORITY_HEX[ticket.priority] || NEUTRAL_HEX,
      fields: [
        { name: 'Priority', value: ticket.priority, inline: true },
        { name: 'Assigned by', value: actorEmail(), inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/** Posts a message when a ticket moves to In review, naming its reviewers. */
export function notifyReviewRequested(ticket, reviewerNames){
  post({
    embeds: [{
      title: `👀 ${ticket.id} is ready for review`,
      description: ticket.title,
      color: 0x5B8DD9,
      fields: [
        { name: 'Reviewers', value: reviewerNames.join(', ') || '—', inline: false },
        { name: 'Moved by', value: actorEmail(), inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/** Posts a message when someone @mentions teammates in a comment. */
export function notifyMentioned(ticket, names, text){
  post({
    embeds: [{
      title: `💬 ${ticket.id}: ${ticket.title}`,
      description: text.length > 300 ? text.slice(0, 297) + '…' : text,
      color: NEUTRAL_HEX,
      fields: [
        { name: 'Mentioned', value: names.join(', '), inline: true },
        { name: 'By', value: actorEmail(), inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/** Posts a message when a ticket is marked as blocked. */
export function notifyTicketBlocked(ticket, reason){
  post({
    content: pingFor(ticket),
    embeds: [{
      title: `⛔ ${ticket.id} is blocked`,
      description: ticket.title,
      color: BLOCKED_HEX,
      fields: [
        { name: 'Reason', value: reason || '—', inline: false },
        { name: 'Owner', value: ticket.owner || 'Unassigned', inline: true },
        { name: 'Flagged by', value: actorEmail(), inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/** Posts a message when one or more tickets are archived (single or bulk). */
export function notifyTicketsArchived(tickets){
  if(!tickets || tickets.length === 0) return;
  const list = tickets.map(t => `**${t.id}** — ${t.title}`).join('\n');
  post({
    embeds: [{
      title: tickets.length === 1 ? '📦 Ticket archived' : `📦 ${tickets.length} tickets archived`,
      description: list,
      color: NEUTRAL_HEX,
      fields: [{ name: 'Archived by', value: actorEmail(), inline: false }],
      timestamp: new Date().toISOString()
    }]
  });
}

/** Posts a message when an archived ticket is permanently deleted. */
export function notifyTicketsDeleted(tickets){
  if(!tickets || tickets.length === 0) return;
  const list = tickets.map(t => `**${t.id}** — ${t.title}`).join('\n');
  post({
    embeds: [{
      title: tickets.length === 1 ? '🗑️ Ticket permanently deleted' : `🗑️ ${tickets.length} tickets permanently deleted`,
      description: list,
      color: NEUTRAL_HEX,
      fields: [{ name: 'Deleted by', value: actorEmail(), inline: false }],
      timestamp: new Date().toISOString()
    }]
  });
}
