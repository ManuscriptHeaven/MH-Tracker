import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import type {
  AIMessage,
  AIConversation,
  AIUserSettings,
  DailySummary,
  AIToolContext,
  AIToolResult,
  AIActionPreview,
  AIActionAuditLog,
  DisambiguationOption,
  AIOperatorIntelligence,
  AIOperatorTelemetrySummary,
} from './aiTypes';
import { aiService } from './aiService';
import { voiceService } from './voiceService';
import { voiceQueryEngine } from './voiceQueryEngine';
import { wakeWordService } from './wakeWordService';
import { buildDailyBriefing } from './dailyBriefing';
import {
  buildOperatorIntelligence,
  emptyOperatorTelemetry,
} from './operatorIntelligence';
import { useCurrency } from '../currency';

function isPersistentConversationId(value?: string | null) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function titleFromPrompt(text: string) {
  const compact = text.trim().replace(/\s+/g, ' ');
  return compact.length > 56 ? `${compact.slice(0, 53)}...` : compact || 'New Conversation';
}

function persistentMessageMetadata(message: AIMessage['metadata']): AIMessage['metadata'] {
  if (!message) return {};
  return {
    toolUsed: message.toolUsed,
    actionStatus: message.actionStatus,
    auditLog: message.auditLog,
    invoice: message.invoice,
    verification: message.verification,
    actionPlan: message.actionPlan,
    suggestedFollowUps: message.suggestedFollowUps,
  };
}

function isClarificationResult(result: AIToolResult) {
  const clarificationErrors = new Set([
    'project_not_found',
    'project_required',
    'task_not_found',
    'client_not_found',
    'ambiguous_client',
    'recipient_not_found',
    'invalid_date',
    'invalid_amount',
    'task_details_required',
    'client_name_required',
    'client_email_required',
  ]);

  return Boolean(
    result.disambiguation?.length ||
      (result.error && clarificationErrors.has(result.error)),
  );
}

function suggestedFollowUpsForResult(result: AIToolResult): string[] {
  switch (result.toolName) {
    case 'get_overdue_projects':
      return ['Which clients?', 'Who is assigned to them?', 'What is due today?'];
    case 'get_pending_approvals':
      return ['Which clients are waiting?', 'What is overdue?', 'Show projects in revision'];
    case 'get_client_receivables':
      return ['Who owes the most?', 'Show order revenue and expenses this month', 'Show invoice summary'];
    case 'get_finance_summary':
      return ['Who owes us money?', 'How much do we owe the team?', 'Show invoice summary'];
    case 'get_employee_workload':
      return ['Who has overdue work?', 'Show active projects summary', 'What is due this week?'];
    case 'get_projects_in_revision':
      return ['Which ones?', 'Who is working on them?', 'What is due this week?'];
    case 'get_project_summary':
      return ['What is overdue?', 'What is due today?', 'What is waiting for client approval?'];
    default:
      return [];
  }
}

interface AIContextType {
  isOpen: boolean;
  isChatMinimized: boolean;
  activeTab: 'chat' | 'activity';
  setActiveTab: (tab: 'chat' | 'activity') => void;
  conversations: AIConversation[];
  activeConversationId: string | null;
  messages: AIMessage[];
  isProcessing: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  isWakeWordListening: boolean;
  liveTranscript: string;
  voiceError: string | null;
  dailySummary: DailySummary | null;
  operatorIntelligence: AIOperatorIntelligence | null;
  showDailyPopup: boolean;
  settings: AIUserSettings;
  pendingAction: AIActionPreview | null;
  auditLogs: AIActionAuditLog[];

  toggleChat: () => void;
  openChat: () => void;
  closeChat: () => void;
  minimizeChat: (min: boolean) => void;
  sendMessage: (text: string) => Promise<void>;
  confirmAction: (action: AIActionPreview) => Promise<void>;
  cancelAction: (action: AIActionPreview) => void;
  selectDisambiguationOption: (option: DisambiguationOption) => Promise<void>;
  startNewConversation: () => void;
  switchConversation: (id: string) => void;
  clearConversation: () => void;
  dismissDailyPopup: () => void;
  updateSettings: (settings: Partial<AIUserSettings>) => Promise<void>;
  startVoice: () => void;
  stopVoice: () => void;
  toggleMute: () => void;
  toggleWakeWordListener: () => void;
  triggerWakeUpGreeting: () => Promise<void>;
  speakText: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  clearVoiceError: () => void;
  refreshDailyBriefing: () => void;
  refreshOperatorIntelligence: () => Promise<void>;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

export function AIProvider({
  children,
  tracker,
  activeView = 'dashboard',
  selectedProject = null,
}: {
  children: ReactNode;
  tracker: any;
  activeView?: string;
  selectedProject?: any;
}) {
  const currencyCtx = useCurrency();
  const [isOpen, setIsOpen] = useState(false);
  const [isChatMinimized, setIsChatMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'activity'>('chat');

  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<AIActionPreview | null>(null);

  const [auditLogs, setAuditLogs] = useState<AIActionAuditLog[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('mh_ai_audit_logs');
        return saved ? JSON.parse(saved) : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [operatorTelemetry, setOperatorTelemetry] = useState<AIOperatorTelemetrySummary>(() =>
    emptyOperatorTelemetry(
      tracker.currentProfile?.role === 'admin' ? 'workspace' : 'personal',
      30,
    ),
  );
  const [operatorIntelligence, setOperatorIntelligence] = useState<AIOperatorIntelligence | null>(null);
  const [showDailyPopup, setShowDailyPopup] = useState(false);

  const [isWakeWordListening, setIsWakeWordListening] = useState(false);

  const [settings, setSettings] = useState<AIUserSettings>({
    voiceEnabled: true,
    voiceLanguage: 'en-US',
    ttsEnabled: true,
    autoSpeak: true,
    isMuted: false,
    wakeWordEnabled: true,
    wakeWord: 'hey james',
    assistantName: 'James',
  });

  // Keep a ref to activeConversationId & settings to avoid stale closures in voice callbacks
  const activeConvoRef = useRef<string | null>(null);
  activeConvoRef.current = activeConversationId;
  const settingsRef = useRef<AIUserSettings>(settings);
  settingsRef.current = settings;
  const trackerRef = useRef<any>(tracker);
  trackerRef.current = tracker;
  const currencyRef = useRef<any>(currencyCtx);
  currencyRef.current = currencyCtx;

  const activeViewRef = useRef<string>(activeView);
  activeViewRef.current = activeView;
  const selectedProjectRef = useRef<any>(selectedProject);
  selectedProjectRef.current = selectedProject;
  const dailyPopupCheckRef = useRef<string | null>(null);

  // Persist audit logs
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('mh_ai_audit_logs', JSON.stringify(auditLogs.slice(0, 100)));
      } catch (e) {}
    }
  }, [auditLogs]);

  const refreshDailyBriefing = useCallback(() => {
    const current = trackerRef.current;
    if (!current?.currentProfile || !current?.data) return;

    setDailySummary(
      buildDailyBriefing({
        data: current.data,
        visibleProjects: current.visibleProjects || current.data.projects || [],
        visibleTasks: current.visibleTasks || current.data.tasks || [],
        currentProfile: current.currentProfile,
      }),
    );
  }, []);

  const refreshOperatorIntelligence = useCallback(async () => {
    const telemetry = await aiService.loadOperatorTelemetry(30);
    setOperatorTelemetry(telemetry);
  }, []);

  useEffect(() => {
    const current = trackerRef.current;
    if (!current?.currentProfile || !current?.data) {
      setOperatorIntelligence(null);
      return;
    }

    setOperatorIntelligence(
      buildOperatorIntelligence({
        data: current.data,
        visibleProjects: current.visibleProjects || current.data.projects || [],
        visibleTasks: current.visibleTasks || current.data.tasks || [],
        currentProfile: current.currentProfile,
        dailySummary,
        telemetry: operatorTelemetry,
      }),
    );
  }, [
    dailySummary,
    operatorTelemetry,
    tracker.data,
    tracker.visibleProjects,
    tracker.visibleTasks,
    tracker.currentProfile?.id,
  ]);

  // Keep the deterministic daily briefing synced to live Tracker data.
  useEffect(() => {
    refreshDailyBriefing();
  }, [
    tracker.data,
    tracker.visibleProjects,
    tracker.visibleTasks,
    tracker.currentProfile?.id,
    refreshDailyBriefing,
  ]);

  // Show the briefing once per day unless this user dismissed it.
  useEffect(() => {
    const userId = tracker.currentProfile?.id;
    if (!userId) return;

    const today = new Date().toISOString().slice(0, 10);
    const checkKey = userId + ':' + today;
    if (dailyPopupCheckRef.current === checkKey) return;
    dailyPopupCheckRef.current = checkKey;
    setShowDailyPopup(false);

    void (async () => {
      const dismissed = await aiService.wasDailySummaryDismissedToday();
      if (!dismissed) {
        setShowDailyPopup(true);
      }
    })();
  }, [tracker.currentProfile?.id]);

  // Initialize user settings and saved conversation history.
  useEffect(() => {
    async function init() {
      const loadedSettings = await aiService.getUserSettings();
      setSettings((prev) => ({ ...prev, ...loadedSettings }));
      voiceService.setMuted(Boolean(loadedSettings.isMuted));
      if (loadedSettings.voiceLanguage) {
        voiceService.setLanguage(loadedSettings.voiceLanguage);
      }

      const userId = trackerRef.current?.currentProfile?.id;
      if (userId) {
        void refreshOperatorIntelligence();
        const loadedConversations = await aiService.loadConversations(userId);
        setConversations(loadedConversations);

        if (loadedConversations.length > 0 && !activeConvoRef.current) {
          const latest = loadedConversations[0];
          setActiveConversationId(latest.id);
          activeConvoRef.current = latest.id;
          const loadedMessages = await aiService.loadMessages(latest.id);
          setMessages(loadedMessages);
        }
      }
    }

    init();
  }, [refreshOperatorIntelligence]);

  // Helper to build tool context with mutations
  const getToolContext = useCallback((): AIToolContext => {
    const t = trackerRef.current;
    const c = currencyRef.current;

    return {
      currentProfile: t.currentProfile,
      data: t.data,
      visibleProjects: t.visibleProjects || [],
      visibleTasks: t.visibleTasks || [],
      displayCurrency: c.displayCurrency || 'USD',
      exchangeRate: c.exchangeRate || 277.5,
      formatMoney: c.formatMoney,
      convertMoney: c.convertMoney,
      activeView: activeViewRef.current,
      selectedProject: selectedProjectRef.current,
      trackerMutations: {
        createProject: t.createProject,
        duplicateProject: t.duplicateProject,
        createTask: t.createTask,
        updateTask: t.updateTask,
        deleteTask: t.deleteTask,
        updateProject: t.updateProject,
        deleteProject: t.deleteProject,
        inviteClient: t.inviteClient,
        addNote: t.addNote,
        createRevisionRequest: t.createRevisionRequest,
        updateRevisionRequest: t.updateRevisionRequest,
        respondToRevisionRequest: t.respondToRevisionRequest,
        approveProjectMilestone: t.approveProjectMilestone,
        submitStageForApproval: t.submitStageForApproval,
        setProjectLifecycle: t.setProjectLifecycle,
        completeFinalDelivery: t.completeFinalDelivery,
        createFinanceTransaction: t.createFinanceTransaction,
        updateFinanceTransaction: t.updateFinanceTransaction,
        deleteFinanceTransaction: t.deleteFinanceTransaction,
        saveInvoiceVersion: t.saveInvoiceVersion,
        addEmployeeLedgerEntry: t.addEmployeeLedgerEntry,
        deleteEmployeeLedgerEntry: t.deleteEmployeeLedgerEntry,
        sendMessage: t.sendMessage,
        getOrCreateDM: t.getOrCreateDM,
        getOrCreateProjectConversation: t.getOrCreateProjectConversation,
        getOrCreateTaskConversation: t.getOrCreateTaskConversation,
      },
    } as any;
  }, []);

  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => {
    setIsOpen(false);
    voiceService.stopSpeaking();
    voiceService.stopListening();
  }, []);

  const toggleChat = useCallback(() => {
    setIsOpen((p) => {
      const next = !p;
      if (!next && isSpeaking) {
        voiceService.stopSpeaking();
      }
      return next;
    });
  }, [isSpeaking]);

  const minimizeChat = useCallback((min: boolean) => setIsChatMinimized(min), []);

  const switchConversation = useCallback(async (id: string) => {
    voiceQueryEngine.clearMemory();
    voiceService.stopSpeaking();
    setPendingAction(null);
    setVoiceError(null);
    setActiveConversationId(id);
    activeConvoRef.current = id;

    if (isPersistentConversationId(id)) {
      const loaded = await aiService.loadMessages(id);
      setMessages(loaded);
    } else {
      setMessages([]);
    }
  }, []);

  const startNewConversation = useCallback(() => {
    voiceQueryEngine.clearMemory();
    voiceService.stopSpeaking();
    setActiveConversationId(null);
    activeConvoRef.current = null;
    setMessages([]);
    setPendingAction(null);
    setVoiceError(null);
    if (!isOpen) openChat();
  }, [isOpen, openChat]);

  // Historical chats are preserved in Supabase. "Clear" starts a fresh chat
  // instead of deleting the audit/history trail.
  const clearConversation = useCallback(() => {
    voiceQueryEngine.clearMemory();
    voiceService.stopSpeaking();
    setActiveConversationId(null);
    activeConvoRef.current = null;
    setMessages([]);
    setPendingAction(null);
    setVoiceError(null);
  }, []);

  const toggleMute = useCallback(() => {
    setSettings((prev) => {
      const nextMuted = !prev.isMuted;
      voiceService.setMuted(nextMuted);
      return { ...prev, isMuted: nextMuted };
    });
  }, []);

  const speakText = useCallback(async (text: string) => {
    if (!text) return;
    await voiceService.speak(text, settingsRef.current.voiceLanguage);
  }, []);

  const stopSpeaking = useCallback(() => {
    voiceService.stopSpeaking();
  }, []);

  const startVoice = useCallback(() => {
    setVoiceError(null);
    voiceService.startListening(settings.voiceLanguage);
  }, [settings.voiceLanguage]);

  const stopVoice = useCallback(() => {
    voiceService.stopListening();
  }, []);

  const toggleWakeWordListener = useCallback(() => {
    setSettings((prev) => {
      const next = !prev.wakeWordEnabled;
      if (!next) {
        wakeWordService.stopListening();
      }
      return { ...prev, wakeWordEnabled: next };
    });
  }, []);

  const clearVoiceError = useCallback(() => {
    setVoiceError(null);
  }, []);

  const triggerWakeUpGreeting = useCallback(async () => {
    setIsOpen(true);
    const userName = trackerRef.current?.currentProfile?.full_name?.split(' ')[0] || 'there';
    const assistantName = settingsRef.current?.assistantName || 'James';
    const welcomeText = `Hello ${userName}! I'm ${assistantName}, your AI Assistant. How can I assist you today?`;

    const welcomeMsg: AIMessage = {
      id: `msg-${Date.now()}`,
      conversationId: activeConversationId || 'default',
      role: 'assistant',
      content: welcomeText,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, welcomeMsg]);

    if (settingsRef.current.ttsEnabled && !settingsRef.current.isMuted) {
      await voiceService.speak(welcomeText, settingsRef.current.voiceLanguage);
    }
    
    startVoice();
  }, [startVoice]);

  // Synchronize Wake Word Service Event Listeners
  useEffect(() => {
    wakeWordService.onListeningStateChange = (active) => {
      setIsWakeWordListening(active);
    };

    wakeWordService.onWakeWordDetected = () => {
      triggerWakeUpGreeting();
    };
  }, [triggerWakeUpGreeting]);

  // Manage background Wake Word listener loop
  useEffect(() => {
    const isManagerOrAdmin =
      trackerRef.current?.canManageAll ||
      trackerRef.current?.currentProfile?.role === 'admin' ||
      trackerRef.current?.currentProfile?.role === 'project_manager' ||
      trackerRef.current?.currentProfile?.role === 'manager';

    if (settings.wakeWordEnabled && !isListening && !isSpeaking && isManagerOrAdmin) {
      wakeWordService.startListening(settings.wakeWord || 'hey james', settings.assistantName || 'James');
    } else {
      wakeWordService.stopListening();
    }
  }, [settings.wakeWordEnabled, settings.wakeWord, settings.assistantName, isListening, isSpeaking]);

  // Voice Event Handlers
  useEffect(() => {
    voiceService.onListeningChange = (listening) => {
      setIsListening(listening);
      if (listening) {
        setVoiceError(null);
      } else {
        setLiveTranscript('');
      }
    };

    voiceService.onSpeakingChange = (speaking) => {
      setIsSpeaking(speaking);
    };

    voiceService.onError = (err) => {
      setVoiceError(err);
      setIsListening(false);
      setLiveTranscript('');
    };

    voiceService.onTranscript = (text, isFinal) => {
      setLiveTranscript(text);
      if (isFinal && text.trim()) {
        sendMessage(text.trim());
      }
    };

    return () => {
      voiceService.onListeningChange = undefined;
      voiceService.onSpeakingChange = undefined;
      voiceService.onError = undefined;
      voiceService.onTranscript = undefined;
    };
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      if (!isOpen) openChat();

      let convoId = activeConvoRef.current;
      if (!convoId) {
        const userId = trackerRef.current?.currentProfile?.id;
        const created = userId
          ? await aiService.createConversation(userId, titleFromPrompt(text))
          : null;

        if (created) {
          convoId = created.id;
          setConversations((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        } else {
          convoId = `conv-${Date.now()}`;
        }

        setActiveConversationId(convoId);
        activeConvoRef.current = convoId;
      }

      const userMsgId = `msg-${Date.now()}`;
      const userMsg: AIMessage = {
        id: userMsgId,
        conversationId: convoId,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsProcessing(true);
      setVoiceError(null);

      if (isPersistentConversationId(convoId)) {
        await aiService.saveMessage(convoId, 'user', text, {});
      }

      const operatorStartedAt = Date.now();

      try {
        const toolCtx = getToolContext();

        // Process query using semantic Natural Language Voice Query Engine
        const result: AIToolResult = await voiceQueryEngine.processQuery(text, toolCtx);

        if (result.pendingAction) {
          setPendingAction(result.pendingAction);
        } else {
          setPendingAction(null);
        }

        if (result.auditLog) {
          setAuditLogs((prev) => [result.auditLog!, ...prev]);
        }

        const assistantMsgId = `msg-${Date.now() + 1}`;
        const assistantMsg: AIMessage = {
          id: assistantMsgId,
          conversationId: convoId,
          role: 'assistant',
          content: result.displayText,
          spokenText: result.spokenText,
          metadata: {
            toolUsed: result.toolName,
            toolResult: result,
            pendingAction: result.pendingAction,
            disambiguation: result.disambiguation,
            auditLog: result.auditLog,
            invoice: result.invoice,
            verification: result.verification,
            actionPlan: result.actionPlan,
            suggestedFollowUps: suggestedFollowUpsForResult(result),
          },
          createdAt: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        if (isPersistentConversationId(convoId)) {
          await aiService.saveMessage(
            convoId,
            'assistant',
            assistantMsg.content,
            persistentMessageMetadata(assistantMsg.metadata),
          );
          await aiService.touchConversation(convoId);
          const now = new Date().toISOString();
          setConversations((prev) =>
            prev
              .map((item) => (item.id === convoId ? { ...item, updatedAt: now } : item))
              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
          );
        }

        void aiService
          .recordOperatorEvent({
            eventType: 'query_result',
            conversationId: isPersistentConversationId(convoId) ? convoId : null,
            toolName: result.toolName,
            success: result.success,
            errorCode: result.error || null,
            requiresConfirmation: Boolean(result.pendingAction),
            wasClarification: isClarificationResult(result),
            hadDisambiguation: Boolean(result.disambiguation?.length),
            verificationStatus: result.verification?.status || null,
            planStepCount: result.actionPlan?.totalSteps || 0,
            latencyMs: Date.now() - operatorStartedAt,
            metadata: {
              userRole: trackerRef.current?.currentProfile?.role || 'unknown',
              activeView: activeViewRef.current || 'unknown',
            },
          })
          .then(refreshOperatorIntelligence);

        // Speak response if voice TTS is enabled and not muted
        if (settingsRef.current.ttsEnabled && settingsRef.current.autoSpeak && !settingsRef.current.isMuted) {
          voiceService.speak(result.spokenText || result.displayText, settingsRef.current.voiceLanguage);
        }
      } catch (e: any) {
        console.error('Error processing query:', e);
        void aiService
          .recordOperatorEvent({
            eventType: 'query_result',
            conversationId: isPersistentConversationId(convoId) ? convoId : null,
            toolName: null,
            success: false,
            errorCode: 'unexpected_error',
            latencyMs: Date.now() - operatorStartedAt,
            metadata: {
              userRole: trackerRef.current?.currentProfile?.role || 'unknown',
              activeView: activeViewRef.current || 'unknown',
            },
          })
          .then(refreshOperatorIntelligence);
        const errorMsg: AIMessage = {
          id: `msg-${Date.now() + 1}`,
          conversationId: convoId,
          role: 'assistant',
          content: `I couldn't complete that request. ${e?.message || 'An unexpected error occurred.'}`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
        if (isPersistentConversationId(convoId)) {
          await aiService.saveMessage(convoId, 'assistant', errorMsg.content, {});
          await aiService.touchConversation(convoId);
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [getToolContext, isOpen, openChat, refreshOperatorIntelligence],
  );

  const confirmAction = useCallback(
    async (action: AIActionPreview) => {
      setIsProcessing(true);
      setPendingAction(null);
      voiceQueryEngine.setPendingAction(null);

      let convoId = activeConvoRef.current;
      if (!convoId) {
        const userId = trackerRef.current?.currentProfile?.id;
        const created = userId
          ? await aiService.createConversation(userId, 'AI action')
          : null;
        convoId = created?.id || `conv-${Date.now()}`;
        if (created) {
          setConversations((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        }
        setActiveConversationId(convoId);
        activeConvoRef.current = convoId;
      }

      const operatorStartedAt = Date.now();

      try {
        const toolCtx = getToolContext();
        const result = await voiceQueryEngine.executeConfirmedAction(action, toolCtx);

        if (result.pendingAction) {
          setPendingAction(result.pendingAction);
        } else {
          setPendingAction(null);
        }

        if (result.auditLog) {
          setAuditLogs((prev) => [result.auditLog!, ...prev]);
        }

        const assistantMsg: AIMessage = {
          id: `msg-${Date.now()}`,
          conversationId: convoId,
          role: 'assistant',
          content: result.displayText,
          spokenText: result.spokenText,
          metadata: {
            toolUsed: action.toolName,
            actionStatus: result.success ? 'confirmed' : 'failed',
            auditLog: result.auditLog,
            pendingAction: result.pendingAction,
            disambiguation: result.disambiguation,
            verification: result.verification,
            actionPlan: result.actionPlan,
            invoice: result.invoice,
          },
          createdAt: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        if (isPersistentConversationId(convoId)) {
          await aiService.saveMessage(
            convoId,
            'assistant',
            assistantMsg.content,
            persistentMessageMetadata(assistantMsg.metadata),
          );
          await aiService.touchConversation(convoId);
        }

        void aiService
          .recordOperatorEvent({
            eventType: 'action_confirmed',
            conversationId: isPersistentConversationId(convoId) ? convoId : null,
            toolName: action.toolName,
            success: result.success && result.verification?.status !== 'failed',
            errorCode:
              result.error ||
              (result.verification?.status === 'failed' ? 'verification_failed' : null),
            requiresConfirmation: true,
            verificationStatus: result.verification?.status || null,
            planStepCount: result.actionPlan?.totalSteps || 0,
            latencyMs: Date.now() - operatorStartedAt,
            metadata: {
              userRole: trackerRef.current?.currentProfile?.role || 'unknown',
              actionCategory: action.category,
            },
          })
          .then(refreshOperatorIntelligence);

        if (settingsRef.current.ttsEnabled && settingsRef.current.autoSpeak && !settingsRef.current.isMuted) {
          voiceService.speak(result.spokenText || result.displayText, settingsRef.current.voiceLanguage);
        }
      } catch (e: any) {
        void aiService
          .recordOperatorEvent({
            eventType: 'action_failed',
            conversationId: isPersistentConversationId(convoId) ? convoId : null,
            toolName: action.toolName,
            success: false,
            errorCode: 'unexpected_action_error',
            requiresConfirmation: true,
            latencyMs: Date.now() - operatorStartedAt,
            metadata: {
              userRole: trackerRef.current?.currentProfile?.role || 'unknown',
              actionCategory: action.category,
            },
          })
          .then(refreshOperatorIntelligence);
        const errorMsg: AIMessage = {
          id: `msg-${Date.now()}`,
          conversationId: convoId,
          role: 'assistant',
          content: `❌ Could not complete action: ${e?.message || 'Unknown error'}`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
        if (isPersistentConversationId(convoId)) {
          await aiService.saveMessage(convoId, 'assistant', errorMsg.content, {});
          await aiService.touchConversation(convoId);
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [getToolContext, refreshOperatorIntelligence],
  );

  const cancelAction = useCallback((action: AIActionPreview) => {
    setPendingAction(null);
    voiceQueryEngine.setPendingAction(null);
    voiceQueryEngine.cancelPendingPlan();

    let convoId = activeConvoRef.current || `conv-${Date.now()}`;
    const cancelMsg: AIMessage = {
      id: `msg-${Date.now()}`,
      conversationId: convoId,
      role: 'assistant',
      content: '🛑 **Action cancelled.** No changes were made.',
      spokenText: 'Action cancelled.',
      metadata: {
        actionStatus: 'cancelled',
      },
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, cancelMsg]);

    if (isPersistentConversationId(convoId)) {
      void aiService.saveMessage(
        convoId,
        'assistant',
        cancelMsg.content,
        persistentMessageMetadata(cancelMsg.metadata),
      );
      void aiService.touchConversation(convoId);
    }

    void aiService
      .recordOperatorEvent({
        eventType: 'action_cancelled',
        conversationId: isPersistentConversationId(convoId) ? convoId : null,
        toolName: action.toolName,
        success: true,
        requiresConfirmation: true,
        metadata: {
          userRole: trackerRef.current?.currentProfile?.role || 'unknown',
          actionCategory: action.category,
        },
      })
      .then(refreshOperatorIntelligence);

    if (settingsRef.current.ttsEnabled && settingsRef.current.autoSpeak && !settingsRef.current.isMuted) {
      voiceService.speak('Action cancelled.', settingsRef.current.voiceLanguage);
    }
  }, [refreshOperatorIntelligence]);

  const selectDisambiguationOption = useCallback(
    async (option: DisambiguationOption) => {
      // Keep the engine's pending disambiguation context intact. processQuery()
      // will match this selected title and resume the original action safely.
      await sendMessage(option.title);
    },
    [sendMessage],
  );

  const dismissDailyPopup = useCallback(() => {
    setShowDailyPopup(false);
    aiService.dismissDailySummary();
  }, []);

  const updateSettings = useCallback(
    async (newSettings: Partial<AIUserSettings>) => {
      const updated = { ...settings, ...newSettings };
      setSettings(updated);
      if (newSettings.isMuted !== undefined) {
        voiceService.setMuted(newSettings.isMuted);
      }
      if (newSettings.voiceLanguage) {
        voiceService.setLanguage(newSettings.voiceLanguage);
      }
      await aiService.updateUserSettings(updated);
    },
    [settings],
  );

  const value = {
    isOpen,
    isChatMinimized,
    activeTab,
    setActiveTab,
    conversations,
    activeConversationId,
    messages,
    isProcessing,
    isListening,
    isSpeaking,
    isMuted: Boolean(settings.isMuted),
    isWakeWordListening,
    liveTranscript,
    voiceError,
    dailySummary,
    operatorIntelligence,
    showDailyPopup,
    settings,
    pendingAction,
    auditLogs,
    toggleChat,
    openChat,
    closeChat,
    minimizeChat,
    sendMessage,
    confirmAction,
    cancelAction,
    selectDisambiguationOption,
    startNewConversation,
    switchConversation,
    clearConversation,
    dismissDailyPopup,
    updateSettings,
    startVoice,
    stopVoice,
    toggleMute,
    toggleWakeWordListener,
    triggerWakeUpGreeting,
    speakText,
    stopSpeaking,
    clearVoiceError,
    refreshDailyBriefing,
    refreshOperatorIntelligence,
  };

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

export function useAIContext() {
  const context = useContext(AIContext);
  if (context === undefined) {
    throw new Error('useAIContext must be used within an AIProvider');
  }
  return context;
}
