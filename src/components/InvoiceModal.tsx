import { Building2, Calendar, FileText, Mail, Printer, X } from 'lucide-react';
import { PaymentBadge } from './Badges';
import { Button, IconButton } from './ui';
import { formatDate } from '../lib/date';
import type { Project } from '../lib/types';
import { currency } from '../lib/utils';

export function InvoiceModal({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const totalPrice = Number(project.total_price || 0);
  const advancePaid = Number(project.advance_paid || 0);
  const dueAmount = Math.max(totalPrice - advancePaid, 0);

  function handlePrint() {
    window.print();
  }

  return (
    <div className="printable-invoice-modal fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
      <div className="printable-invoice-content flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl border border-border">
        {/* Header - Actions (Hidden on Print) */}
        <header className="no-print flex items-center justify-between border-b border-border bg-ivory px-6 py-4">
          <div className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-gold" />
            <h2 className="font-display text-xl font-semibold text-ink">Client Invoice</h2>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </Button>
            <IconButton title="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </header>

        {/* Printable Invoice Document Body */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 bg-white text-ink">
          {/* Top Brand Banner */}
          <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-md bg-gold font-display text-lg font-bold text-ink">
                  MH
                </div>
                <div>
                  <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Manuscript Heaven</h1>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">Publishing & Formatting Services</p>
                </div>
              </div>
            </div>

            <div className="text-left sm:text-right">
              <span className="inline-block rounded-md bg-gold/15 px-3 py-1 text-sm font-bold text-ink">
                INVOICE #{project.project_number}
              </span>
              <p className="mt-2 text-xs text-muted">
                Invoice Date: <span className="font-semibold text-ink">{formatDate(new Date().toISOString())}</span>
              </p>
              <p className="text-xs text-muted">
                Due Date: <span className="font-semibold text-ink">{formatDate(project.due_date)}</span>
              </p>
            </div>
          </div>

          {/* Client & Billing Info */}
          <div className="grid gap-6 sm:grid-cols-2 rounded-lg border border-border bg-ivory/40 p-5">
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-muted">Billed To</p>
              <p className="mt-1 font-display text-lg font-bold text-ink">{project.client_name}</p>
              {project.client_email ? (
                <div className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                  <Mail className="h-4 w-4 text-gold" />
                  <span>{project.client_email}</span>
                </div>
              ) : null}
            </div>

            <div className="sm:text-right">
              <p className="text-xs uppercase tracking-wider font-semibold text-muted">Payment Overview</p>
              <div className="mt-2 flex items-center sm:justify-end gap-2">
                <span className="text-sm font-medium text-muted">Status:</span>
                <PaymentBadge status={project.payment_status} />
              </div>
              {project.payment_date ? (
                <p className="mt-1 text-xs text-muted">
                  Last Payment Received: <span className="font-semibold">{formatDate(project.payment_date)}</span>
                </p>
              ) : null}
            </div>
          </div>

          {/* Project & Line Items */}
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-muted mb-3">Service & Project Details</h3>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-left text-sm border-collapse">
                <thead className="bg-ivory text-xs uppercase tracking-wider text-muted border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Service Type</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-4 py-4">
                      <p className="font-bold text-ink">{project.project_title}</p>
                      <p className="text-xs text-muted mt-0.5">Project ID: #{project.project_number}</p>
                    </td>
                    <td className="px-4 py-4 text-muted">{project.service_type || 'Publishing Services'}</td>
                    <td className="px-4 py-4 text-right font-semibold text-ink">{currency(totalPrice)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Total Calculation Breakdown */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-t border-border pt-6">
            <div className="max-w-xs space-y-2 text-xs text-muted">
              {project.payment_notes ? (
                <div>
                  <p className="font-semibold text-ink uppercase tracking-wider">Payment Notes</p>
                  <p className="mt-1 leading-relaxed">{project.payment_notes}</p>
                </div>
              ) : null}
              <div className="pt-2">
                <p className="font-semibold text-ink uppercase tracking-wider">Payment Instructions</p>
                <p className="mt-1">Please issue payment on or before the due date. Thank you for working with Manuscript Heaven!</p>
              </div>
            </div>

            <div className="w-full sm:w-64 space-y-2 rounded-md bg-ivory p-4 text-sm border border-border">
              <div className="flex justify-between text-muted">
                <span>Total Amount:</span>
                <span className="font-medium text-ink">{currency(totalPrice)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Advance Paid:</span>
                <span className="font-medium text-success">{currency(advancePaid)}</span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between font-bold text-base">
                <span className="text-ink">Balance Due:</span>
                <span className="text-warning">{currency(dueAmount)}</span>
              </div>
            </div>
          </div>

          {/* Footer Thank You */}
          <div className="border-t border-border pt-6 text-center text-xs text-muted">
            <p className="font-semibold text-ink">Manuscript Heaven - Professional Publishing Solutions</p>
            <p className="mt-1">If you have any questions regarding this invoice, please contact your project manager.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
