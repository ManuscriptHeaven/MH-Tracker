import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  MicOff,
  SendHorizontal,
  Volume2,
  VolumeX,
  Trash2,
  Sparkles,
  History,
  MessageSquare,
  AlertTriangle,
  FolderKanban,
  Clock,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Receipt,
  CheckCircle2,
} from 'lucide-react';
import { useAIContext } from '../lib/ai/aiContext';
import { AIChatMessage } from '../components/ai/AIChatMessage';
import { AIVoiceIndicator } from '../components/ai/AIVoiceIndicator';
import { AIActivityHistory } from '../components/ai/AIActivityHistory';
import { InvoiceModal } from '../components/InvoiceModal';
import { cn } from '../lib/utils';
import { isOverdue } from '../lib/date';
import { useCurrency } from '../lib/currency';
import type { Project, Invoice } from '../lib/types';

interface AIAssistantPageProps {
  projects?: Project[];
}

export function AIAssistantPage({ projects = [] }: AIAssistantPageProps) {
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
    toggleMute,
    stopSpeaking,
    clearConversation,
    clearVoiceError,
    activeTab,
    setActiveTab,
    auditLogs,
  } = useAIContext();

  const { formatMoney } = useCurrency();
  const [input, setInput] = useState('');
  const [activeChipSlide, setActiveChipSlide] = useState(0);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Live KPI Calculations
  const activeProjects = projects.filter(
    (p) => p.status !== 'Completed' && p.status !== 'Delivered' && p.status !== 'Cancelled',
  );
  const overdueProjects = activeProjects.filter((p) => isOverdue(p));
  const pendingApprovals = activeProjects.filter(
    (p) => p.status === 'Awaiting Client Approval' || (p.current_stage || '').includes('Approval'),
  );
  const totalReceivables = projects.reduce((sum, p) => sum + (p.remaining_balance || 0), 0);

  // Auto-scroll on new message or live transcript
  useEffect(() => {
    if (activeTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isProcessing, liveTranscript, activeTab]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    const text = input.trim();
    setInput('');
    sendMessage(text);
  };

  const handleVoiceToggle = () => {
    clearVoiceError();
    if (isListening) {
      stopVoice();
    } else {
      startVoice();
    }
  };

  const handleQuickPrompt = (promptText: string) => {
    sendMessage(promptText);
  };

  // Quick Action Chip Packs (Slide 0 & Slide 1)
  const chipPacks = [
    [
      { label: 'List Overdue', query: 'How many projects are overdue?' },
      { label: 'Active Projects', query: 'Show active projects summary' },
      { label: 'Assign Task', query: 'Create a task for Zain to check the print PDF tomorrow' },
      { label: 'Review Receivables', query: 'Who owes us money and what are the receivables?' },
      { label: 'Generate Invoice (BCH)', query: 'Generate invoice for BCH for all pending payments' },
      { label: 'Pending Approvals', query: 'What projects are waiting for client approval?' },
    ],
    [
      { label: 'Income This Month', query: 'What is our income and net profit this month?' },
      { label: 'Projects in Revision', query: 'How many projects are currently in revision?' },
      { label: 'Team Payroll', query: 'How much do we owe the team in monthly payroll?' },
      { label: 'Put QAI on Hold', query: 'Put QAI Reformatting on hold' },
      { label: 'Move BCH to Print Approval', query: 'Put Project BCH to Print Approval' },
      { label: 'Employee Workload', query: 'Who has the most active projects?' },
    ],
  ];

  return (
    <div className="flex flex-col gap-5 p-4 lg:p-6 max-w-6xl mx-auto w-full min-h-[calc(100vh-8rem)]">
      {/* Top Header & Tab Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs sm:text-sm font-medium text-muted">Welcome back, Tahir</p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-ink">
            AI Assistant
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Assistant Console vs Activity Log */}
          <div className="flex rounded-xl bg-ink/90 p-1 shadow-sm border border-gold/20">
            <button
              onClick={() => setActiveTab('chat')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition',
                activeTab === 'chat'
                  ? 'bg-gold text-ink shadow-sm'
                  : 'text-white/75 hover:text-white',
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Assistant Console
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition',
                activeTab === 'activity'
                  ? 'bg-gold text-ink shadow-sm'
                  : 'text-white/75 hover:text-white',
              )}
            >
              <History className="h-3.5 w-3.5" />
              Activity Log
              {auditLogs.length > 0 && (
                <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.2 text-[10px] font-bold">
                  {auditLogs.length}
                </span>
              )}
            </button>
          </div>

          {/* Voice Mute Toggle */}
          <button
            onClick={toggleMute}
            title={isMuted ? 'Unmute Assistant Voice' : 'Mute Assistant Voice'}
            className={cn(
              'rounded-xl border p-2 text-xs font-medium transition shadow-sm',
              isMuted
                ? 'border-red-500/40 bg-red-500/20 text-red-600'
                : 'border-border bg-card text-muted-foreground hover:bg-gold/10 hover:text-ink',
            )}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          {/* Clear Chat */}
          <button
            onClick={clearConversation}
            title="Clear Chat History"
            className="rounded-xl border border-border bg-card p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition shadow-sm"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {activeTab === 'activity' ? (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm flex-1">
          <AIActivityHistory />
        </div>
      ) : (
        <>
          {/* HERO CENTERPIECE: Luxury AI Voice Console & Live Operational Stage */}
          <div className="relative overflow-hidden rounded-3xl border border-gold/40 bg-gradient-to-b from-[#1c1a17] via-[#141312] to-[#0e0d0d] p-6 text-white shadow-2xl">
            {/* Top Row: Title, Subtitle, and Connected Status Badge */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 text-center sm:text-left">
                <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight text-white flex items-center justify-center sm:justify-start gap-2">
                  <Sparkles className="h-4 w-4 text-gold" />
                  MH AI Business Assistant
                </h2>
                <p className="text-xs text-white/60 mt-0.5">
                  Live Voice Operations, Guided Confirmations, Timeline Control & Financial Queries
                </p>
              </div>

              <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-400 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Connected
              </div>
            </div>

            {/* Middle Section: Left Metrics | Center Glowing Voice Orb | Right Metrics */}
            <div className="my-6 grid grid-cols-1 items-center gap-6 sm:grid-cols-12">
              {/* Left Column Metric Cards */}
              <div className="flex sm:flex-col gap-3 sm:col-span-4">
                {/* Active Projects */}
                <div
                  onClick={() => handleQuickPrompt('Show active projects summary')}
                  className="flex-1 cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-4 transition duration-200 hover:border-gold/50 hover:bg-white/10"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-white/70">
                    <FolderKanban className="h-4 w-4 text-blue-400" />
                    Active
                  </div>
                  <div className="mt-2 font-display text-2xl sm:text-3xl font-bold text-white">
                    {activeProjects.length}
                  </div>
                </div>

                {/* Approvals */}
                <div
                  onClick={() => handleQuickPrompt('What projects are waiting for client approval?')}
                  className="flex-1 cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-4 transition duration-200 hover:border-gold/50 hover:bg-white/10"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-white/70">
                    <Clock className="h-4 w-4 text-amber-400" />
                    Approvals
                  </div>
                  <div className="mt-2 font-display text-2xl sm:text-3xl font-bold text-amber-400">
                    {pendingApprovals.length}
                  </div>
                </div>
              </div>

              {/* Center Glowing Voice Orb */}
              <div className="flex flex-col items-center justify-center sm:col-span-4 relative py-2">
                {/* Carousel arrow Left */}
                <button
                  onClick={() => setActiveChipSlide((prev) => (prev === 0 ? 1 : 0))}
                  title="Previous Prompt Pack"
                  className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-white/40 hover:text-white hover:bg-white/10 transition hidden lg:block"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>

                {/* The Glowing Orb Disc */}
                <div className="relative flex items-center justify-center">
                  {/* Pulsating outer acoustic glow */}
                  <div
                    className={cn(
                      'absolute h-32 w-32 rounded-full transition-all duration-700',
                      isListening
                        ? 'bg-red-500/30 animate-ping scale-125'
                        : isSpeaking
                          ? 'bg-gold/30 animate-pulse scale-110'
                          : 'bg-gold/15 scale-100',
                    )}
                  />
                  <div
                    className={cn(
                      'absolute h-28 w-28 rounded-full border border-gold/40 transition-transform duration-500',
                      (isListening || isSpeaking) && 'scale-110 border-gold shadow-[0_0_30px_rgba(212,175,55,0.4)]',
                    )}
                  />

                  {/* Core Orb Button */}
                  <button
                    onClick={handleVoiceToggle}
                    title={isListening ? 'Tap to Stop Listening' : 'Tap to Speak'}
                    className={cn(
                      'relative z-10 flex h-24 w-24 items-center justify-center rounded-full shadow-2xl transition-all duration-300 transform active:scale-95',
                      isListening
                        ? 'bg-gradient-to-tr from-red-600 to-red-400 text-white shadow-red-500/50 ring-4 ring-red-400/40 animate-pulse'
                        : isSpeaking
                          ? 'bg-gradient-to-tr from-[#c89c3a] via-gold to-[#f3e198] text-ink shadow-[0_0_35px_rgba(212,175,55,0.6)] ring-4 ring-gold/40'
                          : 'bg-gradient-to-tr from-[#b88c30] via-gold to-[#e8d28a] text-ink hover:scale-105 shadow-[0_0_25px_rgba(212,175,55,0.35)]',
                    )}
                  >
                    {isListening ? (
                      <MicOff className="h-10 w-10 animate-bounce" />
                    ) : (
                      <Mic className="h-10 w-10" />
                    )}
                  </button>
                </div>

                {/* Dynamic State Label below Orb */}
                <div className="mt-3 text-center">
                  <span
                    className={cn(
                      'font-display text-sm font-semibold tracking-wide block transition-colors',
                      isListening
                        ? 'text-red-400 animate-pulse'
                        : isSpeaking
                          ? 'text-gold'
                          : isProcessing
                            ? 'text-amber-300'
                            : 'text-white/90',
                    )}
                  >
                    {isListening
                      ? 'Listening...'
                      : isSpeaking
                        ? 'Assistant Speaking...'
                        : isProcessing
                          ? 'Processing live data...'
                          : 'Tap to Speak'}
                  </span>
                  {liveTranscript && isListening && (
                    <span className="text-xs text-white/70 italic max-w-xs block mt-1 line-clamp-1">
                      "{liveTranscript}"
                    </span>
                  )}
                </div>

                {/* Carousel arrow Right */}
                <button
                  onClick={() => setActiveChipSlide((prev) => (prev === 0 ? 1 : 0))}
                  title="Next Prompt Pack"
                  className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-white/40 hover:text-white hover:bg-white/10 transition hidden lg:block"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>

              {/* Right Column Metric Cards */}
              <div className="flex sm:flex-col gap-3 sm:col-span-4">
                {/* Overdue Projects */}
                <div
                  onClick={() => handleQuickPrompt('How many projects are overdue?')}
                  className="flex-1 cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-4 transition duration-200 hover:border-red-500/50 hover:bg-red-500/10"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-white/70">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    Overdue
                  </div>
                  <div
                    className={cn(
                      'mt-2 font-display text-2xl sm:text-3xl font-bold',
                      overdueProjects.length > 0 ? 'text-red-400' : 'text-white',
                    )}
                  >
                    {overdueProjects.length}
                  </div>
                </div>

                {/* Receivables */}
                <div
                  onClick={() => handleQuickPrompt('Who owes us money and what are the receivables?')}
                  className="flex-1 cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-4 transition duration-200 hover:border-emerald-500/50 hover:bg-emerald-500/10"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-white/70">
                    <DollarSign className="h-4 w-4 text-emerald-400" />
                    Receivables
                  </div>
                  <div className="mt-2 font-display text-lg sm:text-2xl font-bold text-emerald-400 truncate">
                    {formatMoney(totalReceivables)}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Quick Action Chips */}
            <div className="border-t border-white/10 pt-4">
              <div className="flex flex-wrap items-center justify-center gap-2">
                {chipPacks[activeChipSlide].map((chip) => (
                  <button
                    key={chip.label}
                    onClick={() => handleQuickPrompt(chip.query)}
                    className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-white/80 transition hover:border-gold hover:bg-gold/15 hover:text-white shadow-sm"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* CONVERSATION STREAM & ACTION LOG */}
          <div className="flex flex-col rounded-3xl border border-border bg-card shadow-sm p-4 min-h-[320px] max-h-[480px] overflow-y-auto">
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center text-center p-8 text-muted-foreground">
                <div className="h-12 w-12 rounded-full bg-gold/10 text-gold flex items-center justify-center mb-3">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h3 className="font-display text-base font-bold text-ink">Ready to Assist</h3>
                <p className="text-xs max-w-md mt-1">
                  Ask questions, manage projects, update timeline stages, or say{' '}
                  <strong className="text-ink">"Generate invoice for BCH"</strong> to compile pending
                  payments.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <AIChatMessage
                    key={message.id}
                    message={message}
                    onViewInvoice={(invoice) => setViewingInvoice(invoice)}
                  />
                ))}

                {/* Processing Spinner */}
                {isProcessing && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
                    <div className="flex space-x-1">
                      <div className="h-2 w-2 rounded-full bg-gold animate-bounce" />
                      <div className="h-2 w-2 rounded-full bg-gold animate-bounce [animation-delay:0.2s]" />
                      <div className="h-2 w-2 rounded-full bg-gold animate-bounce [animation-delay:0.4s]" />
                    </div>
                    <span>Processing live Tracker data & safe actions...</span>
                  </div>
                )}

                {/* Voice Error Alert */}
                {voiceError && (
                  <div className="flex items-center justify-between rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                      <span>{voiceError}</span>
                    </div>
                    <button
                      onClick={clearVoiceError}
                      className="text-xs underline hover:no-underline font-semibold"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* BOTTOM FLOATING / STICKY VOICE & TEXT INPUT CONSOLE */}
          <div className="rounded-2xl border border-border bg-card p-2.5 shadow-md">
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleVoiceToggle}
                title={isListening ? 'Stop Listening' : 'Speak to Assistant'}
                className={cn(
                  'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl transition shadow-sm',
                  isListening
                    ? 'bg-red-500 text-white animate-pulse shadow-red-500/50'
                    : 'bg-gold text-ink hover:bg-gold/90',
                )}
              >
                {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>

              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  isListening
                    ? 'Listening to your voice...'
                    : 'Ask question or speak a command (e.g. "Generate invoice for BCH", "Put QAI on hold")...'
                }
                disabled={isProcessing}
                className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/50"
              />

              <button
                type="submit"
                disabled={!input.trim() || isProcessing}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-ink text-white transition hover:bg-ink/90 disabled:opacity-40"
              >
                <SendHorizontal className="h-5 w-5" />
              </button>
            </form>
          </div>
        </>
      )}

      {/* Full Printable / Downloadable Invoice Modal */}
      {viewingInvoice && (
        <InvoiceModal invoice={viewingInvoice} onClose={() => setViewingInvoice(null)} />
      )}
    </div>
  );
}
