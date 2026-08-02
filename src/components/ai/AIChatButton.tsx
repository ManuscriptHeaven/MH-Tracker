import React from 'react';
import { Sparkles, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAIContext } from '../../lib/ai/aiContext';

export function AIChatButton() {
  const { isOpen, toggleChat, messages } = useAIContext();
  
  const hasUnread = !isOpen && messages && messages.length > 0;

  return (
    <button
      onClick={toggleChat}
      aria-label="Toggle AI Assistant"
      className={cn(
        "fixed z-[60] bottom-24 right-4 lg:bottom-6 lg:right-6",
        "w-14 h-14 rounded-full flex items-center justify-center",
        "bg-gradient-to-br from-gold to-[#b89757] text-white",
        "shadow-lg shadow-gold/25 hover:shadow-xl hover:shadow-gold/40 hover:scale-105",
        "transition-all duration-300 ease-in-out ai-pulse focus:outline-none focus:ring-2 focus:ring-gold/50 focus:ring-offset-2 dark:focus:ring-offset-ink"
      )}
    >
      <div className="relative flex items-center justify-center w-full h-full">
        <Sparkles 
          className={cn(
            "absolute w-6 h-6 transition-all duration-300",
            isOpen ? "opacity-0 rotate-90 scale-50" : "opacity-100 rotate-0 scale-100"
          )} 
        />
        <X 
          className={cn(
            "absolute w-6 h-6 transition-all duration-300",
            isOpen ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-50"
          )} 
        />
      </div>
      {hasUnread && (
        <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 border-2 border-white dark:border-ink rounded-full" />
      )}
    </button>
  );
}
