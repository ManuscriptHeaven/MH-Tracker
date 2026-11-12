import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CreditCard,
  FilePenLine,
  ImageDown,
  Layers,
  Printer,
  X,
} from 'lucide-react';
import { Button, IconButton } from './ui';
import { formatDate } from '../lib/date';
import type { Invoice, InvoiceItem, Project } from '../lib/types';
import { useCurrency } from '../lib/currency';
import { calculateDueAmount, chunkInvoiceItems } from '../lib/invoiceUtils';
import { invoiceConfig } from '../lib/invoiceConfig';
import { ManuscriptHeavenLogo } from './ManuscriptHeavenLogo';

// Twelve compact rows fit on the first US Letter page while keeping room for
// the billing panel, final totals and footer on invoices with up to 12 items.
const ITEMS_PER_PAGE = 12;
const EXPORT_SCALE_300_DPI = 3.125;

function reviewFlags(item: InvoiceItem, allItems: InvoiceItem[], projectHistory: Project[]) {
  const flags: string[] = [];
  const redundant = /^(reformatting|formatting|typesetting)\b/i.exec(item.project_title || '');
  if (redundant && item.service_type.toLowerCase().includes(redundant[1].toLowerCase())) {
    flags.push('Review title: service wording is repeated');
  }
  const invoicedProjectIds = new Set(allItems.map((peer) => peer.project_id));
  const history = projectHistory.filter((project) => project.service_type === item.service_type && !invoicedProjectIds.has(project.id)).map((project) => Number(project.total_price || 0)).filter((price) => price > 0);
  const peers = (history.length >= 3 ? history : allItems.filter((peer) => peer.service_type === item.service_type && peer.project_id !== item.project_id).map((peer) => peer.total_price)).sort((a, b) => a - b);
  if (peers.length >= 2) {
    const median = peers[Math.floor(peers.length / 2)];
    if (median > 0 && (item.total_price < median * 0.5 || item.total_price > median * 2)) flags.push('Review price against this service rate');
  }
  return flags;
}

export function InvoiceModal({
  project,
  invoice,
  projects = [],
  onClose,
  onRevise,
}: {
  project?: Project | null;
  invoice?: Invoice | null;
  projects?: Project[];
  onClose: () => void;
  onRevise?: (invoice: Invoice) => void;
}) {
  const { formatMoney } = useCurrency();
  const formatInvoiceMoney = (amount: number, showCode = false) => formatMoney(amount, 'USD', { showCode });
  const invoiceRef = useRef<HTMLDivElement>(null);
  const [savingImage, setSavingImage] = useState(false);

  if (!project && !invoice) {
    return null;
  }

  const invoiceNumber = invoice
    ? invoice.invoice_number || 'INV-000'
    : `INV-${project?.project_number || '001'}`;

  const invoiceDate = invoice
    ? formatDate(invoice.created_at)
    : formatDate(new Date().toISOString());

  const dueDate = invoice ? formatDate(invoice.due_date) : formatDate(project?.due_date);
  const clientName = invoice ? invoice.client_name : project?.client_name || 'Valued Client';
  const clientEmail = invoice ? invoice.client_email : project?.client_email || '';
  const billedCompany = invoice?.company_name || invoice?.items?.[0]?.company_name || project?.company_name || '';
  const billedContact = invoice?.contact_name || invoice?.items?.[0]?.contact_name || project?.contact_name || clientName;
  const billingAddress = invoice?.billing_address || invoice?.items?.[0]?.billing_address || project?.billing_address || '';

  const rawStatus = invoice
    ? invoice.status === 'Paid'
      ? 'PAID'
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

  const itemPages = chunkInvoiceItems(items);
  const totalPages = itemPages.length;
  const versionSuffix = invoice?.version_number ? `-v${invoice.version_number}` : '';

  function handlePrint() {
    const previousTitle = document.title;
    document.title = `Invoice-${invoiceNumber}`;
    try {
      window.print();
    } finally {
      document.title = previousTitle;
    }
  }

  async function waitForInvoiceAssets() {
    try {
      const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (fontSet) await fontSet.ready;
    } catch {
      // Browser may not expose document.fonts.
    }

    if (!invoiceRef.current) return;
    const images = Array.from(invoiceRef.current.querySelectorAll('img'));
    await Promise.all(
      images.map(async (image) => {
        if (image.complete) {
          try {
            await image.decode();
          } catch {
            // Already-loaded images can reject decode in some browsers.
          }
          return;
        }
        await new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        });
      }),
    );
  }

  async function loadHtml2Canvas() {
    if (!(window as unknown as Record<string, unknown>)['html2canvas']) {
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>('script[data-mh-html2canvas="true"]');
        if (existing) {
          existing.addEventListener('load', () => resolve(), { once: true });
          existing.addEventListener('error', () => reject(new Error('Failed to load html2canvas')), {
            once: true,
          });
          return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.dataset.mhHtml2canvas = 'true';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load html2canvas'));
        document.head.appendChild(script);
      });
    }

    return (window as unknown as Record<string, unknown>)['html2canvas'] as (
      el: HTMLElement,
      opts?: object,
    ) => Promise<HTMLCanvasElement>;
  }

  async function waitForExportLayout() {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  }

  async function handleSaveImage() {
    if (!invoiceRef.current) return;
    setSavingImage(true);

    try {
      await waitForInvoiceAssets();
      const html2canvas = await loadHtml2Canvas();
      const pages = Array.from(invoiceRef.current.querySelectorAll<HTMLElement>('.invoice-page'));

      if (pages.length === 0) {
        throw new Error('No invoice pages were found for export.');
      }

      pages.forEach((page) => page.classList.add('invoice-png-export'));
      await waitForExportLayout();

      try {
        for (let index = 0; index < pages.length; index += 1) {
          const page = pages[index];
          const canvas = await html2canvas(page, {
          scale: EXPORT_SCALE_300_DPI,
          useCORS: true,
          allowTaint: false,
          backgroundColor: '#ffffff',
          logging: false,
          width: 794,
          height: 1123,
          windowWidth: 794,
          windowHeight: 1123,
          scrollX: 0,
          scrollY: 0,
        });

        const link = document.createElement('a');
        const pageSuffix = pages.length > 1 ? `-page-${String(index + 1).padStart(2, '0')}-of-${String(pages.length).padStart(2, '0')}` : '';
        link.download = `Invoice-${invoiceNumber}${versionSuffix}${pageSuffix}.png`;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        link.remove();

          if (pages.length > 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 120));
          }
        }
      } finally {
        pages.forEach((page) => page.classList.remove('invoice-png-export'));
      }
    } catch (err) {
      console.error('Invoice image export failed:', err);
      alert('PNG export failed. Print / Save PDF remains the highest-quality export option.');
    } finally {
      setSavingImage(false);
    }
  }

  function renderInvoiceIdentity(compact = false) {
    return (
      <div className={compact ? 'flex items-start justify-between border-b-2 border-[#e8dec8] pb-2 mb-3' : 'flex items-start justify-between border-b-2 border-[#e8dec8] pb-3 mb-3'}>
        <ManuscriptHeavenLogo variant="invoice-header" className={compact ? 'scale-90 origin-left' : ''} />

        <div className="invoice-export-header-right text-right">
          <h1 className={compact ? 'invoice-export-title font-serif text-2xl font-bold tracking-wider text-[#7a5518] leading-none mb-1.5' : 'invoice-export-title font-serif text-3xl font-bold tracking-wider text-[#7a5518] leading-none mb-1.5'}>
            INVOICE
          </h1>
          <div className="invoice-export-badges flex items-center justify-end gap-2">
            <span className="inline-block rounded-md bg-[#7a5518] px-3 py-1 font-mono text-xs font-bold text-white tracking-wider shadow-xs">
              #{invoiceNumber}
            </span>
          </div>

          {compact && (
            <div className="mt-2 flex items-center justify-end gap-4 text-[10px] text-[#555555]">
              <span>{clientName}</span>
              <span>Due {dueDate}</span>
              <span className="font-bold text-[#7a5518]">{formatInvoiceMoney(totalDue)} due</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderClientAndSummary() {
    return (
      <div className="grid grid-cols-12 gap-3 mb-3 invoice-keep-together">
        <div className="col-span-5 rounded-xl border border-[#e8dec8] bg-[#faf8f5] p-3 min-h-[80px]">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#704b12] mb-2">BILLED TO</div>
          <div className="min-w-0">
              {billedCompany ? <p className="font-display text-base font-bold text-[#1a1a1a] break-words">{billedCompany}</p> : null}
              <h3 className="font-display text-base font-bold text-[#1a1a1a] break-words">{billedContact}</h3>
              {clientEmail ? (
                <p className="text-[11px] leading-snug text-[#666666] break-all mt-1">{clientEmail}</p>
              ) : null}
              {billingAddress ? <p className="text-[10px] leading-snug text-[#555555] whitespace-pre-line mt-1">{billingAddress}</p> : null}
          </div>
        </div>

        <div className="col-span-7 rounded-xl border border-[#e8dec8] bg-[#faf8f5] p-3 min-h-[80px]">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#704b12] mb-1.5">INVOICE DETAILS</div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-1">
            <div><span className="text-[9px] font-bold uppercase text-[#555555] block">Invoice Date</span><p className="text-xs font-semibold text-[#1a1a1a]">{invoiceDate}</p></div>
            <div><span className="text-[9px] font-bold uppercase text-[#555555] block">Due Date</span><p className="text-xs font-semibold text-[#1a1a1a]">{dueDate}</p></div>
            <div><span className="text-[9px] font-bold uppercase text-[#555555] block">Payment Terms</span><p className="text-xs font-semibold text-[#1a1a1a]">{invoice?.payment_terms || invoiceConfig.defaultPaymentTerms}</p></div>
            <div><span className="text-[9px] font-bold uppercase text-[#555555] block">Services Delivered</span><p className="text-xs font-semibold text-[#1a1a1a]">{invoice?.services_delivered || invoice?.items?.[0]?.invoice_services_delivered || invoice?.month_label || '—'}</p></div>
            <div><span className="text-[9px] font-bold uppercase text-[#555555] block">Currency</span><p className="text-xs font-semibold text-[#1a1a1a]">USD</p></div>
            <div><span className="text-[9px] font-bold uppercase text-[#555555] block">Status</span><p className="text-xs font-semibold text-[#1a1a1a]">{statusLabel}</p></div>
          </div>
        </div>
      </div>
    );
  }

  function renderServices(pageItems: InvoiceItem[], pageIndex: number) {
    return (
      <div className="mb-3">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-[#7a5518] text-white text-[10px]">
              <Layers className="h-3 w-3" />
            </div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]">
              SERVICES
            </h4>
          </div>
          {totalPages > 1 ? (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#704b12]">
              Projects {pageIndex * ITEMS_PER_PAGE + 1}–{pageIndex * ITEMS_PER_PAGE + pageItems.length} of {items.length}
            </span>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-xl border border-[#e8dec8]">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#7a5518] text-white font-bold text-[11px] tracking-wider uppercase">
                <th className="py-1.5 px-2 text-center w-8">#</th>
                <th className="py-1.5 px-3">PROJECT</th>
                <th className="py-1.5 px-3">SERVICE</th>
                <th className="py-1.5 px-2 text-right">TOTAL</th>
                <th className="py-1.5 px-2 text-right">PAID</th>
                <th className="py-1.5 px-2 text-right text-white">BALANCE DUE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8dec8]">
              {pageItems.map((item, idx) => (
                <tr key={item.project_id || `${pageIndex}-${idx}`} className={`invoice-keep-together ${idx % 2 === 1 ? 'bg-[#faf8f5]' : 'bg-white'}`}>
                  <td className="py-1 px-2 text-center font-medium text-[#555555]">
                    {pageIndex * ITEMS_PER_PAGE + idx + 1}
                  </td>
                  <td className="py-1 px-3 max-w-[220px]">
                    <span className="invoice-export-project-title font-bold text-[#1a1a1a] block text-[11px] leading-tight line-clamp-2">
                      {item.project_title}
                    </span>
                    {item.author || item.description ? <span className="block text-[9px] leading-tight text-[#555555] line-clamp-1">{item.author ? `by ${item.author}` : ''}{item.author && item.description ? ' · ' : ''}{item.description || ''}</span> : null}
                    <span className="invoice-export-project-id font-mono text-[9px] leading-tight text-[#555555]">ID: {item.project_number}{item.delivered_on ? ` · Delivered ${formatDate(item.delivered_on)}` : ''}</span>
                    {reviewFlags(item, items, projects).map((flag) => <span key={flag} className="block text-[9px] font-semibold text-[#704b12]">{flag}</span>)}
                  </td>
                  <td className="py-1 px-3 text-[#444444] text-[10px] max-w-[150px]">
                    <span className="invoice-export-service line-clamp-2">{item.service_type || 'Publishing & Formatting'}</span>
                  </td>
                  <td className="py-1 px-2 text-right font-medium text-[#1a1a1a] whitespace-nowrap">
                    {formatInvoiceMoney(item.total_price)}
                  </td>
                  <td className={`py-1 px-2 text-right font-medium whitespace-nowrap ${item.due_amount <= 0 ? 'text-emerald-700' : 'text-[#444444]'}`}>
                    {formatInvoiceMoney(item.advance_paid)}
                  </td>
                  <td className="py-1 px-2 text-right font-bold text-[#7a5518] whitespace-nowrap">
                    {formatInvoiceMoney(item.due_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderTotals() {
    return (
      <div className="grid grid-cols-12 gap-3 mb-3 invoice-keep-together">
        <div className="col-span-6 space-y-2 text-xs">
          <div className="flex items-start gap-2 rounded-lg border border-[#e8dec8] bg-[#faf8f5] p-2.5">
            <CreditCard className="h-4 w-4 text-[#7a5518] flex-shrink-0 mt-0.5" />
            <div>
              <strong className="text-[11px] font-bold uppercase tracking-wider text-[#7a5518] block">
                PAYMENT INSTRUCTIONS
              </strong>
              <p className="text-[#555555] text-[11px] mt-0.5">
                Please pay by {dueDate} ({invoice?.payment_terms || invoiceConfig.defaultPaymentTerms}). Use invoice number {invoiceNumber} as your payment reference.
              </p>
              <p className="mt-1 text-[10px] font-semibold text-[#444444]">{invoiceConfig.paymentDetailsPlaceholder}</p>
              {invoice?.notes ? <p className="mt-1 border-t border-[#e8dec8] pt-1 text-[10px] text-[#555555]"><strong className="text-[#7a5518]">Note:</strong> {invoice.notes}</p> : null}
              {invoiceConfig.latePaymentNoteEnabled ? <p className="mt-1 text-[10px] text-[#444444]">{invoiceConfig.latePaymentNote}</p> : null}
            </div>
          </div>
        </div>

        <div className="col-span-6 rounded-xl border border-[#e8dec8] bg-[#faf8f5] p-3">
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between text-[#555555]">
              <span>Subtotal</span>
              <strong className="text-[#1a1a1a]">{formatInvoiceMoney(subtotal, true)}</strong>
            </div>
            <div className="flex justify-between text-[#555555]">
              <span>Total Paid</span>
              <strong className="text-[#1a1a1a]">{formatInvoiceMoney(totalPaid, true)}</strong>
            </div>
            <div className="border-t border-dashed border-[#d8ccb8] pt-1" />
            <div className="rounded-lg bg-[#faf0dc] border border-[#e0cb9e] p-2 flex items-center justify-between">
              <span className="font-display font-bold text-sm uppercase tracking-wider text-[#7a5518]">TOTAL DUE</span>
              <span className="font-display text-xl font-extrabold text-[#7a5518]">{formatInvoiceMoney(totalDue, true)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderFullFooter(pageNumber: number) {
    return (
      <div className="mt-auto border-t border-[#d8ccb8] pt-3 invoice-keep-together text-[9px] leading-snug text-[#444444]">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <strong className="block font-serif text-[10px] text-[#7a5518] uppercase tracking-wider">{invoiceConfig.businessName}</strong>
            <p>{invoiceConfig.email} <span className="mx-1">|</span> {invoiceConfig.website} <span className="mx-1">|</span> {invoiceConfig.phone}</p>
            <p>{invoiceConfig.address}</p>
          </div>
          <div className="min-w-[130px] text-right">
            <strong className="block text-[10px] text-[#1a1a1a]">{invoiceConfig.footerThankYou}</strong>
            <span className="mt-1 block font-semibold text-[#704b12]">Page {pageNumber} of {totalPages}</span>
          </div>
        </div>
      </div>
    );
  }

  function renderContinuationFooter(pageNumber: number) {
    return (
      <div className="mt-auto flex items-center justify-between border-t border-[#e8dec8] pt-3 text-[9px] uppercase tracking-wider text-[#704b12]">
        <span>Manuscript Heaven · {invoiceNumber}</span>
        <span>Page {pageNumber} of {totalPages}</span>
      </div>
    );
  }

  return createPortal(
    <div className="printable-invoice-modal fixed inset-0 z-50 flex items-center justify-center bg-ink/50 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="printable-invoice-wrapper flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-border">
        <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-border bg-[#faf7f2] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold/20 text-ink border border-gold/40 font-bold">
              🧾
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-ink">Official Invoice Preview</h2>
              <p className="text-xs text-muted-foreground">
                {items.length} project{items.length === 1 ? '' : 's'} · {totalPages} page{totalPages === 1 ? '' : 's'} · max {ITEMS_PER_PAGE} projects/page
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {invoice && onRevise ? (
              <Button
                variant="secondary"
                onClick={() => onRevise(invoice)}
                className="border-border text-ink hover:bg-gold/10 text-xs py-1.5 px-3"
              >
                <FilePenLine className="mr-1.5 h-4 w-4 text-gold" />
                Revise Invoice
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={handleSaveImage}
              disabled={savingImage}
              className="border-border text-ink hover:bg-gold/10 text-xs py-1.5 px-3"
            >
              <ImageDown className="mr-1.5 h-4 w-4 text-gold" />
              {savingImage ? 'Saving...' : totalPages > 1 ? `Save ${totalPages} PNGs` : 'Save PNG'}
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

        <div className="overflow-y-auto bg-[#f0ebe1]/60 p-4 sm:p-8">
          <div ref={invoiceRef} className="invoice-pages mx-auto flex w-[794px] flex-col gap-6">
            {itemPages.map((pageItems, pageIndex) => {
              const pageNumber = pageIndex + 1;
              const isFirstPage = pageIndex === 0;
              const isLastPage = pageIndex === totalPages - 1;

              return (
                <section
                  key={pageNumber}
                  data-invoice-page={pageNumber}
                  className="invoice-page printable-invoice-content h-[1123px] w-[794px] overflow-hidden bg-white p-12 text-[#1a1a1a] shadow-xl border border-[#e8dec8] flex flex-col box-border font-sans"
                  style={{ fontFamily: '"Inter", "Segoe UI", Arial, sans-serif' }}
                >
                  <div>
                    {renderInvoiceIdentity(!isFirstPage)}
                    {isFirstPage ? renderClientAndSummary() : null}
                    {renderServices(pageItems, pageIndex)}
                    {isLastPage ? renderTotals() : null}
                  </div>

                  {renderFullFooter(pageNumber)}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
