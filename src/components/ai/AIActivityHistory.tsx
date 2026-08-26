import React from 'react';
import { CheckCircle2, Clock, ShieldCheck, XCircle, Trash2, ArrowRight } from 'lucide-react';
import { useAIContext } from '../../lib/ai/aiContext';
import { formatDate } from '../../lib/date';

export function AIActivityHistory() {
  const { auditLogs } = useAIContext();

  if (!auditLogs || auditLogs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center text-muted">
        <ShieldCheck className="w-10 h-10 text-gold/50 mb-2" />
        <h4 className="font-display font-semibold text-ink text-sm mb-1">No AI Activity Yet</h4>
        <p className="text-xs max-w-xs">
          Actions executed by the AI Assistant (such as assigning tasks, changing deadlines, or updating statuses) will appear here for auditability.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto max-h-full">
      <div className="flex items-center justify-between pb-2 border-b border-border text-xs">
        <span className="font-semibold text-ink">AI Action Audit Trail</span>
        <span className="text-muted text-[11px]">{auditLogs.length} actions</span>
      </div>

      <div className="space-y-2.5">
        {auditLogs.map((log) => (
          <div
            key={log.id}
            className="p-3 rounded-xl bg-white border border-border/80 shadow-xs flex flex-col gap-1.5 text-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 font-medium text-ink">
                {log.status === 'success' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                ) : log.status === 'cancelled' ? (
                  <Clock className="w-3.5 h-3.5 text-muted shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                )}
                <span>{log.action}</span>
              </div>
              <span className="text-[10px] text-muted shrink-0">
                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {log.targetTitle && (
              <div className="text-[11px] text-muted pl-5">
                Target: <strong className="text-ink font-normal">{log.targetTitle}</strong>
              </div>
            )}

            {(log.oldValue || log.newValue) && (
              <div className="flex items-center gap-1.5 text-[11px] pl-5 bg-linen/50 rounded p-1">
                {log.oldValue && (
                  <>
                    <span className="line-through text-muted text-[10px]">{log.oldValue}</span>
                    <ArrowRight className="w-2.5 h-2.5 text-muted" />
                  </>
                )}
                <span className="font-semibold text-ink">{log.newValue}</span>
              </div>
            )}

            <div className="flex items-center justify-between text-[10px] text-muted pl-5 pt-0.5 border-t border-black/5">
              <span>Initiated by: {log.userName}</span>
              <span className="capitalize">{log.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
