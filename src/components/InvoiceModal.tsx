import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageDown, Mail, Printer, X } from 'lucide-react';
import { PaymentBadge } from './Badges';
import { Button, IconButton } from './ui';
import { formatDate } from '../lib/date';
import type { Invoice, InvoiceItem, Project } from '../lib/types';
import { useCurrency } from '../lib/currency';
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
  const { formatMoney } = useCurrency();
  const invoiceRef = useRef<HTMLDivElement>(null);
  const [savingJpg, setSavingJpg] = useState(false);

  if (!project && !invoice) {
    return null;
  }

  function handlePrint() {
    window.print();
  }

  async function handleSaveJpg() {
    if (!invoiceRef.current) return;
    setSavingJpg(true);
    try {
      // Load html2canvas from CDN if not already loaded
      if (!(window as unknown as Record<string, unknown>)['html2canvas']) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load html2canvas'));
          document.head.appendChild(script);
        });
      }
      const html2canvas = (window as unknown as Record<string, unknown>)['html2canvas'] as (
        el: HTMLElement,
        opts?: object
      ) => Promise<HTMLCanvasElement>;

      const canvas = await html2canvas(invoiceRef.current, {
        scale: 2.5,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `Invoice-${invoiceNumber}.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 0.95);
      link.click();
    } catch (err) {
      console.error('JPG export failed:', err);
      alert('JPG export failed. Use Print / Save PDF to save as PDF instead.');
    } finally {
      setSavingJpg(false);
    }
  }

  // Normalize data safely
  const invoiceNumber = invoice
    ? invoice.invoice_number || 'INV-000'
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
    ? invoice.items || []
    : project
    ? [
        {
          project_id: project.id,
          project_number: project.project_number || '000',
          project_title: project.project_title || 'Publishing Service',
          service_type: project.service_type || 'Publishing Services',
          total_price: Number(project.total_price || 0),
          advance_paid: Number(project.advance_paid || 0),
          due_amount: calculateDueAmount(project),
          completion_date: project.delivery_date || project.due_date,
        },
      ]
    : [];

  const subtotal = invoice ? Number(invoice.subtotal || 0) : Number(project?.total_price || 0);
  const totalPaid = invoice ? Number(invoice.total_paid || 0) : Number(project?.advance_paid || 0);
  const totalDue = invoice ? Number(invoice.total_due || 0) : project ? calculateDueAmount(project) : 0;
  const paymentNotes = !invoice ? project?.payment_notes : invoice?.notes;

  // Shared inline styles (used for both screen and PNG capture)
  const s = {
    root: {
      width: '794px',  // 210mm at 96dpi
      minHeight: '1123px', // 297mm at 96dpi
      padding: '53px', // ~14mm at 96dpi
      background: '#ffffff',
      boxSizing: 'border-box' as const,
      fontFamily: '"Inter", "Segoe UI", Arial, sans-serif',
      fontSize: '13px',
      color: '#1a1a1a',
    },
    header: {
      display: 'flex' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'flex-start' as const,
      borderBottom: '2px solid #e5ddd0',
      paddingBottom: '16px',
      marginBottom: '18px',
    },
    logo: {
      width: '40px', height: '40px', background: '#c8a96b',
      borderRadius: '6px', display: 'flex' as const,
      alignItems: 'center' as const, justifyContent: 'center' as const,
      fontWeight: 800, fontSize: '15px', color: '#1a1a1a',
      marginRight: '10px', flexShrink: 0 as const,
    },
    badge: {
      background: '#f5ead8', border: '1px solid #c8a96b',
      borderRadius: '4px', padding: '4px 12px',
      fontWeight: 700, fontSize: '12px', color: '#1a1a1a',
      display: 'inline-block' as const,
    },
    infoBox: {
      display: 'grid' as const, gridTemplateColumns: '1fr 1fr',
      gap: '16px', background: '#fbf8f1',
      border: '1px solid #e5ddd0', borderRadius: '6px',
      padding: '14px', marginBottom: '18px',
    },
    label: {
      fontSize: '9px', color: '#7a6a55',
      textTransform: 'uppercase' as const, letterSpacing: '1.5px',
      fontWeight: 600, marginBottom: '4px',
    },
    th: {
      padding: '8px 12px', textAlign: 'left' as const,
      fontWeight: 600, color: '#7a6a55', fontSize: '9px',
      textTransform: 'uppercase' as const, letterSpacing: '1px',
      borderBottom: '1px solid #e5ddd0', background: '#fbf8f1',
    },
    td: { padding: '10px 12px', borderBottom: '1px solid #f0e8dc' },
  };

  return createPortal(
    <div className="printable-invoice-modal fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="printable-invoice-wrapper flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl border border-border">

        {/* Action Header — hidden on print */}
        <header className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-border bg-ivory px-5 py-3">
          <div className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-gold" />
            <h2 className="font-display text-lg font-semibold text-ink">Invoice Preview</h2>
            <span className="text-xs text-muted ml-2">— 1 A4 page</span>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </Button>
            <Button type="button" variant="secondary" onClick={handleSaveJpg} disabled={savingJpg}>
              <ImageDown className="h-4 w-4" />
              {savingJpg ? 'Saving…' : 'Save as JPG'}
            </Button>
            <IconButton title="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </header>

        {/* Scrollable preview area */}
        <div className="flex-1 overflow-auto bg-gray-100 p-6 flex justify-center">

          {/* The actual A4 invoice — this div is captured for PNG and printed */}
          <div ref={invoiceRef} className="printable-invoice-content" style={s.root}>

            {/* Brand Header */}
            <div style={s.header}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={s.logo}>MH</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '20px', letterSpacing: '-0.5px' }}>Manuscript Heaven</div>
                  <div style={{ fontSize: '9px', color: '#7a6a55', textTransform: 'uppercase', letterSpacing: '2px', marginTop: '2px' }}>Publishing &amp; Formatting Services</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={s.badge}>INVOICE #{invoiceNumber}</div>
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#7a6a55' }}>
                  Invoice Date: <strong style={{ color: '#1a1a1a' }}>{invoiceDate}</strong>
                </div>
                <div style={{ fontSize: '11px', color: '#7a6a55', marginTop: '2px' }}>
                  Due Date: <strong style={{ color: '#1a1a1a' }}>{dueDate}</strong>
                </div>
              </div>
            </div>

            {/* Billed To + Payment Status */}
            <div style={s.infoBox}>
              <div>
                <div style={s.label}>Billed To</div>
                <div style={{ fontWeight: 700, fontSize: '16px' }}>{clientName}</div>
                {clientEmail ? (
                  <div style={{ fontSize: '11px', color: '#7a6a55', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    ✉ {clientEmail}
                  </div>
                ) : null}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={s.label}>Payment Overview</div>
                <div style={{ marginTop: '4px' }}>
                  <PaymentBadge status={paymentStatus} />
                </div>
                {lastPaymentDate ? (
                  <div style={{ fontSize: '10px', color: '#7a6a55', marginTop: '6px' }}>
                    Last Payment: <strong>{lastPaymentDate}</strong>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Items Table */}
            <div style={{ marginBottom: '18px' }}>
              <div style={s.label}>
                Itemized Services — {items.length} {items.length === 1 ? 'Project' : 'Projects'}
              </div>
              <div style={{ border: '1px solid #e5ddd0', borderRadius: '6px', overflow: 'hidden', marginTop: '6px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th style={s.th}>Description</th>
                      <th style={s.th}>Service Type</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Total</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Paid</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Balance Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={item.project_id || idx}>
                        <td style={s.td}>
                          <div style={{ fontWeight: 600 }}>{item.project_title}</div>
                          <div style={{ fontSize: '10px', color: '#7a6a55' }}>#{item.project_number}</div>
                        </td>
                        <td style={{ ...s.td, color: '#7a6a55' }}>{item.service_type || 'Publishing Services'}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontWeight: 500 }}>{formatMoney(item.total_price, 'USD')}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontWeight: 500, color: '#2d6a4f' }}>{formatMoney(item.advance_paid, 'USD')}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontWeight: 700, color: '#b5451b' }}>{formatMoney(item.due_amount, 'USD')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals + Notes */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px', borderTop: '2px solid #e5ddd0', paddingTop: '16px' }}>
              <div style={{ flex: 1, fontSize: '11px', color: '#7a6a55', maxWidth: '320px' }}>
                {paymentNotes ? (
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ ...s.label, marginBottom: '4px' }}>Payment Notes</div>
                    <div style={{ lineHeight: '1.6' }}>{paymentNotes}</div>
                  </div>
                ) : null}
                <div>
                  <div style={{ ...s.label, marginBottom: '4px' }}>Payment Instructions</div>
                  <div style={{ lineHeight: '1.6' }}>Please issue payment on or before the due date. Thank you for choosing Manuscript Heaven!</div>
                </div>
              </div>

              <div style={{ width: '220px', background: '#fbf8f1', border: '1px solid #e5ddd0', borderRadius: '6px', padding: '14px', fontSize: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: '#7a6a55' }}>
                  <span>Subtotal:</span>
                  <strong style={{ color: '#1a1a1a' }}>{formatMoney(subtotal, 'USD')}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', color: '#7a6a55' }}>
                  <span>Total Paid:</span>
                  <strong style={{ color: '#2d6a4f' }}>{formatMoney(totalPaid, 'USD')}</strong>
                </div>
                <div style={{ borderTop: '1px solid #e5ddd0', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '14px' }}>
                  <span>Balance Due:</span>
                  <span style={{ color: '#b5451b' }}>{formatMoney(totalDue, 'USD')}</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ marginTop: '28px', borderTop: '1px solid #e5ddd0', paddingTop: '12px', textAlign: 'center', fontSize: '10px', color: '#7a6a55' }}>
              <strong style={{ color: '#1a1a1a' }}>Manuscript Heaven</strong> — Professional Publishing Solutions
              <br />
              For any questions regarding this invoice, please contact your project manager.
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
