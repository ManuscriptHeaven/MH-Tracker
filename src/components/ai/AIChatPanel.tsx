import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Plus, SendHorizontal, Mic, MicOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAIContext } from '../../lib/ai/aiContext';
import { AIChatMessage } from './AIChatMessage';
import { AIQuickActions } from './AIQuickActions';
import { AICommandConfirmation } from './AICommandConfirmation';
import { AIVoiceIndicator } from './AIVoiceIndicator';
import type { QuickAction } from '../../lib/ai/aiTypes';

export function AIChatPanel() {
  const ctx = useAIContext();
  const { 
    isOpen, closeChat, messages, isStreaming, streamingText,
    sendMessage, startNewConversation, settings,
    isListening, isSpeaking, startVoice, stopVoice,
    confirmAction, cancelAction
  } = ctx;

  // pendingCommand may exist on the context
  const pendingCommand = (ctx as any).pendingCommand ?? null;

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, isStreaming, pendingCommand, isOpen]);

  if (!isOpen) return null;

  const handleSend = () => {
    if (input.trim() && !isStreaming) {
      sendMessage(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleVoice = () => {
    if (isListening) stopVoice();
    else startVoice();
  };

  const defaultActions: QuickAction[] = [
    { id: 'qa-1', label: 'Show overdue tasks', command: 'show overdue tasks', category: 'tasks' },
    { id: 'qa-2', label: 'Due today', command: 'show tasks due today', category: 'tasks' },
    { id: 'qa-3', label: 'Pending invoices', command: 'show pending invoices', category: 'invoices' },
    { id: 'qa-4', label: 'Find project', command: 'find project', category: 'projects' },
  ];

  return (
    <div className={cn(
      "fixed z-[59] bottom-0 right-0 lg:bottom-20 lg:right-6 inset-0 lg:inset-auto",
      "w-full lg:w-[380px] h-full lg:h-[520px] lg:max-h-[800px]",
      "flex flex-col lg:rounded-2xl overflow-hidden shadow-2xl",
      "backdrop-blur-2xl bg-white/85 dark:bg-ink/90 border-0 lg:border border-white/30 dark:border-gold/20",
      "ai-slide-up transform origin-bottom-right"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border dark:border-white/10 bg-white/50 dark:bg-ink/50 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-gold to-[#b89757] flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold font-display text-ink dark:text-white">MH AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startNewConversation}
            title="New conversation"
            aria-label="New conversation"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-ivory hover:text-ink dark:hover:bg-white/10 dark:hover:text-white"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={closeChat}
            title="Close chat"
            aria-label="Close chat"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-ivory hover:text-ink dark:hover:bg-white/10 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col ai-hide-scrollbar">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 ai-fade-in opacity-70">
            <Sparkles className="w-10 h-10 text-gold mb-3 opacity-50" />
            <p className="text-ink dark:text-white font-medium mb-1">Hi! I'm your MH AI Assistant.</p>
            <p className="text-sm text-muted">How can I help you manage your projects today?</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <AIChatMessage key={msg.id || idx} message={msg} />
          ))
        )}
        
        {isStreaming && (
          <AIChatMessage 
            message={{ id: 'streaming', conversationId: '', role: 'assistant', content: streamingText || '', createdAt: new Date().toISOString(), metadata: {} }} 
            isStreaming={true} 
          />
        )}

        {pendingCommand && (
          <AICommandConfirmation 
            command={pendingCommand}
            onConfirm={() => confirmAction(pendingCommand)}
            onCancel={cancelAction}
            isExecuting={false}
          />
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Footer Area */}
      <div className="p-3 bg-white/50 dark:bg-ink/50 backdrop-blur-md border-t border-border dark:border-white/10 shrink-0">
        <AIQuickActions actions={defaultActions} onSelect={(cmd) => sendMessage(cmd)} />
        
        <div className="mt-2 relative flex items-end gap-2 bg-white dark:bg-charcoal border border-border dark:border-white/20 rounded-xl p-1 shadow-sm focus-within:border-gold focus-within:ring-1 focus-within:ring-gold transition-all">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything..."
            disabled={isStreaming}
            className="flex-1 max-h-32 min-h-[40px] bg-transparent border-none focus:outline-none focus:ring-0 resize-none py-2 px-3 text-sm text-ink dark:text-white placeholder:text-muted"
            rows={1}
          />
          <div className="flex items-center gap-1 pb-1 pr-1 shrink-0">
            {settings?.voiceEnabled && (
              <button
                onClick={toggleVoice}
                title={isListening ? "Stop listening" : "Start listening"}
                aria-label={isListening ? "Stop listening" : "Start listening"}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:text-ink dark:hover:text-white",
                  isListening && "text-danger animate-pulse"
                )}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              title="Send message"
              aria-label="Send message"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gold hover:bg-[#b89757] text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <SendHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {(isListening || isSpeaking) && (
          <div className="mt-2 flex justify-center">
            <AIVoiceIndicator isListening={isListening} isSpeaking={isSpeaking} language={settings?.voiceLanguage || 'en-US'} />
          </div>
        )}
      </div>
    </div>
  );
}
