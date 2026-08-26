import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ImageDown,
  Printer,
  X,
  Calendar,
  Clock,
  User,
  CreditCard,
  Building2,
  Mail,
  Globe,
  Phone,
  MapPin,
  HeartHandshake,
  Layers,
} from 'lucide-react';
import { Button, IconButton } from './ui';
import { formatDate } from '../lib/date';
import type { Invoice, InvoiceItem, Project } from '../lib/types';
import { useCurrency } from '../lib/currency';
import { calculateDueAmount } from '../lib/invoiceUtils';
import { ManuscriptHeavenLogo } from './ManuscriptHeavenLogo';
import { UserAvatar } from './UserAvatar';

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
        opts?: object,
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

  const dueDate = invoice ? formatDate(invoice.due_date) : formatDate(project?.due_date);

  const clientName = invoice ? invoice.client_name : project?.client_name || 'Valued Client';
  const clientEmail = invoice ? invoice.client_email : project?.client_email || '';

  const rawStatus = invoice
    ? invoice.status === 'Paid'
      ? 'PAID'
      : invoice.status === 'Sent'
        ? 'PENDING'
        : 'PENDING'
    : (project?.payment_status || 'PENDING').toUpperCase();

  const isPaid = rawStatus.includes('PAID') || rawStatus === 'PAID';
  const isPartial = rawStatus.includes('PARTIAL');
  const statusLabel = isPaid ? 'PAID' : isPartial ? 'PARTIAL' : 'PENDING';

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
  const totalDue = invoice
    ? Number(invoice.total_due || 0)
    : project
      ? calculateDueAmount(project)
      : 0;

  return createPortal(
    <div className="printable-invoice-modal fixed inset-0 z-50 flex items-center justify-center bg-ink/50 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="printable-invoice-wrapper flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-border">
        {/* Modal Top Control Bar (Hidden when printed) */}
        <div className="no-print flex items-center justify-between border-b border-border bg-[#faf7f2] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold/20 text-ink border border-gold/40 font-bold">
              🧾
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-ink">
                Official Invoice Preview
              </h2>
              <p className="text-xs text-muted-foreground">
                Manuscript Heaven Publishing & Formatting Services
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={handleSaveJpg}
              disabled={savingJpg}
              className="border-border text-ink hover:bg-gold/10 text-xs py-1.5 px-3"
            >
              <ImageDown className="mr-1.5 h-4 w-4 text-gold" />
              {savingJpg ? 'Saving...' : 'Save JPG'}
            </Button>
            <Button
              variant="primary"
              onClick={handlePrint}
              className="bg-gold text-ink hover:bg-gold/90 font-semibold text-xs py-1.5 px-3"
            >
              <Printer className="mr-1.5 h-4 w-4" />
              Print / Save PDF
            </Button>
            <IconButton title="Close" onClick={onClose} className="hover:bg-black/5">
              <X className="h-5 w-5" />
            </IconButton>
          </div>
        </div>

        {/* Scrollable Printable Document Viewport */}
        <div className="overflow-y-auto p-4 sm:p-8 flex justify-center bg-[#f0ebe1]/60">
          {/* THE OFFICIAL A4 INVOICE SHEET */}
          <div
            ref={invoiceRef}
            className="printable-invoice-content w-[794px] min-h-[1080px] bg-white p-12 text-[#1a1a1a] shadow-xl border border-[#e8dec8] flex flex-col justify-between box-border font-sans"
            style={{ fontFamily: '"Inter", "Segoe UI", Arial, sans-serif' }}
          >
            <div>
              {/* TOP HEADER ROW: Logo & INVOICE Heading */}
              <div className="flex items-start justify-between border-b-2 border-[#e8dec8] pb-6 mb-6">
                {/* Left: Official MH Quill Logo */}
                <ManuscriptHeavenLogo variant="invoice-header" />

                {/* Right: INVOICE Title & Metadata */}
                <div className="text-right">
                  <h1 className="font-serif text-3xl font-bold tracking-wider text-[#7a5518] leading-none mb-1.5">
                    INVOICE
                  </h1>
                  <span className="inline-block rounded-md bg-[#7a5518] px-3 py-1 font-mono text-xs font-bold text-white tracking-wider shadow-xs">
                    #{invoiceNumber}
                  </span>

                  {/* Sub-row: Dates & Status */}
                  <div className="mt-4 flex items-center justify-end gap-6 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#8b6f38] tracking-wider flex items-center gap-1 justify-end">
                        <Calendar className="h-3 w-3" /> INVOICE DATE
                      </span>
                      <strong className="block text-[#1a1a1a] font-semibold text-xs mt-0.5">
                        {invoiceDate}
                      </strong>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#8b6f38] tracking-wider flex items-center gap-1 justify-end">
                        <Clock className="h-3 w-3" /> DUE DATE
                      </span>
                      <strong className="block text-[#1a1a1a] font-semibold text-xs mt-0.5">
                        {dueDate}
                      </strong>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#8b6f38] tracking-wider block">
                        STATUS
                      </span>
                      <span
                        className={`inline-block mt-0.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase border ${
                          isPaid
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                            : isPartial
                              ? 'bg-blue-50 text-blue-700 border-blue-300'
                              : 'bg-[#faf5eb] text-[#8b6f38] border-[#e2d2b4]'
                        }`}
                      >
                        {statusLabel}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECOND ROW: BILLED TO & PAYMENT OVERVIEW CARDS */}
              <div className="grid grid-cols-12 gap-5 mb-7">
                {/* BILLED TO CARD */}
                <div className="col-span-5 rounded-xl border border-[#e8dec8] bg-[#faf8f5] p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#8b6f38] mb-3">
                    BILLED TO
                  </div>
                  <div className="flex items-center gap-3">
                    <UserAvatar name={clientName} size="lg" showRoleRing={false} />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-base font-bold text-[#1a1a1a] truncate">
                        {clientName}
                      </h3>
                      {clientEmail && (
                        <p className="text-xs text-[#666666] truncate mt-0.5">{clientEmail}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* PAYMENT OVERVIEW CARD */}
                <div className="col-span-7 rounded-xl border border-[#e8dec8] bg-[#faf8f5] p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#8b6f38] mb-2.5">
                    PAYMENT OVERVIEW
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-2">
                      <span className="text-[10px] font-bold uppercase text-[#777777] block">
                        TOTAL AMOUNT
                      </span>
                      <p className="font-display text-lg font-bold text-[#1a1a1a] mt-1">
                        {formatMoney(subtotal)}
                      </p>
                    </div>

                    <div className="p-2 border-l border-[#e8dec8]">
                      <span className="text-[10px] font-bold uppercase text-[#777777] block">
                        PAID AMOUNT
                      </span>
                      <p className="font-display text-lg font-bold text-[#1a1a1a] mt-1">
                        {formatMoney(totalPaid)}
                      </p>
                    </div>

                    <div className="rounded-lg bg-[#faf0dc] border border-[#e0cb9e] p-2 text-center">
                      <span className="text-[10px] font-bold uppercase text-[#7a5518] block">
                        AMOUNT DUE
                      </span>
                      <p className="font-display text-lg font-bold text-[#7a5518] mt-1">
                        {formatMoney(totalDue)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* THIRD SECTION: SERVICES TABLE */}
              <div className="mb-7">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="flex h-5 w-5 items-center justify-center rounded bg-[#7a5518] text-white text-[10px]">
                    <Layers className="h-3 w-3" />
                  </div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]">
                    SERVICES
                  </h4>
                </div>

                <div className="overflow-hidden rounded-xl border border-[#e8dec8]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#7a5518] text-white font-bold text-[11px] tracking-wider uppercase">
                        <th className="py-2.5 px-3 text-center w-10">#</th>
                        <th className="py-2.5 px-4">PROJECT</th>
                        <th className="py-2.5 px-4">SERVICE</th>
                        <th className="py-2.5 px-4 text-right">TOTAL</th>
                        <th className="py-2.5 px-4 text-right">PAID</th>
                        <th className="py-2.5 px-4 text-right text-[#ffe8b8]">BALANCE DUE</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e8dec8] bg-white">
                      {items.map((item, idx) => (
                        <tr key={item.project_id || idx} className="hover:bg-[#faf8f5]">
                          <td className="py-3 px-3 text-center font-medium text-[#777777]">
                            {idx + 1}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-[#1a1a1a] block text-xs">
                              {item.project_title}
                            </span>
                            <span className="font-mono text-[10px] text-[#777777]">
                              Project ID: {item.project_number}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[#444444] text-[11px]">
                            {item.service_type || 'Publishing & Formatting'}
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-[#1a1a1a]">
                            {formatMoney(item.total_price)}
                          </td>
                          <td className="py-3 px-4 text-right text-emerald-700 font-medium">
                            {formatMoney(item.advance_paid)}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-[#7a5518]">
                            {formatMoney(item.due_amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* FOURTH SECTION: PAYMENT INSTRUCTIONS & TOTALS BOX */}
              <div className="grid grid-cols-12 gap-5 mb-8">
                {/* Left: Payment Instructions */}
                <div className="col-span-6 space-y-3 text-xs">
                  <div className="flex items-start gap-2.5 rounded-lg border border-[#e8dec8] bg-[#faf8f5] p-3">
                    <CreditCard className="h-4 w-4 text-[#7a5518] flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-[11px] font-bold uppercase tracking-wider text-[#7a5518] block">
                        PAYMENT INSTRUCTIONS
                      </strong>
                      <p className="text-[#555555] text-[11px] mt-0.5">
                        Please issue payment on or before the due date. Thank you for choosing
                        Manuscript Heaven.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 rounded-lg border border-[#e8dec8] bg-[#faf8f5] p-3">
                    <Building2 className="h-4 w-4 text-[#7a5518] flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[#555555] text-[11px]">
                        We accept bank transfer, PayPal, Wise, and major credit cards. Payment
                        details will be shared upon request.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right: Totals Box */}
                <div className="col-span-6 rounded-xl border border-[#e8dec8] bg-[#faf8f5] p-4">
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-[#555555]">
                      <span>Subtotal</span>
                      <strong className="text-[#1a1a1a]">{formatMoney(subtotal)}</strong>
                    </div>

                    <div className="flex justify-between text-[#555555]">
                      <span>Total Paid</span>
                      <strong className="text-[#1a1a1a]">{formatMoney(totalPaid)}</strong>
                    </div>

                    <div className="border-t border-dashed border-[#d8ccb8] pt-2" />

                    <div className="rounded-lg bg-[#faf0dc] border border-[#e0cb9e] p-3 flex items-center justify-between">
                      <span className="font-display font-bold text-sm uppercase tracking-wider text-[#7a5518]">
                        TOTAL DUE
                      </span>
                      <span className="font-display text-2xl font-extrabold text-[#7a5518]">
                        {formatMoney(totalDue)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* FIFTH SECTION: FOOTER WITH EMBLEM & CONTACT INFO */}
            <div className="border-t-2 border-[#e8dec8] pt-5">
              <div className="grid grid-cols-12 items-center gap-4 text-xs">
                {/* Left: Emblem */}
                <div className="col-span-2 flex items-center justify-center">
                  <ManuscriptHeavenLogo variant="emblem" size="md" />
                </div>

                {/* Middle: Company Details */}
                <div className="col-span-5 border-l border-[#e8dec8] pl-4 space-y-1 text-[11px] text-[#555555]">
                  <strong className="font-serif text-xs font-bold text-[#7a5518] uppercase block tracking-wider">
                    MANUSCRIPT HEAVEN
                  </strong>
                  <p className="flex items-center gap-1.5">
                    <Mail className="h-3 w-3 text-[#7a5518]" /> hello@manuscriptheaven.com
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Globe className="h-3 w-3 text-[#7a5518]" /> www.manuscriptheaven.com
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Phone className="h-3 w-3 text-[#7a5518]" /> +1 (844) 687-0111
                  </p>
                  <p className="flex items-center gap-1.5">
                    <MapPin className="h-3 w-3 text-[#7a5518] flex-shrink-0" /> 3031 Tisch Way,
                    Suite 110, San Jose, CA 95128
                  </p>
                </div>

                {/* Right: Thank you note */}
                <div className="col-span-5 border-l border-[#e8dec8] pl-4">
                  <div className="flex items-center gap-1.5 text-[#7a5518] font-bold text-xs uppercase tracking-wider mb-1">
                    <HeartHandshake className="h-4 w-4" />
                    THANK YOU!
                  </div>
                  <p className="text-[11px] text-[#555555] leading-relaxed">
                    We appreciate your business and look forward to helping you publish more
                    incredible books.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
