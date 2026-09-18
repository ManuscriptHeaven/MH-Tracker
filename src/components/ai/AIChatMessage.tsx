import React from 'react';
import { Bot, Square, User, Volume2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AIMessage } from '../../lib/ai/aiTypes';
import type { Invoice } from '../../lib/types';
import { useAIContext } from '../../lib/ai/aiContext';
import { AIActionPreviewCard } from './AIActionPreviewCard';
import { AIDisambiguationCard } from './AIDisambiguationCard';
import { AIInvoiceCard } from './AIInvoiceCard';

interface AIChatMessageProps {
  message: AIMessage;
  isProcessing?: boolean;
  onViewInvoice?: (invoice: Invoice) => void;
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={index} className="font-semibold text-inherit">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={index}
          className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.92em] text-inherit"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function SafeMessageContent({ content }: { content: string }) {
  const lines = (content || '').split('\n');

  return (
    <div className="space-y-1.5">
      {lines.map((line, index) => {
        const trimmed = line.trim();

        if (!trimmed) {
          return <div key={index} className="h-1" aria-hidden="true" />;
        }

        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={index} className="pt-1 font-display text-sm font-semibold text-[#7a5518]">
              {renderInlineMarkdown(trimmed.slice(4))}
            </h4>
          );
        }

        const bulletMatch = trimmed.match(/^[•\-*]\s+(.*)$/);
        if (bulletMatch) {
          return (
            <div key={index} className="flex items-start gap-2">
              <span className="mt-0.5 select-none font-bold text-gold">•</span>
              <span className="min-w-0">{renderInlineMarkdown(bulletMatch[1])}</span>
            </div>
          );
        }

        return (
          <p key={index} className="whitespace-pre-wrap break-words">
            {renderInlineMarkdown(line)}
          </p>
        );
      })}
    </div>
  );
}

export function AIChatMessage({ message, isProcessing, onViewInvoice }: AIChatMessageProps) {
  const { isSpeaking, speakText, stopSpeaking, sendMessage } = useAIContext();
  const isUser = message.role === 'user';

  const handlePlayVoice = () => {
    if (isSpeaking) {
      stopSpeaking();
    } else {
      speakText(message.spokenText || message.content);
    }
  };

  return (
    <div
      className={cn(
        'flex w-full gap-2.5 transition-all duration-200',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      {!isUser ? (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-gold/30 bg-ink text-gold shadow-xs">
          <Bot className="h-4 w-4" />
        </div>
      ) : null}

      <div className={cn('min-w-0 max-w-[90%] sm:max-w-[82%]', isUser && 'ml-8')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-[13px] leading-6 shadow-xs sm:text-sm',
            isUser
              ? 'rounded-tr-md bg-ink text-white'
              : 'rounded-tl-md border border-border bg-white text-ink',
          )}
        >
          {message.content ? (
            <SafeMessageContent content={message.content} />
          ) : isProcessing && !isUser ? (
            <div className="flex items-center gap-2 py-1 text-xs text-muted">
              <div className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-gold animate-bounce" />
                <span className="h-1.5 w-1.5 rounded-full bg-gold animate-bounce [animation-delay:0.15s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-gold animate-bounce [animation-delay:0.3s]" />
              </div>
              <span className="font-medium">Checking live tracker data…</span>
            </div>
          ) : null}

          {message.metadata?.pendingAction ? (
            <AIActionPreviewCard
              action={message.metadata.pendingAction}
              isConfirmedOrCancelled={Boolean(message.metadata.actionStatus)}
            />
          ) : null}

          {message.metadata?.disambiguation && message.metadata.disambiguation.length > 0 ? (
            <AIDisambiguationCard options={message.metadata.disambiguation} />
          ) : null}

          {message.metadata?.invoice ? (
            <AIInvoiceCard invoice={message.metadata.invoice} onViewInvoice={onViewInvoice} />
          ) : null}
        </div>

        {message.metadata?.suggestedFollowUps?.length ? (
          <div className={cn('mt-2 flex flex-wrap gap-1.5', isUser && 'justify-end')}>
            {message.metadata.suggestedFollowUps.slice(0, 3).map((followUp) => (
              <button
                key={followUp}
                type="button"
                onClick={() => sendMessage(followUp)}
                className="rounded-full border border-border bg-white px-2.5 py-1 text-[10px] font-semibold text-muted transition hover:border-gold/60 hover:text-ink"
              >
                {followUp}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className={cn(
            'mt-1.5 flex items-center gap-2 px-1 text-[10px] text-muted',
            isUser ? 'justify-end' : 'justify-between',
          )}
        >
          <div className="flex items-center gap-1.5">
            {message.createdAt ? (
              <span>
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            ) : null}
            {!isUser && message.metadata?.toolUsed ? (
              <span className="rounded-full bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#7a5518]">
                Live workspace data
              </span>
            ) : null}
          </div>

          {!isUser && message.content ? (
            <button
              type="button"
              onClick={handlePlayVoice}
              title={isSpeaking ? 'Stop audio' : 'Play audio'}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold transition',
                isSpeaking ? 'text-danger hover:bg-danger/10' : 'text-[#7a5518] hover:bg-gold/10',
              )}
            >
              {isSpeaking ? <Square className="h-3 w-3 fill-current" /> : <Volume2 className="h-3 w-3" />}
              {isSpeaking ? 'Stop' : 'Listen'}
            </button>
          ) : null}
        </div>
      </div>

      {isUser ? (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gold/25 text-ink shadow-xs">
          <User className="h-4 w-4" />
        </div>
      ) : null}
    </div>
  );
}
