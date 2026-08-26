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
  Zap,
} from 'lucide-react';
import { useAIContext } from '../lib/ai/aiContext';
import { AIChatMessage } from '../components/ai/AIChatMessage';
import { AIVoiceIndicator } from '../components/ai/AIVoiceIndicator';
import { AIActivityHistory } from '../components/ai/AIActivityHistory';
import { cn } from '../lib/utils';
import { isOverdue } from '../lib/date';
import { useCurrency } from '../lib/currency';
import type { Project } from '../lib/types';

export function AIAssistantPage({ projects = [] }: { projects?: Project[] }) {
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeProjects = projects.filter((p) => p.status !== 'Completed' && p.status !== 'Delivered' && p.status !== 'Cancelled');
  const overdueProjects = activeProjects.filter((p) => isOverdue(p));
  const pendingApprovals = activeProjects.filter((p) => p.status === 'Awaiting Client Approval' || p.current_stage?.includes('Approval'));
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

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6 min-h-[calc(100vh-10rem)] max-w-7xl mx-auto w-full">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gold/30 bg-ink p-4 text-white shadow-md">
        <div className="flex items-center gap-3">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gold text-ink shadow">
            <Sparkles className="h-6 w-6" />
            {isListening && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-red-500" />
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-bold tracking-tight text-white">
                MH AI Business Assistant
              </h1>
              <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-semibold text-gold border border-gold/30">
                Phase 2 Safe Actions
              </span>
            </div>
            <p className="text-xs text-white/70">
              Live Voice Operations, Guided Confirmations, Timeline Control & Financial Queries
            </p>
          </div>
        </div>

        {/* Header Controls */}
        <div className="flex items-center gap-2">
          {/* Tab Switcher */}
          <div className="flex rounded-lg bg-white/10 p-1">
            <button
              onClick={() => setActiveTab('chat')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition',
                activeTab === 'chat'
                  ? 'bg-gold text-ink shadow-sm'
                  : 'text-white/70 hover:text-white',
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Assistant Console
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition',
                activeTab === 'activity'
                  ? 'bg-gold text-ink shadow-sm'
                  : 'text-white/70 hover:text-white',
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
            title={isMuted ? 'Unmute Assistant Speech' : 'Mute Assistant Speech'}
            className={cn(
              'rounded-lg border p-2 text-xs font-medium transition',
              isMuted
                ? 'border-red-500/40 bg-red-500/20 text-red-300'
                : 'border-white/20 bg-white/10 text-white/80 hover:bg-white/20',
            )}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          {/* Clear Chat */}
          <button
            onClick={clearConversation}
            title="Clear Chat History"
            className="rounded-lg border border-white/20 bg-white/10 p-2 text-white/70 hover:bg-white/20 hover:text-white transition"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left / Main Column: Chat Console or Activity History */}
        <div className="flex flex-col rounded-xl border border-border bg-card shadow-sm lg:col-span-8 overflow-hidden h-[650px] lg:h-[750px]">
          {activeTab === 'activity' ? (
            <div className="flex-1 overflow-y-auto p-4">
              <AIActivityHistory />
            </div>
          ) : (
            <>
              {/* Message Stream */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((message) => (
                  <AIChatMessage key={message.id} message={message} />
                ))}

                {/* Live Speech Recognition Bubble */}
                {isListening && liveTranscript && (
                  <div className="flex items-start gap-2 text-sm italic text-muted-foreground animate-pulse bg-gold/10 p-3 rounded-lg border border-gold/30">
                    <Mic className="h-4 w-4 text-gold flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="text-xs font-semibold text-gold uppercase tracking-wider block">
                        Listening Live...
                      </span>
                      <span>"{liveTranscript}"</span>
                    </div>
                  </div>
                )}

                {/* Processing Indicator */}
                {isProcessing && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
                    <div className="flex space-x-1">
                      <div className="h-2 w-2 rounded-full bg-gold animate-bounce" />
                      <div className="h-2 w-2 rounded-full bg-gold animate-bounce [animation-delay:0.2s]" />
                      <div className="h-2 w-2 rounded-full bg-gold animate-bounce [animation-delay:0.4s]" />
                    </div>
                    <span>Processing live Tracker data & safe operations...</span>
                  </div>
                )}

                {/* Voice Error Alert */}
                {voiceError && (
                  <div className="flex items-center justify-between rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
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

              {/* Audio Wave Indicator when speaking */}
              {isSpeaking && (
                <div className="border-t border-border bg-gold/10 px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AIVoiceIndicator isSpeaking={isSpeaking} isListening={false} />
                    <span className="text-xs font-medium text-ink">Assistant Speaking...</span>
                  </div>
                  <button
                    onClick={stopSpeaking}
                    className="text-xs font-semibold text-muted-foreground hover:text-ink underline"
                  >
                    Stop Speaking
                  </button>
                </div>
              )}

              {/* Input & Voice Console */}
              <div className="border-t border-border bg-card p-3">
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
                        : 'Ask question or speak a command (e.g. "Put QAI on hold", "What\'s due today?")...'
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
        </div>

        {/* Right Column: Live Tracker Snapshot & Suggested Actions */}
        <div className="flex flex-col gap-4 lg:col-span-4 overflow-y-auto">
          {/* Card 1: Real-Time Operations Snapshot */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-sm font-bold text-ink flex items-center gap-2">
                <Zap className="h-4 w-4 text-gold" />
                Live Operations Snapshot
              </h2>
              <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                Connected
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-border bg-background p-2.5">
                <span className="text-muted-foreground flex items-center gap-1">
                  <FolderKanban className="h-3.5 w-3.5 text-blue-500" /> Active
                </span>
                <p className="mt-1 font-display text-lg font-bold text-ink">
                  {activeProjects.length}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-background p-2.5">
                <span className="text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500" /> Overdue
                </span>
                <p className={cn("mt-1 font-display text-lg font-bold", overdueProjects.length > 0 ? "text-red-600" : "text-ink")}>
                  {overdueProjects.length}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-background p-2.5">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-amber-500" /> Approvals
                </span>
                <p className="mt-1 font-display text-lg font-bold text-amber-600">
                  {pendingApprovals.length}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-background p-2.5">
                <span className="text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3.5 w-3.5 text-emerald-500" /> Receivables
                </span>
                <p className="mt-1 font-display text-sm font-bold text-ink truncate">
                  {formatMoney(totalReceivables)}
                </p>
              </div>
            </div>
          </div>

          {/* Card 2: Voice & Action Shortcuts */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex-1">
            <h2 className="font-display text-sm font-bold text-ink mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-gold" />
              Suggested Voice Commands
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Click any command below to execute or speak aloud:
            </p>

            <div className="space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block">
                📊 Information Queries
              </span>
              <button
                onClick={() => handleQuickPrompt("How many projects are overdue?")}
                className="w-full text-left rounded-lg border border-border/80 bg-background/60 hover:bg-gold/10 hover:border-gold/50 p-2 text-xs font-medium text-ink transition"
              >
                "How many projects are overdue?"
              </button>
              <button
                onClick={() => handleQuickPrompt("Pending client approvals")}
                className="w-full text-left rounded-lg border border-border/80 bg-background/60 hover:bg-gold/10 hover:border-gold/50 p-2 text-xs font-medium text-ink transition"
              >
                "What projects are pending approval?"
              </button>
              <button
                onClick={() => handleQuickPrompt("Who has the most active projects?")}
                className="w-full text-left rounded-lg border border-border/80 bg-background/60 hover:bg-gold/10 hover:border-gold/50 p-2 text-xs font-medium text-ink transition"
              >
                "Who has the most active projects?"
              </button>

              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block pt-2">
                🛡️ Safe Actions & Updates
              </span>
              <button
                onClick={() => handleQuickPrompt("Add a new project named as Good One Client BCH")}
                className="w-full text-left rounded-lg border border-border/80 bg-background/60 hover:bg-gold/10 hover:border-gold/50 p-2 text-xs font-medium text-ink transition"
              >
                "Add a new project named as Good One Client BCH"
              </button>
              <button
                onClick={() => handleQuickPrompt("Put QAI Reformatting on hold")}
                className="w-full text-left rounded-lg border border-border/80 bg-background/60 hover:bg-gold/10 hover:border-gold/50 p-2 text-xs font-medium text-ink transition"
              >
                "Put QAI Reformatting on hold"
              </button>
              <button
                onClick={() => handleQuickPrompt("Assign Founder Notes Workbook revision to Zain")}
                className="w-full text-left rounded-lg border border-border/80 bg-background/60 hover:bg-gold/10 hover:border-gold/50 p-2 text-xs font-medium text-ink transition"
              >
                "Assign Founder Notes revision to Zain"
              </button>
              <button
                onClick={() => handleQuickPrompt("Create a task for Zain to check the print PDF tomorrow")}
                className="w-full text-left rounded-lg border border-border/80 bg-background/60 hover:bg-gold/10 hover:border-gold/50 p-2 text-xs font-medium text-ink transition"
              >
                "Create task for Zain to check print PDF"
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
