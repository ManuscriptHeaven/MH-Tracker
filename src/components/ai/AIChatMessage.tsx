import React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AIMessage } from '../../lib/ai/aiTypes';

interface AIChatMessageProps {
  message: AIMessage;
  isStreaming?: boolean;
}

export function AIChatMessage({ message, isStreaming }: AIChatMessageProps) {
  const isUser = message.role === 'user';

  const renderContent = (content: string) => {
    let rendered = content || '';
    // Handle bold
    rendered = rendered.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Handle code blocks (simple inline)
    rendered = rendered.replace(/`(.*?)`/g, '<code class="bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-sm font-mono">$1</code>');
    // Handle bullet points
    rendered = rendered.replace(/^[-•]\s+(.*)$/gm, '<div class="flex gap-2"><span class="text-gold mt-1">•</span><span>$1</span></div>');
    
    return <div dangerouslySetInnerHTML={{ __html: rendered }} />;
  };

  return (
    <div
      className={cn(
        "flex w-full mb-4 ai-fade-in",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-gold to-[#b89757] flex items-center justify-center mr-2 shadow-sm">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
      )}
      
      <div
        className={cn(
          "relative max-w-[85%] rounded-2xl px-4 py-3 shadow-sm",
          isUser
            ? "bg-gold/15 text-ink dark:bg-gold/25 dark:text-white rounded-tr-sm max-w-[80%]"
            : "bg-white dark:bg-charcoal border border-border dark:border-white/10 text-ink dark:text-white rounded-tl-sm"
        )}
      >
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {message.content ? (
            renderContent(message.content)
          ) : isStreaming && !isUser ? (
            <div className="ai-bounce-dots">
              <span /><span /><span />
            </div>
          ) : null}
          {isStreaming && message.content && (
            <span className="inline-block w-1.5 h-4 ml-1 bg-gold animate-pulse align-middle" />
          )}
        </div>
        
        {message.createdAt && (
          <div className={cn(
            "text-[10px] mt-1.5 font-medium",
            isUser ? "text-ink/50 dark:text-white/50 text-right" : "text-muted"
          )}>
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  );
}
