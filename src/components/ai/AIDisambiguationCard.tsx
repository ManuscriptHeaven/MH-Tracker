import React from 'react';
import { HelpCircle, ChevronRight } from 'lucide-react';
import type { DisambiguationOption } from '../../lib/ai/aiTypes';
import { useAIContext } from '../../lib/ai/aiContext';

interface Props {
  options: DisambiguationOption[];
}

export function AIDisambiguationCard({ options }: Props) {
  const { selectDisambiguationOption, isProcessing } = useAIContext();

  return (
    <div className="mt-2.5 mb-1.5 rounded-xl border border-gold/30 bg-gold/5 p-3 shadow-xs text-xs">
      <div className="flex items-center gap-1.5 pb-2 text-ink font-semibold border-b border-gold/20">
        <HelpCircle className="w-4 h-4 text-gold shrink-0" />
        <span>Select which one you mean:</span>
      </div>

      <div className="mt-2 space-y-1.5">
        {options.map((option, idx) => (
          <button
            key={option.id || idx}
            onClick={() => selectDisambiguationOption(option)}
            disabled={isProcessing}
            className="w-full text-left p-2 rounded-lg bg-white hover:bg-gold/15 border border-border transition flex items-center justify-between gap-2 active:scale-[0.99] group"
          >
            <div>
              <div className="font-semibold text-ink text-xs group-hover:text-gold-darker">
                {idx + 1}. {option.title}
              </div>
              {option.subtitle && <div className="text-[10px] text-muted">{option.subtitle}</div>}
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted group-hover:text-ink shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
