import React, { useState, useRef, useEffect } from 'react';
import { Bot, Sparkles, X, Plus, SendHorizontal, Mic, MicOff, Volume2, VolumeX, Trash2, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAIContext } from '../../lib/ai/aiContext';
import { AIChatMessage } from './AIChatMessage';
import { AIVoiceIndicator } from './AIVoiceIndicator';

export function AIChatPanel() {
  const { 
    isOpen, closeChat, messages, isProcessing,
    sendMessage, startNewConversation, clearConversation, settings,
    isListening, isSpeaking, isMuted, startVoice, stopVoice, toggleMute,
    liveTranscript, voiceError, stopSpeaking, clearVoiceError
  } = useAIContext();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isProcessing, isOpen, isListening, liveTranscript]);

  if (!isOpen) return null;

  const handleSend = () => {
    if (input.trim() && !isProcessing) {
      sendMessage(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleVoice = () => {
    if (isListening) {
      stopVoice();
    } else {
      startVoice();
    }
  };

  const quickQuestions = [
    "How many projects are overdue?",
    "What's due today?",
    "How many in revision?",
    "What is Zain working on?",
    "How much do clients owe us?",
  ];

  return (
    <div className={cn(
      "fixed z-[59] bottom-0 right-0 lg:bottom-20 lg:right-6 inset-0 lg:inset-auto",
      "w-full lg:w-[420px] h-full lg:h-[580px] lg:max-h-[85vh]",
      "flex flex-col lg:rounded-2xl overflow-hidden shadow-2xl",
      "bg-linen text-ink border-0 lg:border border-gold/30",
      "transition-all duration-300 transform origin-bottom-right"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-ink text-linen border-b border-gold/30 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gold text-ink flex items-center justify-center font-bold text-xs shadow-sm">
            MH
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-display font-semibold text-sm text-linen">MH AI Assistant</span>
              <span className="px-1.5 py-0.2 text-[9px] font-semibold bg-gold/20 text-gold rounded tracking-wider uppercase">
                Phase 1 Live
              </span>
            </div>
            <p className="text-[10px] text-linen/60">Read-Only Business Voice Assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Mute Voice Toggle */}
          <button
            onClick={toggleMute}
            title={isMuted ? "Unmute voice responses" : "Mute voice responses"}
            aria-label="Toggle voice mute"
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-lg transition",
              isMuted ? "text-linen/40 hover:text-linen" : "text-gold hover:text-gold/80"
            )}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Clear History */}
          <button
            onClick={clearConversation}
            title="Clear conversation"
            aria-label="Clear conversation"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-linen/60 transition hover:bg-white/10 hover:text-linen"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* Close Panel */}
          <button
            onClick={closeChat}
            title="Close assistant"
            aria-label="Close assistant"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-linen/60 transition hover:bg-white/10 hover:text-linen ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col space-y-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-6">
            <div className="w-14 h-14 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center mb-3">
              <Sparkles className="w-7 h-7 text-gold" />
            </div>
            <h3 className="text-base font-display font-semibold text-ink mb-1">
              Hi! Ask me anything about MH Tracker.
            </h3>
            <p className="text-xs text-muted max-w-[280px] mb-5">
              Tap the microphone to speak naturally or tap a sample question below.
            </p>

            {/* Quick Action Pills */}
            <div className="flex flex-wrap justify-center gap-1.5 max-w-sm">
              {quickQuestions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => sendMessage(q)}
                  className="px-3 py-1.5 rounded-full bg-white hover:bg-gold/15 text-ink text-xs font-medium border border-border transition active:scale-95 shadow-xs"
                >
                  "{q}"
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <AIChatMessage key={msg.id || idx} message={msg} />
            ))}
          </>
        )}
        
        {isProcessing && (
          <AIChatMessage 
            message={{ id: 'processing', conversationId: '', role: 'assistant', content: '', createdAt: new Date().toISOString() }} 
            isProcessing={true} 
          />
        )}

        {/* Live Listening Transcription Preview */}
        {isListening && liveTranscript && (
          <div className="p-2.5 rounded-xl bg-gold/15 border border-gold/30 text-xs text-ink animate-pulse my-2">
            <span className="font-semibold text-gold mr-1.5">Hearing:</span>
            <span>"{liveTranscript}"</span>
          </div>
        )}

        {/* Voice Error Notification */}
        {voiceError && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-xs text-amber-900 shadow-xs flex flex-col gap-1.5 my-2">
            <div className="flex items-start justify-between gap-2">
              <p className="leading-relaxed">{voiceError}</p>
              <button
                onClick={clearVoiceError}
                className="text-amber-700/60 hover:text-amber-900 p-0.5"
                title="Dismiss"
                aria-label="Dismiss notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-3 pt-0.5">
              <button 
                onClick={() => {
                  clearVoiceError();
                  startVoice();
                }}
                className="font-semibold text-xs text-amber-800 underline hover:text-amber-950 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" /> Retry Microphone
              </button>
              <button
                onClick={() => {
                  clearVoiceError();
                  inputRef.current?.focus();
                }}
                className="text-xs text-muted hover:text-ink"
              >
                Type question instead →
              </button>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Voice Bar Indicator if active */}
      {(isListening || isSpeaking) && (
        <div className="px-3 py-1 bg-white/70 backdrop-blur-sm border-t border-border">
          <AIVoiceIndicator 
            isListening={isListening} 
            isSpeaking={isSpeaking}
            onStopListening={stopVoice}
            onStopSpeaking={stopSpeaking}
          />
        </div>
      )}

      {/* Footer Area with Ergonomic Voice & Text Controls */}
      <div className="p-3 bg-white border-t border-border shrink-0">
        <div className="flex items-center gap-2">
          {/* Main Tap-to-Speak Button */}
          <button
            onClick={toggleVoice}
            title={isListening ? "Tap to stop listening" : "Tap to speak"}
            aria-label={isListening ? "Stop listening" : "Tap to speak"}
            className={cn(
              "flex-shrink-0 h-11 px-3.5 rounded-xl flex items-center gap-2 font-medium text-xs transition active:scale-95 shadow-sm",
              isListening
                ? "bg-danger text-white animate-pulse"
                : "bg-ink hover:bg-charcoal text-gold border border-gold/40"
            )}
          >
            {isListening ? (
              <>
                <MicOff className="w-4 h-4" />
                <span className="font-semibold">Stop</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 text-gold" />
                <span className="hidden xs:inline text-linen font-semibold">Speak</span>
              </>
            )}
          </button>

          {/* Text Input Fallback */}
          <div className="flex-1 relative flex items-center bg-linen rounded-xl border border-border focus-within:border-gold focus-within:ring-1 focus-within:ring-gold transition">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isListening ? "Listening to your voice..." : "Type or speak a question..."}
              disabled={isProcessing}
              className="w-full bg-transparent border-none focus:outline-none focus:ring-0 py-2.5 pl-3 pr-2 text-xs sm:text-sm text-ink placeholder:text-muted"
            />
            
            <button
              onClick={handleSend}
              disabled={!input.trim() || isProcessing}
              title="Send question"
              aria-label="Send question"
              className="mr-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gold hover:bg-[#b89757] text-ink transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <SendHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick follow-up hint below input */}
        <div className="flex items-center justify-between mt-2 text-[10px] text-muted px-1">
          <span>Phase 1: Read-Only live data</span>
          <span>USD & PKR Currency Aware</span>
        </div>
      </div>
    </div>
  );
}
