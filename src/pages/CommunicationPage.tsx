import { useMemo, useState } from 'react';
import {
  AtSign,
  FileText,
  FolderKanban,
  Hash,
  Image,
  Inbox,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  Smile,
  User,
  Users,
} from 'lucide-react';
import type {
  ChatMessage,
  Conversation,
  Profile,
  Project,
  Task,
  TrackerData,
} from '../lib/types';
import { firstName, initials, isClientRole } from '../lib/utils';
import { roleLabels } from '../lib/constants';

interface CommunicationPageProps {
  currentProfile: Profile;
  data: TrackerData;
  projects: Project[];
  profiles: Profile[];
  tasks: Task[];
  onSendMessage: (
    conversationId: string,
    body: string,
    attachments?: { file_name: string; file_url: string; file_type: string; file_size: number }[],
    parentMessageId?: string | null,
  ) => Promise<ChatMessage>;
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
  onMarkRead: (conversationId: string) => Promise<void>;
  onGetOrCreateDM: (otherUserId: string) => Promise<Conversation>;
  onGetOrCreateProjectConversation: (projectId: string, isInternal: boolean) => Promise<Conversation>;
}

const EMOJI_LIST = ['👍', '❤️', '🎉', '😄', '🚀', '👀', '✅'];

const TEAM_CHANNELS = [
  { name: 'general', desc: 'Company announcements and general team chat' },
  { name: 'formatting', desc: 'Print layout and book interior formatting discussions' },
  { name: 'covers', desc: 'Cover design files, concepts, and revisions' },
  { name: 'qc', desc: 'Final quality control and proof checking' },
  { name: 'announcements', desc: 'Important project and office announcements' },
];

export function CommunicationPage({
  currentProfile,
  data,
  projects,
  profiles,
  tasks,
  onSendMessage,
  onToggleReaction,
  onMarkRead,
  onGetOrCreateDM,
  onGetOrCreateProjectConversation,
}: CommunicationPageProps) {
  const isClient = isClientRole(currentProfile.role);
  const conversations = data.conversations || [];
  const messages = data.messages || [];
  const conversationMembers = data.conversationMembers || [];
  const messageReactions = data.messageReactions || [];

  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    conversations.length > 0 ? conversations[0].id : null,
  );
  const [activeTab, setActiveTab] = useState<'inbox' | 'team' | 'dm' | 'project_internal' | 'project_client'>(
    isClient ? 'project_client' : 'inbox',
  );

  const [messageInput, setMessageInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<
    { file_name: string; file_url: string; file_type: string; file_size: number }[]
  >([]);

  // Filtered lists
  const teamMembers = useMemo(
    () => profiles.filter((p) => p.role !== 'client' && p.id !== currentProfile.id),
    [profiles, currentProfile.id],
  );

  const clientProfiles = useMemo(
    () => profiles.filter((p) => p.role === 'client'),
    [profiles],
  );

  // Active conversation object
  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId],
  );

  // Messages for active conversation
  const activeMessages = useMemo(() => {
    if (!activeConversationId) return [];
    return messages.filter((m) => m.conversation_id === activeConversationId);
  }, [messages, activeConversationId]);

  // Context project for active conversation if project-bound
  const activeProject = useMemo(() => {
    if (!activeConv?.project_id) return null;
    return projects.find((p) => p.id === activeConv.project_id) || null;
  }, [activeConv, projects]);

  // Handler to select channel or create if missing
  const handleSelectChannel = (channelName: string) => {
    const existing = conversations.find((c) => c.type === 'team_channel' && c.name === channelName);
    if (existing) {
      setActiveConversationId(existing.id);
      onMarkRead(existing.id);
    }
  };

  const handleSelectDM = async (otherUserId: string) => {
    const conv = await onGetOrCreateDM(otherUserId);
    setActiveConversationId(conv.id);
    onMarkRead(conv.id);
  };

  const handleSelectProjectConv = async (projectId: string, isInternal: boolean) => {
    const conv = await onGetOrCreateProjectConversation(projectId, isInternal);
    setActiveConversationId(conv.id);
    onMarkRead(conv.id);
  };

  const handleSend = async () => {
    if (!activeConversationId || (!messageInput.trim() && pendingAttachments.length === 0)) return;

    const currentInput = messageInput;
    const currentAtts = pendingAttachments;
    const currentReplyId = replyingToMessage?.id || null;

    setMessageInput('');
    setPendingAttachments([]);
    setReplyingToMessage(null);
    setShowMentionPopover(false);

    try {
      await onSendMessage(
        activeConversationId,
        currentInput,
        currentAtts,
        currentReplyId,
      );
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleFileUploadSimulate = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const mockAttachment = {
      file_name: file.name,
      file_url: URL.createObjectURL(file),
      file_type: file.name.split('.').pop() || 'file',
      file_size: file.size,
    };

    setPendingAttachments((prev) => [...prev, mockAttachment]);
  };

  return (
    <div className="flex h-[calc(100vh-140px)] overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      {/* LEFT SIDEBAR: Communication Directory */}
      <div className="flex w-80 flex-col border-r border-border bg-linen/50">
        <div className="border-b border-border p-4">
          <h2 className="font-display text-lg font-bold text-ink flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-gold" />
            Communication
          </h2>
          <div className="mt-3 relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-md border border-border bg-white pl-8 pr-3 py-1.5 text-xs focus:border-gold outline-none"
            />
          </div>
        </div>

        {/* Section Navigation Tabs */}
        {!isClient && (
          <div className="flex border-b border-border bg-linen px-2 py-1 gap-1 text-xs font-semibold overflow-x-auto">
            <button
              onClick={() => setActiveTab('inbox')}
              className={`flex items-center gap-1.5 rounded px-2 py-1.5 ${
                activeTab === 'inbox' ? 'bg-ink text-gold' : 'text-muted hover:text-ink'
              }`}
            >
              <Inbox className="h-3.5 w-3.5" />
              Inbox
            </button>
            <button
              onClick={() => setActiveTab('team')}
              className={`flex items-center gap-1.5 rounded px-2 py-1.5 ${
                activeTab === 'team' ? 'bg-ink text-gold' : 'text-muted hover:text-ink'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Team
            </button>
            <button
              onClick={() => setActiveTab('dm')}
              className={`flex items-center gap-1.5 rounded px-2 py-1.5 ${
                activeTab === 'dm' ? 'bg-ink text-gold' : 'text-muted hover:text-ink'
              }`}
            >
              <User className="h-3.5 w-3.5" />
              DMs
            </button>
            <button
              onClick={() => setActiveTab('project_internal')}
              className={`flex items-center gap-1.5 rounded px-2 py-1.5 ${
                activeTab === 'project_internal' ? 'bg-ink text-gold' : 'text-muted hover:text-ink'
              }`}
            >
              <Lock className="h-3.5 w-3.5" />
              Projects
            </button>
          </div>
        )}

        {/* Directory Items List */}
        <div className="flex-1 overflow-y-y space-y-4 p-3 overflow-y-auto">
          {/* Team Chat Channels */}
          {(!isClient && (activeTab === 'inbox' || activeTab === 'team')) && (
            <div>
              <p className="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted flex items-center justify-between">
                <span>Team Channels</span>
                <span className="rounded bg-gold/20 px-1 text-ink">{TEAM_CHANNELS.length}</span>
              </p>
              <div className="space-y-0.5">
                {TEAM_CHANNELS.map((ch) => {
                  const conv = conversations.find((c) => c.type === 'team_channel' && c.name === ch.name);
                  const isSelected = activeConversationId === conv?.id;

                  return (
                    <button
                      key={ch.name}
                      onClick={() => handleSelectChannel(ch.name)}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs font-medium transition ${
                        isSelected ? 'bg-gold text-ink font-bold' : 'hover:bg-black/5 text-ink/80'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Hash className="h-3.5 w-3.5 text-muted shrink-0" />
                        <span className="truncate">{ch.name}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Direct Messages */}
          {(!isClient && (activeTab === 'inbox' || activeTab === 'dm')) && (
            <div>
              <p className="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                Direct Messages
              </p>
              <div className="space-y-0.5">
                {teamMembers.map((member) => {
                  return (
                    <button
                      key={member.id}
                      onClick={() => handleSelectDM(member.id)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs font-medium hover:bg-black/5 text-ink/80"
                    >
                      <div className="relative">
                        <div className="grid h-6 w-6 place-items-center rounded-full bg-gold/30 text-[10px] font-bold text-ink">
                          {initials(member.full_name)}
                        </div>
                        <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-success ring-1 ring-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{member.full_name}</p>
                        <p className="truncate text-[10px] text-muted">{roleLabels[member.role]}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Project Discussions */}
          <div>
            <p className="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted flex items-center justify-between">
              <span>{isClient ? 'Your Project Messages' : 'Project Discussions'}</span>
            </p>
            <div className="space-y-0.5">
              {projects.map((proj) => (
                <div key={proj.id} className="space-y-0.5">
                  {!isClient && (
                    <button
                      onClick={() => handleSelectProjectConv(proj.id, true)}
                      className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-medium hover:bg-black/5 text-ink/80"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Lock className="h-3 w-3 text-gold shrink-0" />
                        <span className="truncate">{proj.project_title} (Internal)</span>
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() => handleSelectProjectConv(proj.id, false)}
                    className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-medium hover:bg-black/5 text-ink/80"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <User className="h-3 w-3 text-blue-600 shrink-0" />
                      <span className="truncate">{proj.project_title} (Client)</span>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT MAIN WORKSPACE: Active Conversation Thread */}
      {activeConv ? (
        <div className="flex flex-1 flex-col bg-white">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-3 bg-linen/30">
            <div className="flex items-center gap-3">
              {activeConv.type === 'team_channel' ? (
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-gold/20 text-ink">
                  <Hash className="h-5 w-5 text-ink" />
                </div>
              ) : activeConv.type === 'dm' ? (
                <div className="grid h-10 w-10 place-items-center rounded-full bg-ink text-gold font-bold text-sm">
                  DM
                </div>
              ) : (
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-gold text-ink">
                  <FolderKanban className="h-5 w-5" />
                </div>
              )}

              <div>
                <h3 className="font-display font-bold text-ink text-base flex items-center gap-2">
                  {activeConv.type === 'team_channel'
                    ? `#${activeConv.name}`
                    : activeConv.type === 'dm'
                    ? 'Direct Message'
                    : activeProject?.project_title || 'Project Discussion'}
                  {activeConv.type === 'project_internal' && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                      <Lock className="h-3 w-3" /> Internal Team Only
                    </span>
                  )}
                  {activeConv.type === 'project_client' && (
                    <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">
                      <User className="h-3 w-3" /> Client Portal Shared
                    </span>
                  )}
                </h3>
                <p className="text-xs text-muted">
                  {activeConv.type === 'team_channel'
                    ? TEAM_CHANNELS.find((c) => c.name === activeConv.name)?.desc
                    : activeProject
                    ? `Client: ${activeProject.client_name} • Manager: ${activeProject.project_manager || 'Unassigned'}`
                    : 'Real-time conversation'}
                </p>
              </div>
            </div>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {activeMessages.length === 0 ? (
              <div className="grid h-full place-items-center text-center p-8 text-muted">
                <div>
                  <MessageSquare className="mx-auto h-12 w-12 text-muted/40 mb-2" />
                  <p className="text-sm font-medium">No messages yet in this conversation.</p>
                  <p className="text-xs mt-1">Send a message below to start the discussion!</p>
                </div>
              </div>
            ) : (
              activeMessages.map((msg) => {
                const sender = profiles.find((p) => p.id === msg.sender_id);
                const isMe = msg.sender_id === currentProfile.id;
                const reactions = messageReactions.filter((r) => r.message_id === msg.id);

                return (
                  <div key={msg.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                    <div className="grid h-8 w-8 place-items-center rounded-full bg-gold text-ink font-bold text-xs shrink-0">
                      {initials(sender?.full_name || 'User')}
                    </div>

                    <div className={`max-w-[70%] space-y-1 ${isMe ? 'items-end text-right' : ''}`}>
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <span className="font-semibold text-ink">{sender?.full_name || 'User'}</span>
                        <span className="text-[10px]">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      {/* Message Bubble */}
                      <div
                        className={`rounded-xl p-3 text-xs leading-relaxed ${
                          isMe
                            ? 'bg-ink text-white rounded-tr-none'
                            : 'bg-linen border border-border text-ink rounded-tl-none'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.body}</p>

                        {/* Attachments inside message */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-2 space-y-1.5 border-t border-white/20 pt-2">
                            {msg.attachments.map((att) => (
                              <div
                                key={att.id}
                                className="flex items-center justify-between rounded bg-white/10 p-2 text-[11px]"
                              >
                                <span className="flex items-center gap-2 truncate">
                                  <FileText className="h-4 w-4" />
                                  <span className="truncate">{att.file_name}</span>
                                </span>
                                <a
                                  href={att.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline ml-2 text-gold font-semibold"
                                >
                                  Download
                                </a>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Reactions Row */}
                      <div className="flex items-center gap-1 text-xs pt-0.5">
                        {EMOJI_LIST.slice(0, 4).map((emoji) => {
                          const count = reactions.filter((r) => r.emoji === emoji).length;
                          return (
                            <button
                              key={emoji}
                              onClick={() => onToggleReaction(msg.id, emoji)}
                              className={`rounded-full px-2 py-0.5 text-[11px] border transition ${
                                count > 0 ? 'bg-gold/20 border-gold font-bold' : 'border-border hover:bg-black/5'
                              }`}
                            >
                              {emoji} {count > 0 && count}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Attachment Preview Box */}
          {pendingAttachments.length > 0 && (
            <div className="border-t border-border bg-linen/40 px-4 py-2 flex items-center gap-2">
              <span className="text-xs font-semibold text-muted">Attached files:</span>
              {pendingAttachments.map((att, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 rounded bg-white border border-border px-2 py-1 text-xs font-medium text-ink"
                >
                  <Paperclip className="h-3 w-3 text-gold" />
                  {att.file_name}
                </span>
              ))}
            </div>
          )}

          {/* Mention Popover Dropdown */}
          {showMentionPopover && (
            <div className="mx-6 mb-2 rounded-lg border border-border bg-white p-2 shadow-lg max-h-40 overflow-y-auto">
              <p className="px-2 py-1 text-[10px] font-bold text-muted uppercase">Mention Team Member</p>
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setMessageInput((prev) => prev + `@${firstName(p.full_name)} `);
                    setShowMentionPopover(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-gold/20 text-left font-medium"
                >
                  <AtSign className="h-3.5 w-3.5 text-gold" />
                  <span>{p.full_name} ({roleLabels[p.role]})</span>
                </button>
              ))}
            </div>
          )}

          {/* Input Box */}
          <div className="border-t border-border p-4 bg-linen/20">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-white p-2 focus-within:border-gold">
              <label className="cursor-pointer p-1.5 text-muted hover:text-ink transition">
                <Paperclip className="h-4 w-4" />
                <input type="file" onChange={handleFileUploadSimulate} className="hidden" />
              </label>

              <button
                type="button"
                onClick={() => setShowMentionPopover((prev) => !prev)}
                className="p-1.5 text-muted hover:text-ink transition"
                title="Mention someone"
              >
                <AtSign className="h-4 w-4" />
              </button>

              <input
                type="text"
                placeholder="Write a message... (Use @ to mention someone)"
                value={messageInput}
                onChange={(e) => {
                  setMessageInput(e.target.value);
                  if (e.target.value.endsWith('@')) setShowMentionPopover(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                className="flex-1 bg-transparent px-2 text-xs text-ink outline-none"
              />

              <button
                onClick={handleSend}
                disabled={!messageInput.trim() && pendingAttachments.length === 0}
                className="flex items-center gap-1.5 rounded-md bg-gold px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-gold/90 disabled:opacity-50"
              >
                <span>Send</span>
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-center p-8">
          <div>
            <MessageSquare className="mx-auto h-16 w-16 text-muted/30 mb-3" />
            <h3 className="font-display text-lg font-bold text-ink">Select a conversation</h3>
            <p className="text-xs text-muted max-w-sm mt-1">
              Choose a Team Channel, Direct Message, or Project Discussion from the left panel to begin.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
