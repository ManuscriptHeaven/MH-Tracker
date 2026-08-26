import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { voiceService } from './voiceService';
import { voiceQueryEngine } from './voiceQueryEngine';
import { aiService } from './aiService';
import { useCurrency } from '../currency';
import type { 
  AIConversation, AIMessage, AIUserSettings, DailySummary, AIToolContext, AIToolResult
} from './aiTypes';

interface AIContextType {
  isOpen: boolean;
  isChatMinimized: boolean;
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
  
  toggleChat: () => void;
  openChat: () => void;
  closeChat: () => void;
  minimizeChat: (min: boolean) => void;
  sendMessage: (text: string) => Promise<void>;
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
}

const AIContext = createContext<AIContextType | undefined>(undefined);

export function AIProvider({ children, tracker }: { children: ReactNode; tracker: any }) {
  const currencyCtx = useCurrency();
  const [isOpen, setIsOpen] = useState(false);
  const [isChatMinimized, setIsChatMinimized] = useState(false);
  
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  
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

  // Initialize initial greeting or load user settings
  useEffect(() => {
    async function init() {
      const loadedSettings = await aiService.getUserSettings();
      setSettings(prev => ({ ...prev, ...loadedSettings }));
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

  const toggleChat = useCallback(() => {
    setIsOpen(p => {
      const next = !p;
      if (!next && isSpeaking) {
        voiceService.stopSpeaking();
      }
      return next;
    });
  }, [isSpeaking]);

  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => {
    setIsOpen(false);
    voiceService.stopSpeaking();
    voiceService.stopListening();
  }, []);

  const minimizeChat = useCallback((min: boolean) => setIsChatMinimized(min), []);

  const switchConversation = useCallback(async (id: string) => {
    setActiveConversationId(id);
  }, []);

  const startNewConversation = useCallback(() => {
    voiceQueryEngine.clearMemory();
    const newId = `conv-${Date.now()}`;
    setActiveConversationId(newId);
    setMessages([]);
    setVoiceError(null);
    if (!isOpen) openChat();
  }, [isOpen, openChat]);

  const clearConversation = useCallback(() => {
    voiceQueryEngine.clearMemory();
    voiceService.stopSpeaking();
    setMessages([]);
    setVoiceError(null);
  }, []);

  const toggleMute = useCallback(() => {
    setSettings(prev => {
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

  const sendMessage = useCallback(async (text: string) => {
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
      createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, userMsg]);
    setIsProcessing(true);
    setVoiceError(null);

    try {
      const t = trackerRef.current;
      const c = currencyRef.current;

      const toolCtx: AIToolContext = {
        currentProfile: t.currentProfile,
        data: t.data,
        visibleProjects: t.visibleProjects || [],
        visibleTasks: t.visibleTasks || [],
        displayCurrency: c.displayCurrency || 'USD',
        exchangeRate: c.exchangeRate || 277.5,
        formatMoney: c.formatMoney,
        convertMoney: c.convertMoney,
      };

      // Process query using semantic Natural Language Voice Query Engine
      const result: AIToolResult = await voiceQueryEngine.processQuery(text, toolCtx);

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
        },
        createdAt: new Date().toISOString()
      };

      setMessages(prev => [...prev, assistantMsg]);

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
        content: "I'm having trouble answering right now. Please try again.",
        spokenText: "I'm having trouble answering right now. Please try again.",
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsProcessing(false);
    }
  }, [isOpen, openChat]);

  const dismissDailyPopup = useCallback(() => {
    setShowDailyPopup(false);
    aiService.dismissDailySummary();
  }, []);

  const updateSettings = useCallback(async (newSettings: Partial<AIUserSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    if (newSettings.isMuted !== undefined) {
      voiceService.setMuted(newSettings.isMuted);
    }
    if (newSettings.voiceLanguage) {
      voiceService.setLanguage(newSettings.voiceLanguage);
    }
    await aiService.updateUserSettings(updated);
  }, [settings]);

  const startVoice = useCallback(() => {
    setVoiceError(null);
    voiceService.startListening(settings.voiceLanguage);
  }, [settings.voiceLanguage]);

  const stopVoice = useCallback(() => {
    voiceService.stopListening();
  }, []);

  const value = {
    isOpen, isChatMinimized, conversations, activeConversationId,
    messages, isProcessing, isListening, isSpeaking, isMuted: Boolean(settings.isMuted),
    liveTranscript, voiceError, dailySummary, showDailyPopup,
    settings,
    toggleChat, openChat, closeChat, minimizeChat, sendMessage,
    startNewConversation, switchConversation, clearConversation,
    dismissDailyPopup, updateSettings, startVoice, stopVoice, toggleMute,
    speakText, stopSpeaking
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
