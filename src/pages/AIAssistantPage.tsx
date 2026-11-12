import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Command,
  FolderKanban,
  LayoutGrid,
  Mic,
  MicOff,
  ShieldCheck,
  Sparkles,
  Square,
  Plus,
  FolderPlus,
} from 'lucide-react';
import { useAIContext } from '../lib/ai/aiContext';
import { AIQuickCommandsPanel } from '../components/ai/AIQuickCommandsPanel';
import { AIVoiceHeroPanel } from '../components/ai/AIVoiceHeroPanel';
import { AIChatPanelV2 } from '../components/ai/AIChatPanelV2';
import { AICreationForm, type CreationFormSelection } from '../components/ai/AICreationForm';
import { AIOperatorIntelligencePanel } from '../components/ai/AIOperatorIntelligencePanel';
import { InvoiceModal } from '../components/InvoiceModal';
import { assistantState, dashboardCommands } from '../lib/ai/dashboardV2';
import { firstName } from '../lib/utils';
import { isDueToday, isOverdue } from '../lib/date';
import type { Invoice, Profile, Project } from '../lib/types';
import '../styles/ai-dashboard.css';

interface AIAssistantPageProps {
  projects?: Project[];
  profiles?: Profile[];
  currentProfile: Profile;
}

function loadRecent(userId: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(`mh_ai_recent_commands:${userId}`) || '[]');
    return Array.isArray(value)
      ? value.filter((item) => typeof item === 'string').slice(0, 10)
      : [];
  } catch {
    return [];
  }
}

export function AIAssistantPage({
  projects = [],
  profiles = [],
  currentProfile,
}: AIAssistantPageProps) {
  const {
    sendMessage,
    isProcessing,
    isListening,
    isSpeaking,
    pendingAction,
    voiceError,
    clearVoiceError,
    startVoice,
    stopVoice,
    stopSpeaking,
    startNewConversation,
    activeTab,
    setActiveTab,
    dailySummary,
    refreshDailyBriefing,
    settings,
    messages,
  } = useAIContext();
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => loadRecent(currentProfile.id));
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [creationForm, setCreationForm] = useState<CreationFormSelection | null>(null);
  const openedFormMessageRef = useRef<string | null>(null);
  const closeCreationForm = useCallback(() => {
    stopVoice();
    setCreationForm(null);
  }, [stopVoice]);
  const commands = useMemo(
    () => dashboardCommands(currentProfile, projects),
    [currentProfile, projects],
  );
  const userName = firstName(currentProfile.full_name);
  const lastReply = [...messages].reverse().find((message) => message.role === 'assistant');
  const lastResult = lastReply?.metadata?.toolResult;
  useEffect(() => {
    const form = lastResult?.data?.creationForm;
    if (
      isProcessing ||
      !lastReply ||
      openedFormMessageRef.current === lastReply.id ||
      !form ||
      !['task', 'project'].includes(form.kind)
    )
      return;
    openedFormMessageRef.current = lastReply.id;
    stopVoice();
    stopSpeaking();
    setCommandsOpen(false);
    setCreationForm({ kind: form.kind, draft: form.draft });
  }, [lastReply, lastResult, isProcessing, stopVoice, stopSpeaking]);
  const requestFailed =
    !isProcessing &&
    !pendingAction &&
    (lastReply?.metadata?.actionStatus === 'failed' ||
      (lastResult?.success === false &&
        !lastResult.disambiguation?.length &&
        !/required|not_found|ambiguous|invalid_date|invalid_amount/.test(lastResult.error || '')));
  const state = assistantState({
    requestFailed,
    isListening,
    isSpeaking,
    isProcessing,
    voiceError,
    hasPendingAction: Boolean(pendingAction),
  });
  const closeCommands = useCallback(() => setCommandsOpen(false), []);
  useEffect(() => {
    setRecent(loadRecent(currentProfile.id));
  }, [currentProfile.id]);
  useEffect(
    () => () => {
      stopVoice();
      stopSpeaking();
    },
    [stopVoice, stopSpeaking],
  );
  useEffect(() => {
    const root = dashboardRef.current;
    if (!root) return;
    const nav = document.querySelector('[data-mobile-bottom-nav]');
    const composer = root.querySelector('.ai-chat-composer');
    const measure = () => {
      root.style.setProperty(
        '--ai-mobile-nav-height',
        `${nav?.getBoundingClientRect().height || 64}px`,
      );
      root.style.setProperty(
        '--ai-composer-height',
        `${composer?.getBoundingClientRect().height || 0}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    if (nav) observer.observe(nav);
    if (composer) observer.observe(composer);
    measure();
    return () => observer.disconnect();
  }, [activeTab]);

  function handleCommand(query: string) {
    if (isProcessing) return;
    stopVoice();
    stopSpeaking();
    clearVoiceError();
    setRecent((previous) => {
      const next = [query, ...previous.filter((item) => item !== query)].slice(0, 10);
      try {
        localStorage.setItem(`mh_ai_recent_commands:${currentProfile.id}`, JSON.stringify(next));
      } catch {
        /* Storage may be unavailable in private browsing. */
      }
      return next;
    });
    setActiveTab('chat');
    setCommandsOpen(false);
    if (query === 'Create a task' || query === 'Create a new project') {
      setCreationForm({ kind: query === 'Create a task' ? 'task' : 'project' });
      return;
    }
    void sendMessage(query);
  }
  function handleNewChat() {
    if (isProcessing) return;
    startNewConversation();
    setActiveTab('chat');
    setCommandsOpen(false);
  }
  function handleVoice() {
    clearVoiceError();
    if (isSpeaking) stopSpeaking();
    else if (isListening) stopVoice();
    else if (!isProcessing) startVoice();
  }
  const activeProjects = projects.filter(
    (project) =>
      !['completed', 'delivered', 'cancelled', 'archived'].includes(
        String(project.status).toLowerCase(),
      ) &&
      !['completed', 'cancelled', 'archived'].includes(
        String(project.project_status || '').toLowerCase(),
      ),
  );
  const metrics = [
    {
      label: 'Active projects',
      value: activeProjects.length,
      query: 'Show active projects summary',
      tone: 'gold',
    },
    {
      label: 'Overdue',
      value: activeProjects.filter(isOverdue).length,
      query: 'How many projects are overdue?',
      tone: 'amber',
    },
    {
      label: 'Due today',
      value: activeProjects.filter(isDueToday).length,
      query: 'What projects are due today?',
      tone: 'green',
    },
  ];

  return (
    <div ref={dashboardRef} className="mh-ai" data-dashboard-version="2">
      <header className="ai-page-header">
        <div>
          <div className="ai-brand-line">
            <span className="ai-mh-monogram">MH</span>
            <span>Live Workspace Intelligence</span>
            <i />
            <span>ASSISTANT V2</span>
          </div>
          <h1>
            AI Command Center<span>Make room for what matters.</span>
          </h1>
        </div>
        <div className="ai-header-actions">
          <button
            className="ai-outline-button ai-create-command"
            disabled={isProcessing}
            onClick={() => handleCommand('Create a new project')}
          >
            <FolderPlus size={15} />
            New Project
          </button>
          <button
            className="ai-speak-button ai-create-command"
            disabled={isProcessing}
            onClick={() => handleCommand('Create a task')}
          >
            <Plus size={15} />
            New Task
          </button>
          <span className="ai-private-label">
            <ShieldCheck size={13} /> Confirmation protected
          </span>
          <button
            className="ai-outline-button ai-open-commands"
            onClick={() => setCommandsOpen(true)}
            aria-expanded={commandsOpen}
            aria-controls="ai-command-rail"
          >
            <Command size={15} />
            Commands
          </button>
        </div>
      </header>
      <div className="ai-workspace-strip">
        <span>
          <FolderKanban size={14} /> Workspace at a glance
        </span>
        <div>
          {metrics.map((metric) => (
            <button
              key={metric.label}
              disabled={isProcessing}
              onClick={() => handleCommand(metric.query)}
            >
              <i className={`ai-metric-dot ${metric.tone}`} />
              <strong>{metric.value}</strong> {metric.label}
              <ArrowUpRight size={11} />
            </button>
          ))}
        </div>
        <span className="ai-connected">
          <i /> Live workspace context
        </span>
      </div>
      <div className="ai-dashboard-grid">
        <AIQuickCommandsPanel
          commands={commands}
          recent={recent.filter((query) => commands.some((command) => command.query === query))}
          disabled={isProcessing}
          open={commandsOpen}
          onClose={closeCommands}
          onCommand={handleCommand}
          onNewChat={handleNewChat}
        />
        <AIVoiceHeroPanel
          state={state}
          userName={userName}
          commands={commands}
          onCommand={handleCommand}
          onVoice={handleVoice}
        />
        <AIChatPanelV2
          onVoice={handleVoice}
          onNewChat={handleNewChat}
          onViewInvoice={setViewingInvoice}
        />
      </div>
      <div className="ai-dashboard-footer">
        <span>
          <Sparkles size={12} /> Built around your workspace.
        </span>
        <span>
          <ShieldCheck size={12} /> Click-to-speak only · You approve every change
        </span>
      </div>
      <details className="ai-workspace-details">
        <summary>
          <LayoutGrid size={15} /> Workspace insights & assistant health
        </summary>
        <div className="ai-details-content">
          {dailySummary && (
            <section className="ai-daily-details">
              <div>
                <span className="ai-eyebrow">TODAY’S AI BRIEFING</span>
                <button className="ai-outline-button" onClick={refreshDailyBriefing}>
                  Refresh briefing
                </button>
              </div>
              <h2>{dailySummary.headline}</h2>
              <p>
                {dailySummary.overdueProjects.count} overdue · {dailySummary.dueToday.count} due
                today · {dailySummary.awaitingApprovals.count} awaiting approval ·{' '}
                {dailySummary.overdueTasks.count} overdue tasks
              </p>
              {dailySummary.proactiveInsights.slice(0, 3).map((insight) => (
                <p key={insight.type + insight.title}>
                  <strong>{insight.title}</strong> — {insight.description}
                </p>
              ))}
            </section>
          )}
          <AIOperatorIntelligencePanel />
        </div>
      </details>
      <div className="ai-mobile-actions">
        <button
          className="ai-outline-button"
          onClick={() => setCommandsOpen(true)}
          aria-expanded={commandsOpen}
          aria-controls="ai-command-rail"
        >
          <Command size={16} />
          Commands
        </button>
        <button
          className="ai-speak-button"
          disabled={isProcessing || (!settings.voiceEnabled && !isListening && !isSpeaking)}
          onClick={handleVoice}
        >
          {isSpeaking ? (
            <Square size={16} />
          ) : isListening ? (
            <MicOff size={16} />
          ) : (
            <Mic size={16} />
          )}
          {isSpeaking ? 'Stop Speaking' : isListening ? 'Stop Listening' : 'Speak'}
        </button>
      </div>
      {viewingInvoice && (
        <InvoiceModal invoice={viewingInvoice} onClose={() => setViewingInvoice(null)} />
      )}
      {creationForm && (
        <AICreationForm
          key={creationForm.kind + (openedFormMessageRef.current || '')}
          selection={creationForm}
          projects={projects}
          profiles={profiles}
          onClose={closeCreationForm}
        />
      )}
    </div>
  );
}
