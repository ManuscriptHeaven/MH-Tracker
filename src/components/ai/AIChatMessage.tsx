import React from 'react';
import { Bot, User, Volume2, VolumeX, Square, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AIMessage } from '../../lib/ai/aiTypes';
import { useAIContext } from '../../lib/ai/aiContext';

interface AIChatMessageProps {
  message: AIMessage;
  isProcessing?: boolean;
}

export function AIChatMessage({ message, isProcessing }: AIChatMessageProps) {
  const { isSpeaking, isMuted, speakText, stopSpeaking } = useAIContext();
  const isUser = message.role === 'user';

  const handlePlayVoice = () => {
    if (isSpeaking) {
      stopSpeaking();
    } else {
      speakText(message.spokenText || message.content);
    }
  };

  const renderContent = (content: string) => {
    let rendered = content || '';

    // Bold
    rendered = rendered.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-ink dark:text-linen">$1</strong>');
    
    // Headings ###
    rendered = rendered.replace(/^### (.*$)/gim, '<h4 class="font-display font-semibold text-sm text-gold mt-1.5 mb-1">$1</h4>');
    
    // Inline code
    rendered = rendered.replace(/`(.*?)`/g, '<code class="bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded text-xs font-mono">$1</code>');
    
    // Bullet points
    rendered = rendered.replace(/^[•\-\*]\s+(.*)$/gm, '<div class="flex items-start gap-1.5 my-0.5"><span class="text-gold mt-0.5 select-none">•</span><span>$1</span></div>');

    return <div dangerouslySetInnerHTML={{ __html: rendered }} />;
  };

  return (
    <div
      className={cn(
        "flex w-full mb-3.5 transition-all duration-200",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-ink text-gold border border-gold/30 flex items-center justify-center mr-2 shadow-sm mt-0.5">
          <Bot className="w-4 h-4" />
        </div>
      )}
      
      <div
        className={cn(
          "relative max-w-[88%] sm:max-w-[82%] rounded-2xl px-3.5 py-2.5 shadow-sm text-xs sm:text-sm leading-relaxed",
          isUser
            ? "bg-gold text-ink font-medium rounded-tr-xs ml-8"
            : "bg-white text-ink border border-border rounded-tl-xs shadow-xs"
        )}
      >
        <div className="whitespace-pre-wrap">
          {message.content ? (
            renderContent(message.content)
          ) : isProcessing && !isUser ? (
            <div className="flex items-center gap-1.5 py-1 text-muted text-xs">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gold animate-bounce" />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gold animate-bounce [animation-delay:0.2s]" />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gold animate-bounce [animation-delay:0.4s]" />
              <span className="ml-1 font-medium">Analyzing live data...</span>
            </div>
          ) : null}
        </div>

        {/* Footer info & Action buttons */}
        <div className="flex items-center justify-between gap-2 mt-2 pt-1 border-t border-black/5 text-[10px] text-muted">
          <div className="flex items-center gap-1.5">
            {message.createdAt && (
              <span>
                {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {message.metadata?.toolUsed && (
              <span className="hidden xs:inline-block px-1.5 py-0.2 rounded bg-gold/10 text-gold font-mono text-[9px]">
                Live Data
              </span>
            )}
          </div>

          {!isUser && message.content && (
            <button
              onClick={handlePlayVoice}
              title={isSpeaking ? "Stop audio" : "Play audio"}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-gold hover:bg-gold/10 transition font-medium text-[10px]"
            >
              {isSpeaking ? (
                <>
                  <Square className="w-3 h-3 text-danger fill-danger" />
                  <span className="text-danger">Stop</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-3 h-3" />
                  <span>Play</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gold/30 text-ink flex items-center justify-center ml-2 shadow-sm mt-0.5">
          <User className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}
