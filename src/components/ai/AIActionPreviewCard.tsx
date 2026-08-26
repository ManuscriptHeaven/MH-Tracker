import React from 'react';
import { AlertCircle, CheckCircle2, ShieldAlert, X, ArrowRight, Send, AlertTriangle } from 'lucide-react';
import type { AIActionPreview } from '../../lib/ai/aiTypes';
import { useAIContext } from '../../lib/ai/aiContext';
import { cn } from '../../lib/utils';

interface Props {
  action: AIActionPreview;
  isConfirmedOrCancelled?: boolean;
}

export function AIActionPreviewCard({ action, isConfirmedOrCancelled }: Props) {
  const { confirmAction, cancelAction, isProcessing } = useAIContext();

  const isDestructive = action.category === 'destructive' || action.requiresStrongConfirmation;
  const isHighRisk = action.category === 'high_risk';

  return (
    <div
      className={cn(
        'mt-2.5 mb-1.5 rounded-xl border p-3.5 shadow-sm transition-all text-xs',
        isDestructive
          ? 'bg-rose-50/90 border-rose-200 text-rose-950'
          : isHighRisk
            ? 'bg-amber-50/90 border-amber-200 text-amber-950'
            : 'bg-gold/10 border-gold/30 text-ink',
      )}
    >
      {/* Header & Category Badge */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-black/5">
        <div className="flex items-center gap-1.5">
          {isDestructive ? (
            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          ) : isHighRisk ? (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-gold shrink-0" />
          )}
          <span className="font-display font-semibold text-xs text-ink tracking-tight">
            {action.title}
          </span>
        </div>

        <span
          className={cn(
            'px-1.5 py-0.5 text-[9px] font-semibold rounded uppercase tracking-wider',
            isDestructive
              ? 'bg-rose-100 text-rose-700'
              : isHighRisk
                ? 'bg-amber-100 text-amber-800'
                : 'bg-gold/20 text-gold-darker font-medium',
          )}
        >
          {isDestructive ? 'Destructive' : isHighRisk ? 'Confirmation Required' : 'Safe Action'}
        </span>
      </div>

      {/* Target & Project Context */}
      {action.targetTitle && (
        <div className="pt-2 text-[11px] text-muted">
          <span>Target: </span>
          <strong className="text-ink font-medium">{action.targetTitle}</strong>
          {action.clientName && <span> ({action.clientName})</span>}
        </div>
      )}

      {/* Change Comparison List */}
      {action.changes && action.changes.length > 0 && (
        <div className="my-2.5 rounded-lg bg-white/80 border border-black/5 p-2 space-y-1.5">
          {action.changes.map((change, idx) => (
            <div key={idx} className="flex items-center justify-between text-[11px] gap-2">
              <span className="text-muted font-medium shrink-0">{change.label}:</span>
              <div className="flex items-center gap-1.5 text-right overflow-hidden text-ellipsis">
                {change.oldValue && (
                  <>
                    <span className="line-through text-muted text-[10px]">{String(change.oldValue)}</span>
                    <ArrowRight className="w-3 h-3 text-muted shrink-0" />
                  </>
                )}
                <span className="font-semibold text-ink">{String(change.newValue)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons (Disabled if already answered) */}
      {!isConfirmedOrCancelled ? (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => confirmAction(action)}
            disabled={isProcessing}
            className={cn(
              'flex-1 py-2 px-3 rounded-lg font-medium text-xs shadow-xs transition active:scale-95 flex items-center justify-center gap-1.5',
              isDestructive
                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                : 'bg-gold hover:bg-[#b89757] text-ink font-semibold',
            )}
          >
            {isDestructive ? <AlertCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            <span>{action.confirmButtonText || 'Confirm'}</span>
          </button>

          <button
            onClick={() => cancelAction(action)}
            disabled={isProcessing}
            className="py-2 px-3 rounded-lg bg-white hover:bg-black/5 text-muted hover:text-ink font-medium text-xs border border-black/10 transition active:scale-95 flex items-center justify-center gap-1"
          >
            <X className="w-3.5 h-3.5" />
            <span>{action.cancelButtonText || 'Cancel'}</span>
          </button>
        </div>
      ) : (
        <div className="pt-1 text-[10px] text-muted italic">Action completed</div>
      )}
    </div>
  );
}
