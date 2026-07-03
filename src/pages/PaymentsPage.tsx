import { AlertTriangle, CheckCircle2, CircleDollarSign, Download, Edit, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PaymentBadge, StatusBadge } from '../components/Badges';
import { Button, Card, EmptyState, Field, SelectField } from '../components/ui';
import { paymentStatuses, statusOptions } from '../lib/constants';
import { daysUntil, formatDate, todayInput } from '../lib/date';
import { currency, downloadTextFile } from '../lib/utils';
import type { PaymentStatus, Profile, Project, ProjectStatus } from '../lib/types';

type PaymentFilter = 'all' | 'paid' | 'partial' | 'unpaid' | 'overdue' | 'due_soon';

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
                <span>Total {currency(row.total)}</span>
                <span>Paid {currency(row.paid)}</span>
                <span className="font-semibold text-warning">Due {currency(row.due)}</span>
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
}: {
  projects: Project[];
  currentProfile: Profile;
  isLoading: boolean;
  error: string | null;
  onSelectProject: (project: Project) => void;
  onEditProject: (project: Project) => void;
  onUpdateProject: (projectId: string, updates: Partial<Project>) => Promise<unknown>;
  onDeletePayment: (projectId: string) => Promise<void>;
}) {
  const [clientFilter, setClientFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<PaymentStatus | 'all'>('all');
  const [projectStatusFilter, setProjectStatusFilter] = useState<ProjectStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const clients = useMemo(() => [...new Set(projects.map((project) => project.client_name).filter(Boolean))].sort(), [
    projects,
  ]);
  const years = useMemo(
    () => [...new Set(projects.map(yearValue).filter(Boolean))].sort((a, b) => b - a),
    [projects],
  );

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
      setActionError(markError instanceof Error ? markError.message : 'Payment could not be updated.');
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
      setActionError(deleteError instanceof Error ? deleteError.message : 'Payment could not be deleted.');
    } finally {
      setBusyProjectId(null);
    }
  }

  if (isLoading) {
    return <EmptyState title="Loading payments..." message="Fetching the latest payment data from Supabase." />;
  }

  if (error) {
    return <EmptyState title="Error loading payments" message={`Error loading payments: ${error}`} />;
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Card>
          <p className="text-sm text-muted">Total Revenue</p>
          <p className="mt-3 text-2xl font-bold">{currency(summary.total)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Total Paid</p>
          <p className="mt-3 text-2xl font-bold text-success">{currency(summary.paid)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Total Due</p>
          <p className="mt-3 text-2xl font-bold text-warning">{currency(summary.due)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Due This Month</p>
          <p className="mt-3 text-2xl font-bold">{currency(dueThisMonth)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Overdue Amount</p>
          <p className="mt-3 text-2xl font-bold text-danger">{currency(summary.overdue)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Selected Client Due</p>
          <p className="mt-3 text-2xl font-bold">{currency(selectedClientDue)}</p>
        </Card>
      </section>

      <Card>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-md bg-gold/20 text-gold">
              <CircleDollarSign className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold">Payment Reports</h2>
              <p className="text-sm text-muted">
                {filteredProjects.length} matching project{filteredProjects.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <Field
              label="Search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Client or project"
            />
            <SelectField label="Client" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
              <option value="all">All clients</option>
              {clients.map((client) => (
                <option key={client}>{client}</option>
              ))}
            </SelectField>
            <SelectField label="Month" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
              <option value="all">All months</option>
              {monthNames.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </SelectField>
            <SelectField label="Year" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
              <option value="all">All years</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </SelectField>
            <SelectField
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
            <SelectField
              label="Payment"
              value={paymentStatusFilter}
              onChange={(event) => setPaymentStatusFilter(event.target.value as PaymentStatus | 'all')}
            >
              <option value="all">All payments</option>
              {paymentStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </SelectField>
            <SelectField
              label="Project"
              value={projectStatusFilter}
              onChange={(event) => setProjectStatusFilter(event.target.value as ProjectStatus | 'all')}
            >
              <option value="all">All projects</option>
              {statusOptions.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </SelectField>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={clearFilters}>
                <RotateCcw className="h-4 w-4" />
                Clear
              </Button>
              <Button type="button" variant="secondary" onClick={exportPayments}>
                <Download className="h-4 w-4" />
                CSV
              </Button>
            </div>
          </div>
        </div>

        {actionError ? (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-danger">Error loading payments: {actionError}</p>
        ) : null}
      </Card>

      {filteredProjects.length ? (
        <Card className="overflow-hidden p-0">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-ivory text-xs uppercase tracking-[0.12em] text-muted">
                <tr>
                  <th className="px-4 py-3">Client Name</th>
                  <th className="px-4 py-3">Project Title</th>
                  <th className="px-4 py-3">Total Amount</th>
                  <th className="px-4 py-3">Paid Amount</th>
                  <th className="px-4 py-3">Due Amount</th>
                  <th className="px-4 py-3">Payment Status</th>
                  <th className="px-4 py-3">Payment Date</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Month</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((project) => {
                  const state = paymentState(project);
                  const due = dueAmount(project);
                  const busy = busyProjectId === project.id;

                  return (
                    <tr key={project.id} className="transition hover:bg-ivory/70">
                      <td className="border-t border-border px-4 py-3 font-semibold">{project.client_name}</td>
                      <td className="border-t border-border px-4 py-3">
                        <button className="text-left" onClick={() => onSelectProject(project)}>
                          <p className="font-semibold text-ink">{project.project_title}</p>
                          <p className="text-xs text-muted">{project.project_number}</p>
                        </button>
                      </td>
                      <td className="border-t border-border px-4 py-3">{currency(project.total_price)}</td>
                      <td className="border-t border-border px-4 py-3">{currency(project.advance_paid)}</td>
                      <td className="border-t border-border px-4 py-3 font-semibold text-warning">{currency(due)}</td>
                      <td className="border-t border-border px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold">{state}</span>
                          <PaymentBadge status={project.payment_status} />
                        </div>
                      </td>
                      <td className="border-t border-border px-4 py-3">{formatDate(project.payment_date)}</td>
                      <td className="border-t border-border px-4 py-3">{formatDate(project.due_date)}</td>
                      <td className="border-t border-border px-4 py-3">{monthLabel(project)}</td>
                      <td className="max-w-[220px] border-t border-border px-4 py-3 text-muted">
                        <p className="line-clamp-2">{project.payment_notes || 'No notes'}</p>
                      </td>
                      <td className="border-t border-border px-4 py-3">
                        <div className="flex justify-end gap-2">
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

              return (
                <div key={project.id} className="rounded-md border border-border bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{project.client_name}</p>
                      <button className="text-left text-sm text-muted" onClick={() => onSelectProject(project)}>
                        {project.project_title}
                      </button>
                    </div>
                    <span className="font-semibold text-warning">{currency(due)}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <span>Total {currency(project.total_price)}</span>
                    <span>Paid {currency(project.advance_paid)}</span>
                    <span>Due {formatDate(project.due_date)}</span>
                    <span>{monthLabel(project)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <PaymentBadge status={project.payment_status} />
                    <StatusBadge status={project.status} />
                  </div>
                  <p className="mt-3 text-sm text-muted">{project.payment_notes || 'No notes'}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
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
        </Card>
      ) : (
        <EmptyState title="No payments found" message="No payments found for selected filters." />
      )}

      <section className="grid gap-5 xl:grid-cols-2">
        <MiniReport title="Monthly Dues Report" rows={monthlyReport} />
        <MiniReport title="Client-Wise Dues Report" rows={clientReport} />
        <MiniReport title="Overdue Payments Report" rows={overdueReport} />
        <MiniReport title="Paid Payments Report" rows={paidReport} />
      </section>

      {summary.overdue > 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" />
          Overdue amount in the current filter is {currency(summary.overdue)}.
        </div>
      ) : null}
    </div>
  );
}
