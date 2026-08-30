import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  AtSign,
  BellOff,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  ExternalLink,
  FileText,
  FolderKanban,
  Hash,
  Info,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Reply,
  Search,
  Send,
  Smile,
  User,
  Users,
  X,
} from 'lucide-react';
import type {
  ChatMessage,
  Conversation,
  ConversationMember,
  Priority,
  Profile,
  Project,
  Task,
  TaskDraft,
  TrackerData,
} from '../lib/types';
import { firstName, initials, isClientRole } from '../lib/utils';
import { roleLabels } from '../lib/constants';
import { UserAvatar } from '../components/UserAvatar';

/* ═══════════════════════════════════════════════════════════════
   TYPES & CONSTANTS
═══════════════════════════════════════════════════════════════ */

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
  onCreateTask?: (draft: TaskDraft) => Promise<void>;
  jumpToConversationId?: string | null;
  onJumpHandled?: () => void;
}

const EMOJI_LIST = ['👍', '❤️', '🎉', '😄', '🚀', '👀', '✅', '🔥', '💯', '😮', '🙏', '😢'];

const TEAM_CHANNELS = [
  { name: 'general', desc: 'Company announcements and general team chat' },
  { name: 'formatting', desc: 'Print layout and book interior formatting discussions' },
  { name: 'covers', desc: 'Cover design files, concepts, and revisions' },
  { name: 'qc', desc: 'Final quality control and proof checking' },
  { name: 'announcements', desc: 'Important project and office announcements' },
];

type FilterMode = 'all' | 'unread' | 'mentions';
type ConvTab = 'chat' | 'files' | 'tasks' | 'details';
type NewMsgType = 'dm' | 'channel' | 'project_internal' | 'project_client';
type MobilePanel = 'list' | 'chat' | 'context';

/* ═══════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════ */

function relativeTime(isoStr: string): string {
  try {
    const date = new Date(isoStr);
    const diffMs = Date.now() - date.getTime();
    const m = Math.floor(diffMs / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function formatTime(isoStr: string): string {
  try {
    const date = new Date(isoStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return timeStr;
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    if (date.toDateString() === yest.toDateString()) return `Yesterday ${timeStr}`;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  } catch { return ''; }
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fileIcon(ext: string): string {
  const t = ext.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(t)) return '🖼️';
  if (t === 'pdf') return '📄';
  if (['doc', 'docx'].includes(t)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(t)) return '📊';
  if (['ppt', 'pptx'].includes(t)) return '📊';
  if (['zip', 'rar', '7z', 'tar'].includes(t)) return '🗜️';
  return '📎';
}

function priorityColor(p: Priority): string {
  if (p === 'Urgent') return 'text-red-700 bg-red-50 border-red-200';
  if (p === 'High') return 'text-orange-700 bg-orange-50 border-orange-200';
  if (p === 'Low') return 'text-stone-600 bg-stone-50 border-stone-200';
  return 'text-blue-700 bg-blue-50 border-blue-200';
}

/* ═══════════════════════════════════════════════════════════════
   SUB-COMPONENTS
═══════════════════════════════════════════════════════════════ */

/** Single conversation row in the left sidebar */
function ConvRow({
  icon, name, subtitle, lastMsg, lastTime, unreadCount, isSelected, onClick,
}: {
  icon: React.ReactNode;
  name: string;
  subtitle?: string;
  lastMsg?: string;
  lastTime?: string;
  unreadCount?: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all ${
        isSelected
          ? 'bg-gold/12 border-l-2 border-gold ml-0 pl-2'
          : 'border-l-2 border-transparent hover:bg-black/5'
      }`}
    >
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className={`truncate text-xs font-semibold ${isSelected ? 'text-ink' : 'text-ink/85'}`}>
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
      </div>
    </button>
  );
}

/** Collapsible section header */
function SidebarSection({
  label, count, collapsed, onToggle, children,
}: {
  label: string; count?: number; collapsed: boolean;
  onToggle: () => void; children: React.ReactNode;
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

/** Create Task from Message modal */
function CreateTaskModal({
  message, projects, profiles, defaultProjectId, onClose, onSubmit,
}: {
  message: ChatMessage;
  projects: Project[];
  profiles: Profile[];
  defaultProjectId?: string | null;
  onClose: () => void;
  onSubmit: (draft: TaskDraft) => Promise<void>;
}) {
  const [title, setTitle] = useState(message.body.slice(0, 80));
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [assignedTo, setAssignedTo] = useState('');
  const [priority, setPriority] = useState<Priority>('Normal');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState(`From message:\n"${message.body}"`);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const teamProfiles = profiles.filter(p => p.role !== 'client');

  async function handleSubmit() {
    if (!title.trim()) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description,
        project_id: projectId || null,
        assigned_to: assignedTo || null,
        status: 'To Do',
        priority,
        due_date: dueDate || null,
      });
      onClose();
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-soft border border-border">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-gold" />
            <h2 className="font-display text-base font-bold text-ink">Create Task</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink"><X className="h-4 w-4" /></button>
        </div>

        {/* Original message quote */}
        <div className="mx-5 mt-4 rounded-lg border-l-2 border-gold bg-linen px-3 py-2 text-xs text-muted italic">
          "{message.body.slice(0, 120)}{message.body.length > 120 ? '…' : ''}"
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Task Title *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none focus:border-gold"
              placeholder="Task title..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Project</label>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink outline-none focus:border-gold"
              >
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.project_title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Assign To</label>
              <select
                value={assignedTo}
                onChange={e => setAssignedTo(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink outline-none focus:border-gold"
              >
                <option value="">Unassigned</option>
                {teamProfiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as Priority)}
                className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink outline-none focus:border-gold"
              >
                {(['Low', 'Normal', 'High', 'Urgent'] as Priority[]).map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink outline-none focus:border-gold"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink outline-none focus:border-gold resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-semibold text-muted hover:text-ink transition">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || isSubmitting}
            className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-xs font-bold text-ink hover:bg-gold/90 transition disabled:opacity-40"
          >
            <CheckSquare className="h-3.5 w-3.5" />
            {isSubmitting ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** New Message dialog */
function NewMessageModal({
  teamMembers, projects, channels, onClose, onOpen,
}: {
  teamMembers: Profile[];
  projects: Project[];
  channels: typeof TEAM_CHANNELS;
  onClose: () => void;
  onOpen: (type: NewMsgType, targetId: string) => void;
}) {
  const [type, setType] = useState<NewMsgType>('dm');
  const [targetUser, setTargetUser] = useState('');
  const [targetProject, setTargetProject] = useState('');
  const [targetChannel, setTargetChannel] = useState('general');

  function handleOpen() {
    if (type === 'dm' && targetUser) onOpen('dm', targetUser);
    else if (type === 'channel') onOpen('channel', targetChannel);
    else if (type === 'project_internal' && targetProject) onOpen('project_internal', targetProject);
    else if (type === 'project_client' && targetProject) onOpen('project_client', targetProject);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-soft border border-border">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-base font-bold text-ink flex items-center gap-2">
            <Plus className="h-4 w-4 text-gold" /> New Message
          </h2>
          <button onClick={onClose} className="text-muted hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">Message Type</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'dm', label: 'Direct Message', icon: User },
                { value: 'channel', label: 'Team Channel', icon: Hash },
                { value: 'project_internal', label: 'Project (Internal)', icon: Lock },
                { value: 'project_client', label: 'Project (Client)', icon: Users },
              ] as const).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setType(value)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition ${
                    type === value ? 'border-gold bg-gold/10 text-ink font-bold' : 'border-border text-muted hover:border-ink/30'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
            </div>
          </div>
          {type === 'dm' && (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Send To</label>
              <select value={targetUser} onChange={e => setTargetUser(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink outline-none focus:border-gold">
                <option value="">Select team member…</option>
                {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name} ({roleLabels[m.role]})</option>)}
              </select>
            </div>
          )}
          {type === 'channel' && (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Channel</label>
              <select value={targetChannel} onChange={e => setTargetChannel(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink outline-none focus:border-gold">
                {channels.map(ch => <option key={ch.name} value={ch.name}>#{ch.name}</option>)}
              </select>
            </div>
          )}
          {(type === 'project_internal' || type === 'project_client') && (
            <>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Project</label>
                <select value={targetProject} onChange={e => setTargetProject(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink outline-none focus:border-gold">
                  <option value="">Select project…</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.project_title} ({p.client_name})</option>)}
                </select>
              </div>
              <p className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-[11px] ${
                type === 'project_internal'
                  ? 'bg-amber-50 border border-amber-100 text-amber-800'
                  : 'bg-purple-50 border border-purple-100 text-purple-800'
              }`}>
                {type === 'project_internal'
                  ? <><Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" /> Internal — never visible to clients.</>
                  : <><User className="h-3.5 w-3.5 shrink-0 mt-0.5" /> Shared with the client. Internal messages remain private.</>}
              </p>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-semibold text-muted hover:text-ink transition">Cancel</button>
          <button
            onClick={handleOpen}
            className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-xs font-bold text-ink hover:bg-gold/90 transition"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Open Conversation
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */

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
  onCreateTask,
  jumpToConversationId,
  onJumpHandled,
}: CommunicationPageProps) {
  const isClient = isClientRole(currentProfile.role);

  /* ── Raw data ── */
  const allConversations: Conversation[] = useMemo(() => {
    const raw = data.conversations || [];
    if (isClient) {
      const clientProjIds = new Set(projects.map(p => p.id));
      return raw.filter(c => c.type === 'project_client' && c.project_id && clientProjIds.has(c.project_id));
    }
    return raw;
  }, [data.conversations, isClient, projects]);

  const messages = useMemo(() => data.messages || [], [data.messages]);
  const conversationMembers: ConversationMember[] = useMemo(() => data.conversationMembers || [], [data.conversationMembers]);
  const messageReactions = useMemo(() => data.messageReactions || [], [data.messageReactions]);
  const messageMentions = useMemo(() => data.messageMentions || [], [data.messageMentions]);
  const messageAttachments = useMemo(() => data.messageAttachments || [], [data.messageAttachments]);
  const allTasks = useMemo(() => data.tasks || [], [data.tasks]);

  /* ── Derived helpers ── */
  const teamMembers = useMemo(
    () => profiles.filter(p => p.role !== 'client' && p.id !== currentProfile.id),
    [profiles, currentProfile.id],
  );

  /* Unread counts */
  const unreadCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    const mine = conversationMembers.filter(m => m.user_id === currentProfile.id);
    for (const m of mine) {
      const lastRead = m.last_read_at ? new Date(m.last_read_at).getTime() : 0;
      map[m.conversation_id] = messages.filter(
        msg => msg.conversation_id === m.conversation_id &&
          msg.sender_id !== currentProfile.id &&
          new Date(msg.created_at).getTime() > lastRead,
      ).length;
    }
    return map;
  }, [conversationMembers, messages, currentProfile.id]);

  const totalUnread = useMemo(() => Object.values(unreadCountMap).reduce((s, n) => s + n, 0), [unreadCountMap]);

  /* Mention conv IDs */
  const mentionConvIds = useMemo(() => {
    const mine = conversationMembers.filter(m => m.user_id === currentProfile.id);
    const mentionedMsgIds = new Set(messageMentions.filter(m => m.user_id === currentProfile.id).map(m => m.message_id));
    const ids = new Set<string>();
    for (const m of mine) {
      const lastRead = m.last_read_at ? new Date(m.last_read_at).getTime() : 0;
      const has = messages.some(msg =>
        msg.conversation_id === m.conversation_id &&
        msg.sender_id !== currentProfile.id &&
        new Date(msg.created_at).getTime() > lastRead &&
        mentionedMsgIds.has(msg.id)
      );
      if (has) ids.add(m.conversation_id);
    }
    return ids;
  }, [conversationMembers, messageMentions, messages, currentProfile.id]);

  const totalMentions = mentionConvIds.size;

  /* ── UI State ── */
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectConvMode, setProjectConvMode] = useState<'internal' | 'client'>('internal');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState<string | null>(null);
  const [menuMsgId, setMenuMsgId] = useState<string | null>(null);
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<
    { file_name: string; file_url: string; file_type: string; file_size: number }[]
  >([]);
  const [showNewMsg, setShowNewMsg] = useState(false);
  const [createTaskMessage, setCreateTaskMessage] = useState<ChatMessage | null>(null);
  const [activeConvTab, setActiveConvTab] = useState<ConvTab>('chat');
  const [contextPanelOpen, setContextPanelOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('list');
  // sidebar collapse state
  const [dmsCollapsed, setDmsCollapsed] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [channelsCollapsed, setChannelsCollapsed] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const emojiRef = useRef<HTMLDivElement | null>(null);

  /* ── Auto-select first conversation ── */
  useEffect(() => {
    if (!activeConversationId && allConversations.length > 0) {
      setActiveConversationId(allConversations[0].id);
    }
  }, [allConversations, activeConversationId]);

  /* ── Jump to specific conversation from notification ── */
  useEffect(() => {
    if (!jumpToConversationId) return;
    const conv = allConversations.find(c => c.id === jumpToConversationId);
    if (!conv) return;
    setActiveConversationId(jumpToConversationId);
    setActiveConvTab('chat');
    setMobilePanel('chat');
    if (conv.project_id) {
      setActiveProjectId(conv.project_id);
      setProjectConvMode(conv.type === 'project_internal' ? 'internal' : 'client');
    } else {
      setActiveProjectId(null);
    }
    onMarkRead(jumpToConversationId).catch(() => {});
    onJumpHandled?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToConversationId]);

  /* ── Scroll to bottom on new messages ── */
  useEffect(() => {
    if (activeConvTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeConversationId, messages.length, activeConvTab]);

  /* ── Close emoji/menu on outside click ── */
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuMsgId(null);
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setEmojiPickerMsgId(null);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  /* ── Active conversation ── */
  const activeConv = useMemo(() => {
    const found = allConversations.find(c => c.id === activeConversationId);
    if (!found) return null;
    if (isClient && (found.type !== 'project_client' || !projects.some(p => p.id === found.project_id))) return null;
    return found;
  }, [allConversations, activeConversationId, isClient, projects]);

  /* ── For project conversations: resolve displayed conv based on mode ── */
  const displayedConv = useMemo(() => {
    if (!activeProjectId) return activeConv;
    const type = projectConvMode === 'internal' ? 'project_internal' : 'project_client';
    return allConversations.find(c => c.project_id === activeProjectId && c.type === type) || activeConv;
  }, [activeProjectId, projectConvMode, allConversations, activeConv]);

  const activeProject = useMemo(() => {
    const pid = displayedConv?.project_id || activeProjectId;
    if (!pid) return null;
    return projects.find(p => p.id === pid) || null;
  }, [displayedConv, activeProjectId, projects]);

  /* ── Messages for displayed conversation ── */
  const activeMessages = useMemo(() => {
    if (!displayedConv) return [];
    if (isClient && displayedConv.type !== 'project_client') return [];
    return messages
      .filter(m => m.conversation_id === displayedConv.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [messages, displayedConv, isClient]);

  /* ── Attachments for current conversation ── */
  const convAttachments = useMemo(() => {
    if (!displayedConv) return [];
    const convMsgIds = new Set(activeMessages.map(m => m.id));
    return messageAttachments.filter(a => convMsgIds.has(a.message_id));
  }, [displayedConv, activeMessages, messageAttachments]);

  /* ── Tasks linked to active project ── */
  const convTasks = useMemo(() => {
    if (!activeProject) return [];
    return allTasks.filter(t => t.project_id === activeProject.id);
  }, [activeProject, allTasks]);

  /* ── Members of displayed conversation ── */
  const convMemberProfiles = useMemo(() => {
    if (!displayedConv) return [];
    const memberIds = new Set(
      conversationMembers.filter(m => m.conversation_id === displayedConv.id).map(m => m.user_id)
    );
    return profiles.filter(p => memberIds.has(p.id));
  }, [displayedConv, conversationMembers, profiles]);

  /* ── Is project conversation ── */
  const isProjectConv = displayedConv?.type === 'project_internal' || displayedConv?.type === 'project_client';

  /* ── Last message helper ── */
  function lastMsgFor(convId: string) {
    return messages
      .filter(m => m.conversation_id === convId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null;
  }

  /* ── Filter helpers ── */
  function convPassesFilter(convId: string) {
    if (filterMode === 'unread') return (unreadCountMap[convId] || 0) > 0;
    if (filterMode === 'mentions') return mentionConvIds.has(convId);
    return true;
  }

  const sl = searchTerm.toLowerCase();
  function matchesSearch(text: string) { return !sl || text.toLowerCase().includes(sl); }
  function convMatchesSearch(conv: Conversation, name: string) {
    if (!sl) return true;
    if (name.toLowerCase().includes(sl)) return true;
    const last = lastMsgFor(conv.id);
    return !!(last && last.body.toLowerCase().includes(sl));
  }

  /* ── Navigation handlers ── */
  async function selectConversation(convId: string) {
    setActiveConversationId(convId);
    setActiveProjectId(null);
    setActiveConvTab('chat');
    setMobilePanel('chat');
    try { await onMarkRead(convId); } catch {}
  }

  async function selectProjectConv(projectId: string, mode: 'internal' | 'client') {
    setActiveProjectId(projectId);
    setProjectConvMode(mode);
    setActiveConvTab('chat');
    setMobilePanel('chat');
    try {
      const conv = await onGetOrCreateProjectConversation(projectId, mode === 'internal');
      setActiveConversationId(conv.id);
      await onMarkRead(conv.id);
    } catch {}
  }

  async function selectChannel(channelName: string) {
    const existing = allConversations.find(c => c.type === 'team_channel' && c.name === channelName);
    if (existing) {
      setActiveConversationId(existing.id);
      setActiveProjectId(null);
      setActiveConvTab('chat');
      setMobilePanel('chat');
      try { await onMarkRead(existing.id); } catch {}
    }
  }

  async function selectDM(userId: string) {
    try {
      const conv = await onGetOrCreateDM(userId);
      setActiveConversationId(conv.id);
      setActiveProjectId(null);
      setActiveConvTab('chat');
      setMobilePanel('chat');
      await onMarkRead(conv.id);
    } catch {}
  }

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
    try { await onSendMessage(displayedConv.id, body, atts, replyId); }
    catch (err) { console.error('Send failed:', err); }
  }

  /* ── File attachment ── */
  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    setPendingAttachments(prev => [...prev, {
      file_name: file.name,
      file_url: URL.createObjectURL(file),
      file_type: file.name.split('.').pop() || 'file',
      file_size: file.size,
    }]);
    event.target.value = '';
  }

  /* ── New message open ── */
  async function handleNewMsgOpen(type: NewMsgType, id: string) {
    try {
      if (type === 'dm') await selectDM(id);
      else if (type === 'channel') await selectChannel(id);
      else if (type === 'project_internal') await selectProjectConv(id, 'internal');
      else if (type === 'project_client') await selectProjectConv(id, 'client');
    } catch {}
  }

  /* ── Header name ── */
  const headerName = useMemo(() => {
    if (!displayedConv) return '';
    if (displayedConv.type === 'team_channel') return `#${displayedConv.name}`;
    if (displayedConv.type === 'dm') {
      const other = conversationMembers
        .filter(m => m.conversation_id === displayedConv.id && m.user_id !== currentProfile.id)
        .map(m => profiles.find(p => p.id === m.user_id))
        .filter(Boolean)[0];
      return other?.full_name || 'Direct Message';
    }
    return activeProject?.project_title || 'Project Discussion';
  }, [displayedConv, conversationMembers, currentProfile.id, profiles, activeProject]);

  /* ════════════════════════════════════════════════════
     SIDEBAR CONTENT
  ════════════════════════════════════════════════════ */

  const dmConvs = useMemo(() => {
    if (isClient) return [];
    return teamMembers.map(member => {
      const conv = allConversations.find(c =>
        c.type === 'dm' &&
        conversationMembers.some(m => m.conversation_id === c.id && m.user_id === member.id) &&
        conversationMembers.some(m => m.conversation_id === c.id && m.user_id === currentProfile.id)
      );
      return { member, conv };
    });
  }, [isClient, teamMembers, allConversations, conversationMembers, currentProfile.id]);

  const projectConvItems = useMemo(() => {
    if (isClient) return [];
    return projects.map(proj => {
      const internal = allConversations.find(c => c.type === 'project_internal' && c.project_id === proj.id);
      const client = allConversations.find(c => c.type === 'project_client' && c.project_id === proj.id);
      const lastI = internal ? lastMsgFor(internal.id) : null;
      const lastC = client ? lastMsgFor(client.id) : null;
      const effectiveLast = !lastI ? lastC : !lastC ? lastI :
        new Date(lastI.created_at) > new Date(lastC.created_at) ? lastI : lastC;
      const unread = (internal ? unreadCountMap[internal.id] || 0 : 0) + (client ? unreadCountMap[client.id] || 0 : 0);
      return { proj, internalConv: internal, clientConv: client, effectiveLast, unread };
    });
  }, [isClient, projects, allConversations, unreadCountMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const sidebar = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search conversations…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-border bg-white pl-8 pr-3 py-1.5 text-xs outline-none focus:border-gold"
          />
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
        {(['all', 'unread', 'mentions'] as FilterMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => setFilterMode(mode)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              filterMode === mode ? 'bg-ink text-gold' : 'text-muted hover:text-ink hover:bg-black/5'
            }`}
          >
            {mode === 'all' ? 'All' : mode === 'unread' ? `Unread${totalUnread > 0 ? ` ${totalUnread}` : ''}` : `Mentions${totalMentions > 0 ? ` ${totalMentions}` : ''}`}
          </button>
        ))}
      </div>

      {/* Lists */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">

        {/* CLIENT VIEW */}
        {isClient && allConversations
          .filter(c => c.type === 'project_client' && c.project_id)
          .filter(c => convPassesFilter(c.id))
          .map(c => {
            const proj = projects.find(p => p.id === c.project_id);
            const last = lastMsgFor(c.id);
            return (
              <ConvRow
                key={c.id}
                icon={<div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gold/20"><FolderKanban className="h-3.5 w-3.5 text-gold" /></div>}
                name={proj?.project_title || 'Project'}
                subtitle={proj?.client_name}
                lastMsg={last?.body}
                lastTime={last ? relativeTime(last.created_at) : undefined}
                unreadCount={unreadCountMap[c.id] || 0}
                isSelected={activeConversationId === c.id}
                onClick={() => selectConversation(c.id)}
              />
            );
          })}

        {/* TEAM VIEW */}
        {!isClient && (
          <>
            {/* DIRECT MESSAGES */}
            <SidebarSection
              label="Direct Messages"
              count={dmConvs.filter(({ conv }) => conv && (unreadCountMap[conv.id] || 0) > 0).length}
              collapsed={dmsCollapsed}
              onToggle={() => setDmsCollapsed(v => !v)}
            >
              {dmConvs
                .filter(({ member }) => matchesSearch(member.full_name))
                .filter(({ conv }) => !conv || convPassesFilter(conv.id))
                .map(({ member, conv }) => {
                  const last = conv ? lastMsgFor(conv.id) : null;
                  return (
                    <ConvRow
                      key={member.id}
                      icon={<UserAvatar profile={member} size="xs" showStatusDot isOnline />}
                      name={member.full_name}
                      subtitle={roleLabels[member.role]}
                      lastMsg={last?.body}
                      lastTime={last ? relativeTime(last.created_at) : undefined}
                      unreadCount={conv ? unreadCountMap[conv.id] || 0 : 0}
                      isSelected={!activeProjectId && conv?.id === activeConversationId}
                      onClick={() => selectDM(member.id)}
                    />
                  );
                })}
            </SidebarSection>

            {/* PROJECT CONVERSATIONS */}
            <SidebarSection
              label="Project Conversations"
              count={projectConvItems.filter(p => p.unread > 0).length}
              collapsed={projectsCollapsed}
              onToggle={() => setProjectsCollapsed(v => !v)}
            >
              {projectConvItems
                .filter(({ proj }) => matchesSearch(proj.project_title) || matchesSearch(proj.client_name))
                .filter(({ internalConv, clientConv }) => {
                  if (filterMode === 'all') return true;
                  return [internalConv?.id, clientConv?.id].filter(Boolean).some(id => convPassesFilter(id!));
                })
                .map(({ proj, effectiveLast, unread }) => (
                  <ConvRow
                    key={proj.id}
                    icon={
                      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gold/15">
                        <FolderKanban className="h-3.5 w-3.5 text-gold" />
                      </div>
                    }
                    name={proj.project_title}
                    subtitle={proj.client_name}
                    lastMsg={effectiveLast?.body}
                    lastTime={effectiveLast ? relativeTime(effectiveLast.created_at) : undefined}
                    unreadCount={unread}
                    isSelected={activeProjectId === proj.id}
                    onClick={() => selectProjectConv(proj.id, 'internal')}
                  />
                ))}
            </SidebarSection>

            {/* CHANNELS */}
            <SidebarSection
              label="Channels"
              collapsed={channelsCollapsed}
              onToggle={() => setChannelsCollapsed(v => !v)}
            >
              {TEAM_CHANNELS.filter(ch => matchesSearch(ch.name)).map(ch => {
                const conv = allConversations.find(c => c.type === 'team_channel' && c.name === ch.name);
                const last = conv ? lastMsgFor(conv.id) : null;
                const unread = conv ? unreadCountMap[conv.id] || 0 : 0;
                if (conv && filterMode !== 'all' && !convPassesFilter(conv.id)) return null;
                return (
                  <ConvRow
                    key={ch.name}
                    icon={<div className="grid h-7 w-7 place-items-center rounded bg-linen border border-border"><Hash className="h-3.5 w-3.5 text-muted" /></div>}
                    name={`#${ch.name}`}
                    lastMsg={last?.body}
                    lastTime={last ? relativeTime(last.created_at) : undefined}
                    unreadCount={unread}
                    isSelected={!activeProjectId && conv?.id === activeConversationId}
                    onClick={() => selectChannel(ch.name)}
                  />
                );
              })}
            </SidebarSection>
          </>
        )}
      </div>
    </div>
  );

  /* ════════════════════════════════════════════════════
     MAIN CONVERSATION PANEL
  ════════════════════════════════════════════════════ */

  // Conversation type badge
  function convTypeBadge() {
    if (!displayedConv) return null;
    if (displayedConv.type === 'project_internal') return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
        <Lock className="h-2.5 w-2.5" /> INTERNAL
      </span>
    );
    if (displayedConv.type === 'project_client') return (
      <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800">
        <User className="h-2.5 w-2.5" /> CLIENT
      </span>
    );
    if (displayedConv.type === 'dm') return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">
        <User className="h-2.5 w-2.5" /> DM
      </span>
    );
    if (displayedConv.type === 'team_channel') return (
      <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-700">
        <Hash className="h-2.5 w-2.5" /> CHANNEL
      </span>
    );
    return null;
  }

  // Tasks count for tab badge
  const tasksTabCount = convTasks.filter(t => t.status !== 'Done').length;
  // Files count
  const filesTabCount = convAttachments.length;

  const mainPanel = (
    <div className="flex flex-1 flex-col bg-white min-h-0">
      {displayedConv ? (
        <>
          {/* ─── HEADER ─── */}
          <div className="shrink-0 border-b border-border bg-white">
            <div className="flex items-start justify-between gap-3 px-5 py-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* Mobile back */}
                <button className="md:hidden shrink-0 text-muted hover:text-ink" onClick={() => setMobilePanel('list')}>
                  <ArrowLeft className="h-5 w-5" />
                </button>
                {/* Icon */}
                <div className={`shrink-0 grid h-9 w-9 place-items-center rounded-lg ${
                  displayedConv.type === 'team_channel' ? 'bg-stone-100 text-stone-600'
                  : displayedConv.type === 'dm' ? 'bg-blue-50 text-blue-600'
                  : displayedConv.type === 'project_internal' ? 'bg-amber-50 text-amber-700'
                  : 'bg-purple-50 text-purple-700'
                }`}>
                  {displayedConv.type === 'team_channel' ? <Hash className="h-4 w-4" />
                  : displayedConv.type === 'dm' ? <User className="h-4 w-4" />
                  : <FolderKanban className="h-4 w-4" />}
                </div>
                {/* Name + badge */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base font-bold text-ink truncate">{headerName}</h3>
                    {convTypeBadge()}
                  </div>
                  {activeProject && (
                    <p className="text-[11px] text-muted truncate">
                      {activeProject.client_name}
                      {activeProject.current_stage ? ` · ${activeProject.current_stage}` : ''}
                    </p>
                  )}
                  {displayedConv.type === 'dm' && (() => {
                    const other = conversationMembers
                      .filter(m => m.conversation_id === displayedConv.id && m.user_id !== currentProfile.id)
                      .map(m => profiles.find(p => p.id === m.user_id)).filter(Boolean)[0];
                    return other ? <p className="text-[11px] text-muted">{roleLabels[other.role]}</p> : null;
                  })()}
                </div>
              </div>

              {/* Right actions */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Member avatars */}
                {convMemberProfiles.length > 0 && (
                  <div className="hidden sm:flex items-center">
                    {convMemberProfiles.slice(0, 4).map((p, i) => (
                      <div key={p.id} className="relative" style={{ marginLeft: i > 0 ? '-8px' : 0 }}>
                        <UserAvatar profile={p} size="xs" className="ring-2 ring-white" />
                      </div>
                    ))}
                    {convMemberProfiles.length > 4 && (
                      <span className="ml-1 text-[10px] text-muted font-semibold">+{convMemberProfiles.length - 4}</span>
                    )}
                  </div>
                )}
                {/* Open project */}
                {activeProject && onOpenProject && (
                  <button
                    onClick={() => onOpenProject(activeProject.id)}
                    className="hidden sm:flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:bg-linen transition"
                  >
                    <ExternalLink className="h-3 w-3 text-gold" /> Open Project
                  </button>
                )}
                {/* Info / context panel toggle */}
                <button
                  onClick={() => setContextPanelOpen(v => !v)}
                  className={`rounded-lg p-2 transition ${contextPanelOpen ? 'bg-gold/15 text-ink' : 'text-muted hover:text-ink hover:bg-black/5'}`}
                  title="Conversation info"
                >
                  <Info className="h-4 w-4" />
                </button>
                {/* Mobile context */}
                <button
                  className="md:hidden rounded-lg p-2 text-muted hover:text-ink"
                  onClick={() => setMobilePanel('context')}
                >
                  <Info className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Project context bar */}
            {isProjectConv && activeProject && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 bg-linen/30 px-5 py-2 text-[11px]">
                {activeProject.current_stage && <span className="text-muted">Stage: <strong className="text-ink">{activeProject.current_stage}</strong></span>}
                {activeProject.status && <span className="text-muted">Status: <strong className="text-ink">{activeProject.status}</strong></span>}
                {activeProject.waiting_on && activeProject.waiting_on !== 'None' && <span className="text-muted">Waiting: <strong className="text-ink">{activeProject.waiting_on}</strong></span>}
                {activeProject.revision_count && activeProject.revision_count > 0 ? <span className="text-muted">Rev: <strong className="text-ink">#{activeProject.revision_count}</strong></span> : null}
              </div>
            )}

            {/* Internal/Client toggle */}
            {isProjectConv && !isClient && activeProjectId && (
              <div className="flex gap-1 border-t border-border/50 px-5 py-2">
                <button
                  onClick={() => switchProjectConvMode('internal')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition ${
                    projectConvMode === 'internal' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'text-muted hover:bg-linen border border-transparent'
                  }`}
                >
                  <Lock className="h-3 w-3" /> Internal
                </button>
                <button
                  onClick={() => switchProjectConvMode('client')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition ${
                    projectConvMode === 'client' ? 'bg-purple-100 text-purple-800 border border-purple-200' : 'text-muted hover:bg-linen border border-transparent'
                  }`}
                >
                  <User className="h-3 w-3" /> Client
                </button>
              </div>
            )}

            {/* Sub-tabs */}
            <div className="flex gap-0 border-t border-border/50 px-5">
              {([
                { id: 'chat', label: 'Chat' },
                { id: 'files', label: `Files${filesTabCount > 0 ? ` (${filesTabCount})` : ''}` },
                { id: 'tasks', label: `Tasks${tasksTabCount > 0 ? ` (${tasksTabCount})` : ''}` },
                { id: 'details', label: 'Details' },
              ] as { id: ConvTab; label: string }[]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveConvTab(tab.id)}
                  className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
                    activeConvTab === tab.id
                      ? 'border-gold text-gold'
                      : 'border-transparent text-muted hover:text-ink'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* ─── TAB CONTENT ─── */}

          {/* CHAT TAB */}
          {activeConvTab === 'chat' && (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {activeMessages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center">
                    <div>
                      <MessageSquare className="mx-auto h-10 w-10 text-muted/30 mb-2" />
                      <p className="text-sm font-medium text-ink">No messages yet</p>
                      <p className="text-xs text-muted mt-1">
                        {displayedConv.type === 'project_internal' ? 'Internal team discussion — clients cannot see this.' : 'Send a message below to start.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  activeMessages.map(msg => {
                    const sender = profiles.find(p => p.id === msg.sender_id);
                    const isMe = msg.sender_id === currentProfile.id;
                    const reactions = messageReactions.filter(r => r.message_id === msg.id);
                    const replyParent = msg.parent_message_id ? activeMessages.find(m => m.id === msg.parent_message_id) : null;
                    const isHovered = hoveredMessageId === msg.id;
                    const showEmojiPicker = emojiPickerMsgId === msg.id;
                    const showMenu = menuMsgId === msg.id;

                    // Group emoji reactions
                    const reactionGroups: Record<string, number> = {};
                    reactions.forEach(r => { reactionGroups[r.emoji] = (reactionGroups[r.emoji] || 0) + 1; });

                    return (
                      <div
                        key={msg.id}
                        className={`relative flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}
                        onMouseEnter={() => setHoveredMessageId(msg.id)}
                        onMouseLeave={() => { setHoveredMessageId(null); }}
                      >
                        <UserAvatar profile={sender || (isMe ? currentProfile : null)} name={sender?.full_name} size="sm" showRoleRing />
                        <div className={`max-w-[68%] space-y-1 ${isMe ? 'items-end text-right' : ''}`}>
                          {/* Sender name + time */}
                          <div className={`flex items-center gap-2 text-[11px] ${isMe ? 'justify-end' : ''}`}>
                            <span className="font-semibold text-ink">{isMe ? 'You' : sender?.full_name || 'User'}</span>
                            <span className="text-muted">{formatTime(msg.created_at)}</span>
                          </div>

                          {/* Reply context */}
                          {replyParent && (
                            <div className="rounded border-l-2 border-gold/50 bg-linen pl-2 pr-2 py-1 text-[10px] text-muted italic">
                              ↩ {replyParent.body.slice(0, 60)}{replyParent.body.length > 60 ? '…' : ''}
                            </div>
                          )}

                          {/* Message bubble */}
                          <div className={`inline-block rounded-xl px-3.5 py-2.5 text-xs leading-relaxed text-left break-words ${
                            isMe ? 'bg-ink text-white rounded-tr-none'
                            : displayedConv.type === 'project_internal' ? 'bg-amber-50 border border-amber-100 text-ink rounded-tl-none'
                            : displayedConv.type === 'project_client' ? 'bg-purple-50 border border-purple-100 text-ink rounded-tl-none'
                            : 'bg-linen border border-border text-ink rounded-tl-none'
                          }`}>
                            <p className="whitespace-pre-wrap">{msg.body}</p>

                            {/* Attachments in bubble */}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="mt-2 space-y-1.5 border-t border-white/20 pt-2">
                                {msg.attachments.map(att => (
                                  <div key={att.id} className="flex items-center justify-between rounded bg-white/10 px-2 py-1.5 text-[11px]">
                                    <span className="flex items-center gap-1.5 truncate">
                                      <FileText className="h-3.5 w-3.5 shrink-0" />
                                      <span className="truncate">{att.file_name}</span>
                                      <span className="text-muted">{formatFileSize(att.file_size)}</span>
                                    </span>
                                    <a href={att.file_url} target="_blank" rel="noopener noreferrer" className="ml-2 font-bold underline text-gold">Open</a>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Reactions */}
                          {Object.keys(reactionGroups).length > 0 && (
                            <div className={`flex flex-wrap gap-1 ${isMe ? 'justify-end' : ''}`}>
                              {Object.entries(reactionGroups).map(([emoji, count]) => (
                                <button
                                  key={emoji}
                                  onClick={() => onToggleReaction(msg.id, emoji)}
                                  className="rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[11px] font-semibold hover:bg-gold/20 transition"
                                >
                                  {emoji} {count}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Hover action bar */}
                        {isHovered && (
                          <div className={`absolute -top-8 ${isMe ? 'right-10' : 'left-10'} flex items-center gap-0.5 rounded-lg border border-border bg-white shadow-soft px-1 py-1 z-10`}>
                            {/* Emoji picker toggle */}
                            <div className="relative">
                              <button
                                onClick={e => { e.stopPropagation(); setEmojiPickerMsgId(showEmojiPicker ? null : msg.id); setMenuMsgId(null); }}
                                className="rounded p-1.5 text-muted hover:text-ink hover:bg-black/5 transition"
                                title="React"
                              >
                                <Smile className="h-3.5 w-3.5" />
                              </button>
                              {showEmojiPicker && (
                                <div ref={emojiRef} className={`absolute z-20 -top-10 ${isMe ? 'right-0' : 'left-0'} flex gap-0.5 rounded-lg border border-border bg-white shadow-soft p-1`}>
                                  {EMOJI_LIST.slice(0, 8).map(emoji => (
                                    <button
                                      key={emoji}
                                      onClick={() => { onToggleReaction(msg.id, emoji); setEmojiPickerMsgId(null); }}
                                      className="rounded p-1 text-base hover:bg-black/5 transition"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Reply */}
                            <button
                              onClick={() => { setReplyingToMessage(msg); setEmojiPickerMsgId(null); setMenuMsgId(null); }}
                              className="rounded p-1.5 text-muted hover:text-ink hover:bg-black/5 transition"
                              title="Reply"
                            >
                              <Reply className="h-3.5 w-3.5" />
                            </button>

                            {/* More menu */}
                            <div className="relative">
                              <button
                                onClick={e => { e.stopPropagation(); setMenuMsgId(showMenu ? null : msg.id); setEmojiPickerMsgId(null); }}
                                className="rounded p-1.5 text-muted hover:text-ink hover:bg-black/5 transition"
                                title="More"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                              {showMenu && (
                                <div ref={menuRef} className={`absolute z-20 top-full mt-1 ${isMe ? 'right-0' : 'left-0'} w-44 rounded-lg border border-border bg-white shadow-soft py-1`}>
                                  <button
                                    onClick={() => { navigator.clipboard.writeText(msg.body).catch(() => {}); setMenuMsgId(null); }}
                                    className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-ink hover:bg-black/5 transition"
                                  >
                                    <Copy className="h-3.5 w-3.5 text-muted" /> Copy Message
                                  </button>
                                  <button
                                    onClick={() => { setReplyingToMessage(msg); setMenuMsgId(null); }}
                                    className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-ink hover:bg-black/5 transition"
                                  >
                                    <Reply className="h-3.5 w-3.5 text-muted" /> Reply
                                  </button>
                                  {onCreateTask && (
                                    <button
                                      onClick={() => { setCreateTaskMessage(msg); setMenuMsgId(null); }}
                                      className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-ink hover:bg-black/5 transition"
                                    >
                                      <ClipboardList className="h-3.5 w-3.5 text-muted" /> Create Task
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Pending attachments */}
              {pendingAttachments.length > 0 && (
                <div className="shrink-0 border-t border-border bg-linen/40 px-4 py-2 flex flex-wrap gap-2">
                  {pendingAttachments.map((att, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2 py-1 text-xs font-medium">
                      <Paperclip className="h-3 w-3 text-gold" />
                      {att.file_name}
                      <button onClick={() => setPendingAttachments(prev => prev.filter((_, idx) => idx !== i))} className="text-muted hover:text-danger ml-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Reply indicator */}
              {replyingToMessage && (
                <div className="shrink-0 flex items-center justify-between border-t border-border bg-linen/40 px-4 py-1.5 text-[11px] text-muted">
                  <span>
                    ↩ Replying to <strong className="text-ink">
                      {profiles.find(p => p.id === replyingToMessage.sender_id)?.full_name || 'User'}
                    </strong>: {replyingToMessage.body.slice(0, 50)}{replyingToMessage.body.length > 50 ? '…' : ''}
                  </span>
                  <button onClick={() => setReplyingToMessage(null)} className="text-muted hover:text-danger">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Mention popover */}
              {showMentionPopover && (
                <div className="shrink-0 mx-4 mb-1 rounded-lg border border-border bg-white shadow-soft max-h-36 overflow-y-auto">
                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase text-muted">Mention Someone</p>
                  {profiles.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setMessageInput(prev => prev + `@${firstName(p.full_name)} `); setShowMentionPopover(false); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-gold/10 text-left"
                    >
                      <UserAvatar profile={p} size="xs" />
                      {p.full_name} <span className="text-muted ml-1">({roleLabels[p.role]})</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Composer */}
              <div className="shrink-0 border-t border-border bg-linen/20 p-3">
                <div className="rounded-xl border border-border bg-white focus-within:border-gold transition overflow-hidden">
                  <div className="flex items-center gap-1.5 px-3 py-2.5">
                    <label className="cursor-pointer shrink-0 rounded p-1.5 text-muted hover:text-ink hover:bg-black/5 transition">
                      <Paperclip className="h-4 w-4" />
                      <input type="file" onChange={handleFileUpload} className="hidden" />
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowMentionPopover(v => !v)}
                      className="shrink-0 rounded p-1.5 text-muted hover:text-ink hover:bg-black/5 transition"
                      title="Mention someone"
                    >
                      <AtSign className="h-4 w-4" />
                    </button>
                    <input
                      type="text"
                      placeholder={`Message ${headerName || ''}…`}
                      value={messageInput}
                      onChange={e => { setMessageInput(e.target.value); if (e.target.value.endsWith('@')) setShowMentionPopover(true); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                        if (e.key === 'Escape') { setShowMentionPopover(false); setReplyingToMessage(null); }
                      }}
                      className="flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted/60"
                    />
                    <button
                      onClick={handleSend}
                      disabled={!messageInput.trim() && pendingAttachments.length === 0}
                      className="shrink-0 flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-bold text-ink hover:bg-gold/90 transition disabled:opacity-40"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Send</span>
                    </button>
                  </div>
                </div>
                <p className="text-center text-[10px] text-muted/50 mt-1">Enter to send · Shift+Enter for new line</p>
              </div>
            </div>
          )}

          {/* FILES TAB */}
          {activeConvTab === 'files' && (
            <div className="flex-1 overflow-y-auto p-5">
              {convAttachments.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center">
                  <div>
                    <Paperclip className="mx-auto h-10 w-10 text-muted/30 mb-2" />
                    <p className="text-sm font-medium text-ink">No files yet</p>
                    <p className="text-xs text-muted mt-1">Files shared in this conversation will appear here.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-muted uppercase tracking-wider mb-3">
                    {convAttachments.length} file{convAttachments.length !== 1 ? 's' : ''} shared
                  </p>
                  {convAttachments.map(att => {
                    const sender = profiles.find(p => {
                      const msg = activeMessages.find(m => m.id === att.message_id);
                      return msg && p.id === msg.sender_id;
                    });
                    const msg = activeMessages.find(m => m.id === att.message_id);
                    return (
                      <div key={att.id} className="flex items-center justify-between rounded-lg border border-border bg-white px-4 py-3 hover:bg-linen/50 transition">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-2xl shrink-0">{fileIcon(att.file_type)}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-ink truncate">{att.file_name}</p>
                            <p className="text-[11px] text-muted">
                              {formatFileSize(att.file_size)}
                              {sender ? ` · ${sender.full_name}` : ''}
                              {msg ? ` · ${relativeTime(msg.created_at)}` : ''}
                            </p>
                          </div>
                        </div>
                        <a
                          href={att.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 ml-3 text-xs font-bold text-gold hover:underline"
                        >
                          Open
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TASKS TAB */}
          {activeConvTab === 'tasks' && (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-bold text-muted uppercase tracking-wider">
                  Tasks{activeProject ? ` · ${activeProject.project_title}` : ''}
                </p>
                {onCreateTask && (
                  <button
                    onClick={() => {
                      // Create an empty task linked to this project
                      const fakeMsg: ChatMessage = {
                        id: '', conversation_id: '', sender_id: currentProfile.id,
                        body: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                      };
                      setCreateTaskMessage(fakeMsg);
                    }}
                    className="flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-bold text-ink hover:bg-gold/90 transition"
                  >
                    <Plus className="h-3.5 w-3.5" /> Create Task
                  </button>
                )}
              </div>
              {!activeProject ? (
                <div className="flex h-40 items-center justify-center text-center">
                  <div>
                    <CheckSquare className="mx-auto h-8 w-8 text-muted/30 mb-2" />
                    <p className="text-xs text-muted">Tasks are available for project conversations.</p>
                  </div>
                </div>
              ) : convTasks.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-center">
                  <div>
                    <CheckSquare className="mx-auto h-8 w-8 text-muted/30 mb-2" />
                    <p className="text-sm font-medium text-ink">No tasks yet</p>
                    <p className="text-xs text-muted mt-1">Create a task to track work for this project.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {convTasks.map(task => {
                    const assignee = profiles.find(p => p.id === task.assigned_to);
                    const isDone = task.status === 'Done';
                    return (
                      <div key={task.id} className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${isDone ? 'border-border bg-linen/30 opacity-60' : 'border-border bg-white hover:bg-linen/40'} transition`}>
                        <div className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center ${isDone ? 'border-success bg-success/10' : 'border-border'}`}>
                          {isDone && <span className="text-[10px] text-success">✓</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-semibold ${isDone ? 'line-through text-muted' : 'text-ink'}`}>{task.title}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${priorityColor(task.priority)}`}>{task.priority}</span>
                            {assignee && (
                              <span className="flex items-center gap-1 text-[11px] text-muted">
                                <UserAvatar profile={assignee} size="xs" />
                                {assignee.full_name}
                              </span>
                            )}
                            {task.due_date && (
                              <span className="flex items-center gap-1 text-[11px] text-muted">
                                <Calendar className="h-3 w-3" />
                                {new Date(task.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          task.status === 'Done' ? 'bg-green-50 text-success' : task.status === 'In Progress' ? 'bg-amber-50 text-amber-800' : 'bg-stone-100 text-stone-600'
                        }`}>{task.status}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* DETAILS TAB */}
          {activeConvTab === 'details' && (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-white p-4 space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted">Conversation Details</h4>
                  <dl className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <dt className="text-muted">Type</dt>
                      <dd className="font-semibold text-ink capitalize">{displayedConv.type.replace('_', ' ')}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Created</dt>
                      <dd className="font-semibold text-ink">{new Date(displayedConv.created_at).toLocaleDateString([], { dateStyle: 'medium' })}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Members</dt>
                      <dd className="font-semibold text-ink">{convMemberProfiles.length}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Messages</dt>
                      <dd className="font-semibold text-ink">{activeMessages.length}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Files</dt>
                      <dd className="font-semibold text-ink">{convAttachments.length}</dd>
                    </div>
                    {activeProject && (
                      <div className="flex justify-between">
                        <dt className="text-muted">Linked Project</dt>
                        <dd className="font-semibold text-ink truncate max-w-[140px]">{activeProject.project_title}</dd>
                      </div>
                    )}
                    {activeProject && (
                      <div className="flex justify-between">
                        <dt className="text-muted">Tasks</dt>
                        <dd className="font-semibold text-ink">{convTasks.length} ({convTasks.filter(t => t.status === 'Done').length} done)</dd>
                      </div>
                    )}
                  </dl>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-center p-8">
          <div>
            <MessageSquare className="mx-auto h-14 w-14 text-muted/25 mb-3" />
            <h3 className="font-display text-lg font-bold text-ink">Select a conversation</h3>
            <p className="text-xs text-muted max-w-xs mt-1">Choose a conversation from the left panel to begin.</p>
          </div>
        </div>
      )}
    </div>
  );

  /* ════════════════════════════════════════════════════
     CONTEXT PANEL
  ════════════════════════════════════════════════════ */

  const contextPanel = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Conversation Info</h3>
        <div className="flex items-center gap-1">
          {/* Mobile back */}
          <button className="md:hidden text-muted hover:text-ink" onClick={() => setMobilePanel('chat')}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          {/* Desktop close */}
          <button className="hidden lg:block text-muted hover:text-ink" onClick={() => setContextPanelOpen(false)}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {displayedConv ? (
          <div className="divide-y divide-border">

            {/* ABOUT */}
            <div className="px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-2">About</p>
              <p className="text-xs text-muted leading-relaxed">
                {displayedConv.type === 'project_internal'
                  ? `Internal team discussion for ${activeProject?.project_title || 'this project'}. Clients cannot see this conversation.`
                  : displayedConv.type === 'project_client'
                  ? `Shared conversation with ${activeProject?.client_name || 'the client'} for ${activeProject?.project_title || 'this project'}.`
                  : displayedConv.type === 'dm'
                  ? 'Direct message between you and a team member.'
                  : `Team channel for ${displayedConv.name ? `#${displayedConv.name}` : 'team discussions'}.`}
              </p>
              {displayedConv.type === 'project_internal' && (
                <div className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-100 px-2 py-1.5 text-[11px] text-amber-800">
                  <Lock className="h-3 w-3 shrink-0" /> Internal — staff only
                </div>
              )}
            </div>

            {/* MEMBERS */}
            <div className="px-4 py-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Members ({convMemberProfiles.length})</p>
              </div>
              <div className="space-y-2">
                {convMemberProfiles.slice(0, 6).map(p => (
                  <div key={p.id} className="flex items-center gap-2.5">
                    <UserAvatar profile={p} size="xs" showStatusDot isOnline />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink truncate">
                        {p.full_name}
                        {p.id === currentProfile.id && <span className="ml-1 text-[10px] text-muted">(you)</span>}
                      </p>
                      <p className="text-[10px] text-muted">{roleLabels[p.role]}</p>
                    </div>
                  </div>
                ))}
                {convMemberProfiles.length > 6 && (
                  <p className="text-xs text-muted pl-8">+{convMemberProfiles.length - 6} more</p>
                )}
              </div>
            </div>

            {/* LINKED PROJECT */}
            {activeProject && (
              <div className="px-4 py-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-3">Linked Project</p>
                <div className="rounded-lg border border-border bg-white p-3">
                  <div className="flex items-start gap-2">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold/15">
                      <FolderKanban className="h-4 w-4 text-gold" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-ink truncate">{activeProject.project_title}</p>
                      <p className="text-[10px] text-muted">{activeProject.client_name}</p>
                      {activeProject.status && (
                        <span className="mt-1 inline-block rounded bg-linen px-1.5 py-0.5 text-[10px] font-semibold text-muted border border-border">
                          {activeProject.status}
                        </span>
                      )}
                    </div>
                  </div>
                  {onOpenProject && (
                    <button
                      onClick={() => onOpenProject(activeProject.id)}
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-border py-1.5 text-[11px] font-semibold text-ink hover:bg-linen transition"
                    >
                      <ExternalLink className="h-3 w-3 text-gold" /> Open Project
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* OPTIONS */}
            <div className="px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-3">Options</p>
              <div className="space-y-1">
                <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-ink hover:bg-black/5 transition">
                  <BellOff className="h-3.5 w-3.5 text-muted" />
                  Mute Notifications
                </button>
                <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-ink hover:bg-black/5 transition">
                  <Search className="h-3.5 w-3.5 text-muted" />
                  Search in Conversation
                </button>
              </div>
            </div>

          </div>
        ) : (
          <div className="flex h-40 items-center justify-center text-center p-4">
            <p className="text-xs text-muted">Select a conversation to see details.</p>
          </div>
        )}
      </div>
    </div>
  );

  /* ════════════════════════════════════════════════════
     ROOT LAYOUT
  ════════════════════════════════════════════════════ */

  return (
    <>
      {/* Create Task Modal */}
      {createTaskMessage && onCreateTask && (
        <CreateTaskModal
          message={createTaskMessage}
          projects={projects}
          profiles={profiles}
          defaultProjectId={activeProject?.id || null}
          onClose={() => setCreateTaskMessage(null)}
          onSubmit={onCreateTask}
        />
      )}

      {/* New Message Modal */}
      {showNewMsg && (
        <NewMessageModal
          teamMembers={teamMembers}
          projects={projects}
          channels={TEAM_CHANNELS}
          onClose={() => setShowNewMsg(false)}
          onOpen={handleNewMsgOpen}
        />
      )}

      <div className="flex flex-col h-[calc(100vh-140px)] overflow-hidden rounded-xl border border-border bg-white shadow-sm">

        {/* ── TOP BAR ── */}
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border bg-linen/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-gold shrink-0" />
            <h2 className="font-display text-base font-bold text-ink hidden sm:block">Communication</h2>
          </div>
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

        {/* ── BODY: THREE PANELS ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* PANEL 1: Conversations sidebar */}
          <div className={`flex-col w-72 shrink-0 border-r border-border bg-linen/20 ${
            mobilePanel === 'list' ? 'flex' : 'hidden md:flex'
          }`}>
            {sidebar}
          </div>

          {/* PANEL 2: Main conversation */}
          <div className={`flex-col flex-1 min-w-0 ${
            mobilePanel === 'chat' ? 'flex' : 'hidden md:flex'
          }`}>
            {mainPanel}
          </div>

          {/* PANEL 3: Context panel */}
          {contextPanelOpen && (
            <div className={`flex-col w-72 shrink-0 border-l border-border bg-linen/10 ${
              mobilePanel === 'context' ? 'flex' : 'hidden lg:flex'
            }`}>
              {contextPanel}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
