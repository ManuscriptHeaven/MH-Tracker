import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  FolderKanban,
  History,
  MessageSquare,
  Mic,
  MicOff,
  Plus,
  RefreshCw,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useAIContext } from '../lib/ai/aiContext';
import { AIChatMessage } from '../components/ai/AIChatMessage';
import { AIActivityHistory } from '../components/ai/AIActivityHistory';
import { AIOperatorIntelligencePanel } from '../components/ai/AIOperatorIntelligencePanel';
import { InvoiceModal } from '../components/InvoiceModal';
import { cn, firstName, isManagerRole } from '../lib/utils';
import { isDueToday, isOverdue } from '../lib/date';
import { useCurrency } from '../lib/currency';
import type { Invoice, Profile, Project } from '../lib/types';

interface AIAssistantPageProps {
  projects?: Project[];
  currentProfile: Profile;
}

type QuickCommand = {
  label: string;
  description: string;
  query: string;
  icon: typeof Sparkles;
  adminOnly?: boolean;
};

function conversationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function AIAssistantPage({
  projects = [],
  currentProfile,
}: AIAssistantPageProps) {
  const {
    messages,
    sendMessage,
    isProcessing,
    isListening,
    isSpeaking,
    isMuted,
    liveTranscript,
    voiceError,
    startVoice,
    stopVoice,
    stopSpeaking,
    toggleMute,
    clearConversation,
    clearVoiceError,
    activeTab,
    setActiveTab,
    auditLogs,
    conversations,
    activeConversationId,
    switchConversation,
    startNewConversation,
    dailySummary,
    refreshDailyBriefing,
  } = useAIContext();

  const { formatMoney } = useCurrency();
  const [input, setInput] = useState('');
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const canManage = isManagerRole(currentProfile.role);
  const isAdmin = currentProfile.role === 'admin';
  const userName = firstName(currentProfile.full_name);

  const activeProjects = useMemo(
    () =>
      projects.filter((project) => {
        const status = String(project.status || '').toLowerCase();
        const lifecycle = String(project.project_status || '').toLowerCase();
        return (
          !['completed', 'delivered', 'cancelled', 'archived'].includes(status) &&
          !['completed', 'cancelled', 'archived'].includes(lifecycle)
        );
      }),
    [projects],
  );

  const overdueProjects = useMemo(
    () => activeProjects.filter((project) => isOverdue(project)),
    [activeProjects],
  );
  const dueTodayProjects = useMemo(
    () => activeProjects.filter((project) => isDueToday(project)),
    [activeProjects],
  );
  const pendingApprovals = useMemo(
    () =>
      activeProjects.filter(
        (project) =>
          project.status === 'Awaiting Client Approval' ||
          project.stage_status === 'PAUSED_CLIENT_REVIEW' ||
          String(project.current_stage || '').includes('Approval'),
      ),
    [activeProjects],
  );
  const totalReceivables = useMemo(
    () =>
      projects.reduce(
        (sum, project) =>
          sum +
          Math.max(
            Number(project.remaining_balance ?? 0),
            Number(project.total_price || 0) - Number(project.advance_paid || 0),
            0,
          ),
        0,
      ),
    [projects],
  );

  const firstUnpaid = useMemo(
    () =>
      projects.find(
        (project) =>
          Math.max(
            Number(project.total_price || 0) - Number(project.advance_paid || 0),
            Number(project.remaining_balance || 0),
          ) > 0.005,
      ),
    [projects],
  );

  const firstOverdue = overdueProjects[0];
  const firstApproval = pendingApprovals[0];

  const quickCommands = useMemo<QuickCommand[]>(() => {
    const commands: QuickCommand[] = [
      {
        label: 'Overdue Projects',
        description: 'See what needs immediate attention.',
        query: 'How many projects are overdue?',
        icon: AlertTriangle,
      },
      {
        label: 'Client Approvals',
        description: 'Review work currently waiting on clients.',
        query: 'What projects are waiting for client approval?',
        icon: Clock3,
      },
      {
        label: 'Team Workload',
        description: 'See who has the most active work.',
        query: 'Which employee has the most active projects?',
        icon: Users,
      },
      {
        label: 'Receivables',
        description: 'See who owes money and outstanding balances.',
        query: 'Who owes us money and what are the receivables?',
        icon: CircleDollarSign,
        adminOnly: true,
      },
      {
        label: 'Finance Summary',
        description: 'Order revenue, expenses and revenue less expenses.',
        query: 'Show order revenue and expenses this month',
        icon: FileText,
        adminOnly: true,
      },
      {
        label: 'Payroll',
        description: 'Review what is currently owed to the team.',
        query: 'How much do we owe the team in monthly payroll?',
        icon: Users,
        adminOnly: true,
      },
    ];

    if (canManage) {
      commands.push(
        {
          label: 'New Project',
          description: 'Start the guided project creation wizard.',
          query: 'Create a new project',
          icon: FolderKanban,
        },
        {
          label: 'Create Task',
          description: 'Preview a task before creating it.',
          query: 'Create a task for Zain to check the print PDF tomorrow',
          icon: CheckCircle2,
        },
      );

      if (firstApproval) {
        commands.push({
          label: 'Client Reminder',
          description: 'Draft an approval reminder from live project context.',
          query: `Draft a professional approval reminder message for ${firstApproval.project_number}`,
          icon: MessageSquare,
        });
      }
    }

    if (firstUnpaid && canManage) {
      commands.push({
        label: 'Generate Invoice',
        description: `Build an invoice from ${firstUnpaid.client_name}'s pending work.`,
        query: `Generate invoice for ${firstUnpaid.client_name} for all pending payments`,
        icon: FileText,
      });
    }

    if (firstOverdue && canManage) {
      commands.push({
        label: 'Project Action',
        description: `Preview a status action for ${firstOverdue.project_title}.`,
        query: `Put ${firstOverdue.project_title} on hold`,
        icon: FolderKanban,
      });
    }

    return commands.filter((command) => !command.adminOnly || isAdmin);
  }, [canManage, firstApproval, firstOverdue, firstUnpaid, isAdmin]);

  useEffect(() => {
    if (activeTab === 'chat') {
      const scrollContainer = messageScrollRef.current;
      if (scrollContainer) {
        scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [messages, isProcessing, liveTranscript, activeTab]);

  // Leaving the AI Command Center also releases the microphone immediately.
  useEffect(() => () => {
    stopVoice();
    stopSpeaking();
  }, [stopVoice, stopSpeaking]);

  function handleVoiceToggle() {
    clearVoiceError();
    if (isListening) {
      stopVoice();
    } else {
      startVoice();
    }
  }

  function handleSubmit() {
    const text = input.trim();
    if (!text || isProcessing) return;
    setInput('');
    if (composerRef.current) composerRef.current.style.height = 'auto';
    void sendMessage(text);
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  function handleNewConversation() {
    startNewConversation();
    setActiveTab('chat');
    setMobileHistoryOpen(false);
    setCommandsOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function runQuickCommand(query: string) {
    setRecentCommands((current) => [query, ...current.filter((item) => item !== query)].slice(0, 4));
    setActiveTab('chat');
    setCommandsOpen(false);
    void sendMessage(query);
  }

  const visibleCommands = quickCommands.filter((command) =>
    (command.label + ' ' + command.description).toLowerCase().includes(commandSearch.trim().toLowerCase()),
  );

  const assistantState = voiceError
    ? 'Error'
    : isListening
      ? 'Listening'
      : isSpeaking
        ? 'Speaking'
        : isProcessing
          ? 'Thinking'
          : 'Ready';

  const voiceIsActive = isListening || isSpeaking || isProcessing;
  const voiceStateColor = voiceError
    ? 'text-rose-300 bg-rose-400/10 border-rose-400/30'
    : isListening
      ? 'text-cyan-300 bg-cyan-400/10 border-cyan-400/30'
      : isSpeaking
        ? 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30'
        : isProcessing
          ? 'text-amber-300 bg-amber-400/10 border-amber-400/30'
          : 'text-slate-300 bg-white/5 border-white/15';

  return (
    <div className="mx-auto w-full max-w-[1660px] space-y-4 pb-8">
      {/* AI Assistant Dashboard V2: keep the existing AI context, permissions, and action confirmations. */}
      <header className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0d1524] px-5 py-5 text-white shadow-xl shadow-black/10 sm:px-7">
        <div className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-gold">
              <Sparkles className="h-3.5 w-3.5" />
              Live Workspace Intelligence
            </div>
            <h1 className="mt-1 font-display text-2xl font-bold sm:text-3xl">AI Command Center <span className="text-gold">V2</span></h1>
            <p className="mt-1 text-xs text-slate-400 sm:text-sm">
              {userName}, speak, chat, or launch a safe workflow from one workspace.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold', voiceStateColor)} aria-live="polite">
              <span className={cn('h-2 w-2 rounded-full', isListening ? 'animate-pulse bg-cyan-300' : isSpeaking ? 'animate-pulse bg-emerald-300' : isProcessing ? 'animate-pulse bg-amber-300' : voiceError ? 'bg-rose-400' : 'bg-slate-400')} />
              {assistantState}
            </span>
            <button type="button" onClick={() => setCommandsOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-semibold text-white xl:hidden">
              <FolderKanban className="h-4 w-4 text-gold" /> Commands
            </button>
            <button
              type="button"
              onClick={toggleMute}
              title={isMuted ? 'Unmute assistant voice' : 'Mute assistant voice'}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {commandsOpen ? (
        <button type="button" aria-label="Close commands" onClick={() => setCommandsOpen(false)}
          className="fixed inset-0 z-[80] bg-black/70 xl:hidden" />
      ) : null}

      <section aria-label="AI Assistant V2 workspace" className="grid min-w-0 gap-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)] xl:grid-cols-[250px_minmax(290px,0.82fr)_minmax(360px,1.18fr)]">
        {/* Left: role-aware commands and saved conversations */}
        <aside className={cn(
          'min-w-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#111c2b] text-slate-100 shadow-2xl shadow-black/10',
          commandsOpen ? 'fixed inset-x-3 bottom-3 top-16 z-[81] flex' : 'hidden',
          'xl:relative xl:inset-auto xl:flex xl:max-h-[820px]',
        )}>
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
            <div>
              <h2 className="text-sm font-bold">Quick Commands</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">Your frequent MH workflows</p>
            </div>
            <button type="button" onClick={() => setCommandsOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 xl:hidden" aria-label="Close commands">
              <MicOff className="h-4 w-4" />
            </button>
            <ShieldCheck className="hidden h-4 w-4 text-gold xl:block" aria-label="Confirmation protected" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <label htmlFor="ai-v2-command-search" className="sr-only">Search quick commands</label>
            <input
              id="ai-v2-command-search"
              type="search"
              value={commandSearch}
              onChange={(event) => setCommandSearch(event.target.value)}
              placeholder="Search commands..."
              className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/50"
            />
            <p className="mb-2 mt-4 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Pinned commands</p>
            <div className="space-y-1.5">
              {visibleCommands.length ? visibleCommands.map((command) => {
                const Icon = command.icon;
                return (
                  <button key={command.label + command.query} type="button" onClick={() => runQuickCommand(command.query)}
                    className="group flex w-full items-start gap-2.5 rounded-xl border border-transparent bg-white/[0.035] px-3 py-2.5 text-left transition hover:border-gold/30 hover:bg-white/10">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold"><Icon className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-100">{command.label}</span>
                      <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-400">{command.description}</span>
                    </span>
                  </button>
                );
              }) : <p className="px-3 py-4 text-xs text-slate-400">No commands match your search.</p>}
            </div>
            {recentCommands.length ? (
              <div className="mt-4 border-t border-white/10 pt-3">
                <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Recent commands</p>
                {recentCommands.map((query) => (
                  <button type="button" key={query} onClick={() => runQuickCommand(query)}
                    className="mb-1 block w-full truncate rounded-lg px-2.5 py-2 text-left text-[11px] text-slate-300 hover:bg-white/10">
                    {query}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="mt-4 border-t border-white/10 pt-3">
              <button type="button" onClick={() => setMobileHistoryOpen((value) => !value)}
                aria-expanded={mobileHistoryOpen}
                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs font-bold text-slate-200 hover:bg-white/10">
                <span className="flex items-center gap-2"><History className="h-3.5 w-3.5 text-gold" /> Conversation History</span>
                <span className="text-[10px] font-normal text-slate-400">{conversations.length}</span>
              </button>
              {mobileHistoryOpen ? (
                <div className="mt-1 max-h-52 space-y-1 overflow-y-auto">
                  <button type="button" onClick={handleNewConversation} className="flex w-full items-center gap-2 rounded-lg border border-gold/20 px-3 py-2 text-xs text-gold hover:bg-white/10">
                    <Plus className="h-3.5 w-3.5" /> New Conversation
                  </button>
                  {conversations.map((conversation) => (
                    <button key={conversation.id} type="button"
                      onClick={() => { void switchConversation(conversation.id); setActiveTab('chat'); setCommandsOpen(false); }}
                      className={cn('w-full rounded-lg px-3 py-2 text-left transition',
                        conversation.id === activeConversationId ? 'bg-gold/15 text-white' : 'text-slate-300 hover:bg-white/10')}>
                      <span className="block truncate text-[11px] font-semibold">{conversation.title || 'New Conversation'}</span>
                      <span className="block text-[10px] text-slate-500">{conversationDate(conversation.updatedAt)}</span>
                    </button>
                  ))}
                  {conversations.length === 0 ? <p className="px-3 py-2 text-[11px] text-slate-500">No saved conversations yet.</p> : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="border-t border-white/10 px-4 py-3 text-[10px] text-slate-400">Live data · write actions require confirmation</div>
        </aside>

        {/* Center: manual, state-driven voice experience */}
        <section aria-label="Voice control" className="relative flex min-h-[540px] min-w-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0c1727] px-5 py-5 text-white shadow-2xl shadow-black/10">
          <div className="pointer-events-none absolute left-1/2 top-1/3 h-80 w-80 -translate-x-1/2 rounded-full bg-cyan-500/[0.065] blur-3xl" aria-hidden="true" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">MH Voice Intelligence</p>
              <h2 className="mt-1 text-base font-semibold">Voice Command Center</h2>
            </div>
            <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold', voiceStateColor)}>{assistantState}</span>
          </div>

          <div className="relative flex flex-1 flex-col items-center justify-center py-8 text-center">
            <div className="relative grid h-60 w-60 place-items-center" aria-hidden="true">
              <div className={cn('absolute inset-0 rounded-full border transition-all duration-500',
                voiceError ? 'border-rose-500/30' : isListening ? 'border-cyan-400/40 motion-safe:animate-pulse' : isSpeaking ? 'border-emerald-400/40 motion-safe:animate-pulse' : isProcessing ? 'border-amber-400/30 motion-safe:animate-pulse' : 'border-white/10')} />
              <div className={cn('absolute inset-5 rounded-full border shadow-[0_0_65px_rgba(34,211,238,0.09)] transition-all duration-500',
                voiceError ? 'border-rose-400/50 bg-rose-500/10' : isListening ? 'border-cyan-300/60 bg-cyan-500/10 motion-safe:animate-pulse' : isSpeaking ? 'border-emerald-300/60 bg-emerald-500/10 motion-safe:animate-pulse' : isProcessing ? 'border-amber-300/50 bg-amber-500/10 motion-safe:animate-pulse' : 'border-cyan-300/20 bg-cyan-500/5')} />
              <div className="absolute inset-11 rounded-full border border-white/10 bg-gradient-to-br from-[#1d3a4e] via-[#14253b] to-[#0b1626] shadow-inner" />
              <div className={cn('relative grid h-24 w-24 place-items-center rounded-full border border-white/10 bg-white/5',
                voiceIsActive && !voiceError ? 'motion-safe:animate-pulse' : '')}>
                {isListening ? <Mic className="h-11 w-11 text-cyan-200" /> :
                  isSpeaking ? <Volume2 className="h-11 w-11 text-emerald-200" /> :
                  isProcessing ? <Sparkles className="h-11 w-11 text-amber-200" /> :
                  voiceError ? <AlertTriangle className="h-11 w-11 text-rose-300" /> :
                  <Bot className="h-11 w-11 text-gold" />}
              </div>
            </div>
            <div className="mt-1 flex h-8 items-center justify-center gap-1.5" aria-hidden="true">
              {[3, 6, 4, 8, 5, 7, 3, 6, 4].map((height, index) => (
                <span key={index} className={cn('w-1.5 rounded-full transition-all duration-300',
                  isListening ? 'bg-cyan-400 motion-safe:animate-pulse' : isSpeaking ? 'bg-emerald-400 motion-safe:animate-pulse' : isProcessing ? 'bg-amber-400 motion-safe:animate-pulse' : 'bg-slate-600')}
                  style={{ height: voiceIsActive ? height * 3 : 6, animationDelay: index * 90 + 'ms' }} />
              ))}
            </div>
            <h3 aria-live="polite" className="mt-3 text-lg font-semibold">
              {voiceError ? 'Microphone needs attention' : isListening ? 'Listening…' : isSpeaking ? 'Speaking…' : isProcessing ? 'Thinking…' : 'Click to Speak'}
            </h3>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
              {isListening ? 'Speak your request clearly. Your transcript will appear below.' :
                isSpeaking ? 'The assistant is reading its response. Stop audio at any time.' :
                isProcessing ? 'Reviewing your request and current workspace data.' :
                'The microphone stays off until you click Speak.'}
            </p>
          </div>

          <div className="relative space-y-3">
            <div className="min-h-16 rounded-2xl border border-white/10 bg-white/5 p-3" aria-live="polite">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Live transcript</p>
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-200">{liveTranscript || (isListening ? 'Listening for your request…' : 'Your words will appear here when you speak.')}</p>
            </div>
            {voiceError ? (
              <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" role="alert">
                {voiceError}
                <button type="button" onClick={clearVoiceError} className="ml-2 font-bold underline">Dismiss</button>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={handleVoiceToggle} disabled={isProcessing}
                className={cn('inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50',
                  isListening ? 'bg-rose-500 text-white hover:bg-rose-400' : 'bg-gold text-[#102035] hover:bg-amber-300')}>
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isListening ? 'Stop Listening' : 'Click to Speak'}
              </button>
              <button type="button" onClick={() => { stopVoice(); stopSpeaking(); }} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-slate-200 hover:bg-white/10">
                <MicOff className="h-4 w-4" /> {isSpeaking ? 'Stop Speaking' : 'Sleep / Stop'}
              </button>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 pb-1">
              {quickCommands.slice(0, 3).map((command) => (
                <button key={command.label} type="button" onClick={() => runQuickCommand(command.query)} className="rounded-full border border-white/10 px-2.5 py-1.5 text-[10px] text-slate-300 hover:border-gold/40 hover:text-gold">
                  {command.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Right: persistent conversation, action previews, and activity */}
        {/* Chat / Activity workspace */}
        <div className="flex h-[min(76vh,820px)] min-h-[590px] min-w-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#101927] shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-3 border-b border-white/10 bg-[#172234] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-gold shadow-xs">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-base font-bold text-slate-100">MH AI Assistant</h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {assistantState}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Live data · write actions require confirmation
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className={cn(
                  'inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition',
                  activeTab === 'chat'
                    ? 'bg-white/15 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white',
                )}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Assistant
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('activity')}
                className={cn(
                  'inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition',
                  activeTab === 'activity'
                    ? 'bg-white/15 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white',
                )}
              >
                <History className="h-3.5 w-3.5" />
                Activity
                {auditLogs.length > 0 ? (
                  <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[9px] text-[#7a5518]">
                    {auditLogs.length}
                  </span>
                ) : null}
              </button>
            </div>
          </div>

          {activeTab === 'activity' ? (
            <div className="min-h-0 flex-1 overflow-hidden bg-[#101927]">
              <AIActivityHistory />
            </div>
          ) : (
            <>
              <div ref={messageScrollRef} className="min-h-0 flex-1 overflow-y-auto bg-[#101927] px-3 py-5 sm:px-4">
                <div className="mx-auto w-full max-w-4xl space-y-5">
                  {messages.length === 0 ? (
                    <div className="flex min-h-[380px] flex-col items-center justify-center text-center">
                      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gold/15 text-[#7a5518]">
                        <Sparkles className="h-6 w-6" />
                      </div>
                      <h3 className="mt-4 font-display text-lg font-bold text-white">
                        What should we work on?
                      </h3>
                      <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-400 sm:text-sm">
                        Ask about projects, deadlines, team workload, finance, invoices, or preview a
                        safe action. Nothing is changed until a write action is confirmed.
                      </p>

                      <div className="mt-5 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                        {quickCommands.slice(0, 4).map((command) => {
                          const Icon = command.icon;
                          return (
                            <button
                              key={command.label}
                              type="button"
                              onClick={() => void sendMessage(command.query)}
                              className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left text-slate-200 transition hover:border-gold/50 hover:bg-white/10"
                            >
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold">
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-xs font-bold text-white">{command.label}</span>
                                <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-400">
                                  {command.description}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    messages.map((message) => (
                      <AIChatMessage
                       dark
                        key={message.id}
                        message={message}
                        onViewInvoice={setViewingInvoice}
                      />
                    ))
                  )}

                  {isProcessing ? (
                    <AIChatMessage
                       dark
                      message={{
                        id: 'ai-processing',
                        conversationId: activeConversationId || '',
                        role: 'assistant',
                        content: '',
                        createdAt: new Date().toISOString(),
                      }}
                      isProcessing
                    />
                  ) : null}

                  {isListening && liveTranscript ? (
                    <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                      <span className="font-bold text-cyan-300">Hearing:</span>{' '}
                      “{liveTranscript}”
                    </div>
                  ) : null}

                  {voiceError ? (
                    <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{voiceError}</span>
                      </div>
                      <button
                        type="button"
                        onClick={clearVoiceError}
                        className="font-bold hover:underline"
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : null}

                  <div />
                </div>
              </div>

              <div className="border-t border-white/10 bg-[#172234] p-3 sm:p-4">
                <div className="mx-auto w-full max-w-4xl">
                  <div className="rounded-2xl border border-white/15 bg-white/5 transition focus-within:border-cyan-400/50 focus-within:ring-2 focus-within:ring-cyan-400/10">
                    <div className="flex items-end gap-2 p-2">
                      <button
                        type="button"
                        onClick={handleVoiceToggle}
                        className={cn(
                          'grid h-10 w-10 shrink-0 place-items-center rounded-xl transition',
                          isListening
                            ? 'bg-rose-600 text-white shadow-rose-200 animate-pulse'
                            : 'bg-white/10 text-gold hover:bg-gold/20',
                        )}
                        title={isListening ? 'Stop listening' : 'Speak to assistant'}
                      >
                        {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      </button>

                      <textarea
                        ref={composerRef}
                        rows={1}
                        value={input}
                        disabled={isProcessing}
                        onChange={(event) => {
                          setInput(event.target.value);
                          event.currentTarget.style.height = 'auto';
                          event.currentTarget.style.height =
                            Math.min(event.currentTarget.scrollHeight, 140) + 'px';
                        }}
                        onKeyDown={handleComposerKeyDown}
                        placeholder={
                          isListening
                            ? 'Listening…'
                            : 'Ask about projects, finance, team workload, or preview an action…'
                        }
                        className="min-h-10 max-h-[140px] flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-5 text-slate-100 outline-none placeholder:text-slate-500"
                      />

                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!input.trim() || isProcessing}
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold text-[#111827] transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-35"
                        title="Send"
                      >
                        <SendHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[10px] text-slate-400">
                    <span>Enter to send · Shift+Enter for a new line</span>
                    <button
                      type="button"
                      onClick={clearConversation}
                      className="font-semibold text-gold hover:underline"
                    >
                      Start fresh chat
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

      </section>

      {/* Existing intelligence, briefing and finance signals remain accessible without crowding voice/chat. */}
      <details className="group rounded-2xl border border-border bg-white shadow-xs">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-bold text-ink">
          <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-gold" /> Workspace Intelligence &amp; Briefing</span>
          <span className="text-xs font-normal text-muted">Expand for alerts, metrics and recommendations</span>
        </summary>
        <div className="space-y-4 border-t border-border p-4 sm:p-5">
      <AIOperatorIntelligencePanel />

      {dailySummary ? (
        <section className="rounded-2xl border border-gold/30 bg-white p-4 shadow-xs sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#7a5518]">
                  <Sparkles className="h-3.5 w-3.5" />
                  Today’s AI Briefing
                </span>
                <button
                  type="button"
                  onClick={refreshDailyBriefing}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-semibold text-muted transition hover:bg-linen hover:text-ink"
                  title="Refresh daily briefing"
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </button>
              </div>
              <h2 className="mt-3 font-display text-lg font-bold text-ink sm:text-xl">
                {dailySummary.headline}
              </h2>
              <p className="mt-1 text-xs text-muted">
                {dailySummary.overdueProjects.count} overdue · {dailySummary.dueToday.count} due today ·{' '}
                {dailySummary.awaitingApprovals.count} awaiting approval · {dailySummary.overdueTasks.count} overdue tasks
              </p>

              {dailySummary.proactiveInsights.length > 0 ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {dailySummary.proactiveInsights.slice(0, 3).map((insight) => (
                    <div
                      key={insight.type + '-' + (insight.relatedId || insight.title)}
                      className={cn(
                        'rounded-xl border p-3',
                        insight.severity === 'critical'
                          ? 'border-rose-200 bg-rose-50'
                          : insight.severity === 'warning'
                            ? 'border-amber-200 bg-amber-50'
                            : 'border-blue-200 bg-blue-50',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle
                          className={cn(
                            'mt-0.5 h-3.5 w-3.5 shrink-0',
                            insight.severity === 'critical'
                              ? 'text-rose-700'
                              : insight.severity === 'warning'
                                ? 'text-amber-700'
                                : 'text-blue-700',
                          )}
                        />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-ink">{insight.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted">
                            {insight.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                  No urgent blockers detected in your current workspace.
                </div>
              )}
            </div>

            <div className="w-full xl:max-w-sm">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                Recommended Next
              </p>
              <div className="mt-2 space-y-2">
                {dailySummary.recommendedActions.slice(0, 3).map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => void sendMessage(action.command)}
                    className="group flex w-full items-center gap-2 rounded-xl border border-border bg-[#fcfbf8] px-3 py-2.5 text-left transition hover:border-gold/60 hover:bg-gold/[0.045]"
                  >
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        action.priority === 'high'
                          ? 'bg-rose-500'
                          : action.priority === 'medium'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink">
                      {action.title}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted/50 group-hover:text-[#7a5518]" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Live business brief */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: 'Active Projects',
            value: activeProjects.length,
            helper: 'Current open workload',
            icon: FolderKanban,
            tone: 'bg-blue-50 text-blue-700',
            query: 'Show active projects summary',
          },
          {
            label: 'Needs Attention',
            value: overdueProjects.length + dueTodayProjects.length,
            helper:
              overdueProjects.length > 0
                ? `${overdueProjects.length} overdue · ${dueTodayProjects.length} due today`
                : `${dueTodayProjects.length} due today`,
            icon: AlertTriangle,
            tone: 'bg-rose-50 text-rose-700',
            query: 'How many projects are overdue?',
          },
          {
            label: 'Awaiting Approval',
            value: pendingApprovals.length,
            helper: 'Waiting for client review',
            icon: Clock3,
            tone: 'bg-amber-50 text-amber-700',
            query: 'What projects are waiting for client approval?',
          },
          {
            label: 'Receivables',
            value: isAdmin ? formatMoney(totalReceivables, 'USD') : 'Restricted',
            helper: isAdmin ? 'Outstanding client balances' : 'Admin financial data',
            icon: CircleDollarSign,
            tone: 'bg-emerald-50 text-emerald-700',
            query: 'Who owes us money and what are the receivables?',
          },
        ].map((metric) => {
          const Icon = metric.icon;
          const disabled = metric.label === 'Receivables' && !isAdmin;
          return (
            <button
              key={metric.label}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && void sendMessage(metric.query)}
              className="rounded-2xl border border-border bg-white p-4 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-soft disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:border-border"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                    {metric.label}
                  </p>
                  <p className="mt-1.5 truncate font-display text-2xl font-bold text-ink sm:text-3xl">
                    {metric.value}
                  </p>
                </div>
                <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', metric.tone)}>
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-3 truncate border-t border-border/60 pt-2.5 text-[11px] text-muted">
                {metric.helper}
              </p>
            </button>
          );
        })}
      </section>


        </div>
      </details>

      {viewingInvoice ? (
        <InvoiceModal invoice={viewingInvoice} onClose={() => setViewingInvoice(null)} />
      ) : null}
    </div>
  );
}
