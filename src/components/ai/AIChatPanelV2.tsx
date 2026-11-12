import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  History,
  MessageSquare,
  Mic,
  MicOff,
  Plus,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useAIContext } from '../../lib/ai/aiContext';
import { AIChatMessage } from './AIChatMessage';
import { AIActivityHistory } from './AIActivityHistory';
import type { Invoice } from '../../lib/types';

export function AIChatPanelV2({
  onVoice,
  onNewChat,
  onViewInvoice,
}: {
  onVoice: () => void;
  onNewChat: () => void;
  onViewInvoice: (invoice: Invoice) => void;
}) {
  const {
    messages,
    sendMessage,
    isProcessing,
    isListening,
    isSpeaking,
    isMuted,
    toggleMute,
    stopSpeaking,
    liveTranscript,
    activeTab,
    setActiveTab,
    activeConversationId,
    pendingAction,
    settings,
  } = useAIContext();
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const lastConversationRef = useRef(activeConversationId);
  useEffect(() => {
    if (lastConversationRef.current !== activeConversationId) {
      setInput('');
      followRef.current = true;
      lastConversationRef.current = activeConversationId;
    }
    if (activeTab === 'chat' && followRef.current && feedRef.current)
      feedRef.current.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isProcessing, liveTranscript, activeTab, activeConversationId]);
  function submit() {
    const text = input.trim();
    if (!text || isProcessing || isListening) return;
    followRef.current = true;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    void sendMessage(text);
  }
  return (
    <section className="ai-chat-panel" aria-label="Conversation">
      <div className="ai-chat-heading">
        <span>
          <MessageSquare size={16} /> Your workspace, in conversation
        </span>
        <button
          className="ai-icon-button"
          aria-label="New conversation"
          disabled={isProcessing}
          onClick={onNewChat}
        >
          <Plus size={17} />
        </button>
      </div>
      <div className="ai-chat-tabs" role="tablist" aria-label="Assistant views">
        <button
          id="ai-assistant-tab"
          role="tab"
          aria-selected={activeTab === 'chat'}
          aria-controls="ai-assistant-feed"
          tabIndex={activeTab === 'chat' ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
              setActiveTab('activity');
              document.getElementById('ai-activity-tab')?.focus();
            }
          }}
          onClick={() => setActiveTab('chat')}
        >
          <Sparkles size={14} />
          Assistant{pendingAction && <i aria-label="Action awaiting confirmation" />}
        </button>
        <button
          id="ai-activity-tab"
          role="tab"
          aria-selected={activeTab === 'activity'}
          aria-controls="ai-activity-feed"
          tabIndex={activeTab === 'activity' ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
              setActiveTab('chat');
              document.getElementById('ai-assistant-tab')?.focus();
            }
          }}
          onClick={() => setActiveTab('activity')}
        >
          <History size={14} />
          Activity
        </button>
        <button
          className="ai-icon-button"
          aria-label={isMuted ? 'Unmute assistant voice' : 'Mute assistant voice'}
          aria-pressed={isMuted}
          onClick={toggleMute}
        >
          {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
      </div>
      {activeTab === 'activity' ? (
        <div
          id="ai-activity-feed"
          className="ai-activity-feed"
          role="tabpanel"
          aria-labelledby="ai-activity-tab"
        >
          <AIActivityHistory />
        </div>
      ) : (
        <>
          <div
            className="ai-chat-feed"
            ref={feedRef}
            id="ai-assistant-feed"
            role="tabpanel"
            aria-labelledby="ai-assistant-tab"
            onScroll={() => {
              const feed = feedRef.current;
              if (feed)
                followRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
            }}
          >
            {messages.length === 0 && (
              <div className="ai-chat-empty">
                <span className="ai-empty-mark">
                  <Bot size={24} strokeWidth={1.3} />
                </span>
                <span className="ai-eyebrow">A LITTLE LESS ADMIN. A LITTLE MORE MOMENTUM.</span>
                <h3>What should we work on?</h3>
                <p>
                  Ask about projects, tasks, invoices, or approvals. We’ll preview any changes
                  before you confirm.
                </p>
                <button
                  disabled={isProcessing}
                  onClick={() => void sendMessage('What projects need my attention today?')}
                >
                  What needs my attention?
                  <ArrowUpRight size={14} />
                </button>
                <div className="ai-empty-safety">
                  <ShieldCheck size={14} /> You stay in control of every change.
                </div>
              </div>
            )}
            <div
              className="ai-message-list"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label="Conversation messages"
            >
              {messages.map((message) => (
                <AIChatMessage key={message.id} message={message} onViewInvoice={onViewInvoice} />
              ))}
              {isProcessing && (
                <div className="ai-thinking" role="status">
                  <span />
                  <span />
                  <span />
                  <p>Assistant is thinking…</p>
                </div>
              )}
              {isListening && liveTranscript && (
                <div className="ai-live-message">
                  <Mic size={13} />
                  <p>{liveTranscript}</p>
                </div>
              )}
            </div>
            <div ref={endRef} />
          </div>
          <div className="ai-chat-composer">
            <div className="ai-composer-box">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  event.target.style.height = 'auto';
                  event.target.style.height = `${Math.min(event.target.scrollHeight, 130)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={
                  pendingAction
                    ? 'Type a correction, or review the action above…'
                    : 'Ask MH AI anything about your work…'
                }
                aria-label="Message MH AI Assistant"
                rows={2}
              />
              <div className="ai-composer-controls">
                <button
                  className={`ai-icon-button ${isListening ? 'is-recording' : ''}`}
                  disabled={isProcessing || (!settings.voiceEnabled && !isListening && !isSpeaking)}
                  aria-label={
                    isSpeaking
                      ? 'Stop speaking'
                      : isListening
                        ? 'Stop listening'
                        : 'Speak to assistant'
                  }
                  onClick={isSpeaking ? stopSpeaking : onVoice}
                >
                  {isSpeaking ? (
                    <Square size={16} />
                  ) : isListening ? (
                    <MicOff size={16} />
                  ) : (
                    <Mic size={16} />
                  )}
                </button>
                <span>Enter to send · Shift+Enter for a new line</span>
                <button
                  className="ai-send-button"
                  aria-label="Send message"
                  disabled={!input.trim() || isProcessing || isListening}
                  onClick={submit}
                >
                  <SendHorizontal size={16} />
                </button>
              </div>
            </div>
            <p>
              <ShieldCheck size={11} /> Write actions require confirmation before anything changes.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
