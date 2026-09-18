import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ FAIL: ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ PASS: ${message}`);
}

const migration = read('supabase/phase6/migrations/00660_invoice_version_history.sql');
const tracker = read('src/lib/useTracker.ts');
const payments = read('src/pages/PaymentsPage.tsx');
const invoiceModal = read('src/components/InvoiceModal.tsx');
const revisionModal = read('src/components/InvoiceRevisionModal.tsx');
const printCss = read('src/styles/index.css');
const aiTools = read('src/lib/ai/safeActionTools.ts');

console.log('--- Invoice Versioning / Export Static Tests ---');

assert(
  migration.includes('create table if not exists public.invoices') &&
    migration.includes('create table if not exists public.invoice_versions') &&
    migration.includes('create table if not exists public.invoice_project_links'),
  'invoice history schema contains logical invoices, immutable versions, and project links',
);

assert(
  migration.includes('unique (invoice_id, version_number)') &&
    migration.includes('for update') &&
    migration.includes('current_version = v_version'),
  'invoice revisions use ordered version numbers under row locking',
);

assert(
  migration.includes('invoiced = true') &&
    migration.includes('invoice_id = v_invoice_id::text') &&
    migration.includes('invoiced_at = coalesce(invoiced_at, now())'),
  'saving an invoice marks linked projects as invoiced',
);

assert(
  migration.includes("phase6_app_actor_class() not in ('admin','project_manager')") &&
    migration.includes('security definer') &&
    migration.includes('set search_path = public, pg_temp'),
  'invoice write RPC is role-gated and uses a fixed search_path',
);

assert(
  tracker.includes("supabase.from('invoice_versions').select('*')") &&
    tracker.includes("supabase.rpc('invoice_save_version'") &&
    tracker.includes('saveInvoiceVersion,'),
  'tracker loads invoice history and exposes the canonical save mutation',
);

assert(
  payments.includes('Invoice History') &&
    payments.includes('Older versions are never overwritten') &&
    payments.includes('latestInvoiceForProject'),
  'payments UI exposes persistent history and project invoice state',
);

assert(
  payments.includes('<InvoiceRevisionModal') &&
    revisionModal.includes('A new immutable invoice version will be created') &&
    revisionModal.includes('Revision Reason *'),
  'invoice revisions require an auditable reason and preserve prior versions',
);

assert(
  invoiceModal.includes('const ITEMS_PER_PAGE = 5') &&
    invoiceModal.includes('chunkInvoiceItems') &&
    invoiceModal.includes('Projects {pageIndex * ITEMS_PER_PAGE + 1}') &&
    invoiceModal.includes('Page {pageNumber} of {totalPages}'),
  'invoice preview enforces a maximum of five projects per numbered page',
);

assert(
  invoiceModal.includes('const EXPORT_SCALE_300_DPI = 3.125') &&
    invoiceModal.includes("canvas.toDataURL('image/png')") &&
    invoiceModal.includes('Save ${totalPages} PNGs') &&
    !invoiceModal.includes('Save JPG'),
  'lossy JPG export is replaced by approximately 300-DPI PNG export per page',
);

assert(
  invoiceModal.includes("page.classList.add('invoice-png-export')") &&
    invoiceModal.includes("page.classList.remove('invoice-png-export')") &&
    invoiceModal.includes('waitForExportLayout') &&
    invoiceModal.includes('invoice-export-project-title') &&
    invoiceModal.includes('invoice-export-service') &&
    printCss.includes('.invoice-page.invoice-png-export .invoice-export-title') &&
    printCss.includes('.invoice-page.invoice-png-export .invoice-export-status') &&
    printCss.includes('-webkit-line-clamp: unset !important') &&
    printCss.includes('vertical-align: middle !important'),
  'PNG export uses a temporary capture-only layout that prevents header collisions and clipped service-row text',
);

assert(
  printCss.includes('.invoice-page:last-child') &&
    printCss.includes('height: 297mm !important') &&
    printCss.includes('page-break-after: always !important') &&
    printCss.includes('table-header-group') &&
    printCss.includes('break-inside: avoid !important'),
  'invoice print CSS enforces exact A4 multi-page boundaries without splitting rows',
);

assert(
  aiTools.includes('trackerMutations?.saveInvoiceVersion') &&
    aiTools.includes('await ctx.trackerMutations.saveInvoiceVersion(invoiceDraft)'),
  'AI-generated invoices use the same persistent invoice history',
);

if (process.exitCode) {
  console.error('Invoice versioning regression checks failed.');
} else {
  console.log('ALL INVOICE VERSIONING CHECKS PASSED.');
}
