import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { aiService } from './aiService';
import { voiceService } from './voiceService';
import { parseCommand, executeCommand } from './aiCommands';
import type { 
  AIConversation, AIMessage, AIUserSettings, DailySummary, AICommand 
} from './aiTypes';

interface AIContextType {
  isOpen: boolean;
  isChatMinimized: boolean;
  conversations: AIConversation[];
  activeConversationId: string | null;
  messages: AIMessage[];
  isStreaming: boolean;
  streamingText: string;
  dailySummary: DailySummary | null;
  showDailyPopup: boolean;
  settings: AIUserSettings;
  isListening: boolean;
  isSpeaking: boolean;
  pendingCommand: AICommand | null;
  
  toggleChat: () => void;
  openChat: () => void;
  closeChat: () => void;
  minimizeChat: (min: boolean) => void;
  sendMessage: (text: string) => Promise<void>;
  startNewConversation: () => void;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  dismissDailyPopup: () => void;
  updateSettings: (settings: Partial<AIUserSettings>) => Promise<void>;
  startVoice: () => void;
  stopVoice: () => void;
  confirmAction: (command: AICommand) => Promise<void>;
  cancelAction: () => void;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

export function AIProvider({ children, tracker }: { children: ReactNode, tracker: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isChatMinimized, setIsChatMinimized] = useState(false);
  
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [showDailyPopup, setShowDailyPopup] = useState(false);
  
  const [settings, setSettings] = useState<AIUserSettings>({
    voiceEnabled: false,
    voiceLanguage: 'en-US',
    ttsEnabled: false,
    autoSpeak: false
  });
  
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const [pendingCommand, setPendingCommand] = useState<AICommand | null>(null);

  useEffect(() => {
    async function init() {
      const userId = 'local-user'; // Replace with real auth if needed
      
      const loadedSettings = await aiService.getUserSettings();
      setSettings(loadedSettings);
      
      const summary = await aiService.getDailySummary();
      if (summary) {
        setDailySummary(summary);
        setShowDailyPopup(true);
      }
      
      const loadedConvos = await aiService.loadConversations(userId);
      setConversations(loadedConvos);
      if (loadedConvos.length > 0) {
        switchConversation(loadedConvos[0].id);
      }
    }
    
    init();
  }, []);

  useEffect(() => {
    voiceService.onListeningChange = setIsListening;
    voiceService.onSpeakingChange = setIsSpeaking;
    voiceService.onTranscript = (text, isFinal) => {
      if (isFinal) {
        sendMessage(text);
      }
    };
    
    return () => {
      voiceService.onListeningChange = undefined;
      voiceService.onSpeakingChange = undefined;
      voiceService.onTranscript = undefined;
    };
  }, [activeConversationId, settings]);

  const toggleChat = useCallback(() => setIsOpen(p => !p), []);
  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => setIsOpen(false), []);
  const minimizeChat = useCallback((min: boolean) => setIsChatMinimized(min), []);

  const switchConversation = useCallback(async (id: string) => {
    setActiveConversationId(id);
    const msgs = await aiService.loadMessages(id);
    setMessages(msgs);
  }, []);

  const startNewConversation = useCallback(() => {
    const newId = `conv-${Date.now()}`;
    const newConvo: AIConversation = {
      id: newId,
      userId: 'local-user',
      title: 'New Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };
    setConversations(prev => [newConvo, ...prev]);
    setActiveConversationId(newId);
    setMessages([]);
    if (!isOpen) openChat();
  }, [isOpen, openChat]);

  const deleteConversation = useCallback(async (id: string) => {
    await aiService.deleteConversation(id);
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setMessages([]);
    }
  }, [activeConversationId]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;
    
    if (!isOpen) openChat();
    
    let convoId = activeConversationId;
    if (!convoId) {
      convoId = `conv-${Date.now()}`;
      startNewConversation();
    }
    
    const userMsgId = `msg-${Date.now()}`;
    const userMsg: AIMessage = {
      id: userMsgId,
      conversationId: convoId!,
      role: 'user',
      content: text,
      metadata: {},
      createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, userMsg]);
    
    const command = parseCommand(text);
    if (command && command.requiresConfirmation) {
      setPendingCommand(command);
      
      const assistantMsg: AIMessage = {
        id: `msg-${Date.now() + 1}`,
        conversationId: convoId!,
        role: 'assistant',
        content: `I'm ready to ${command.description}. Should I proceed?`,
        metadata: { command },
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, assistantMsg]);
      return;
    }
    
    if (command && !command.requiresConfirmation) {
      const result = await executeCommand(command, tracker.data, tracker);
      const assistantMsg: AIMessage = {
        id: `msg-${Date.now() + 1}`,
        conversationId: convoId!,
        role: 'assistant',
        content: result.message,
        metadata: { actionResult: result },
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, assistantMsg]);
      return;
    }

    setIsStreaming(true);
    setStreamingText('');
    
    let fullResponse = '';
    const context = {
      activeProjectsCount: tracker.visibleProjects?.length || 0,
      activeTasksCount: tracker.visibleTasks?.length || 0,
    };
    
    try {
      for await (const chunk of aiService.sendMessage(text, convoId!, context)) {
        fullResponse += chunk;
        setStreamingText(fullResponse);
      }
      
      const finalMsg: AIMessage = {
        id: `msg-${Date.now() + 1}`,
        conversationId: convoId!,
        role: 'assistant',
        content: fullResponse,
        metadata: {},
        createdAt: new Date().toISOString()
      };
      
      setMessages(prev => [...prev, finalMsg]);
      
      if (settings.ttsEnabled && settings.autoSpeak) {
        voiceService.speak(fullResponse, settings.voiceLanguage);
      }
    } catch (e) {
      console.error(e);
      const errorMsg: AIMessage = {
        id: `msg-${Date.now() + 1}`,
        conversationId: convoId!,
        role: 'assistant',
        content: "Sorry, I encountered an error processing your request.",
        metadata: {},
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsStreaming(false);
      setStreamingText('');
    }
  }, [activeConversationId, isOpen, openChat, startNewConversation, tracker, settings]);

  const confirmAction = useCallback(async (command: AICommand) => {
    if (!activeConversationId) return;
    
    const result = await executeCommand(command, tracker.data, tracker);
    const assistantMsg: AIMessage = {
      id: `msg-${Date.now()}`,
      conversationId: activeConversationId,
      role: 'assistant',
      content: result.message,
      metadata: { actionResult: result },
      createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, assistantMsg]);
    setPendingCommand(null);
  }, [activeConversationId, tracker]);

  const cancelAction = useCallback(() => {
    if (!activeConversationId) return;
    
    const assistantMsg: AIMessage = {
      id: `msg-${Date.now()}`,
      conversationId: activeConversationId,
      role: 'assistant',
      content: "Action cancelled.",
      metadata: {},
      createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, assistantMsg]);
    setPendingCommand(null);
  }, [activeConversationId]);

  const dismissDailyPopup = useCallback(() => {
    setShowDailyPopup(false);
    aiService.dismissDailySummary();
  }, []);

  const updateSettings = useCallback(async (newSettings: Partial<AIUserSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    await aiService.updateUserSettings(updated);
    if (newSettings.voiceLanguage) {
      voiceService.setLanguage(newSettings.voiceLanguage);
    }
  }, [settings]);

  const startVoice = useCallback(() => {
    voiceService.startListening(settings.voiceLanguage);
  }, [settings.voiceLanguage]);

  const stopVoice = useCallback(() => {
    voiceService.stopListening();
  }, []);

  const value = {
    isOpen, isChatMinimized, conversations, activeConversationId,
    messages, isStreaming, streamingText, dailySummary, showDailyPopup,
    settings, isListening, isSpeaking, pendingCommand,
    toggleChat, openChat, closeChat, minimizeChat, sendMessage,
    startNewConversation, switchConversation, deleteConversation,
    dismissDailyPopup, updateSettings, startVoice, stopVoice,
    confirmAction, cancelAction
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
