import React from 'react';
import { AlertTriangle, Loader2, Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AICommand } from '../../lib/ai/aiTypes';
import { Button } from '../ui';

interface AICommandConfirmationProps {
  command: AICommand;
  onConfirm: () => void;
  onCancel: () => void;
  isExecuting: boolean;
}

export function AICommandConfirmation({ command, onConfirm, onCancel, isExecuting }: AICommandConfirmationProps) {
  const destructiveTypes = new Set(['update_status']);
  const isDestructive = destructiveTypes.has(command.type);

  return (
    <div className="my-3 p-4 rounded-xl border border-white/20 bg-white/80 dark:bg-ink/80 backdrop-blur-md shadow-sm ai-fade-in">
      <div className="flex items-start gap-3">
        <div className={cn(
          "p-2 rounded-full shrink-0",
          isDestructive ? "bg-danger/10 text-danger" : "bg-gold/10 text-gold"
        )}>
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-ink dark:text-white mb-1">
            {command.description || 'Confirm Action'}
          </h4>
          <p className="text-xs text-muted mb-2">Type: {command.type}</p>
          {command.params && Object.keys(command.params).length > 0 && (
            <div className="text-xs text-muted mb-3 font-mono bg-black/5 dark:bg-white/5 p-2 rounded break-all">
              {Object.entries(command.params).map(([key, value]) => (
                <div key={key}><span className="opacity-70">{key}:</span> {String(value)}</div>
              ))}
            </div>
          )}
          
          <div className="flex gap-2 mt-3">
            <Button 
              onClick={onConfirm} 
              disabled={isExecuting}
              className={cn(
                "flex-1 text-sm h-8 py-0",
                isDestructive ? "bg-danger hover:bg-danger/90 text-white" : ""
              )}
            >
              {isExecuting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Check className="w-4 h-4 mr-1.5" />}
              Confirm
            </Button>
            <Button 
              variant="ghost" 
              onClick={onCancel} 
              disabled={isExecuting}
              className="flex-1 text-sm h-8 py-0"
            >
              <X className="w-4 h-4 mr-1.5" />
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
