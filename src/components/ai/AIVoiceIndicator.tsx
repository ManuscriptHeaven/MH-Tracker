import React from 'react';
import { Mic, Volume2, Square } from 'lucide-react';
import { cn } from '../../lib/utils';

interface AIVoiceIndicatorProps {
  isListening: boolean;
  isSpeaking: boolean;
  language?: string;
  onStopSpeaking?: () => void;
  onStopListening?: () => void;
}

export function AIVoiceIndicator({
  isListening,
  isSpeaking,
  language = 'en-US',
  onStopSpeaking,
  onStopListening,
}: AIVoiceIndicatorProps) {
  if (!isListening && !isSpeaking) return null;

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-ink/90 border border-gold/40 text-linen shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200">
      {isListening && (
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            <span className="absolute w-5 h-5 bg-danger/40 rounded-full animate-ping" />
            <Mic className="w-4 h-4 text-danger relative z-10" />
          </div>
          
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-linen">Listening...</span>
            <div className="flex items-end gap-0.5 h-3.5 ml-1">
              {[40, 80, 55, 95, 30, 70].map((height, i) => (
                <div
                  key={i}
                  className="w-1 bg-gold rounded-full animate-pulse"
                  style={{
                    height: `${height}%`,
                    animationDelay: `${i * 0.12}s`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {isSpeaking && !isListening && (
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            <span className="absolute w-5 h-5 bg-gold/40 rounded-full animate-ping" />
            <Volume2 className="w-4 h-4 text-gold relative z-10" />
          </div>
          
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-gold">Speaking answer...</span>
            <div className="flex items-end gap-0.5 h-3.5 ml-1">
              {[60, 30, 90, 45, 75].map((height, i) => (
                <div
                  key={i}
                  className="w-1 bg-linen rounded-full animate-pulse"
                  style={{
                    height: `${height}%`,
                    animationDelay: `${i * 0.15}s`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {isListening && onStopListening && (
          <button
            onClick={onStopListening}
            className="px-2 py-0.5 rounded bg-danger/20 hover:bg-danger/30 text-danger text-[11px] font-medium transition"
          >
            Done
          </button>
        )}

        {isSpeaking && onStopSpeaking && (
          <button
            onClick={onStopSpeaking}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-linen text-[11px] font-medium transition"
          >
            <Square className="w-2.5 h-2.5 fill-current" />
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
