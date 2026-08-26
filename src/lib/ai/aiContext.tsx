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
} from './aiTypes';
import { aiService } from './aiService';
import { voiceService } from './voiceService';
import { voiceQueryEngine } from './voiceQueryEngine';
import { useCurrency } from '../currency';

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
  liveTranscript: string;
  voiceError: string | null;
  dailySummary: DailySummary | null;
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
  speakText: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  clearVoiceError: () => void;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

export function AIProvider({ children, tracker }: { children: ReactNode; tracker: any }) {
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
  const [showDailyPopup, setShowDailyPopup] = useState(false);

  const [settings, setSettings] = useState<AIUserSettings>({
    voiceEnabled: true,
    voiceLanguage: 'en-US',
    ttsEnabled: true,
    autoSpeak: true,
    isMuted: false,
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

  // Persist audit logs
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('mh_ai_audit_logs', JSON.stringify(auditLogs.slice(0, 100)));
      } catch (e) {}
    }
  }, [auditLogs]);

  // Initialize initial greeting or load user settings
  useEffect(() => {
    async function init() {
      const loadedSettings = await aiService.getUserSettings();
      setSettings((prev) => ({ ...prev, ...loadedSettings }));
      voiceService.setMuted(Boolean(loadedSettings.isMuted));
      if (loadedSettings.voiceLanguage) {
        voiceService.setLanguage(loadedSettings.voiceLanguage);
      }

      const summary = await aiService.getDailySummary();
      if (summary) {
        setDailySummary(summary);
      }
    }

    init();
  }, []);

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
        createFinanceTransaction: t.createFinanceTransaction,
        updateFinanceTransaction: t.updateFinanceTransaction,
        deleteFinanceTransaction: t.deleteFinanceTransaction,
        addEmployeeLedgerEntry: t.addEmployeeLedgerEntry,
        deleteEmployeeLedgerEntry: t.deleteEmployeeLedgerEntry,
        sendMessage: t.sendMessage,
        getOrCreateDM: t.getOrCreateDM,
        getOrCreateProjectConversation: t.getOrCreateProjectConversation,
        getOrCreateTaskConversation: t.getOrCreateTaskConversation,
      },
    };
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
    setActiveConversationId(id);
  }, []);

  const startNewConversation = useCallback(() => {
    voiceQueryEngine.clearMemory();
    const newId = `conv-${Date.now()}`;
    setActiveConversationId(newId);
    setMessages([]);
    setPendingAction(null);
    setVoiceError(null);
    if (!isOpen) openChat();
  }, [isOpen, openChat]);

  const clearConversation = useCallback(() => {
    voiceQueryEngine.clearMemory();
    voiceService.stopSpeaking();
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

  const clearVoiceError = useCallback(() => {
    setVoiceError(null);
  }, []);

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
        convoId = `conv-${Date.now()}`;
        setActiveConversationId(convoId);
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
          },
          createdAt: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        // Speak response if voice TTS is enabled and not muted
        if (settingsRef.current.ttsEnabled && settingsRef.current.autoSpeak && !settingsRef.current.isMuted) {
          voiceService.speak(result.spokenText || result.displayText, settingsRef.current.voiceLanguage);
        }
      } catch (e: any) {
        console.error('Error processing query:', e);
        const errorMsg: AIMessage = {
          id: `msg-${Date.now() + 1}`,
          conversationId: convoId,
          role: 'assistant',
          content: `I couldn't complete that request. ${e?.message || 'An unexpected error occurred.'}`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsProcessing(false);
      }
    },
    [getToolContext, isOpen, openChat],
  );

  const confirmAction = useCallback(
    async (action: AIActionPreview) => {
      setIsProcessing(true);
      setPendingAction(null);
      voiceQueryEngine.setPendingAction(null);

      let convoId = activeConvoRef.current || `conv-${Date.now()}`;

      try {
        const toolCtx = getToolContext();
        const result = await voiceQueryEngine.executeAction(action, toolCtx);

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
          },
          createdAt: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        if (settingsRef.current.ttsEnabled && settingsRef.current.autoSpeak && !settingsRef.current.isMuted) {
          voiceService.speak(result.spokenText || result.displayText, settingsRef.current.voiceLanguage);
        }
      } catch (e: any) {
        const errorMsg: AIMessage = {
          id: `msg-${Date.now()}`,
          conversationId: convoId,
          role: 'assistant',
          content: `❌ Could not complete action: ${e?.message || 'Unknown error'}`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsProcessing(false);
      }
    },
    [getToolContext],
  );

  const cancelAction = useCallback((action: AIActionPreview) => {
    setPendingAction(null);
    voiceQueryEngine.setPendingAction(null);

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

    if (settingsRef.current.ttsEnabled && settingsRef.current.autoSpeak && !settingsRef.current.isMuted) {
      voiceService.speak('Action cancelled.', settingsRef.current.voiceLanguage);
    }
  }, []);

  const selectDisambiguationOption = useCallback(
    async (option: DisambiguationOption) => {
      const toolCtx = getToolContext();
      const mem = voiceQueryEngine.getMemory();
      const context = mem.pendingDisambiguationContext;
      voiceQueryEngine.setPendingDisambiguation(null);

      // Re-trigger query resolution with disambiguated title
      await sendMessage(option.title);
    },
    [getToolContext, sendMessage],
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
    liveTranscript,
    voiceError,
    dailySummary,
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
    speakText,
    stopSpeaking,
    clearVoiceError,
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
