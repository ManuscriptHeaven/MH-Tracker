import React from 'react';
import { cn } from '../../lib/utils';
import { QuickAction } from '../../lib/ai/aiTypes';
import { Zap } from 'lucide-react';

interface AIQuickActionsProps {
  actions: QuickAction[];
  onSelect: (command: string) => void;
}

export function AIQuickActions({ actions, onSelect }: AIQuickActionsProps) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="w-full overflow-x-auto no-scrollbar pb-2 ai-fade-in">
      <div className="flex gap-2 px-1">
        {actions.map((action, idx) => (
          <button
            key={idx}
            onClick={() => onSelect(action.command)}
            className={cn(
              "flex items-center whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium",
              "bg-ivory dark:bg-white/10 border border-border dark:border-white/10",
              "text-ink dark:text-white/80 transition-colors duration-200",
              "hover:border-gold hover:bg-gold/10 hover:text-ink dark:hover:text-white"
            )}
          >
            {action.icon ? (
              <span className="mr-1.5">{action.icon}</span>
            ) : (
              <Zap className="w-3 h-3 mr-1.5 text-gold" />
            )}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
