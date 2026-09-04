import React from 'react';
import type { FederatedResult, JoinedRecord } from '../../lib/ai/aiCrossModuleTypes';

interface Props {
  result: FederatedResult;
}

export function AICrossModuleReport({ result }: Props) {
  if (!result || result.records.length === 0) {
    return (
      <div className="p-3 my-2 text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
        No matching records found across connected modules.
      </div>
    );
  }

  return (
    <div className="my-3 text-xs bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 bg-slate-900 text-white flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2">
          <span>📊 Cross-Module Report</span>
          <span className="text-[10px] bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full font-mono">
            {result.totalRecordsFound} items
          </span>
        </div>
        <div className="text-[10px] text-slate-400">
          Latency: {result.latencyMs}ms {result.fromCache ? '(Cached)' : ''}
        </div>
      </div>

      {/* Module Badges */}
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-1.5 text-[11px]">
        {Object.entries(result.moduleCounts).map(([mod, count]) => {
          if (count === 0) return null;
          return (
            <span key={mod} className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded capitalize">
              {mod}: <strong>{count}</strong>
            </span>
          );
        })}
        {result.permissionMaskedCount > 0 && (
          <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded italic">
            {result.permissionMaskedCount} hidden by security policy
          </span>
        )}
      </div>

      {/* Record Rows */}
      <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
        {result.records.map((rec: JoinedRecord) => (
          <div key={rec.primaryId} className="p-3 hover:bg-slate-50 transition-colors">
            <div className="flex items-center justify-between">
              <a
                href={rec.deepLink}
                className="font-medium text-slate-900 hover:text-sky-600 underline decoration-sky-300"
              >
                {rec.title}
              </a>
              {rec.status && (
                <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-700">
                  {rec.status}
                </span>
              )}
            </div>

            {rec.subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{rec.subtitle}</p>}

            {/* Related Sub-data */}
            {rec.relatedModuleData && Object.keys(rec.relatedModuleData).length > 0 && (
              <div className="mt-2 pl-2 border-l-2 border-slate-200 space-y-1 text-[11px] text-slate-600">
                {rec.relatedModuleData.projects && rec.relatedModuleData.projects.length > 0 && (
                  <div>
                    <span className="font-semibold text-slate-700">Projects: </span>
                    {rec.relatedModuleData.projects.map((p: any) => p.project_title || p.name).join(', ')}
                  </div>
                )}
                {rec.relatedModuleData.tasks && rec.relatedModuleData.tasks.length > 0 && (
                  <div>
                    <span className="font-semibold text-slate-700">Tasks: </span>
                    {rec.relatedModuleData.tasks.map((t: any) => t.title).join(', ')}
                  </div>
                )}
                {rec.relatedModuleData.invoices && rec.relatedModuleData.invoices.length > 0 && (
                  <div>
                    <span className="font-semibold text-slate-700">Invoices: </span>
                    {rec.relatedModuleData.invoices.map((inv: any) => `${inv.invoice_number || inv.id} ($${inv.amount || 0})`).join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
