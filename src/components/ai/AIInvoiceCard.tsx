import React from 'react';
import { FileText, Download, CheckCircle, ExternalLink, DollarSign } from 'lucide-react';
import type { Invoice } from '../../lib/types';
import { useCurrency } from '../../lib/currency';
import { formatDate } from '../../lib/date';

interface AIInvoiceCardProps {
  invoice: Invoice;
  onViewInvoice?: (invoice: Invoice) => void;
}

export function AIInvoiceCard({ invoice, onViewInvoice }: AIInvoiceCardProps) {
  const { formatMoney } = useCurrency();

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-gold/40 bg-gradient-to-b from-[#24211e] to-[#1a1816] text-white shadow-lg">
      {/* Card Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold text-ink shadow-sm">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-gold">
                {invoice.invoice_number}
              </span>
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30">
                {invoice.status}
              </span>
            </div>
            <p className="text-xs text-white/70">
              Invoice for <strong className="text-white">{invoice.client_name}</strong>
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-[10px] text-white/50 block">Due Date</span>
          <span className="text-xs font-semibold text-white/90">{formatDate(invoice.due_date)}</span>
        </div>
      </div>

      {/* Itemized Projects Table */}
      <div className="p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">
          Itemized Projects ({invoice.items?.length || 0})
        </div>

        <div className="space-y-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-white/60">
                <th className="pb-1.5 font-medium">Project</th>
                <th className="pb-1.5 font-medium">Service</th>
                <th className="pb-1.5 text-right font-medium">Total</th>
                <th className="pb-1.5 text-right font-medium">Advance</th>
                <th className="pb-1.5 text-right font-medium text-gold">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {invoice.items?.map((item) => (
                <tr key={item.project_id || item.project_number} className="text-white/90">
                  <td className="py-2 pr-2">
                    <span className="font-semibold text-white">{item.project_title}</span>
                    <span className="block font-mono text-[10px] text-white/50">
                      {item.project_number}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-white/70 text-[11px]">{item.service_type}</td>
                  <td className="py-2 text-right">{formatMoney(item.total_price)}</td>
                  <td className="py-2 text-right text-emerald-400">
                    {formatMoney(item.advance_paid)}
                  </td>
                  <td className="py-2 text-right font-bold text-gold">
                    {formatMoney(item.due_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals Summary */}
        <div className="mt-4 rounded-lg bg-black/30 p-3 border border-white/5 flex items-center justify-between">
          <div className="text-xs text-white/60">
            <span>Subtotal: {formatMoney(invoice.subtotal)}</span>
            <span className="mx-2">•</span>
            <span>Paid: {formatMoney(invoice.total_paid)}</span>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase tracking-wider text-white/50 block">
              Total Balance Due
            </span>
            <span className="font-display text-base font-bold text-gold">
              {formatMoney(invoice.total_due)}
            </span>
          </div>
        </div>

        {/* Action Button */}
        {onViewInvoice && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onViewInvoice(invoice)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gold px-3.5 py-2 text-xs font-bold text-ink transition hover:bg-gold/90 shadow-sm"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View & Print Full Invoice
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
