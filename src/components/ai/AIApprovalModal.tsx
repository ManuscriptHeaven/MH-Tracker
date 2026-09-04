import React from 'react';
import { AlertCircle, CheckCircle2, ShieldAlert, X, ArrowRight, RotateCcw, AlertTriangle, Edit3, DollarSign, Mail, Trash2, Layers } from 'lucide-react';
import type { AIProposal, ApprovalRecord } from '../../lib/ai/aiApprovalTypes';

interface Props {
  proposal?: AIProposal;
  approvalRecord?: ApprovalRecord;
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string) => void;
  onEdit?: (proposal: AIProposal) => void;
}

export function AIApprovalModal({ proposal, approvalRecord, onApprove, onReject, onEdit }: Props) {
  if (!proposal && !approvalRecord) return null;

  const currentProp: AIProposal | null = proposal || (approvalRecord ? {
    proposalId: approvalRecord.proposalId,
    requestId: approvalRecord.approvalId,
    actionTool: approvalRecord.actionTool as any,
    targetResource: { type: approvalRecord.targetResourceType as any, id: approvalRecord.targetResourceId },
    proposedChanges: {},
    riskLevel: approvalRecord.riskLevel,
    requiresApproval: true,
    createdAt: approvalRecord.createdAt,
    expiresAt: approvalRecord.expiresAt,
    missingRequiredParams: [],
  } : null);

  if (!currentProp) return null;

  const isCritical = currentProp.riskLevel === 'critical';
  const isHigh = currentProp.riskLevel === 'high';

  return (
    <div className={`mt-2.5 mb-2 rounded-xl border p-4 shadow-sm text-xs transition-all ${
      isCritical
        ? 'bg-rose-50/95 border-rose-300 text-rose-950'
        : isHigh
          ? 'bg-amber-50/95 border-amber-300 text-amber-950'
          : 'bg-slate-50 border-slate-200 text-slate-900'
    }`}>
      {/* Badge & Header */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-black/10">
        <div className="flex items-center gap-1.5 font-bold text-sm">
          {isCritical ? (
            <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
          ) : isHigh ? (
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-blue-600 shrink-0" />
          )}
          <span className="capitalize">{currentProp.actionTool.replace(/_/g, ' ')} Proposal</span>
        </div>

        <span className={`px-2 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider ${
          isCritical
            ? 'bg-rose-200 text-rose-800 border border-rose-300'
            : isHigh
              ? 'bg-amber-200 text-amber-900 border border-amber-300'
              : 'bg-blue-100 text-blue-800'
        }`}>
          {currentProp.riskLevel} Risk
        </span>
      </div>

      {/* Target Resource Summary */}
      <div className="py-2.5 space-y-1.5 text-xs">
        <div className="text-slate-600">
          <span>Target Resource: </span>
          <strong className="text-slate-900 font-semibold">{currentProp.targetResource.name || currentProp.targetResource.id || 'Selected Item'}</strong>
        </div>

        {/* Financial Action Details */}
        {currentProp.financialDetails && (
          <div className="my-2 rounded-lg bg-white/90 border border-amber-200 p-2.5 space-y-1 text-xs">
            <div className="flex items-center gap-1.5 text-amber-900 font-bold">
              <DollarSign className="w-4 h-4 text-amber-600" />
              <span>Financial Action Details ({currentProp.financialDetails.currency})</span>
            </div>
            <div>Invoice ID: <strong>{currentProp.financialDetails.invoiceId}</strong></div>
            <div>Client: <strong>{currentProp.financialDetails.clientName}</strong></div>
            <div className="flex items-center gap-2 pt-1 font-mono">
              <span className="line-through text-slate-500">{currentProp.financialDetails.beforeAmount.toLocaleString()} {currentProp.financialDetails.currency}</span>
              <ArrowRight className="w-3.5 h-3.5 text-amber-600" />
              <strong className="text-slate-900">{currentProp.financialDetails.afterAmount.toLocaleString()} {currentProp.financialDetails.currency}</strong>
            </div>
          </div>
        )}

        {/* Message Preview */}
        {currentProp.messageDetails && (
          <div className="my-2 rounded-lg bg-white/90 border border-blue-200 p-2.5 space-y-1 text-xs">
            <div className="flex items-center gap-1.5 text-blue-900 font-bold">
              <Mail className="w-4 h-4 text-blue-600" />
              <span>Outbound Message Preview</span>
            </div>
            <div>To: <strong>{currentProp.messageDetails.recipientName} ({currentProp.messageDetails.channel})</strong></div>
            <div className="p-2 rounded bg-slate-50 border text-slate-800 italic text-[11px]">
              "{currentProp.messageDetails.body}"
            </div>
          </div>
        )}

        {/* Delete Details */}
        {currentProp.deleteDetails && (
          <div className="my-2 rounded-lg bg-rose-100/90 border border-rose-300 p-2.5 space-y-1 text-xs text-rose-950">
            <div className="flex items-center gap-1.5 font-bold text-rose-900">
              <Trash2 className="w-4 h-4 text-rose-600" />
              <span>Deletion Impact Summary</span>
            </div>
            <div>Deleting: <strong>{currentProp.deleteDetails.entityName} ({currentProp.deleteDetails.entityType})</strong></div>
            <div>Dependent Tasks Affected: <strong>{currentProp.deleteDetails.dependentTasksCount}</strong></div>
            <div className="text-[10px] text-rose-700 italic">This record will be safely archived (soft delete enabled).</div>
          </div>
        )}

        {/* Bulk Details */}
        {currentProp.bulkDetails && (
          <div className="my-2 rounded-lg bg-purple-100/90 border border-purple-300 p-2.5 space-y-1 text-xs text-purple-950">
            <div className="flex items-center gap-1.5 font-bold text-purple-900">
              <Layers className="w-4 h-4 text-purple-600" />
              <span>Bulk Action Summary</span>
            </div>
            <div>Total Affected Records: <strong>{currentProp.bulkDetails.affectedCount} items</strong></div>
            <div>Scope: <em>{currentProp.bulkDetails.scopeDescription}</em></div>
          </div>
        )}

        {/* Field Diff List */}
        {Object.keys(currentProp.proposedChanges).length > 0 && (
          <div className="my-2 space-y-1 border-t border-b border-black/5 py-1.5">
            {Object.entries(currentProp.proposedChanges).map(([field, val]) => (
              <div key={field} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 capitalize">{field}:</span>
                <div className="flex items-center gap-1">
                  {val.from !== undefined && <span className="line-through text-slate-400">{String(val.from)}</span>}
                  {val.from !== undefined && <ArrowRight className="w-3 h-3 text-slate-400" />}
                  <strong className="text-slate-900">{String(val.to)}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Buttons: Edit, Cancel, Confirm */}
      <div className="flex items-center gap-2 pt-2.5 border-t border-black/10">
        {onApprove && approvalRecord && (
          <button
            onClick={() => onApprove(approvalRecord.approvalId)}
            className={`flex-1 py-2 px-3 rounded-lg font-bold text-xs shadow-xs transition ${
              isCritical
                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            Confirm & Execute
          </button>
        )}

        {onEdit && (
          <button
            onClick={() => onEdit(currentProp)}
            className="py-2 px-3 rounded-lg font-medium text-xs bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition flex items-center gap-1"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Edit
          </button>
        )}

        {onReject && approvalRecord && (
          <button
            onClick={() => onReject(approvalRecord.approvalId)}
            className="py-2 px-3 rounded-lg font-medium text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 transition"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
