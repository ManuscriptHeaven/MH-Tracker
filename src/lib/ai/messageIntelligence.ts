import type { AIToolContext, AIToolResult } from './aiTypes';
import type { ChatMessage, Conversation, Profile } from '../types';
import { sanitizeUntrustedData } from './aiSecurityBoundary';

// Read-only. Caller data arrives under Supabase JWT/RLS; these filters add
// client-side defense in depth, especially for private two-member DMs.
export function isMessageReadingIntent(query: string): boolean {
  const q = query.trim();
  if (/^(?:send|draft|write|reply|respond|forward|delete|remove|mark)\b/i.test(q)) return false;
  if (/^(?:what did|what has|what was)\s+.{2,65}?\s+(?:say|write|send)\b/i.test(q)) return true;
  return (/\b(?:messages?|chats?|conversations?|inbox|dms?)\b/i.test(q) || /(?:پیغامات|پیغام)/u.test(q))
    && /\b(?:read|show|find|search|list|check|summari[sz]e|recap|latest|recent|unread|new|today|yesterday|what|which|who|any|pending|questions|catch\s+up)\b/i.test(q);
}

function safeText(value: string, limit = 220): string {
  return sanitizeUntrustedData(value || '')
    .replace(/\s+/g, ' ').trim().replace(/[<>]/g, '')
    .replace(/([\\*_[\]])/g, '\\$1').slice(0, limit);
}

function activeStaff(profile?: Profile): boolean {
  return Boolean(profile && profile.status !== 'inactive'
    && ['admin','manager','project_manager','employee','junior_assistant'].includes(profile.role));
}

function allowedConversation(conversation: Conversation, ctx: AIToolContext): boolean {
  if (!activeStaff(ctx.currentProfile)) return false;
  const members = (ctx.data.conversationMembers || []).filter((m) => m.conversation_id === conversation.id);
  if (conversation.type === 'dm') {
    // An admin is NOT entitled to a DM they did not join.
    return members.length === 2
      && members.some((m) => m.user_id === ctx.currentProfile.id)
      && members.every((m) => activeStaff(ctx.data.profiles.find((p) => p.id === m.user_id)));
  }
  if (conversation.type === 'project_client' || conversation.type === 'project_internal') {
    return Boolean(conversation.project_id && ctx.visibleProjects.some((p) => p.id === conversation.project_id));
  }
  if (conversation.type === 'task') {
    return Boolean(conversation.task_id && ctx.visibleTasks.some((t) => t.id === conversation.task_id));
  }
  return conversation.type === 'team_channel';
}

function matchSender(query: string, ctx: AIToolContext): { sender?: Profile; ambiguous?: boolean } {
  const said = query.match(/\b(?:what did|what has|what was)\s+(.{2,55}?)\s+(?:say|write|send)\b/i);
  const from = query.match(/\b(?:from|by)\s+(.+?)(?=\s+(?:about|on|in|today|yesterday|this|containing|mentioning|regarding)\b|[?!.]|$)/i);
  const name = (said?.[1] || from?.[1] || '').trim().toLowerCase();
  if (!name || /^(?:my|the|our|your)?\s*(?:team|staff|clients?|employees?|manager|everyone|anyone|all)\b/.test(name)) return {};
  const matches = ctx.data.profiles.filter((p) =>
    p.full_name.toLowerCase() === name || p.full_name.toLowerCase().startsWith(name + ' ')
    || p.email.toLowerCase() === name);
  return matches.length === 1 ? { sender: matches[0] } : { ambiguous: matches.length > 1 };
}

function matchesDate(query: string, value: string): boolean {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return false;
  const now = new Date();
  if (/\btoday\b/i.test(query)) return time.toDateString() === now.toDateString();
  if (/\byesterday\b/i.test(query)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return time.toDateString() === d.toDateString();
  }
  if (/\bthis week\b/i.test(query)) return time.getTime() >= now.getTime() - 7 * 86400000;
  return true;
}

function unreadFor(message: ChatMessage, ctx: AIToolContext): boolean {
  if (message.sender_id === ctx.currentProfile.id) return false;
  const receipt = (ctx.data.conversationMembers || []).find((m) =>
    m.conversation_id === message.conversation_id && m.user_id === ctx.currentProfile.id);
  // An absent membership/read receipt is unknown, never a guessed unread.
  if (!receipt) return false;
  return !receipt.last_read_at
    || new Date(message.created_at).getTime() > new Date(receipt.last_read_at).getTime();
}

function conversationLabel(conversation: Conversation, ctx: AIToolContext): string {
  if (conversation.type === 'dm') {
    const peer = (ctx.data.conversationMembers || []).find((m) =>
      m.conversation_id === conversation.id && m.user_id !== ctx.currentProfile.id);
    return 'DM: ' + (ctx.data.profiles.find((p) => p.id === peer?.user_id)?.full_name || 'Team member');
  }
  const project = ctx.visibleProjects.find((p) => p.id === conversation.project_id);
  if (project) return project.project_title + (conversation.type === 'project_client' ? ' (Client)' : ' (Internal)');
  return conversation.name || (conversation.type === 'team_channel' ? 'Team channel' : 'Task discussion');
}

export function readTrackerMessages(query: string, ctx: AIToolContext): AIToolResult {
  if (!activeStaff(ctx.currentProfile)) {
    return { success: false, toolName: 'get_messages', error: 'permission_denied',
      spokenText: 'Message reading is not available for this role.',
      displayText: 'Message reading is limited to active team accounts. No messages were accessed.' };
  }
  const accessible = new Map((ctx.data.conversations || [])
    .filter((c) => allowedConversation(c, ctx)).map((c) => [c.id, c]));
  const { sender, ambiguous } = matchSender(query, ctx);
  if (ambiguous) return { success: false, toolName: 'search_messages', error: 'ambiguous_sender',
    spokenText: 'More than one person matches. Please use the full name.',
    displayText: 'Several people match that name. Please use the full name.' };

  const lower = query.toLowerCase();
  const projects = ctx.visibleProjects.filter((p) => p.project_title.length >= 3
    && lower.includes(p.project_title.toLowerCase()));
  if (projects.length > 1) return { success: false, toolName: 'search_messages', error: 'ambiguous_project',
    spokenText: 'Several projects match. Please use the exact title.',
    displayText: 'Several projects match. Please use the exact project title.' };
  const project = projects[0];
  const unreadOnly = /\b(?:unread|not read|new messages)\b/i.test(query);
  const possibleQuestions = /\b(?:questions|waiting for (?:my|our) (?:reply|response)|follow.?ups?)\b/i.test(query);
  const clientOnly = /\b(?:client|author)\s+(?:messages?|chats?|conversations?)|(?:messages?|chats?)\s+(?:from|with)\s+(?:clients?|authors?)/i.test(query);
  const teamOnly = /\b(?:team|internal)\s+(?:messages?|chats?|conversations?)/i.test(query);
  const quoted = query.match(/\b(?:containing|mentioning|keyword|search\s+(?:messages?\s+)?for)\s+["']?(.+?)["']?(?:[.?!]|$)/i);
  const about = query.match(/\babout\s+["']?(.+?)["']?(?:[.?!]|$)/i);
  const keyword = (quoted?.[1] || (!project ? about?.[1] : '') || '').trim().toLowerCase();

  const messages = (ctx.data.messages || []).filter((m) => {
    const conversation = accessible.get(m.conversation_id);
    if (!conversation) return false;
    if (sender && m.sender_id !== sender.id) return false;
    if (project && conversation.project_id !== project.id) return false;
    if (clientOnly && conversation.type !== 'project_client') return false;
    if (teamOnly && conversation.type === 'project_client') return false;
    if (unreadOnly && !unreadFor(m, ctx)) return false;
    if (!matchesDate(query, m.created_at)) return false;
    if (keyword && !m.body.toLowerCase().includes(keyword)) return false;
    if (possibleQuestions && !/\?|could you|can you|please|need (?:a|the|your)|waiting for/i.test(m.body)) return false;
    return true;
  }).sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const toolName = keyword || sender || project ? 'search_messages' : 'get_messages';
  if (messages.length === 0) {
    return { success: true, toolName, count: 0,
      spokenText: 'No accessible messages match that request.',
      displayText: 'No accessible messages matched your filters. Private DMs require membership, and unread counts require a read receipt.' };
  }
  const selected = messages.slice(0, 8);
  const countConversations = new Set(messages.map((m) => m.conversation_id)).size;
  const overview = 'Found ' + messages.length + ' matching messages across ' + countConversations
    + ' accessible conversation' + (countConversations === 1 ? '' : 's') + '.';
  const items = selected.map((m) => {
    const conversation = accessible.get(m.conversation_id)!;
    const senderName = ctx.data.profiles.find((p) => p.id === m.sender_id)?.full_name || 'Team member';
    return '- **' + safeText(conversationLabel(conversation, ctx), 80) + '** — '
      + safeText(senderName, 40) + ' (' + new Date(m.created_at).toLocaleString() + '): '
      + safeText(m.body, 240);
  });
  return {
    success: true, toolName, count: messages.length,
    spokenText: overview + ' Most recent: ' + safeText(selected[0].body, 130),
    displayText: '### Message overview\n\n' + overview + '\n\n' + items.join('\n')
      + (possibleQuestions ? '\n\n_Possible follow-ups only. A message may already have been answered elsewhere._' : '')
      + '\n\n_Read-only: no messages marked as read and no replies sent._',
  };
}
