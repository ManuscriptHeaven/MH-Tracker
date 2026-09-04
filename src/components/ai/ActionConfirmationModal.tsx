import React from 'react';
import { AlertCircle, CheckCircle2, ShieldAlert, X, ArrowRight, RotateCcw, AlertTriangle } from 'lucide-react';
import type { AIActionPlan, ConfirmationToken, ActionResult } from '../../lib/ai/aiActionTypes';
import { ActionHistoryManager } from '../../lib/ai/aiActionHistory';

interface Props {
  token?: ConfirmationToken;
  actionResult?: ActionResult;
  onConfirm?: (token: ConfirmationToken) => void;
  onCancel?: () => void;
  onUndo?: (actionId: string) => void;
}

export function ActionConfirmationModal({ token, actionResult, onConfirm, onCancel, onUndo }: Props) {
  if (!token && !actionResult) return null;

  if (actionResult) {
    const canUndo = actionResult.undoAvailable && actionResult.actionId;
    return (
      <div className="mt-2.5 mb-1.5 rounded-xl border border-emerald-200 bg-emerald-50/90 p-3.5 shadow-xs text-xs text-emerald-950">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-emerald-200/50">
          <div className="flex items-center gap-1.5 font-semibold text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Action Executed Successfully</span>
          </div>
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded uppercase tracking-wider bg-emerald-100 text-emerald-800">
            Receipt
          </span>
        </div>

        <div className="py-2 text-xs leading-relaxed text-emerald-900">
          {actionResult.spokenText}
        </div>

        {canUndo && onUndo && (
          <div className="pt-2 flex justify-end">
            <button
              onClick={() => onUndo(actionResult.actionId)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-100 transition"
            >
              <RotateCcw className="w-3 h-3" />
              Undo Action
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!token) return null;

  const plan = token.actionPlan;
  const isHighRisk = plan.riskLevel === 'high';

  return (
    <div className={`mt-2.5 mb-1.5 rounded-xl border p-3.5 shadow-sm text-xs ${isHighRisk ? 'bg-amber-50/90 border-amber-200 text-amber-950' : 'bg-slate-50 border-slate-200 text-slate-900'}`}>
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-black/5">
        <div className="flex items-center gap-1.5 font-semibold">
          {isHighRisk ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" /> : <ShieldAlert className="w-4 h-4 text-blue-600 shrink-0" />}
          <span className="capitalize">{plan.actionTool.replace('_', ' ')} Confirmation</span>
        </div>
        <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded uppercase tracking-wider ${isHighRisk ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
          {plan.riskLevel} Risk
        </span>
      </div>

      <div className="py-2 text-[11px] space-y-1">
        <div><strong>Target Item:</strong> {plan.targetResource.name || plan.targetResource.id || 'Selected Resource'}</div>
        {Object.entries(plan.proposedChanges).map(([field, val]) => (
          <div key={field} className="flex items-center gap-1.5">
            <span className="text-slate-500 capitalize">{field}:</span>
            {val.from && <span className="line-through text-slate-400">{String(val.from)} ➔ </span>}
            <span className="font-semibold">{String(val.to)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-black/5">
        {onConfirm && (
          <button
            onClick={() => onConfirm(token)}
            className="flex-1 py-1.5 px-3 rounded-lg font-medium text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition"
          >
            Confirm
          </button>
        )}
        {onCancel && (
          <button
            onClick={onCancel}
            className="py-1.5 px-3 rounded-lg font-medium text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 transition"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
