import React from 'react';
import { Mic, Volume2 } from 'lucide-react';

interface AIVoiceIndicatorProps {
  isListening: boolean;
  isSpeaking: boolean;
  language: string;
}

export function AIVoiceIndicator({ isListening, isSpeaking, language }: AIVoiceIndicatorProps) {
  if (!isListening && !isSpeaking) return null;

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-white/50 dark:bg-ink/50 backdrop-blur-sm border border-border dark:border-white/10 ai-fade-in">
      {isListening && (
        <div className="flex items-center gap-1.5">
          <Mic className="w-3.5 h-3.5 text-danger animate-pulse" />
          <div className="flex items-end gap-0.5 h-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="w-1 bg-gold rounded-full ai-waveform"
                style={{ 
                  height: `${Math.max(20, Math.random() * 100)}%`,
                  animationDelay: `${i * 0.1}s` 
                }}
              />
            ))}
          </div>
          <span className="text-[10px] font-medium text-muted uppercase ml-1">{language}</span>
        </div>
      )}

      {isSpeaking && !isListening && (
        <div className="flex items-center gap-2">
          <div className="relative flex items-center justify-center">
            <Volume2 className="w-4 h-4 text-gold relative z-10" />
            <span className="absolute w-full h-full bg-gold/30 rounded-full animate-ping" />
          </div>
          <span className="text-xs font-medium text-gold">Speaking...</span>
        </div>
      )}
    </div>
  );
}
