import { Mail, Printer, X } from 'lucide-react';
import { PaymentBadge } from './Badges';
import { Button, IconButton } from './ui';
import { formatDate } from '../lib/date';
import type { Invoice, InvoiceItem, Project } from '../lib/types';
import { currency } from '../lib/utils';
import { calculateDueAmount } from '../lib/invoiceUtils';

export function InvoiceModal({
  project,
  invoice,
  onClose,
}: {
  project?: Project | null;
  invoice?: Invoice | null;
  onClose: () => void;
}) {
  // If neither project nor invoice is provided, return null
  if (!project && !invoice) {
    return null;
  }

  function handlePrint() {
    window.print();
  }

  // Normalize single project or bulk invoice into uniform data
  const invoiceNumber = invoice
    ? invoice.invoice_number
    : `INV-${project?.project_number || '001'}`;

  const invoiceDate = invoice
    ? formatDate(invoice.created_at)
    : formatDate(new Date().toISOString());

  const dueDate = invoice
    ? formatDate(invoice.due_date)
    : formatDate(project?.due_date);

  const clientName = invoice ? invoice.client_name : project?.client_name || 'Valued Client';
  const clientEmail = invoice ? invoice.client_email : project?.client_email || '';

  const paymentStatus = invoice
    ? invoice.status === 'Paid'
      ? 'Fully Paid'
      : invoice.status === 'Sent'
      ? 'Pending'
      : 'Not Started'
    : project?.payment_status || 'Pending';

  const lastPaymentDate = !invoice && project?.payment_date ? formatDate(project.payment_date) : null;

  const items: InvoiceItem[] = invoice
    ? invoice.items
    : project
    ? [
        {
          project_id: project.id,
          project_number: project.project_number,
          project_title: project.project_title,
          service_type: project.service_type || 'Publishing Services',
          total_price: Number(project.total_price || 0),
          advance_paid: Number(project.advance_paid || 0),
          due_amount: calculateDueAmount(project),
          completion_date: project.delivery_date || project.due_date,
        },
      ]
    : [];

  const subtotal = invoice
    ? invoice.subtotal
    : Number(project?.total_price || 0);

  const totalPaid = invoice
    ? invoice.total_paid
    : Number(project?.advance_paid || 0);

  const totalDue = invoice
    ? invoice.total_due
    : calculateDueAmount(project!);

  const paymentNotes = !invoice ? project?.payment_notes : invoice.notes;

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
                INVOICE #{invoiceNumber}
              </span>
              <p className="mt-2 text-xs text-muted">
                Invoice Date: <span className="font-semibold text-ink">{invoiceDate}</span>
              </p>
              <p className="text-xs text-muted">
                Due Date: <span className="font-semibold text-ink">{dueDate}</span>
              </p>
            </div>
          </div>

          {/* Client & Billing Info */}
          <div className="grid gap-6 sm:grid-cols-2 rounded-lg border border-border bg-ivory/40 p-5">
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-muted">Billed To</p>
              <p className="mt-1 font-display text-lg font-bold text-ink">{clientName}</p>
              {clientEmail ? (
                <div className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                  <Mail className="h-4 w-4 text-gold" />
                  <span>{clientEmail}</span>
                </div>
              ) : null}
            </div>

            <div className="sm:text-right">
              <p className="text-xs uppercase tracking-wider font-semibold text-muted">Payment Overview</p>
              <div className="mt-2 flex items-center sm:justify-end gap-2">
                <span className="text-sm font-medium text-muted">Status:</span>
                <PaymentBadge status={paymentStatus} />
              </div>
              {lastPaymentDate ? (
                <p className="mt-1 text-xs text-muted">
                  Last Payment Received: <span className="font-semibold">{lastPaymentDate}</span>
                </p>
              ) : null}
            </div>
          </div>

          {/* Project & Line Items Table */}
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-muted mb-3">
              Itemized Services ({items.length} {items.length === 1 ? 'Project' : 'Projects'})
            </h3>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-left text-sm border-collapse">
                <thead className="bg-ivory text-xs uppercase tracking-wider text-muted border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Service Type</th>
                    <th className="px-4 py-3 text-right">Total Price</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-right">Balance Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item, idx) => (
                    <tr key={item.project_id || idx}>
                      <td className="px-4 py-4">
                        <p className="font-bold text-ink">{item.project_title}</p>
                        <p className="text-xs text-muted mt-0.5">Project ID: #{item.project_number}</p>
                      </td>
                      <td className="px-4 py-4 text-muted">{item.service_type || 'Publishing Services'}</td>
                      <td className="px-4 py-4 text-right font-medium text-ink">{currency(item.total_price)}</td>
                      <td className="px-4 py-4 text-right font-medium text-success">{currency(item.advance_paid)}</td>
                      <td className="px-4 py-4 text-right font-semibold text-warning">{currency(item.due_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Total Calculation Breakdown */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-t border-border pt-6">
            <div className="max-w-xs space-y-2 text-xs text-muted">
              {paymentNotes ? (
                <div>
                  <p className="font-semibold text-ink uppercase tracking-wider">Payment Notes</p>
                  <p className="mt-1 leading-relaxed">{paymentNotes}</p>
                </div>
              ) : null}
              <div className="pt-2">
                <p className="font-semibold text-ink uppercase tracking-wider">Payment Instructions</p>
                <p className="mt-1">Please issue payment on or before the due date. Thank you for working with Manuscript Heaven!</p>
              </div>
            </div>

            <div className="w-full sm:w-64 space-y-2 rounded-md bg-ivory p-4 text-sm border border-border">
              <div className="flex justify-between text-muted">
                <span>Subtotal Amount:</span>
                <span className="font-medium text-ink">{currency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Total Paid:</span>
                <span className="font-medium text-success">{currency(totalPaid)}</span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between font-bold text-base">
                <span className="text-ink">Total Balance Due:</span>
                <span className="text-warning">{currency(totalDue)}</span>
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
