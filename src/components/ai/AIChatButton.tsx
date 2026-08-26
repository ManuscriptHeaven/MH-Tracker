import React from 'react';
import { Mic, Sparkles, X, Volume2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAIContext } from '../../lib/ai/aiContext';

export function AIChatButton() {
  const { isOpen, toggleChat, messages, isListening, isSpeaking } = useAIContext();
  
  const hasUnread = !isOpen && messages && messages.length > 0;

  return (
    <button
      onClick={toggleChat}
      aria-label="Toggle AI Assistant"
      className={cn(
        "fixed z-[60] bottom-24 right-4 lg:bottom-6 lg:right-6",
        "flex items-center gap-2 rounded-full px-3.5 py-3 lg:px-4 lg:py-3.5",
        "bg-gradient-to-r from-ink via-charcoal to-ink text-white border border-gold/40",
        "shadow-xl shadow-ink/20 hover:shadow-2xl hover:border-gold hover:scale-105",
        "transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-gold/50",
        isListening && "border-danger ring-2 ring-danger/40 animate-pulse",
        isSpeaking && "border-gold ring-2 ring-gold/40"
      )}
    >
      <div className="relative flex items-center justify-center">
        {isOpen ? (
          <X className="w-5 h-5 text-gold transition-transform duration-300 rotate-0" />
        ) : isListening ? (
          <span className="flex h-5 w-5 items-center justify-center text-danger animate-pulse">
            <Mic className="w-5 h-5" />
          </span>
        ) : isSpeaking ? (
          <Volume2 className="w-5 h-5 text-gold animate-bounce" />
        ) : (
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gold/20">
            <Mic className="w-4 h-4 text-gold" />
          </div>
        )}
      </div>

      <span className="hidden sm:inline font-semibold text-xs tracking-wide text-linen uppercase">
        {isOpen ? 'Close' : isListening ? 'Listening...' : 'AI Assistant'}
      </span>

      {hasUnread && !isOpen && (
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-gold border-2 border-ink rounded-full animate-ping" />
      )}
    </button>
  );
}
