import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock,
  Download,
  Edit,
  Eye,
  FilePenLine,
  FileText,
  History,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { PaymentBadge, StatusBadge } from '../components/Badges';
import { InvoiceModal } from '../components/InvoiceModal';
import { InvoiceRevisionModal } from '../components/InvoiceRevisionModal';
import { Button, Card, EmptyState, Field, IconButton, SelectField } from '../components/ui';
import { paymentStatuses, statusOptions } from '../lib/constants';
import { daysUntil, formatDate, todayInput } from '../lib/date';
import { calculateDueAmount, createBulkInvoice, getEligibleProjectsForClient, isProjectArchived } from '../lib/invoiceUtils';
import { downloadTextFile, errorMessage } from '../lib/utils';
import { useCurrency } from '../lib/currency';
import type { Invoice, PaymentStatus, Profile, Project, ProjectStatus } from '../lib/types';

type PaymentFilter = 'all' | 'paid' | 'partial' | 'unpaid' | 'overdue' | 'due_soon';
type InvoiceTab = 'open' | 'paid' | 'all';
type InvoicePayState = 'Paid' | 'Partial' | 'Unpaid';

function InvoiceStatusPill({ state }: { state: InvoicePayState }) {
  const styles: Record<InvoicePayState, string> = {
    Paid: 'bg-emerald-50 text-success border-emerald-100',
    Partial: 'bg-amber-50 text-amber-700 border-amber-100',
    Unpaid: 'bg-red-50 text-danger border-red-100',
  };
  const labels: Record<InvoicePayState, string> = { Paid: 'Paid', Partial: 'Partially paid', Unpaid: 'Unpaid' };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${styles[state]}`}>
      {labels[state]}
    </span>
  );
}

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function dueAmount(project: Project) {
  return Math.max(Number(project.total_price || 0) - Number(project.advance_paid || 0), 0);
}

function paymentState(project: Project) {
  const due = dueAmount(project);
  const paid = Number(project.advance_paid || 0);
  const total = Number(project.total_price || 0);
  const days = daysUntil(project.due_date);

  if (total > 0 && paid >= total) {
    return 'Paid';
  }

  if (due > 0 && days < 0) {
    return 'Overdue';
  }

  if (due > 0 && days >= 0 && days <= 7) {
    return 'Due Soon';
  }

  if (paid > 0 && paid < total) {
    return 'Partial';
  }

  return 'Unpaid';
}

function monthValue(project: Project) {
  return project.due_date ? Number(project.due_date.slice(5, 7)) : 0;
}

function yearValue(project: Project) {
  return project.due_date ? Number(project.due_date.slice(0, 4)) : 0;
}

function monthLabel(project: Project) {
  const month = monthValue(project);
  const year = yearValue(project);
  return month && year ? `${monthNames[month - 1]} ${year}` : 'Not set';
}

function csvEscape(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function paymentCsv(projects: Project[]) {
  const headers = [
    'Client Name',
    'Project Title',
    'Total Amount',
    'Paid Amount',
    'Due Amount',
    'Payment Status',
    'Due Date',
    'Payment Date',
    'Notes',
  ];

  const rows = projects.map((project) => [
    project.client_name,
    project.project_title,
    project.total_price,
    project.advance_paid,
    dueAmount(project),
    paymentState(project),
    project.due_date,
    project.payment_date || '',
    project.payment_notes || '',
  ]);

  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

function amountSummary(projects: Project[]) {
  return projects.reduce(
    (summary, project) => {
      const total = Number(project.total_price || 0);
      const paid = Number(project.advance_paid || 0);
      const due = dueAmount(project);

      summary.total += total;
      summary.paid += paid;
      summary.due += due;

      if (due > 0 && daysUntil(project.due_date) < 0) {
        summary.overdue += due;
      }

      return summary;
    },
    { total: 0, paid: 0, due: 0, overdue: 0 },
  );
}

function groupDueBy(projects: Project[], keyFor: (project: Project) => string) {
  const groups = new Map<string, { label: string; count: number; due: number; paid: number; total: number }>();

  projects.forEach((project) => {
    const label = keyFor(project);
    const current = groups.get(label) || { label, count: 0, due: 0, paid: 0, total: 0 };
    current.count += 1;
    current.due += dueAmount(project);
    current.paid += Number(project.advance_paid || 0);
    current.total += Number(project.total_price || 0);
    groups.set(label, current);
  });

  return [...groups.values()].sort((a, b) => b.due - a.due);
}

function MiniReport({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; count: number; due: number; paid: number; total: number }>;
}) {
  const { formatMoney } = useCurrency();
  return (
    <Card>
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.length ? (
          rows.slice(0, 6).map((row) => (
            <div key={row.label} className="grid gap-2 rounded-md border border-border bg-ivory p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">{row.label}</p>
                <p className="text-muted">{row.count} project{row.count === 1 ? '' : 's'}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-muted">
                <span>Total {formatMoney(row.total, 'USD')}</span>
                <span>Paid {formatMoney(row.paid, 'USD')}</span>
                <span className="font-semibold text-warning">Due {formatMoney(row.due, 'USD')}</span>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted">No report data.</p>
        )}
      </div>
    </Card>
  );
}

export function PaymentsPage({
  projects,
  currentProfile,
  isLoading,
  error,
  onSelectProject,
  onEditProject,
  onUpdateProject,
  onDeletePayment,
  invoices = [],
  onSaveInvoiceVersion,
}: {
  projects: Project[];
  currentProfile: Profile;
  isLoading: boolean;
  error: string | null;
  onSelectProject: (project: Project) => void;
  onEditProject: (project: Project) => void;
  onUpdateProject: (projectId: string, updates: Partial<Project>) => Promise<unknown>;
  onDeletePayment: (projectId: string) => Promise<void>;
  invoices?: Invoice[];
  onSaveInvoiceVersion: (
    draft: Invoice,
    existingInvoiceId?: string | null,
    changeNote?: string,
  ) => Promise<Invoice>;
}) {
  const { formatMoney } = useCurrency();
  const [clientFilter, setClientFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<PaymentStatus | 'all'>('all');
  const [projectStatusFilter, setProjectStatusFilter] = useState<ProjectStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Bulk Monthly Invoice State
  const [bulkClient, setBulkClient] = useState('all');
  const [bulkMonth, setBulkMonth] = useState<number | 'all'>('all');
  const [bulkYear, setBulkYear] = useState<number | 'all'>('all');
  const [servicesDeliveredOverride, setServicesDeliveredOverride] = useState('');
  const [bulkPaymentStatus, setBulkPaymentStatus] = useState<string>('all');
  const [includeInvoiced, setIncludeInvoiced] = useState<boolean>(false);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [selectedBulkInvoice, setSelectedBulkInvoice] = useState<Invoice | null>(null);
  const [revisingInvoice, setRevisingInvoice] = useState<Invoice | null>(null);

  // Invoices panel state
  const [invoiceTab, setInvoiceTab] = useState<InvoiceTab>('open');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showReports, setShowReports] = useState(false);

  const clients = useMemo(() => [...new Set(projects.map((project) => project.client_name).filter(Boolean))].sort(), [
    projects,
  ]);
  const years = useMemo(
    () => [...new Set(projects.map(yearValue).filter(Boolean))].sort((a, b) => b - a),
    [projects],
  );

  const invoiceHistory = useMemo(
    () => [...invoices].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [invoices],
  );

  const latestInvoices = useMemo(() => {
    const latest = new Map<string, Invoice>();
    invoiceHistory.forEach((invoice) => {
      const key = invoice.logical_invoice_id || invoice.invoice_number;
      const current = latest.get(key);
      if (!current || Number(invoice.version_number || 1) > Number(current.version_number || 1)) {
        latest.set(key, invoice);
      }
    });
    return Array.from(latest.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [invoiceHistory]);

  function latestInvoiceForProject(projectId: string) {
    return latestInvoices.find((invoice) =>
      invoice.items.some((item) => item.project_id === projectId),
    ) || null;
  }

  const eligibleProjectsForBulk = useMemo(() => {
    if (bulkClient === 'all') {
      return [];
    }
    return getEligibleProjectsForClient(projects, bulkClient, bulkMonth, bulkYear, bulkPaymentStatus, includeInvoiced);
  }, [projects, bulkClient, bulkMonth, bulkYear, bulkPaymentStatus, includeInvoiced]);

  async function handleGenerateBulkInvoice() {
    if (!bulkClient || bulkClient === 'all' || eligibleProjectsForBulk.length === 0) {
      return;
    }

    setIsGeneratingInvoice(true);
    setActionError(null);

    try {
      const clientEmail = eligibleProjectsForBulk[0]?.client_email || '';
      const newInvoice = createBulkInvoice(
        bulkClient,
        clientEmail,
        eligibleProjectsForBulk,
        bulkMonth,
        bulkYear,
        servicesDeliveredOverride,
      );
      const savedInvoice = await onSaveInvoiceVersion(newInvoice);
      setSelectedBulkInvoice(savedInvoice);
    } catch (err) {
      setActionError(errorMessage(err, 'Failed to generate invoice.'));
    } finally {
      setIsGeneratingInvoice(false);
    }
  }

  async function handleProjectInvoice(project: Project) {
    const existing = latestInvoiceForProject(project.id);
    if (existing) {
      setSelectedBulkInvoice(existing);
      return;
    }
    if (isProjectArchived(project)) {
      setActionError('Archived projects cannot be added to new invoices. Existing invoice history is still available.');
      return;
    }

    setBusyProjectId(project.id);
    setActionError(null);
    try {
      const month = monthValue(project) || new Date().getMonth() + 1;
      const year = yearValue(project) || new Date().getFullYear();
      const draft = createBulkInvoice(
        project.client_name,
        project.client_email || '',
        [project],
        month,
        year,
      );
      const savedInvoice = await onSaveInvoiceVersion(draft);
      setSelectedBulkInvoice(savedInvoice);
    } catch (err) {
      setActionError(errorMessage(err, 'Failed to generate project invoice.'));
    } finally {
      setBusyProjectId(null);
    }
  }

  const filteredProjects = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return projects.filter((project) => {
      const due = dueAmount(project);
      const paid = Number(project.advance_paid || 0);
      const total = Number(project.total_price || 0);
      const days = daysUntil(project.due_date);
      const matchesClient = clientFilter === 'all' || project.client_name === clientFilter;
      const matchesMonth = monthFilter === 'all' || monthValue(project) === Number(monthFilter);
      const matchesYear = yearFilter === 'all' || yearValue(project) === Number(yearFilter);
      const matchesPaymentStatus =
        paymentStatusFilter === 'all' || project.payment_status === paymentStatusFilter;
      const matchesProjectStatus = projectStatusFilter === 'all' || project.status === projectStatusFilter;
      const matchesSearch =
        !normalizedSearch ||
        project.client_name.toLowerCase().includes(normalizedSearch) ||
        project.project_title.toLowerCase().includes(normalizedSearch) ||
        project.project_number.toLowerCase().includes(normalizedSearch);
      const matchesPaymentState =
        paymentFilter === 'all' ||
        (paymentFilter === 'paid' && total > 0 && paid >= total) ||
        (paymentFilter === 'partial' && paid > 0 && due > 0) ||
        (paymentFilter === 'unpaid' && paid <= 0 && due > 0) ||
        (paymentFilter === 'overdue' && due > 0 && days < 0) ||
        (paymentFilter === 'due_soon' && due > 0 && days >= 0 && days <= 7);

      return (
        matchesClient &&
        matchesMonth &&
        matchesYear &&
        matchesPaymentStatus &&
        matchesProjectStatus &&
        matchesSearch &&
        matchesPaymentState
      );
    });
  }, [
    clientFilter,
    monthFilter,
    paymentFilter,
    paymentStatusFilter,
    projectStatusFilter,
    projects,
    searchTerm,
    yearFilter,
  ]);

  const summary = amountSummary(filteredProjects);
  const currentMonth = Number(todayInput().slice(5, 7));
  const currentYear = Number(todayInput().slice(0, 4));
  const dueThisMonth = filteredProjects
    .filter((project) => monthValue(project) === currentMonth && yearValue(project) === currentYear)
    .reduce((total, project) => total + dueAmount(project), 0);
  const selectedClientDue =
    clientFilter === 'all'
      ? 0
      : filteredProjects
          .filter((project) => project.client_name === clientFilter)
          .reduce((total, project) => total + dueAmount(project), 0);
  const monthlyReport = groupDueBy(filteredProjects, monthLabel);
  const clientReport = groupDueBy(filteredProjects, (project) => project.client_name || 'Unknown Client');
  const overdueReport = groupDueBy(
    filteredProjects.filter((project) => dueAmount(project) > 0 && daysUntil(project.due_date) < 0),
    (project) => project.client_name || 'Unknown Client',
  );
  const paidReport = groupDueBy(
    filteredProjects.filter((project) => dueAmount(project) === 0 && Number(project.total_price || 0) > 0),
    (project) => monthLabel(project),
  );

  function clearFilters() {
    setClientFilter('all');
    setMonthFilter('all');
    setYearFilter('all');
    setPaymentFilter('all');
    setPaymentStatusFilter('all');
    setProjectStatusFilter('all');
    setSearchTerm('');
  }

  function exportPayments() {
    downloadTextFile('manuscript-heaven-payment-report.csv', paymentCsv(filteredProjects), 'text/csv');
  }

  async function markPaid(project: Project) {
    setBusyProjectId(project.id);
    setActionError(null);

    try {
      await onUpdateProject(project.id, {
        advance_paid: Number(project.total_price || 0),
        payment_status: 'Fully Paid',
        payment_date: todayInput(),
      });
    } catch (markError) {
      setActionError(errorMessage(markError, 'Payment could not be updated.'));
    } finally {
      setBusyProjectId(null);
    }
  }

  async function deletePayment(project: Project) {
    const confirmed = window.confirm(`Delete payment record for "${project.project_title}"?`);
    if (!confirmed) {
      return;
    }

    setBusyProjectId(project.id);
    setActionError(null);

    try {
      await onDeletePayment(project.id);
    } catch (deleteError) {
      setActionError(errorMessage(deleteError, 'Payment could not be deleted.'));
    } finally {
      setBusyProjectId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Invoice payment state — derived live from the projects on each invoice, so
  // an invoice shows "Paid" as soon as every project on it is fully paid.
  // ---------------------------------------------------------------------------
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  const invoiceRows = useMemo(
    () =>
      latestInvoices.map((invoice) => {
        const linked = invoice.items
          .map((item) => projectsById.get(item.project_id))
          .filter((project): project is Project => Boolean(project));
        const outstanding = linked.filter((project) => dueAmount(project) > 0);
        const dueNow = outstanding.reduce((total, project) => total + dueAmount(project), 0);
        const missing = invoice.items.length - linked.length;
        let state: InvoicePayState = 'Unpaid';
        if (linked.length > 0 && outstanding.length === 0) {
          state = 'Paid';
        } else if (outstanding.length < linked.length || linked.some((project) => Number(project.advance_paid || 0) > 0)) {
          state = 'Partial';
        }
        return { invoice, linked, outstanding, dueNow, missing, state };
      }),
    [latestInvoices, projectsById],
  );

  const invoiceCounts = useMemo(
    () => ({
      open: invoiceRows.filter((row) => row.state !== 'Paid').length,
      paid: invoiceRows.filter((row) => row.state === 'Paid').length,
      all: invoiceRows.length,
    }),
    [invoiceRows],
  );

  const visibleInvoiceRows = useMemo(() => {
    const term = invoiceSearch.trim().toLowerCase();
    return invoiceRows.filter((row) => {
      const matchesTab =
        invoiceTab === 'all' || (invoiceTab === 'paid' ? row.state === 'Paid' : row.state !== 'Paid');
      const matchesSearch =
        !term ||
        row.invoice.invoice_number.toLowerCase().includes(term) ||
        row.invoice.client_name.toLowerCase().includes(term) ||
        (row.invoice.month_label || '').toLowerCase().includes(term);
      return matchesTab && matchesSearch;
    });
  }, [invoiceRows, invoiceSearch, invoiceTab]);

  async function markInvoicePaid(row: (typeof invoiceRows)[number]) {
    if (!row.outstanding.length) {
      return;
    }
    const confirmed = window.confirm(
      `Mark invoice ${row.invoice.invoice_number} as paid?\n\n` +
        `${row.outstanding.length} project${row.outstanding.length === 1 ? '' : 's'} will be set to Fully Paid ` +
        `(${formatMoney(row.dueNow, 'USD')}) with today's payment date.`,
    );
    if (!confirmed) {
      return;
    }

    setPayingInvoiceId(row.invoice.id);
    setActionError(null);
    setActionNotice(null);
    const failed: string[] = [];
    const paymentDate = todayInput();

    for (const project of row.outstanding) {
      try {
        await onUpdateProject(project.id, {
          advance_paid: Number(project.total_price || 0),
          payment_status: 'Fully Paid',
          payment_date: paymentDate,
        });
      } catch {
        failed.push(project.project_title || project.project_number);
      }
    }

    setPayingInvoiceId(null);
    if (failed.length) {
      setActionError(
        `${row.invoice.invoice_number}: ${failed.length} project${failed.length === 1 ? '' : 's'} could not be marked paid (${failed.join(', ')}). Try again.`,
      );
    } else {
      setActionNotice(
        `${row.invoice.invoice_number} marked as paid — ${row.outstanding.length} project${row.outstanding.length === 1 ? '' : 's'} updated.`,
      );
    }
  }

  if (isLoading) {
    return <EmptyState title="Loading payments..." message="Fetching the latest payment data from Supabase." />;
  }

  if (error) {
    return <EmptyState title="Error loading payments" message={`Error loading payments: ${error}`} />;
  }

  const kpis = [
    { label: 'Total Revenue', value: summary.total, icon: Wallet, tone: 'text-ink', chip: 'bg-ivory text-ink' },
    { label: 'Received', value: summary.paid, icon: CheckCircle2, tone: 'text-success', chip: 'bg-emerald-50 text-success' },
    { label: 'Outstanding', value: summary.due, icon: Clock, tone: 'text-warning', chip: 'bg-amber-50 text-warning' },
    { label: 'Due This Month', value: dueThisMonth, icon: CalendarDays, tone: 'text-ink', chip: 'bg-ivory text-ink' },
    { label: 'Overdue', value: summary.overdue, icon: AlertTriangle, tone: 'text-danger', chip: 'bg-red-50 text-danger' },
  ];

  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
      active ? 'bg-ink text-white' : 'text-muted hover:bg-ivory hover:text-ink'
    }`;

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="flex items-center gap-3 rounded-lg border border-border bg-white p-4 shadow-soft">
              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${kpi.chip}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wider text-muted">{kpi.label}</p>
                <p className={`mt-0.5 truncate text-xl font-bold ${kpi.tone}`}>{formatMoney(kpi.value, 'USD')}</p>
              </div>
            </div>
          );
        })}
      </section>

      {actionError ? (
        <div className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button type="button" className="text-xs font-semibold underline" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {actionNotice ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{actionNotice}</span>
          <button type="button" className="text-xs font-semibold underline" onClick={() => setActionNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Invoices — latest version of each invoice, with one-click "Mark Paid" */}
      <Card className="p-0">
        <div className="flex flex-col gap-3 border-b border-border p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-gold text-ink">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink">Invoices</h2>
              <p className="text-xs text-muted">
                Mark an invoice paid and every project on it is set to Fully Paid.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-white p-1">
              <button type="button" className={tabClass(invoiceTab === 'open')} onClick={() => setInvoiceTab('open')}>
                Unpaid <span className="opacity-70">{invoiceCounts.open}</span>
              </button>
              <button type="button" className={tabClass(invoiceTab === 'paid')} onClick={() => setInvoiceTab('paid')}>
                Paid <span className="opacity-70">{invoiceCounts.paid}</span>
              </button>
              <button type="button" className={tabClass(invoiceTab === 'all')} onClick={() => setInvoiceTab('all')}>
                All <span className="opacity-70">{invoiceCounts.all}</span>
              </button>
            </div>
            <label className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                value={invoiceSearch}
                onChange={(event) => setInvoiceSearch(event.target.value)}
                placeholder="Invoice # or client"
                className="h-9 w-48 rounded-md border border-border bg-white pl-8 pr-3 text-xs outline-none focus:border-gold"
              />
            </label>
            <Button type="button" className="min-h-9 px-3 py-1.5 text-xs" onClick={() => setShowGenerator((value) => !value)}>
              <Plus className="h-4 w-4" />
              New Invoice
            </Button>
          </div>
        </div>

        {/* Monthly Bulk Invoice Generator (collapsible) */}
        {showGenerator ? (
          <div className="border-b border-border bg-ivory/50 p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Monthly Bulk Invoice Generator</h3>
                <p className="text-xs text-muted">One combined invoice for all eligible projects of a client in a month.</p>
              </div>
              <button type="button" className="text-muted hover:text-ink" onClick={() => setShowGenerator(false)} aria-label="Close generator">
                <ChevronUp className="h-4 w-4" />
              </button>
            </div>

            <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <SelectField className="w-full min-w-0" label="Client" value={bulkClient} onChange={(e) => setBulkClient(e.target.value)}>
                <option value="all">-- Select Client --</option>
                {clients.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </SelectField>
              <SelectField className="w-full min-w-0"
                label="Month"
                value={String(bulkMonth)}
                onChange={(e) => setBulkMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              >
                <option value="all">All Months</option>
                {monthNames.map((m, idx) => (
                  <option key={m} value={idx + 1}>{m}</option>
                ))}
              </SelectField>
              <SelectField className="w-full min-w-0"
                label="Year"
                value={String(bulkYear)}
                onChange={(e) => setBulkYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              >
                <option value="all">All Years</option>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </SelectField>
              <SelectField className="w-full min-w-0" label="Payment Status" value={bulkPaymentStatus} onChange={(e) => setBulkPaymentStatus(e.target.value)}>
                <option value="all">All Statuses</option>
                <option value="unpaid">Unpaid (Balance Due)</option>
                <option value="partial">Partially Paid</option>
                <option value="paid">Fully Paid</option>
                {paymentStatuses.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </SelectField>
              <Field className="w-full min-w-0"
                label="Services Delivered"
                placeholder="Optional, e.g. October 2026"
                value={servicesDeliveredOverride}
                onChange={(event) => setServicesDeliveredOverride(event.target.value)}
              />
              <Button
                type="button"
                className="w-full"
                disabled={bulkClient === 'all' || eligibleProjectsForBulk.length === 0 || isGeneratingInvoice}
                onClick={handleGenerateBulkInvoice}
              >
                <Printer className="h-4 w-4" />
                {isGeneratingInvoice ? 'Generating...' : 'Generate Invoice'}
              </Button>
            </div>

            <div className="mt-3 flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                id="includeInvoicedCheckbox"
                checked={includeInvoiced}
                onChange={(e) => setIncludeInvoiced(e.target.checked)}
                className="rounded border-border text-gold focus:ring-gold"
              />
              <label htmlFor="includeInvoicedCheckbox" className="cursor-pointer select-none font-medium">
                Include projects already invoiced previously
              </label>
            </div>

            {bulkClient !== 'all' ? (
              <div className="mt-3 rounded-md border border-border bg-white p-3">
                {eligibleProjectsForBulk.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-ink">
                      <span>
                        {eligibleProjectsForBulk.length} eligible project{eligibleProjectsForBulk.length === 1 ? '' : 's'} for {bulkClient}
                      </span>
                      <span className="text-warning">
                        Total Due: {formatMoney(eligibleProjectsForBulk.reduce((acc, p) => acc + calculateDueAmount(p), 0), 'USD')}
                      </span>
                    </div>
                    <div className="max-h-44 divide-y divide-border overflow-y-auto text-xs text-muted">
                      {eligibleProjectsForBulk.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 py-2">
                          <div className="min-w-0">
                            <span className="font-semibold text-ink">{p.project_title}</span>
                            <span className="ml-2">(#{p.project_number})</span>
                            <span className="ml-2 font-medium text-ink">[{p.status}]</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span>Total {formatMoney(p.total_price, 'USD')}</span>
                            <span className="font-semibold text-warning">Due {formatMoney(calculateDueAmount(p), 'USD')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="py-1 text-center text-xs italic text-muted">
                    No uninvoiced projects found for {bulkClient} in the selected month/year/status.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {visibleInvoiceRows.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-ivory/60 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-5 py-2.5">Invoice</th>
                    <th className="px-3 py-2.5">Client</th>
                    <th className="px-3 py-2.5">Period</th>
                    <th className="px-3 py-2.5 text-center">Projects</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                    <th className="px-3 py-2.5 text-right">Due Now</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-5 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {visibleInvoiceRows.map((row) => {
                    const inv = row.invoice;
                    const paying = payingInvoiceId === inv.id;
                    return (
                      <tr key={inv.id} className="transition hover:bg-ivory/50">
                        <td className="px-5 py-3">
                          <button type="button" className="text-left" onClick={() => setSelectedBulkInvoice(inv)}>
                            <p className="font-semibold text-ink hover:text-gold">{inv.invoice_number}</p>
                            <p className="text-[11px] text-muted">
                              Generated {formatDate(inv.created_at)}
                              {Number(inv.version_number || 1) > 1 ? ` · v${inv.version_number}` : ''}
                            </p>
                          </button>
                        </td>
                        <td className="px-3 py-3 font-medium text-ink">{inv.client_name}</td>
                        <td className="px-3 py-3 text-xs text-muted">{inv.month_label}</td>
                        <td className="px-3 py-3 text-center text-muted">{inv.items.length}</td>
                        <td className="px-3 py-3 text-right font-semibold">{formatMoney(inv.subtotal, 'USD')}</td>
                        <td className={`px-3 py-3 text-right font-bold ${row.dueNow > 0 ? 'text-warning' : 'text-muted'}`}>
                          {formatMoney(row.dueNow, 'USD')}
                        </td>
                        <td className="px-3 py-3">
                          <InvoiceStatusPill state={row.state} />
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <Button type="button" variant="ghost" className="min-h-8 px-2.5 py-1 text-xs" onClick={() => setSelectedBulkInvoice(inv)}>
                              <Eye className="h-3.5 w-3.5" />
                              View
                            </Button>
                            <Button type="button" variant="ghost" className="min-h-8 px-2.5 py-1 text-xs" onClick={() => setRevisingInvoice(inv)}>
                              <FilePenLine className="h-3.5 w-3.5" />
                              Revise
                            </Button>
                            {row.state !== 'Paid' ? (
                              <Button
                                type="button"
                                className="min-h-8 px-3 py-1 text-xs"
                                disabled={paying || payingInvoiceId !== null || row.outstanding.length === 0}
                                onClick={() => markInvoicePaid(row)}
                              >
                                <BadgeCheck className="h-3.5 w-3.5" />
                                {paying ? 'Updating...' : 'Mark Paid'}
                              </Button>
                            ) : (
                              <span className="inline-flex min-h-8 items-center gap-1 px-3 text-xs font-semibold text-success">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Settled
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 p-4 md:hidden">
              {visibleInvoiceRows.map((row) => {
                const inv = row.invoice;
                const paying = payingInvoiceId === inv.id;
                return (
                  <div key={inv.id} className="rounded-md border border-border bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{inv.invoice_number}</p>
                        <p className="text-xs text-muted">{inv.client_name} · {inv.month_label} · {inv.items.length} projects</p>
                      </div>
                      <InvoiceStatusPill state={row.state} />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm">
                      <span>Amount {formatMoney(inv.subtotal, 'USD')}</span>
                      <span className="font-bold text-warning">Due {formatMoney(row.dueNow, 'USD')}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" className="min-h-8 px-3 py-1 text-xs" onClick={() => setSelectedBulkInvoice(inv)}>
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </Button>
                      <Button type="button" variant="secondary" className="min-h-8 px-3 py-1 text-xs" onClick={() => setRevisingInvoice(inv)}>
                        <FilePenLine className="h-3.5 w-3.5" />
                        Revise
                      </Button>
                      {row.state !== 'Paid' ? (
                        <Button
                          type="button"
                          className="min-h-8 px-3 py-1 text-xs"
                          disabled={paying || payingInvoiceId !== null || row.outstanding.length === 0}
                          onClick={() => markInvoicePaid(row)}
                        >
                          <BadgeCheck className="h-3.5 w-3.5" />
                          {paying ? 'Updating...' : 'Mark Paid'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-sm text-muted">
            {invoiceRows.length === 0
              ? 'No saved invoices yet. Click "New Invoice" to generate the first one.'
              : invoiceTab === 'open'
                ? 'All invoices are paid. Nothing outstanding.'
                : 'No invoices match this view.'}
          </div>
        )}

        {/* Full version history — collapsed by default. Older versions are never overwritten. */}
        {invoiceHistory.length > latestInvoices.length ? (
          <div className="border-t border-border px-5 py-3">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
              onClick={() => setShowHistory((value) => !value)}
            >
              <History className="h-3.5 w-3.5" />
              {showHistory ? 'Hide' : 'Show'} Invoice History ({invoiceHistory.length} versions)
              {showHistory ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showHistory ? (
              <div className="mt-3 max-h-72 divide-y divide-border/60 overflow-y-auto rounded-md border border-border">
                {invoiceHistory.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => setSelectedBulkInvoice(inv)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-ivory/60"
                  >
                    <span className="font-semibold text-ink">
                      {inv.invoice_number} <span className="font-normal text-muted">v{inv.version_number || 1}</span>
                    </span>
                    <span className="truncate text-muted">{inv.change_note || (Number(inv.version_number || 1) === 1 ? 'Original invoice' : 'Revision')}</span>
                    <span className="shrink-0 text-muted">{formatDate(inv.created_at)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* Project payment records */}
      <Card className="p-0">
        <div className="flex flex-col gap-4 border-b border-border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-md bg-gold/20 text-gold">
                <CircleDollarSign className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-xl font-semibold">Project Payments</h2>
                <p className="text-xs text-muted">
                  {filteredProjects.length} matching project{filteredProjects.length === 1 ? '' : 's'}
                  {clientFilter !== 'all' ? ` · ${clientFilter} due ${formatMoney(selectedClientDue, 'USD')}` : ''}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="min-h-9 px-3 py-1.5 text-xs" onClick={clearFilters}>
                <RotateCcw className="h-4 w-4" />
                Clear
              </Button>
              <Button type="button" variant="secondary" className="min-h-9 px-3 py-1.5 text-xs" onClick={exportPayments}>
                <Download className="h-4 w-4" />
                CSV
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <Field className="w-full min-w-0"
              label="Search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Client or project"
            />
            <SelectField className="w-full min-w-0" label="Client" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
              <option value="all">All clients</option>
              {clients.map((client) => (
                <option key={client}>{client}</option>
              ))}
            </SelectField>
            <SelectField className="w-full min-w-0" label="Month" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
              <option value="all">All months</option>
              {monthNames.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </SelectField>
            <SelectField className="w-full min-w-0" label="Year" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
              <option value="all">All years</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </SelectField>
            <SelectField className="w-full min-w-0"
              label="Due Status"
              value={paymentFilter}
              onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)}
            >
              <option value="all">All</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="unpaid">Unpaid</option>
              <option value="overdue">Overdue</option>
              <option value="due_soon">Due soon</option>
            </SelectField>
            <SelectField className="w-full min-w-0"
              label="Payment"
              value={paymentStatusFilter}
              onChange={(event) => setPaymentStatusFilter(event.target.value as PaymentStatus | 'all')}
            >
              <option value="all">All payments</option>
              {paymentStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </SelectField>
            <SelectField className="w-full min-w-0"
              label="Project"
              value={projectStatusFilter}
              onChange={(event) => setProjectStatusFilter(event.target.value as ProjectStatus | 'all')}
            >
              <option value="all">All projects</option>
              {statusOptions.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </SelectField>
          </div>
        </div>

        {filteredProjects.length ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="bg-ivory/60 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-5 py-2.5">Project</th>
                    <th className="px-3 py-2.5">Client</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-3 py-2.5 text-right">Paid</th>
                    <th className="px-3 py-2.5 text-right">Due</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Due Date</th>
                    <th className="px-3 py-2.5">Paid On</th>
                    <th className="px-5 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {filteredProjects.map((project) => {
                    const state = paymentState(project);
                    const due = dueAmount(project);
                    const busy = busyProjectId === project.id;
                    const projectInvoice = latestInvoiceForProject(project.id);

                    return (
                      <tr key={project.id} className="transition hover:bg-ivory/50">
                        <td className="px-5 py-3">
                          <button className="text-left" onClick={() => onSelectProject(project)}>
                            <p className="font-semibold text-ink hover:text-gold">{project.project_title}</p>
                            <p className="text-[11px] text-muted">
                              {project.project_number} · {monthLabel(project)}
                            </p>
                          </button>
                        </td>
                        <td className="px-3 py-3 font-medium">{project.client_name}</td>
                        <td className="px-3 py-3 text-right">{formatMoney(project.total_price, 'USD')}</td>
                        <td className="px-3 py-3 text-right text-success">{formatMoney(project.advance_paid, 'USD')}</td>
                        <td className={`px-3 py-3 text-right font-semibold ${due > 0 ? 'text-warning' : 'text-muted'}`}>
                          {formatMoney(due, 'USD')}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <PaymentBadge status={project.payment_status} />
                            {state === 'Overdue' || state === 'Due Soon' ? (
                              <span className={`text-[11px] font-semibold ${state === 'Overdue' ? 'text-danger' : 'text-warning'}`}>{state}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted">{formatDate(project.due_date)}</td>
                        <td className="px-3 py-3 text-xs text-muted">{formatDate(project.payment_date)}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="ghost"
                              className="min-h-8 px-2.5 py-1 text-xs"
                              onClick={() => handleProjectInvoice(project)}
                              disabled={busy || (!projectInvoice && isProjectArchived(project))}
                              title={projectInvoice ? `Open ${projectInvoice.invoice_number}` : 'Generate invoice'}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              {projectInvoice ? `v${projectInvoice.version_number || 1}` : isProjectArchived(project) ? 'Archived' : 'Invoice'}
                            </Button>
                            <IconButton title="Edit payment" className="!h-8 !w-8" onClick={() => onEditProject(project)}>
                              <Edit className="h-3.5 w-3.5" />
                            </IconButton>
                            {due > 0 ? (
                              <Button type="button" className="min-h-8 px-3 py-1 text-xs" onClick={() => markPaid(project)} disabled={busy}>
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Paid
                              </Button>
                            ) : null}
                            {currentProfile.role === 'admin' ? (
                              <IconButton
                                title="Delete payment record"
                                className="!h-8 !w-8 hover:border-danger hover:text-danger"
                                onClick={() => deletePayment(project)}
                                disabled={busy}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </IconButton>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 p-4 md:hidden">
              {filteredProjects.map((project) => {
                const due = dueAmount(project);
                const busy = busyProjectId === project.id;
                const projectInvoice = latestInvoiceForProject(project.id);

                return (
                  <div key={project.id} className="rounded-md border border-border bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{project.client_name}</p>
                        <button className="text-left text-sm text-muted" onClick={() => onSelectProject(project)}>
                          {project.project_title}
                        </button>
                      </div>
                      <span className="font-semibold text-warning">{formatMoney(due, 'USD')}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <span>Total {formatMoney(project.total_price, 'USD')}</span>
                      <span>Paid {formatMoney(project.advance_paid, 'USD')}</span>
                      <span>Due {formatDate(project.due_date)}</span>
                      <span>{monthLabel(project)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <PaymentBadge status={project.payment_status} />
                      <StatusBadge status={project.status} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" onClick={() => handleProjectInvoice(project)} disabled={busy || (!projectInvoice && isProjectArchived(project))}>
                        <FileText className="h-4 w-4" />
                        {projectInvoice ? `Invoice v${projectInvoice.version_number || 1}` : isProjectArchived(project) ? 'Archived' : 'Generate Invoice'}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => onEditProject(project)}>
                        <Edit className="h-4 w-4" />
                        Edit
                      </Button>
                      {due > 0 ? (
                        <Button type="button" onClick={() => markPaid(project)} disabled={busy}>
                          <CheckCircle2 className="h-4 w-4" />
                          Paid
                        </Button>
                      ) : null}
                      {currentProfile.role === 'admin' ? (
                        <Button type="button" variant="danger" onClick={() => deletePayment(project)} disabled={busy}>
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-sm text-muted">No payments found for selected filters.</div>
        )}
      </Card>

      {/* Reports — collapsed by default to keep the page focused */}
      <Card className="p-0">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 p-5 text-left"
          onClick={() => setShowReports((value) => !value)}
        >
          <div>
            <h2 className="font-display text-lg font-semibold">Payment Reports</h2>
            <p className="text-xs text-muted">Monthly, client-wise, overdue and paid summaries for the current filter.</p>
          </div>
          {showReports ? <ChevronUp className="h-5 w-5 text-muted" /> : <ChevronDown className="h-5 w-5 text-muted" />}
        </button>
        {showReports ? (
          <div className="grid gap-4 border-t border-border p-5 xl:grid-cols-2">
            <MiniReport title="Monthly Dues Report" rows={monthlyReport} />
            <MiniReport title="Client-Wise Dues Report" rows={clientReport} />
            <MiniReport title="Overdue Payments Report" rows={overdueReport} />
            <MiniReport title="Paid Payments Report" rows={paidReport} />
          </div>
        ) : null}
      </Card>

      {selectedBulkInvoice ? (
        <InvoiceModal
          invoice={selectedBulkInvoice}
          projects={projects}
          onClose={() => setSelectedBulkInvoice(null)}
          onRevise={(invoice) => {
            setSelectedBulkInvoice(null);
            setRevisingInvoice(invoice);
          }}
        />
      ) : null}

      {revisingInvoice ? (
        <InvoiceRevisionModal
          invoice={revisingInvoice}
          onClose={() => setRevisingInvoice(null)}
          onSave={async (draft, changeNote) => {
            const saved = await onSaveInvoiceVersion(
              draft,
              revisingInvoice.logical_invoice_id || null,
              changeNote,
            );
            setRevisingInvoice(null);
            setSelectedBulkInvoice(saved);
          }}
        />
      ) : null}
    </div>
  );
}
