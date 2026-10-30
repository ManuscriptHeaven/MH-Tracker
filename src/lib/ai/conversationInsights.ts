import type { AIActionPreview, AIToolContext, AIToolResult } from './aiTypes';
import type { ChatMessage, Conversation, Profile } from '../types';
import { allowedConversation, safeText } from './messageIntelligence';

type AccessibleThread = { conversation: Conversation; messages: ChatMessage[] };

function activeTeam(profile: Profile): boolean {
  return profile.status !== 'inactive'
    && ['admin','project_manager','manager','employee','junior_assistant'].includes(profile.role);
}

/** Limited to rows already loaded through the signed-in Supabase JWT/RLS. */
export function accessibleThreads(ctx: AIToolContext): AccessibleThread[] {
  if (!ctx.currentProfile || !activeTeam(ctx.currentProfile)) return [];
  const threads = (ctx.data.conversations || []).filter((c) => allowedConversation(c, ctx));
  return threads.map((conversation) => ({
    conversation,
    messages: (ctx.data.messages || [])
      .filter((m) => m.conversation_id === conversation.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
  }));
}

export function isConversationInsightIntent(query: string): boolean {
  const q = query.trim();
  if (isMessageReplyIntent(q)) return false;
  return /\b(?:summari[sz]e|recap|action\s+items?|decisions?|needs?\s+(?:a\s+)?reply|needs?\s+(?:my\s+)?attention|waiting for (?:my|our)\s+(?:response|reply)|conversation\s+summary|discussion\s+summary|what\s+should\s+i\s+do)\b/i.test(q)
    && /\b(?:messages?|chats?|conversations?|discussions?|inbox|dms?|replies?)\b/i.test(q);
}

export function isMessageReplyIntent(query: string): boolean {
  const q = query.trim();
  return /^(?:(?:please|can you|could you|would you)\s+)?(?:draft|prepare|write|compose|reply|respond|send)\b/i.test(q)
    && /\b(?:reply|respond|response)\b/i.test(q)
    && (/\b(?:to|about|for|in|from|latest|last|recent|this)\b/i.test(q) || /\breply\b/i.test(q));
}

function classifyRequest(body: string): { label: string; response: string } | null {
  if (/\b(?:approval|approve|sign.off|confirm the proof|review the proof)\b/i.test(body)) {
    return { label: 'Possible approval/review request',
      response: 'Thank you for the update. I will review the requested approval details and follow up with a clear response.' };
  }
  if (/\b(?:revision|changes?|correction|fix|edit|amend)\b/i.test(body)) {
    return { label: 'Possible revision request',
      response: 'Thank you for the details. I will review the requested changes and confirm the next steps.' };
  }
  if (/\b(?:file|manuscript|attachment|download|upload)\b/i.test(body)) {
    return { label: 'Possible file or attachment follow-up',
      response: 'Thank you for your message. I will check the files and follow up on anything needed.' };
  }
  if (/\b(?:invoice|payment|balance|paid|billing)\b/i.test(body)) {
    return { label: 'Possible payment or invoice question',
      response: 'Thank you for reaching out. I will review the payment details and respond with an update.' };
  }
  if (/\b(?:deadline|due date|when will|schedule|eta|urgent)\b/i.test(body)) {
    return { label: 'Possible scheduling question',
      response: 'Thanks for your message. I will check the current schedule and confirm the next update.' };
  }
  if (/\?|could you|can you|please|need (?:you|your|a|the)/i.test(body)) {
    return { label: 'Possible question requiring a response',
      response: 'Thank you for your message. I will review your question and reply with an update.' };
  }
  return null;
}

function threadLabel(thread: AccessibleThread, ctx: AIToolContext): string {
  const c = thread.conversation;
  if (c.type === 'dm') {
    const other = (ctx.data.conversationMembers || []).find(
      (m) => m.conversation_id === c.id && m.user_id !== ctx.currentProfile.id);
    const name = ctx.data.profiles.find((p) => p.id === other?.user_id)?.full_name || 'Team member';
    return 'DM with ' + name;
  }
  const project = ctx.visibleProjects.find((p) => p.id === c.project_id);
  return project ? project.project_title + ' — ' + (c.type === 'project_client' ? 'client' : 'internal')
    : (c.name || (c.type === 'team_channel' ? 'Team channel' : 'Task discussion'));
}

function senderName(message: ChatMessage, ctx: AIToolContext): string {
  return ctx.data.profiles.find((p) => p.id === message.sender_id)?.full_name || 'Conversation member';
}

function matchRequestedProject(query: string, ctx: AIToolContext): { id?: string; ambiguous?: boolean } {
  const matches = ctx.visibleProjects.filter((p) =>
    p.project_title.length >= 3 && query.toLowerCase().includes(p.project_title.toLowerCase()));
  const explicitProject = /\b(?:project|book)\s+(?:named\s+)?[a-z0-9]/i.test(query);
  if (explicitProject && !matches.length) return { missing: true } as any;
  return matches.length > 1 ? { ambiguous: true } : { id: matches[0]?.id };
}
function matchRequestedSender(query: string, ctx: AIToolContext): { id?: string; ambiguous?: boolean } {
  const match = query.match(/\b(?:from|to|with|what did)\s+(?:the\s+)?([a-z][a-z .-]{1,45})(?=\s+(?:say|write|send|about|for|on|in|message|conversation|chat|reply|latest|today)\b|[?.!]|$)/i);
  const name = (match?.[1] || '').trim().toLowerCase();
  if (!name || /^(?:latest|last|recent|my|our|the|team|client|employee|author|staff|this|project|book)\b/i.test(name)) return {};
  const matches = ctx.data.profiles.filter((p) =>
    p.full_name.toLowerCase() === name || p.full_name.toLowerCase().startsWith(name+' '));
  if (!matches.length) return { missing: true } as any;
  return matches.length > 1 ? { ambiguous: true } : { id: matches[0]?.id };
}

function selectedThreads(query: string, ctx: AIToolContext):
  { threads: AccessibleThread[]; error?: string } {
  const project = matchRequestedProject(query,ctx);
  const sender = matchRequestedSender(query,ctx);
  if (project.ambiguous || sender.ambiguous) return { threads: [], error: 'ambiguous_target' };
  if ((project as any).missing || (sender as any).missing) return { threads: [], error: 'target_not_found' };
  let threads = accessibleThreads(ctx).filter((t) => t.messages.length > 0);
  if (project.id) threads = threads.filter((t) => t.conversation.project_id === project.id);
  if (sender.id) threads = threads.filter((t) => t.messages.some((m) => m.sender_id === sender.id));
  if (/\b(?:client|author)\s+(?:messages?|chats?|conversations?|discussions?|reply)/i.test(query)) {
    threads = threads.filter((t) => t.conversation.type === 'project_client');
  }
  if (/\b(?:team|internal)\s+(?:messages?|chats?|conversations?|discussions?)/i.test(query)) {
    threads = threads.filter((t) => t.conversation.type !== 'project_client');
  }
  if (/\btoday\b/i.test(query)) {
    const day = new Date().toDateString();
    threads = threads.map((t) => ({ ...t, messages: t.messages.filter((m) =>
      new Date(m.created_at).toDateString() === day) })).filter((t)=>t.messages.length>0);
  }
  if (/\bunread\b/i.test(query)) {
    threads = threads.map((t) => {
      const member = (ctx.data.conversationMembers||[]).find((m) =>
        m.conversation_id === t.conversation.id && m.user_id === ctx.currentProfile.id);
      return { ...t, messages: t.messages.filter((m) => m.sender_id !== ctx.currentProfile.id
        && member && (!member.last_read_at ||
          new Date(m.created_at).getTime() > new Date(member.last_read_at).getTime())) };
    }).filter((t)=>t.messages.length>0);
  }
  return { threads };
}

function untrustedSource(message: ChatMessage): string {
  return 'Source message ID: ' + safeText(message.id, 56)
    + ' | ' + new Date(message.created_at).toLocaleString();
}

/** Source-grounded, deterministic conversation digest; no LLM instructions are
 * ingested and no "resolved" claim is inferred from a keyword alone.
 */
export function summarizeMessageThreads(query: string, ctx: AIToolContext): AIToolResult {
  if (!activeTeam(ctx.currentProfile)) {
    return { success: false, toolName: 'get_messages', error: 'permission_denied',
      spokenText: 'Message intelligence is restricted to active team members.',
      displayText: 'Message intelligence is unavailable for this account.' };
  }
  const selection = selectedThreads(query,ctx);
  if (selection.error) return { success: false, toolName: 'search_messages', error: selection.error,
    spokenText:'Several people or projects match. Please specify the exact name.',
    displayText:'Specify one exact person or project to avoid mixing unrelated conversations.' };
  const threads = selection.threads.sort((a,b)=>
    new Date(b.messages[b.messages.length-1].created_at).getTime()
    -new Date(a.messages[a.messages.length-1].created_at).getTime()).slice(0,6);
  const overall = selection.threads.reduce((n,t)=>n+t.messages.length,0);
  if (!overall) return { success:true, toolName:'get_messages', count:0,
    spokenText:'No accessible messages match these filters.',
    displayText:'No accessible messages match these filters. No private conversations were opened.' };

  const sections:string[] = [];
  let actions=0;
  for (const t of threads) {
    const last=t.messages[t.messages.length-1];
    const excerpts=t.messages.slice(-4);
    const bullets=excerpts.map((m)=>'- ' + safeText(senderName(m,ctx),50)+': '
      +safeText(m.body,135)+' ('+untrustedSource(m)+')');
    const latestIncoming = [...t.messages].reverse().find((m)=>m.sender_id!==ctx.currentProfile.id);
    const unaddressed=last.sender_id!==ctx.currentProfile.id && latestIncoming?.id===last.id;
    const signal=unaddressed ? classifyRequest(last.body) : null;
    if(signal)actions++;
    sections.push('**'+safeText(threadLabel(t,ctx),110)+'** — '+t.messages.length
      +' matching messages\n'+bullets.join('\n')
      +(signal?'\n- **Potential follow-up:** '+signal.label+' ('+untrustedSource(last)+')':''));
  }
  const intro='Reviewed '+overall+' accessible messages across '+selection.threads.length
    +' conversations. Identified '+actions+' possible follow-up'+(actions===1?'':'s')
    +' in the displayed conversations.';
  return { success:true,toolName:'get_messages',count:overall,spokenText:intro,
    displayText:'### Conversation digest\n\n'+intro+'\n\n'+sections.join('\n\n')
      +'\n\n_Source references identify original MH Tracker message records. Potential actions are suggestions, not confirmed outstanding obligations. No read receipts were changed._' };
}

export function prepareMessageReply(query: string,ctx: AIToolContext): AIToolResult | null {
  if(!isMessageReplyIntent(query))return null;
  if(!activeTeam(ctx.currentProfile))return {success:false,toolName:'draft_message_reply',
    error:'permission_denied',spokenText:'This account cannot draft team replies.',
    displayText:'This account is not authorized to use AI reply drafting.'};
  const selection=selectedThreads(query,ctx);
  if(selection.error)return {success:false,toolName:'draft_message_reply',error:'ambiguous_target',
    spokenText:'Please specify one exact person or project.',
    displayText:'Multiple people or projects match. Specify one exact conversation; nothing was sent.'};
  const matches=selection.threads.filter((t)=>t.messages.some((m)=>m.sender_id!==ctx.currentProfile.id));
  const explicitLatest=/\b(?:latest|last|most recent)\b/i.test(query);
  if(matches.length>1&&!explicitLatest){
    return {success:false,toolName:'draft_message_reply',error:'conversation_ambiguous',
      spokenText:'Which conversation should I reply to?',
      displayText:'Several accessible conversations match. Specify a project title or sender to avoid replying in the wrong thread. Nothing was sent.'};
  }
  matches.sort((a,b)=>new Date(b.messages[b.messages.length-1].created_at).getTime()
    -new Date(a.messages[a.messages.length-1].created_at).getTime());
  const thread=matches[0];
  if(!thread)return {success:false,toolName:'draft_message_reply',error:'message_not_found',
    spokenText:'No matching incoming message is available.',
    displayText:'No accessible incoming messages match this request. Nothing was sent.'};
  if(thread.conversation.type==='project_client'
    && !['admin','manager','project_manager'].includes(ctx.currentProfile.role)) {
    return {success:false,toolName:'draft_message_reply',error:'permission_denied',
      spokenText:'Only managers can send client-facing messages through AI.',
      displayText:'Client-facing AI replies require Admin or Manager permission. Nothing was sent.'};
  }
  const source=[...thread.messages].reverse().find((m)=>m.sender_id!==ctx.currentProfile.id)!;
  const last=thread.messages[thread.messages.length-1];
  if(last.sender_id===ctx.currentProfile.id && new Date(last.created_at)>new Date(source.created_at)){
    return {success:false,toolName:'draft_message_reply',error:'already_replied',
      spokenText:'You have already replied since that incoming message.',
      displayText:'The latest incoming message appears to have a newer reply from you. Review the conversation before drafting a second response.'};
  }
  const signal=classifyRequest(source.body);
  const body=signal?.response
    || (thread.conversation.type==='project_client'
      ? 'Thank you for your message. I will review the details and follow up shortly.'
      : 'Thanks for the update. I will review this and get back to you with the next steps.');
  const location=safeText(threadLabel(thread,ctx),110);
  const preview='### Professional reply draft\n\n**Conversation:** '+location
    +'\n\n**In response to:** '+safeText(source.body,180)
    +'\n\n'+untrustedSource(source)
    +'\n\n**Draft:**\n\n'+body
    +'\n\n_Draft based on an accessible source message; please check accuracy before sending._';
  // Draft requests never enable sending. Only a separate explicit "reply/send"
  // request prepares a high-risk action, which needs an independent confirm.
  const sendRequested=/^(?:(?:please|can you|could you|would you)\s+)?(?:send|reply|respond)\b/i.test(query)
    && !/\bdraft\b/i.test(query);
  if(!sendRequested)return {success:true,toolName:'draft_message_reply',spokenText:'I prepared a reply draft. Nothing was sent.',displayText:preview,
    data:{conversationId:thread.conversation.id,sourceMessageId:source.id,body}};
  const action:AIActionPreview={
    actionId:'message-reply-'+Date.now(),toolName:'send_message_reply',
    category:'high_risk',targetType:'message',targetId:thread.conversation.id,
    targetTitle:location,title:'Send reviewed reply',
    description:'Send a threaded reply to an existing accessible conversation',
    changes:[{field:'conversation',label:'Conversation',newValue:location},
      {field:'source',label:'Replying to message',newValue:source.id},
      {field:'message',label:'Message',newValue:body}],
    payload:{conversationId:thread.conversation.id,sourceMessageId:source.id,
      sourceSenderId:source.sender_id,body},
    confirmButtonText:'Send Reply',cancelButtonText:'Keep Draft',
    spokenPrompt:'I drafted a response in '+location+'. Review it and confirm before sending.',
    requiresStrongConfirmation:true,
  };
  return {success:true,toolName:'draft_message_reply',spokenText:action.spokenPrompt,
    displayText:preview+'\n\n**Nothing has been sent. Confirm explicitly to send this threaded reply.**',
    pendingAction:action,
    data:{conversationId:thread.conversation.id,sourceMessageId:source.id,body}};
}
