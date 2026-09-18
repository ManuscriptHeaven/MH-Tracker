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
    isWakeWordListening,
    toggleWakeWordListener,
    settings,
    liveTranscript,
    voiceError,
    startVoice,
    stopVoice,
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
  } = useAIContext();

  const { formatMoney } = useCurrency();
  const [input, setInput] = useState('');
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
  }, [canManage, firstOverdue, firstUnpaid, isAdmin]);

  useEffect(() => {
    if (activeTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isProcessing, liveTranscript, activeTab]);

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
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  const assistantState = isListening
    ? 'Listening'
    : isSpeaking
      ? 'Speaking'
      : isProcessing
        ? 'Working'
        : 'Ready';

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-0 sm:space-y-6">
      {/* Page heading */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#8b6f38]">
            <Sparkles className="h-3.5 w-3.5" />
            Live Workspace Intelligence
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">
            AI Command Center
          </h1>
          <p className="mt-1 text-sm text-muted">
            {userName}, ask about live Tracker data or preview safe actions before anything changes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileHistoryOpen((value) => !value)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-white px-3 text-xs font-semibold text-ink shadow-xs lg:hidden"
          >
            <History className="h-4 w-4 text-gold" />
            Chats
            {conversations.length > 0 ? (
              <span className="rounded-full bg-linen px-1.5 py-0.5 text-[10px] text-muted">
                {conversations.length}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={toggleWakeWordListener}
            className={cn(
              'inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition',
              settings.wakeWordEnabled
                ? 'border-gold/50 bg-gold/10 text-[#7a5518]'
                : 'border-border bg-white text-muted hover:text-ink',
            )}
          >
            <span className="relative flex h-2 w-2">
              {settings.wakeWordEnabled && isWakeWordListening ? (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-60" />
              ) : null}
              <span
                className={cn(
                  'relative inline-flex h-2 w-2 rounded-full',
                  settings.wakeWordEnabled ? 'bg-gold' : 'bg-muted',
                )}
              />
            </span>
            {settings.wakeWordEnabled ? 'Hey James On' : 'Hey James Off'}
          </button>

          <button
            type="button"
            onClick={toggleMute}
            className={cn(
              'grid h-10 w-10 place-items-center rounded-xl border bg-white transition',
              isMuted
                ? 'border-rose-200 text-rose-600'
                : 'border-border text-muted hover:border-gold/50 hover:text-ink',
            )}
            title={isMuted ? 'Unmute assistant voice' : 'Mute assistant voice'}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      </section>

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

      {/* Workspace */}
      <section className="grid min-h-[650px] gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Saved conversation rail */}
        <aside
          className={cn(
            'overflow-hidden rounded-2xl border border-border bg-white shadow-xs',
            mobileHistoryOpen ? 'block' : 'hidden',
            'lg:block',
          )}
        >
          <div className="border-b border-border p-3.5">
            <button
              type="button"
              onClick={handleNewConversation}
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-ink px-3 text-xs font-bold text-white transition hover:bg-ink/90"
            >
              <Plus className="h-4 w-4 text-gold" />
              New Conversation
            </button>
          </div>

          <div className="px-3 pb-2 pt-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                Conversation History
              </p>
              <span className="text-[10px] text-muted">{conversations.length}</span>
            </div>
          </div>

          <div className="max-h-[565px] space-y-1.5 overflow-y-auto px-2.5 pb-3">
            {conversations.length ? (
              conversations.map((conversation) => {
                const active = conversation.id === activeConversationId;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => {
                      void switchConversation(conversation.id);
                      setActiveTab('chat');
                      setMobileHistoryOpen(false);
                    }}
                    className={cn(
                      'w-full rounded-xl px-3 py-2.5 text-left transition',
                      active
                        ? 'bg-gold/15 ring-1 ring-gold/30'
                        : 'hover:bg-black/[0.035]',
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <MessageSquare
                        className={cn(
                          'mt-0.5 h-3.5 w-3.5 shrink-0',
                          active ? 'text-[#7a5518]' : 'text-muted',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-ink">
                          {conversation.title || 'New Conversation'}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted">
                          {conversationDate(conversation.updatedAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-[#faf9f6] p-5 text-center">
                <History className="mx-auto h-5 w-5 text-muted/40" />
                <p className="mt-2 text-xs font-semibold text-ink">No saved chats yet</p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted">
                  Your AI conversations will appear here automatically.
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* Chat / Activity workspace */}
        <div className="flex min-h-[650px] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-[#fcfbf8] shadow-xs">
          <div className="flex flex-col gap-3 border-b border-border bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-gold shadow-xs">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-base font-bold text-ink">MH AI Assistant</h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {assistantState}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted">
                  Live data · write actions require confirmation
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 rounded-xl bg-linen p-1">
              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className={cn(
                  'inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition',
                  activeTab === 'chat'
                    ? 'bg-white text-ink shadow-xs'
                    : 'text-muted hover:text-ink',
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
                    ? 'bg-white text-ink shadow-xs'
                    : 'text-muted hover:text-ink',
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
            <div className="min-h-0 flex-1 overflow-hidden bg-white">
              <AIActivityHistory />
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-5 lg:px-7">
                <div className="mx-auto w-full max-w-4xl space-y-5">
                  {messages.length === 0 ? (
                    <div className="flex min-h-[380px] flex-col items-center justify-center text-center">
                      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gold/15 text-[#7a5518]">
                        <Sparkles className="h-6 w-6" />
                      </div>
                      <h3 className="mt-4 font-display text-lg font-bold text-ink">
                        What should we work on?
                      </h3>
                      <p className="mt-1 max-w-md text-xs leading-relaxed text-muted sm:text-sm">
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
                              className="flex items-start gap-3 rounded-xl border border-border bg-white p-3 text-left transition hover:border-gold/60 hover:bg-gold/[0.04]"
                            >
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-linen text-[#7a5518]">
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-xs font-bold text-ink">{command.label}</span>
                                <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
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
                        key={message.id}
                        message={message}
                        onViewInvoice={setViewingInvoice}
                      />
                    ))
                  )}

                  {isProcessing ? (
                    <AIChatMessage
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
                    <div className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-ink">
                      <span className="font-bold text-[#7a5518]">Hearing:</span>{' '}
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

                  <div ref={messagesEndRef} />
                </div>
              </div>

              <div className="border-t border-border bg-white p-3 sm:p-4">
                <div className="mx-auto w-full max-w-4xl">
                  <div className="rounded-2xl border border-border bg-white shadow-xs transition focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/10">
                    <div className="flex items-end gap-2 p-2">
                      <button
                        type="button"
                        onClick={handleVoiceToggle}
                        className={cn(
                          'grid h-10 w-10 shrink-0 place-items-center rounded-xl transition',
                          isListening
                            ? 'bg-rose-600 text-white shadow-rose-200 animate-pulse'
                            : 'bg-gold/20 text-[#7a5518] hover:bg-gold/30',
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
                        className="min-h-10 max-h-[140px] flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-5 text-ink outline-none placeholder:text-muted/60"
                      />

                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!input.trim() || isProcessing}
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-white transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-35"
                        title="Send"
                      >
                        <SendHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[10px] text-muted">
                    <span>Enter to send · Shift+Enter for a new line</span>
                    <button
                      type="button"
                      onClick={clearConversation}
                      className="font-semibold text-[#7a5518] hover:underline"
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

      {/* Quick command library */}
      <section className="rounded-2xl border border-border bg-white p-4 shadow-xs sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Quick Commands</h2>
            <p className="mt-0.5 text-xs text-muted">
              Common live-data questions and safe actions for your current role.
            </p>
          </div>
          <div className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 sm:flex">
            <ShieldCheck className="h-3.5 w-3.5" />
            Confirmation protected
          </div>
        </div>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {quickCommands.map((command) => {
            const Icon = command.icon;
            return (
              <button
                key={command.label + command.query}
                type="button"
                onClick={() => void sendMessage(command.query)}
                className="group flex items-start gap-3 rounded-xl border border-border bg-[#fcfbf8] p-3.5 text-left transition hover:border-gold/60 hover:bg-gold/[0.045]"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-[#7a5518] shadow-xs transition group-hover:bg-gold/15">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-ink">{command.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                    {command.description}
                  </span>
                </span>
                <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted/50 group-hover:text-[#7a5518]" />
              </button>
            );
          })}
        </div>
      </section>

      {viewingInvoice ? (
        <InvoiceModal invoice={viewingInvoice} onClose={() => setViewingInvoice(null)} />
      ) : null}
    </div>
  );
}
