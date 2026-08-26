import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Lock, MessageSquare, Paperclip, Send, User, X } from 'lucide-react';
import type { ChatMessage, Conversation, Profile } from '../lib/types';
import { firstName, initials } from '../lib/utils';
import { roleLabels } from '../lib/constants';
import { Button } from './ui';

export function ProjectDiscussionChat({
  projectId,
  projectName,
  clientName,
  isInternal,
  currentProfile,
  profiles,
  conversations,
  messages,
  onSendMessage,
  onGetOrCreateProjectConversation,
  onMarkRead,
}: {
  projectId: string;
  projectName?: string;
  clientName?: string;
  isInternal: boolean;
  currentProfile: Profile;
  profiles: Profile[];
  conversations: Conversation[];
  messages: ChatMessage[];
  onSendMessage: (
    conversationId: string,
    body: string,
    attachments?: { file_name: string; file_url: string; file_type: string; file_size: number }[],
    parentMessageId?: string | null,
  ) => Promise<ChatMessage>;
  onGetOrCreateProjectConversation: (projectId: string, isInternal: boolean) => Promise<Conversation>;
  onMarkRead?: (conversationId: string) => void;
}) {
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [inputMsg, setInputMsg] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingConv, setIsLoadingConv] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const type = isInternal ? 'project_internal' : 'project_client';

  // Find conversation from existing list or fetch/create
  const matchedConv = useMemo(
    () => (conversations || []).find((c) => c.project_id === projectId && c.type === type),
    [conversations, projectId, type],
  );

  useEffect(() => {
    let isCancelled = false;

    if (matchedConv) {
      setActiveConv(matchedConv);
      return;
    }

    async function initConversation() {
      setIsLoadingConv(true);
      try {
        const conv = await onGetOrCreateProjectConversation(projectId, isInternal);
        if (!isCancelled) {
          setActiveConv(conv);
        }
      } catch (err) {
        console.error('Failed to get/create project conversation:', err);
      } finally {
        if (!isCancelled) {
          setIsLoadingConv(false);
        }
      }
    }

    initConversation();

    return () => {
      isCancelled = true;
    };
  }, [projectId, isInternal, matchedConv, onGetOrCreateProjectConversation]);

  // Messages in this conversation
  const projectMessages = useMemo(() => {
    if (!activeConv) return [];
    return (messages || [])
      .filter((m) => m.conversation_id === activeConv.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [messages, activeConv]);

  // Auto-mark conversation as read when viewing it or receiving new messages
  useEffect(() => {
    if (activeConv && onMarkRead) {
      onMarkRead(activeConv.id);
    }
  }, [activeConv, projectMessages.length, onMarkRead]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [projectMessages.length]);

  const handleSend = async () => {
    const text = inputMsg.trim();
    if (!text || isSending) return;

    let targetConv = activeConv;
    if (!targetConv) {
      try {
        setIsLoadingConv(true);
        targetConv = await onGetOrCreateProjectConversation(projectId, isInternal);
        setActiveConv(targetConv);
      } catch (err) {
        console.error('Failed to init conversation before send:', err);
        setIsLoadingConv(false);
        return;
      }
      setIsLoadingConv(false);
    }

    if (!targetConv) return;

    try {
      setIsSending(true);
      setInputMsg('');
      await onSendMessage(targetConv.id, text);
    } catch (err) {
      console.error('Failed to send project message:', err);
      setInputMsg(text); // Restore on error
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  function formatTime(isoStr: string) {
    try {
      const date = new Date(isoStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (isToday) {
        return `Today ${timeStr}`;
      }

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday ${timeStr}`;
      }

      return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
    } catch {
      return '';
    }
  }

  return (
    <div className="space-y-3">
      {/* Banner info */}
      <div className="flex items-center justify-between text-xs text-muted">
        <p className="flex items-center gap-1.5 font-medium">
          {isInternal ? (
            <>
              <Lock className="h-3.5 w-3.5 text-gold shrink-0" />
              <span>Internal discussion between staff. <strong>Clients cannot see this.</strong></span>
            </>
          ) : (
            <>
              <User className="h-3.5 w-3.5 text-blue-600 shrink-0" />
              <span>Shared discussion with client{clientName ? ` (${clientName})` : ''}.</span>
            </>
          )}
        </p>
        <span className="text-[11px] text-muted">
          {projectMessages.length} message{projectMessages.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Messages Feed */}
      <div className="space-y-3 max-h-72 min-h-[140px] overflow-y-auto pr-1 rounded-lg border border-border bg-white/70 p-3">
        {isLoadingConv && projectMessages.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted">
            <span className="animate-pulse">Loading discussion...</span>
          </div>
        ) : projectMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted">
            <MessageSquare className="h-7 w-7 text-border mb-1.5" />
            <p className="text-xs font-semibold text-ink">
              {isInternal ? 'No internal team messages yet' : 'No client messages yet'}
            </p>
            <p className="text-[11px] text-muted mt-0.5 max-w-xs">
              {isInternal
                ? 'Use this channel to leave notes, discuss formatting or cover tasks with team members.'
                : 'Send updates, ask questions, or share feedback directly with the client.'}
            </p>
          </div>
        ) : (
          projectMessages.map((msg) => {
            const sender = profiles.find((p) => p.id === msg.sender_id);
            const isMe = msg.sender_id === currentProfile.id;
            const senderName = isMe ? 'You' : sender?.full_name || 'User';
            const roleLabel = sender ? roleLabels[sender.role] || sender.role : '';

            return (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {/* Avatar */}
                <div
                  className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold shrink-0 ${
                    isMe
                      ? 'bg-gold text-ink'
                      : sender?.role === 'client'
                        ? 'bg-blue-100 text-blue-900 border border-blue-200'
                        : 'bg-linen text-ink border border-border'
                  }`}
                  title={`${senderName} (${roleLabel})`}
                >
                  {initials(sender?.full_name || (isMe ? currentProfile.full_name : 'User'))}
                </div>

                {/* Message Body */}
                <div className={`max-w-[75%] space-y-1 ${isMe ? 'items-end text-right' : ''}`}>
                  <div className={`flex items-center gap-1.5 text-[11px] ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <span className="font-bold text-ink">
                      {isMe ? 'You' : senderName}
                    </span>
                    {!isMe && roleLabel && (
                      <span className="text-[10px] text-muted">({roleLabel})</span>
                    )}
                    <span className="text-[10px] text-muted ml-1">
                      {formatTime(msg.created_at)}
                    </span>
                  </div>

                  <div
                    className={`rounded-lg p-2.5 text-xs leading-relaxed inline-block text-left break-words ${
                      isMe
                        ? 'bg-ink text-white rounded-tr-none shadow-xs'
                        : isInternal
                          ? 'bg-ivory border border-border text-ink rounded-tl-none'
                          : 'bg-blue-50/70 border border-blue-200/80 text-blue-950 rounded-tl-none'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.body}</p>

                    {/* Attachments */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-2 space-y-1 border-t border-black/10 dark:border-white/10 pt-1.5">
                        {msg.attachments.map((att) => (
                          <div
                            key={att.id}
                            className="flex items-center justify-between rounded bg-white/20 p-1.5 text-[10px]"
                          >
                            <span className="flex items-center gap-1 truncate">
                              <FileText className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{att.file_name}</span>
                            </span>
                            <a
                              href={att.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 font-bold underline text-gold"
                            >
                              Download
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input Box */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder={
            isInternal
              ? 'Write an internal team message...'
              : `Write a message to ${clientName || 'the client'}...`
          }
          value={inputMsg}
          onChange={(e) => setInputMsg(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSending}
          className="flex-1 rounded-md border border-border bg-white px-3 py-2 text-xs text-ink outline-none transition focus:border-gold disabled:opacity-50"
        />
        <Button
          className="min-h-9 text-xs px-3.5 py-1"
          onClick={handleSend}
          disabled={isSending || !inputMsg.trim()}
        >
          <Send className="h-3.5 w-3.5" />
          {isSending ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
