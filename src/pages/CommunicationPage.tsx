import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  AtSign,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderKanban,
  Hash,
  Inbox,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  User,
  Users,
  X,
} from 'lucide-react';
import type {
  ChatMessage,
  Conversation,
  ConversationMember,
  Profile,
  Project,
  Task,
  TrackerData,
} from '../lib/types';
import { firstName, initials, isClientRole } from '../lib/utils';
import { roleLabels } from '../lib/constants';
import { UserAvatar } from '../components/UserAvatar';

/* ─────────────────────────────────────────────── */
/* Types & Constants                               */
/* ─────────────────────────────────────────────── */

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
  onOpenProject?: (projectId: string) => void;
  /** When set, the page will auto-select this conversation on mount/change */
  jumpToConversationId?: string | null;
  /** Called once the jump has been handled so the parent can clear the value */
  onJumpHandled?: () => void;
}

const EMOJI_LIST = ['👍', '❤️', '🎉', '😄', '🚀', '👀', '✅'];

const TEAM_CHANNELS = [
  { name: 'general', desc: 'Company announcements and general team chat' },
  { name: 'formatting', desc: 'Print layout and book interior formatting discussions' },
  { name: 'covers', desc: 'Cover design files, concepts, and revisions' },
  { name: 'qc', desc: 'Final quality control and proof checking' },
  { name: 'announcements', desc: 'Important project and office announcements' },
];

type FilterMode = 'all' | 'unread' | 'mentions';
type NewMsgType = 'dm' | 'channel' | 'project_internal' | 'project_client';

/* ─────────────────────────────────────────────── */
/* Helper: relative time                           */
/* ─────────────────────────────────────────────── */

function relativeTime(isoStr: string): string {
  try {
    const date = new Date(isoStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function formatTime(isoStr: string): string {
  try {
    const date = new Date(isoStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return timeStr;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${timeStr}`;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  } catch {
    return '';
  }
}

/* ─────────────────────────────────────────────── */
/* Sub-components                                  */
/* ─────────────────────────────────────────────── */

/** A single row in the left sidebar list */
function ConvRow({
  icon,
  name,
  subtitle,
  lastMsg,
  lastTime,
  unreadCount,
  isSelected,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  subtitle?: string;
  lastMsg?: string;
  lastTime?: string;
  unreadCount?: number;
  isSelected: boolean;
  badge?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
        isSelected
          ? 'bg-gold/15 border border-gold/30'
          : 'hover:bg-black/5 border border-transparent'
      }`}
    >
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className={`truncate text-xs font-semibold ${isSelected ? 'text-ink' : 'text-ink/90'}`}>
            {name}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {lastTime && <span className="text-[10px] text-muted">{lastTime}</span>}
            {unreadCount && unreadCount > 0 ? (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-ink">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : null}
          </div>
        </div>
        {subtitle && <p className="truncate text-[10px] text-muted">{subtitle}</p>}
        {lastMsg && (
          <p className={`truncate text-[11px] mt-0.5 ${unreadCount ? 'font-medium text-ink/80' : 'text-muted'}`}>
            {lastMsg}
          </p>
        )}
        {badge}
      </div>
    </button>
  );
}

/** Collapsible section header in the left sidebar */
function SidebarSection({
  label,
  count,
  collapsed,
  onToggle,
  children,
}: {
  label: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted hover:text-ink transition"
      >
        <span className="flex items-center gap-1.5">
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {label}
        </span>
        {count !== undefined && count > 0 && (
          <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[9px] font-bold text-ink">{count}</span>
        )}
      </button>
      {!collapsed && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────── */
/* Main Component                                  */
/* ─────────────────────────────────────────────── */

export function CommunicationPage({
  currentProfile,
  data,
  projects,
  profiles,
  onSendMessage,
  onToggleReaction,
  onMarkRead,
  onGetOrCreateDM,
  onGetOrCreateProjectConversation,
  onOpenProject,
  jumpToConversationId,
  onJumpHandled,
}: CommunicationPageProps) {
  const isClient = isClientRole(currentProfile.role);

  /* ── Raw data ── */
  const allConversations: Conversation[] = useMemo(() => {
    const raw = data.conversations || [];
    if (isClient) {
      const clientProjIds = new Set(projects.map((p) => p.id));
      return raw.filter(
        (c) => c.type === 'project_client' && c.project_id && clientProjIds.has(c.project_id),
      );
    }
    return raw;
  }, [data.conversations, isClient, projects]);

  const messages: ChatMessage[] = data.messages || [];
  const conversationMembers: ConversationMember[] = data.conversationMembers || [];
  const messageReactions = data.messageReactions || [];
  const messageMentions = data.messageMentions || [];

  /* ── Derived helpers ── */
  const teamMembers = useMemo(
    () => profiles.filter((p) => p.role !== 'client' && p.id !== currentProfile.id),
    [profiles, currentProfile.id],
  );

  // Unread count per conversation (messages after last_read_at for current user)
  const unreadCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    const myMemberships = conversationMembers.filter((m) => m.user_id === currentProfile.id);
    for (const membership of myMemberships) {
      const lastRead = membership.last_read_at ? new Date(membership.last_read_at).getTime() : 0;
      const count = messages.filter(
        (msg) =>
          msg.conversation_id === membership.conversation_id &&
          msg.sender_id !== currentProfile.id &&
          new Date(msg.created_at).getTime() > lastRead,
      ).length;
      map[membership.conversation_id] = count;
    }
    return map;
  }, [conversationMembers, messages, currentProfile.id]);

  const totalUnread = useMemo(
    () => Object.values(unreadCountMap).reduce((sum, n) => sum + n, 0),
    [unreadCountMap],
  );

  // Conversations where current user is mentioned in any unread message
  const mentionConvIds = useMemo(() => {
    const myMemberships = conversationMembers.filter((m) => m.user_id === currentProfile.id);
    const mentionedMsgIds = new Set(
      messageMentions
        .filter((m) => m.user_id === currentProfile.id)
        .map((m) => m.message_id),
    );
    const ids = new Set<string>();
    for (const membership of myMemberships) {
      const lastRead = membership.last_read_at ? new Date(membership.last_read_at).getTime() : 0;
      const hasMention = messages.some(
        (msg) =>
          msg.conversation_id === membership.conversation_id &&
          msg.sender_id !== currentProfile.id &&
          new Date(msg.created_at).getTime() > lastRead &&
          mentionedMsgIds.has(msg.id),
      );
      if (hasMention) ids.add(membership.conversation_id);
    }
    return ids;
  }, [conversationMembers, messageMentions, messages, currentProfile.id]);

  const totalMentions = mentionConvIds.size;

  /* ── State ── */
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  // For project conversations: which sub-tab is active
  const [projectConvMode, setProjectConvMode] = useState<'internal' | 'client'>('internal');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<
    { file_name: string; file_url: string; file_type: string; file_size: number }[]
  >([]);
  // New Message dialog
  const [showNewMsg, setShowNewMsg] = useState(false);
  const [newMsgType, setNewMsgType] = useState<NewMsgType>('dm');
  const [newMsgTargetUser, setNewMsgTargetUser] = useState('');
  const [newMsgTargetProject, setNewMsgTargetProject] = useState('');
  const [newMsgChannel, setNewMsgChannel] = useState('general');
  // Sidebar collapse state
  const [channelsCollapsed, setChannelsCollapsed] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [clientsCollapsed, setClientsCollapsed] = useState(false);
  // Mobile: show conversation panel
  const [mobileShowConv, setMobileShowConv] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  /* ── Auto-select first conversation ── */
  useEffect(() => {
    if (!activeConversationId && allConversations.length > 0) {
      setActiveConversationId(allConversations[0].id);
    }
  }, [allConversations, activeConversationId]);

  /* ── Jump to a specific conversation from notification bell click ── */
  useEffect(() => {
    if (!jumpToConversationId) return;
    const conv = allConversations.find((c) => c.id === jumpToConversationId);
    if (!conv) return;

    setActiveConversationId(jumpToConversationId);
    setMobileShowConv(true);

    // If it's a project conversation, also set the project + mode
    if (conv.project_id) {
      setActiveProjectId(conv.project_id);
      setProjectConvMode(conv.type === 'project_internal' ? 'internal' : 'client');
    } else {
      setActiveProjectId(null);
    }

    // Mark as read and clear the jump target
    onMarkRead(jumpToConversationId).catch(() => {});
    onJumpHandled?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToConversationId]);

  /* ── Scroll to bottom on new messages ── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversationId, messages.length]);

  /* ── Active conversation objects ── */
  const activeConv = useMemo(() => {
    const found = allConversations.find((c) => c.id === activeConversationId);
    if (!found) return null;
    if (isClient && (found.type !== 'project_client' || !projects.some((p) => p.id === found.project_id))) {
      return null;
    }
    return found;
  }, [allConversations, activeConversationId, isClient, projects]);

  // For project conversations, the "active" conversation displayed might be the internal OR client conversation
  // We track which projectId is active separately to allow switching between internal/client
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // The actual conversation shown on the right — for project views it depends on the mode
  const displayedConv = useMemo(() => {
    if (!activeProjectId) return activeConv;
    // Find the right conversation based on mode
    const type = projectConvMode === 'internal' ? 'project_internal' : 'project_client';
    const found = allConversations.find(
      (c) => c.project_id === activeProjectId && c.type === type,
    );
    return found || activeConv;
  }, [activeProjectId, projectConvMode, allConversations, activeConv]);

  const activeProject = useMemo(() => {
    const pid = displayedConv?.project_id || activeProjectId;
    if (!pid) return null;
    return projects.find((p) => p.id === pid) || null;
  }, [displayedConv, activeProjectId, projects]);

  /* ── Messages for the displayed conversation ── */
  const activeMessages = useMemo(() => {
    if (!displayedConv) return [];
    if (isClient && displayedConv.type !== 'project_client') return [];
    return messages
      .filter((m) => m.conversation_id === displayedConv.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [messages, displayedConv, isClient]);

  /* ── Helper: last message for a conversation ── */
  function lastMsgFor(convId: string) {
    const msgs = messages
      .filter((m) => m.conversation_id === convId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return msgs[0] || null;
  }

  /* ── Filtering: apply filter mode and search ── */
  function convPassesFilter(convId: string): boolean {
    if (filterMode === 'unread') return (unreadCountMap[convId] || 0) > 0;
    if (filterMode === 'mentions') return mentionConvIds.has(convId);
    return true;
  }

  const searchLower = searchTerm.toLowerCase();

  function nameMatchesSearch(name: string) {
    if (!searchLower) return true;
    return name.toLowerCase().includes(searchLower);
  }

  function convMatchesSearch(conv: Conversation, nameFallback: string) {
    if (!searchLower) return true;
    if (nameFallback.toLowerCase().includes(searchLower)) return true;
    // also search last message body
    const lastMsg = lastMsgFor(conv.id);
    if (lastMsg && lastMsg.body.toLowerCase().includes(searchLower)) return true;
    return false;
  }

  /* ── Navigation handlers ── */
  async function selectConversation(convId: string) {
    setActiveConversationId(convId);
    setActiveProjectId(null);
    setMobileShowConv(true);
    try { await onMarkRead(convId); } catch {}
  }

  async function selectProjectConversation(projectId: string, mode: 'internal' | 'client') {
    setActiveProjectId(projectId);
    setProjectConvMode(mode);
    setMobileShowConv(true);
    // get or create the right conversation, then mark read
    try {
      const conv = await onGetOrCreateProjectConversation(projectId, mode === 'internal');
      setActiveConversationId(conv.id);
      await onMarkRead(conv.id);
    } catch {}
  }

  async function selectChannel(channelName: string) {
    const existing = allConversations.find((c) => c.type === 'team_channel' && c.name === channelName);
    if (existing) {
      setActiveConversationId(existing.id);
      setActiveProjectId(null);
      setMobileShowConv(true);
      try { await onMarkRead(existing.id); } catch {}
    }
  }

  async function selectDM(userId: string) {
    try {
      const conv = await onGetOrCreateDM(userId);
      setActiveConversationId(conv.id);
      setActiveProjectId(null);
      setMobileShowConv(true);
      await onMarkRead(conv.id);
    } catch {}
  }

  /* ── Project conv mode toggle ── */
  async function switchProjectConvMode(mode: 'internal' | 'client') {
    if (!activeProjectId) return;
    setProjectConvMode(mode);
    try {
      const conv = await onGetOrCreateProjectConversation(activeProjectId, mode === 'internal');
      setActiveConversationId(conv.id);
      await onMarkRead(conv.id);
    } catch {}
  }

  /* ── Send message ── */
  async function handleSend() {
    if (!displayedConv || (!messageInput.trim() && pendingAttachments.length === 0)) return;
    const body = messageInput;
    const atts = pendingAttachments;
    const replyId = replyingToMessage?.id || null;
    setMessageInput('');
    setPendingAttachments([]);
    setReplyingToMessage(null);
    setShowMentionPopover(false);
    try {
      await onSendMessage(displayedConv.id, body, atts, replyId);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }

  /* ── File attachment ── */
  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    setPendingAttachments((prev) => [
      ...prev,
      {
        file_name: file.name,
        file_url: URL.createObjectURL(file),
        file_type: file.name.split('.').pop() || 'file',
        file_size: file.size,
      },
    ]);
    event.target.value = '';
  }

  /* ── New Message submit ── */
  async function handleNewMsgSend() {
    try {
      if (newMsgType === 'dm' && newMsgTargetUser) {
        const conv = await onGetOrCreateDM(newMsgTargetUser);
        setActiveConversationId(conv.id);
        setActiveProjectId(null);
        setMobileShowConv(true);
      } else if (newMsgType === 'channel' && newMsgChannel) {
        await selectChannel(newMsgChannel);
      } else if (newMsgType === 'project_internal' && newMsgTargetProject) {
        await selectProjectConversation(newMsgTargetProject, 'internal');
      } else if (newMsgType === 'project_client' && newMsgTargetProject) {
        await selectProjectConversation(newMsgTargetProject, 'client');
      }
    } catch (err) {
      console.error('New message navigation failed:', err);
    }
    setShowNewMsg(false);
  }

  /* ─────────────────────────────────────────────── */
  /* BUILD SIDEBAR LISTS                             */
  /* ─────────────────────────────────────────────── */

  // DMs: conversations of type 'dm' that match current profile
  const dmConversations = useMemo(() => {
    if (isClient) return [];
    return teamMembers.map((member) => {
      const conv = allConversations.find(
        (c) =>
          c.type === 'dm' &&
          conversationMembers.some(
            (m) => m.conversation_id === c.id && m.user_id === member.id,
          ) &&
          conversationMembers.some(
            (m) => m.conversation_id === c.id && m.user_id === currentProfile.id,
          ),
      );
      return { member, conv };
    });
  }, [isClient, teamMembers, allConversations, conversationMembers, currentProfile.id]);

  // Project conversations (grouped by project)
  const projectConvItems = useMemo(() => {
    if (isClient) return [];
    return projects.map((proj) => {
      const internalConv = allConversations.find(
        (c) => c.type === 'project_internal' && c.project_id === proj.id,
      );
      const clientConv = allConversations.find(
        (c) => c.type === 'project_client' && c.project_id === proj.id,
      );
      const lastInternal = internalConv ? lastMsgFor(internalConv.id) : null;
      const lastClient = clientConv ? lastMsgFor(clientConv.id) : null;
      // pick whichever has the most recent last message
      const effectiveLast =
        !lastInternal ? lastClient
          : !lastClient ? lastInternal
          : new Date(lastInternal.created_at) > new Date(lastClient.created_at)
          ? lastInternal
          : lastClient;
      const unread =
        (internalConv ? unreadCountMap[internalConv.id] || 0 : 0) +
        (clientConv ? unreadCountMap[clientConv.id] || 0 : 0);
      return { proj, internalConv, clientConv, effectiveLast, unread };
    });
  }, [isClient, projects, allConversations, unreadCountMap]);

  // Client conversations (project_client conversations for each project)
  const clientConvItems = useMemo(() => {
    if (isClient) {
      // For client role: show their accessible project conversations
      return allConversations
        .filter((c) => c.type === 'project_client' && c.project_id)
        .map((c) => {
          const proj = projects.find((p) => p.id === c.project_id);
          const last = lastMsgFor(c.id);
          return { conv: c, proj, last, unread: unreadCountMap[c.id] || 0 };
        });
    }
    return [];
  }, [isClient, allConversations, projects, unreadCountMap]);

  /* ─────────────────────────────────────────────── */
  /* RENDERED SIDEBAR                                */
  /* ─────────────────────────────────────────────── */

  const sidebarContent = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top: Filter pills */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        {(['all', 'unread', 'mentions'] as FilterMode[]).map((mode) => {
          const label =
            mode === 'all'
              ? 'All'
              : mode === 'unread'
              ? `Unread${totalUnread > 0 ? ` ${totalUnread}` : ''}`
              : `Mentions${totalMentions > 0 ? ` ${totalMentions}` : ''}`;
          return (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                filterMode === mode
                  ? 'bg-ink text-gold'
                  : 'text-muted hover:text-ink hover:bg-black/5'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">

        {/* ── CLIENT VIEW ── */}
        {isClient && (
          <div className="space-y-0.5">
            <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-muted">
              Your Projects
            </p>
            {clientConvItems
              .filter(
                ({ conv, proj }) =>
                  convPassesFilter(conv.id) &&
                  convMatchesSearch(conv, proj?.project_title || conv.name || ''),
              )
              .map(({ conv, proj, last, unread }) => (
                <ConvRow
                  key={conv.id}
                  icon={
                    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gold/20 text-ink">
                      <FolderKanban className="h-3.5 w-3.5" />
                    </div>
                  }
                  name={proj?.project_title || conv.name || 'Project'}
                  subtitle={proj?.client_name}
                  lastMsg={last?.body}
                  lastTime={last ? relativeTime(last.created_at) : undefined}
                  unreadCount={unread}
                  isSelected={activeConversationId === conv.id}
                  onClick={() => selectConversation(conv.id)}
                />
              ))}
          </div>
        )}

        {/* ── TEAM VIEW ── */}
        {!isClient && (
          <>
            {/* INBOX section — just DMs with activity */}
            <SidebarSection
              label="Direct"
              count={dmConversations.filter(({ conv }) => conv && (unreadCountMap[conv.id] || 0) > 0).length}
              collapsed={false}
              onToggle={() => {}}
            >
              {dmConversations
                .filter(({ member }) => nameMatchesSearch(member.full_name))
                .filter(({ conv }) => !conv || convPassesFilter(conv.id))
                .map(({ member, conv }) => {
                  const last = conv ? lastMsgFor(conv.id) : null;
                  const unread = conv ? unreadCountMap[conv.id] || 0 : 0;
                  return (
                    <ConvRow
                      key={member.id}
                      icon={
                        <UserAvatar profile={member} size="xs" showStatusDot isOnline />
                      }
                      name={member.full_name}
                      subtitle={roleLabels[member.role]}
                      lastMsg={last?.body}
                      lastTime={last ? relativeTime(last.created_at) : undefined}
                      unreadCount={unread}
                      isSelected={
                        !activeProjectId && conv?.id === activeConversationId
                      }
                      onClick={() => selectDM(member.id)}
                    />
                  );
                })}
            </SidebarSection>

            {/* TEAM CHANNELS */}
            <SidebarSection
              label="Channels"
              collapsed={channelsCollapsed}
              onToggle={() => setChannelsCollapsed((v) => !v)}
            >
              {TEAM_CHANNELS.filter((ch) => nameMatchesSearch(ch.name)).map((ch) => {
                const conv = allConversations.find(
                  (c) => c.type === 'team_channel' && c.name === ch.name,
                );
                const last = conv ? lastMsgFor(conv.id) : null;
                const unread = conv ? unreadCountMap[conv.id] || 0 : 0;
                if (conv && !convPassesFilter(conv.id)) return null;
                return (
                  <ConvRow
                    key={ch.name}
                    icon={
                      <div className="grid h-7 w-7 place-items-center rounded bg-linen border border-border text-muted">
                        <Hash className="h-3.5 w-3.5" />
                      </div>
                    }
                    name={`#${ch.name}`}
                    lastMsg={last?.body}
                    lastTime={last ? relativeTime(last.created_at) : undefined}
                    unreadCount={unread}
                    isSelected={
                      !activeProjectId && conv?.id === activeConversationId
                    }
                    onClick={() => selectChannel(ch.name)}
                  />
                );
              })}
            </SidebarSection>

            {/* PROJECTS */}
            <SidebarSection
              label="Projects"
              count={projectConvItems.filter((p) => p.unread > 0).length}
              collapsed={projectsCollapsed}
              onToggle={() => setProjectsCollapsed((v) => !v)}
            >
              {projectConvItems
                .filter(
                  ({ proj }) =>
                    nameMatchesSearch(proj.project_title) ||
                    nameMatchesSearch(proj.client_name),
                )
                .filter(({ internalConv, clientConv }) => {
                  if (filterMode === 'all') return true;
                  const ids = [internalConv?.id, clientConv?.id].filter(Boolean) as string[];
                  return ids.some((id) => convPassesFilter(id));
                })
                .map(({ proj, effectiveLast, unread }) => {
                  const isActiveProj = activeProjectId === proj.id;
                  return (
                    <ConvRow
                      key={proj.id}
                      icon={
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gold/15 text-ink">
                          <FolderKanban className="h-3.5 w-3.5 text-gold" />
                        </div>
                      }
                      name={proj.project_title}
                      subtitle={proj.client_name}
                      lastMsg={effectiveLast?.body}
                      lastTime={effectiveLast ? relativeTime(effectiveLast.created_at) : undefined}
                      unreadCount={unread}
                      isSelected={isActiveProj}
                      onClick={() => selectProjectConversation(proj.id, 'internal')}
                    />
                  );
                })}
            </SidebarSection>

            {/* CLIENTS (project_client conversations) */}
            <SidebarSection
              label="Clients"
              collapsed={clientsCollapsed}
              onToggle={() => setClientsCollapsed((v) => !v)}
            >
              {projects
                .filter(
                  (proj) =>
                    nameMatchesSearch(proj.project_title) || nameMatchesSearch(proj.client_name),
                )
                .map((proj) => {
                  const conv = allConversations.find(
                    (c) => c.type === 'project_client' && c.project_id === proj.id,
                  );
                  const last = conv ? lastMsgFor(conv.id) : null;
                  const unread = conv ? unreadCountMap[conv.id] || 0 : 0;
                  if (conv && filterMode !== 'all' && !convPassesFilter(conv.id)) return null;
                  const isActiveProj = activeProjectId === proj.id && projectConvMode === 'client';
                  return (
                    <ConvRow
                      key={proj.id}
                      icon={
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold">
                          {initials(proj.client_name)}
                        </div>
                      }
                      name={proj.client_name}
                      subtitle={proj.project_title}
                      lastMsg={last?.body}
                      lastTime={last ? relativeTime(last.created_at) : undefined}
                      unreadCount={unread}
                      isSelected={isActiveProj}
                      onClick={() => selectProjectConversation(proj.id, 'client')}
                    />
                  );
                })}
            </SidebarSection>
          </>
        )}
      </div>
    </div>
  );

  /* ─────────────────────────────────────────────── */
  /* CONVERSATION PANEL                              */
  /* ─────────────────────────────────────────────── */

  const isProjectConv =
    displayedConv?.type === 'project_internal' || displayedConv?.type === 'project_client';

  // Header info
  const headerName = useMemo(() => {
    if (!displayedConv) return '';
    if (displayedConv.type === 'team_channel') return `#${displayedConv.name}`;
    if (displayedConv.type === 'dm') {
      const other = conversationMembers
        .filter(
          (m) => m.conversation_id === displayedConv.id && m.user_id !== currentProfile.id,
        )
        .map((m) => profiles.find((p) => p.id === m.user_id))
        .filter(Boolean)[0];
      return other?.full_name || 'Direct Message';
    }
    return activeProject?.project_title || 'Project Discussion';
  }, [displayedConv, conversationMembers, currentProfile.id, profiles, activeProject]);

  const convPanel = (
    <div className="flex flex-1 flex-col bg-white min-h-0">
      {displayedConv ? (
        <>
          {/* ── Conversation Header ── */}
          <div className="border-b border-border bg-linen/30 px-5 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* Back button (mobile) */}
                <button
                  className="md:hidden shrink-0 text-muted hover:text-ink"
                  onClick={() => setMobileShowConv(false)}
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>

                {/* Icon */}
                {displayedConv.type === 'team_channel' ? (
                  <div className="shrink-0 grid h-9 w-9 place-items-center rounded-lg bg-gold/20 text-ink">
                    <Hash className="h-4 w-4" />
                  </div>
                ) : displayedConv.type === 'dm' ? (
                  (() => {
                    const other = conversationMembers
                      .filter(
                        (m) =>
                          m.conversation_id === displayedConv.id && m.user_id !== currentProfile.id,
                      )
                      .map((m) => profiles.find((p) => p.id === m.user_id))
                      .filter(Boolean)[0];
                    return (
                      <UserAvatar
                        profile={other || undefined}
                        size="sm"
                        showStatusDot
                        isOnline
                      />
                    );
                  })()
                ) : (
                  <div className="shrink-0 grid h-9 w-9 place-items-center rounded-lg bg-gold text-ink">
                    <FolderKanban className="h-4 w-4" />
                  </div>
                )}

                {/* Title + subtitle */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base font-bold text-ink truncate">
                      {headerName}
                    </h3>
                    {/* Badge */}
                    {displayedConv.type === 'project_internal' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        <Lock className="h-2.5 w-2.5" /> Internal
                      </span>
                    )}
                    {displayedConv.type === 'project_client' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800">
                        <User className="h-2.5 w-2.5" /> Client
                      </span>
                    )}
                  </div>
                  {activeProject && (
                    <p className="text-[11px] text-muted truncate">
                      {activeProject.client_name}
                      {activeProject.current_stage
                        ? ` • ${activeProject.current_stage}`
                        : ''}
                    </p>
                  )}
                </div>
              </div>

              {/* Open Project button */}
              {activeProject && onOpenProject && (
                <button
                  onClick={() => onOpenProject(activeProject.id)}
                  className="shrink-0 flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:bg-linen transition"
                >
                  <ExternalLink className="h-3 w-3 text-gold" />
                  Open Project
                </button>
              )}
            </div>

            {/* Context bar for project conversations */}
            {isProjectConv && activeProject && (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white border border-border px-3 py-2 text-[11px]">
                {activeProject.current_stage && (
                  <span className="text-muted">
                    Stage: <strong className="text-ink">{activeProject.current_stage}</strong>
                  </span>
                )}
                {activeProject.status && (
                  <span className="text-muted">
                    Status: <strong className="text-ink">{activeProject.status}</strong>
                  </span>
                )}
                {activeProject.waiting_on && activeProject.waiting_on !== 'None' && (
                  <span className="text-muted">
                    Waiting on: <strong className="text-ink">{activeProject.waiting_on}</strong>
                  </span>
                )}
                {activeProject.revision_count && activeProject.revision_count > 0 ? (
                  <span className="text-muted">
                    Revision: <strong className="text-ink">#{activeProject.revision_count}</strong>
                  </span>
                ) : null}
              </div>
            )}

            {/* Internal ↔ Client tab strip — only for team users viewing a project */}
            {isProjectConv && !isClient && activeProjectId && (
              <div className="mt-2 flex gap-1">
                <button
                  onClick={() => switchProjectConvMode('internal')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition ${
                    projectConvMode === 'internal'
                      ? 'bg-amber-100 text-amber-800 border border-amber-200'
                      : 'text-muted hover:text-ink hover:bg-linen border border-transparent'
                  }`}
                >
                  <Lock className="h-3 w-3" /> Internal
                </button>
                <button
                  onClick={() => switchProjectConvMode('client')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition ${
                    projectConvMode === 'client'
                      ? 'bg-purple-100 text-purple-800 border border-purple-200'
                      : 'text-muted hover:text-ink hover:bg-linen border border-transparent'
                  }`}
                >
                  <User className="h-3 w-3" /> Client
                </button>
              </div>
            )}
          </div>

          {/* ── Messages Feed ── */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {activeMessages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <MessageSquare className="mx-auto h-10 w-10 text-muted/30 mb-2" />
                  <p className="text-sm font-medium text-ink">No messages yet</p>
                  <p className="text-xs text-muted mt-1">
                    {displayedConv.type === 'project_internal'
                      ? 'Internal team discussion — clients cannot see this.'
                      : displayedConv.type === 'project_client'
                      ? 'Shared with the client. Keep it professional.'
                      : 'Send a message below to start the conversation!'}
                  </p>
                </div>
              </div>
            ) : (
              activeMessages.map((msg) => {
                const sender = profiles.find((p) => p.id === msg.sender_id);
                const isMe = msg.sender_id === currentProfile.id;
                const reactions = messageReactions.filter((r) => r.message_id === msg.id);
                const replyParent = msg.parent_message_id
                  ? activeMessages.find((m) => m.id === msg.parent_message_id)
                  : null;
                const isHovered = hoveredMessageId === msg.id;

                return (
                  <div
                    key={msg.id}
                    className={`group flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}
                    onMouseEnter={() => setHoveredMessageId(msg.id)}
                    onMouseLeave={() => setHoveredMessageId(null)}
                  >
                    {/* Avatar */}
                    <UserAvatar
                      profile={sender || (isMe ? currentProfile : null)}
                      name={sender?.full_name || 'User'}
                      size="sm"
                      showRoleRing
                    />

                    <div className={`max-w-[70%] space-y-1 ${isMe ? 'items-end text-right' : ''}`}>
                      {/* Sender + time */}
                      <div className={`flex items-center gap-2 text-[11px] ${isMe ? 'justify-end' : ''}`}>
                        <span className="font-semibold text-ink">{isMe ? 'You' : sender?.full_name || 'User'}</span>
                        <span className="text-muted">{formatTime(msg.created_at)}</span>
                      </div>

                      {/* Reply context */}
                      {replyParent && (
                        <div className={`rounded border-l-2 border-gold bg-linen pl-2 pr-2 py-1 text-[10px] text-muted italic ${isMe ? 'text-right border-r-2 border-l-0 pr-2 pl-2' : ''}`}>
                          ↩ {replyParent.body.slice(0, 60)}{replyParent.body.length > 60 ? '…' : ''}
                        </div>
                      )}

                      {/* Bubble */}
                      <div
                        className={`inline-block rounded-xl px-3.5 py-2.5 text-xs leading-relaxed break-words text-left ${
                          isMe
                            ? 'bg-ink text-white rounded-tr-none'
                            : displayedConv.type === 'project_internal'
                            ? 'bg-amber-50 border border-amber-100 text-ink rounded-tl-none'
                            : displayedConv.type === 'project_client'
                            ? 'bg-purple-50 border border-purple-100 text-ink rounded-tl-none'
                            : 'bg-linen border border-border text-ink rounded-tl-none'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.body}</p>

                        {/* Attachments */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-2 space-y-1.5 border-t border-white/20 pt-2">
                            {msg.attachments.map((att) => (
                              <div
                                key={att.id}
                                className="flex items-center justify-between rounded bg-white/10 px-2 py-1.5 text-[11px]"
                              >
                                <span className="flex items-center gap-1.5 truncate">
                                  <FileText className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{att.file_name}</span>
                                </span>
                                <a
                                  href={att.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ml-2 font-bold underline text-gold"
                                >
                                  Open
                                </a>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Reactions row */}
                      <div className={`flex flex-wrap gap-1 pt-0.5 ${isMe ? 'justify-end' : ''}`}>
                        {EMOJI_LIST.slice(0, 5).map((emoji) => {
                          const count = reactions.filter((r) => r.emoji === emoji).length;
                          if (!count && !isHovered) return null;
                          return (
                            <button
                              key={emoji}
                              onClick={() => onToggleReaction(msg.id, emoji)}
                              className={`rounded-full border px-1.5 py-0.5 text-[11px] transition ${
                                count > 0
                                  ? 'bg-gold/20 border-gold/50 font-bold'
                                  : 'border-border hover:bg-black/5 opacity-60'
                              }`}
                            >
                              {emoji} {count > 0 ? count : ''}
                            </button>
                          );
                        })}

                        {/* Reply button — shows on hover */}
                        {isHovered && (
                          <button
                            onClick={() => setReplyingToMessage(msg)}
                            className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted hover:text-ink hover:bg-black/5 transition"
                          >
                            ↩ Reply
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* ── Pending attachments preview ── */}
          {pendingAttachments.length > 0 && (
            <div className="border-t border-border bg-linen/40 px-4 py-2 flex flex-wrap gap-2">
              {pendingAttachments.map((att, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2 py-1 text-xs font-medium text-ink"
                >
                  <Paperclip className="h-3 w-3 text-gold" />
                  {att.file_name}
                  <button
                    onClick={() => setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    className="ml-1 text-muted hover:text-danger"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* ── Reply indicator ── */}
          {replyingToMessage && (
            <div className="flex items-center justify-between border-t border-border bg-linen/40 px-4 py-1.5 text-[11px] text-muted">
              <span>
                ↩ Replying to{' '}
                <strong className="text-ink">
                  {profiles.find((p) => p.id === replyingToMessage.sender_id)?.full_name || 'User'}
                </strong>
                : {replyingToMessage.body.slice(0, 50)}
                {replyingToMessage.body.length > 50 ? '…' : ''}
              </span>
              <button
                onClick={() => setReplyingToMessage(null)}
                className="ml-2 text-muted hover:text-danger"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* ── Mention popover ── */}
          {showMentionPopover && (
            <div className="mx-4 mb-1 rounded-lg border border-border bg-white shadow-soft max-h-36 overflow-y-auto">
              <p className="px-3 py-1.5 text-[10px] font-bold uppercase text-muted">Mention Someone</p>
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setMessageInput((prev) => prev + `@${firstName(p.full_name)} `);
                    setShowMentionPopover(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-gold/10 text-left"
                >
                  <UserAvatar profile={p} size="xs" />
                  <span>
                    {p.full_name}
                    <span className="ml-1 text-muted">({roleLabels[p.role]})</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ── Composer ── */}
          <div className="border-t border-border bg-linen/20 p-3">
            <div className="rounded-xl border border-border bg-white focus-within:border-gold transition overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2.5">
                {/* Attach */}
                <label className="cursor-pointer shrink-0 rounded p-1 text-muted hover:text-ink hover:bg-black/5 transition">
                  <Paperclip className="h-4 w-4" />
                  <input type="file" onChange={handleFileUpload} className="hidden" />
                </label>

                {/* Mention */}
                <button
                  type="button"
                  onClick={() => setShowMentionPopover((v) => !v)}
                  className="shrink-0 rounded p-1 text-muted hover:text-ink hover:bg-black/5 transition"
                  title="Mention someone"
                >
                  <AtSign className="h-4 w-4" />
                </button>

                {/* Text input */}
                <input
                  type="text"
                  placeholder="Write a message…"
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
                    if (e.key === 'Escape') {
                      setShowMentionPopover(false);
                      setReplyingToMessage(null);
                    }
                  }}
                  className="flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted/60"
                />

                {/* Send */}
                <button
                  onClick={handleSend}
                  disabled={!messageInput.trim() && pendingAttachments.length === 0}
                  className="shrink-0 flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-gold/90 disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Send</span>
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-center p-8">
          <div>
            <MessageSquare className="mx-auto h-14 w-14 text-muted/25 mb-3" />
            <h3 className="font-display text-lg font-bold text-ink">Select a conversation</h3>
            <p className="text-xs text-muted max-w-xs mt-1">
              Choose a conversation from the left panel to begin.
            </p>
          </div>
        </div>
      )}
    </div>
  );

  /* ─────────────────────────────────────────────── */
  /* NEW MESSAGE DIALOG                              */
  /* ─────────────────────────────────────────────── */

  const newMsgDialog = showNewMsg && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-soft border border-border">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-base font-bold text-ink">+ New Message</h2>
          <button onClick={() => setShowNewMsg(false)} className="text-muted hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Type selector */}
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5 uppercase tracking-wider">
              Message Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: 'dm', label: 'Direct Message', icon: User },
                  { value: 'channel', label: 'Team Channel', icon: Hash },
                  { value: 'project_internal', label: 'Project (Internal)', icon: Lock },
                  { value: 'project_client', label: 'Project (Client)', icon: Users },
                ] as const
              ).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setNewMsgType(value)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition ${
                    newMsgType === value
                      ? 'border-gold bg-gold/10 text-ink font-bold'
                      : 'border-border text-muted hover:border-ink/30 hover:text-ink'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Conditional target selector */}
          {newMsgType === 'dm' && (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5 uppercase tracking-wider">
                Send To
              </label>
              <select
                value={newMsgTargetUser}
                onChange={(e) => setNewMsgTargetUser(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-ink outline-none focus:border-gold"
              >
                <option value="">Select team member…</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name} ({roleLabels[m.role]})
                  </option>
                ))}
              </select>
            </div>
          )}

          {newMsgType === 'channel' && (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5 uppercase tracking-wider">
                Channel
              </label>
              <select
                value={newMsgChannel}
                onChange={(e) => setNewMsgChannel(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-ink outline-none focus:border-gold"
              >
                {TEAM_CHANNELS.map((ch) => (
                  <option key={ch.name} value={ch.name}>
                    #{ch.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(newMsgType === 'project_internal' || newMsgType === 'project_client') && (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5 uppercase tracking-wider">
                Project
              </label>
              <select
                value={newMsgTargetProject}
                onChange={(e) => setNewMsgTargetProject(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-ink outline-none focus:border-gold"
              >
                <option value="">Select project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_title} ({p.client_name})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Security note for client messages */}
          {newMsgType === 'project_client' && (
            <p className="flex items-start gap-1.5 rounded-lg bg-purple-50 border border-purple-100 px-3 py-2 text-[11px] text-purple-800">
              <User className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              This conversation is shared with the client. Internal messages will NOT be visible to them.
            </p>
          )}

          {newMsgType === 'project_internal' && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-[11px] text-amber-800">
              <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Internal conversations are never visible to clients.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={() => setShowNewMsg(false)}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-muted hover:text-ink transition"
          >
            Cancel
          </button>
          <button
            onClick={handleNewMsgSend}
            className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-xs font-bold text-ink hover:bg-gold/90 transition"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Open Conversation
          </button>
        </div>
      </div>
    </div>
  );

  /* ─────────────────────────────────────────────── */
  /* ROOT LAYOUT                                     */
  /* ─────────────────────────────────────────────── */

  return (
    <>
      {newMsgDialog}

      <div className="flex flex-col h-[calc(100vh-140px)] overflow-hidden rounded-xl border border-border bg-white shadow-sm">

        {/* ── Top Bar ── */}
        <div className="flex items-center justify-between gap-3 border-b border-border bg-linen/40 px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-gold shrink-0" />
            <h2 className="font-display text-base font-bold text-ink hidden sm:block">Messages</h2>
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search people, projects, messages…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-border bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-gold transition"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* New Message */}
          {!isClient && (
            <button
              onClick={() => setShowNewMsg(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-bold text-ink hover:bg-gold/90 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">New Message</span>
            </button>
          )}
        </div>

        {/* ── Two-column body ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── LEFT SIDEBAR ── */}
          <div
            className={`flex-col w-72 shrink-0 border-r border-border bg-linen/30 ${
              mobileShowConv ? 'hidden md:flex' : 'flex'
            }`}
          >
            {sidebarContent}
          </div>

          {/* ── RIGHT PANEL ── */}
          <div
            className={`flex-col flex-1 min-w-0 ${
              mobileShowConv ? 'flex' : 'hidden md:flex'
            }`}
          >
            {convPanel}
          </div>
        </div>
      </div>
    </>
  );
}
