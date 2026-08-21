import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  DollarSign,
  Edit,
  Eye,
  Mail,
  Phone,
  Plus,
  Search,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { PayrollStatusBadge, RoleBadge } from '../components/Badges';
import { Button, Card, Field, SelectField } from '../components/ui';
import { closedStatuses } from '../lib/constants';
import { useCurrency } from '../lib/currency';
import { isOverdue } from '../lib/date';
import {
  calculatePayrollSummary,
  formatMonthLabel,
  getNextMonth,
  getPreviousMonth,
  normalizeMonth,
} from '../lib/payrollUtils';
import type { EmployeeCompensation, EmployeeLedgerEntry, Profile, Project, Task } from '../lib/types';
import { firstName, initials, isClientRole } from '../lib/utils';
import { AddPayrollEntryModal } from '../components/payroll/AddPayrollEntryModal';
import { RecordPayrollPaymentModal } from '../components/payroll/RecordPayrollPaymentModal';
import { EditEmployeeSalaryModal } from '../components/payroll/EditEmployeeSalaryModal';
import { EmployeePayrollDetailModal } from '../components/payroll/EmployeePayrollDetailModal';

type Tab = 'overview' | 'employees' | 'workload' | 'payroll';

function employeeMetrics(profile: Profile, projects: Project[], tasks: Task[]) {
  const assigned = projects.filter((project) => project.assigned_to === profile.id);
  const active = assigned.filter((project) => !closedStatuses.includes(project.status));
  const completed = assigned.filter((project) => closedStatuses.includes(project.status));
  const overdue = active.filter(isOverdue);
  const employeeTasks = tasks.filter((task) => task.assigned_to === profile.id);
  const doneTasks = employeeTasks.filter((task) => task.status === 'Done');
  const quality = assigned.length ? Math.round(((assigned.length - overdue.length) / assigned.length) * 100) : 100;
  const performance = Math.max(
    0,
    Math.round(quality * 0.55 + (employeeTasks.length ? (doneTasks.length / employeeTasks.length) * 45 : 45)),
  );
  return { assigned, active, completed, overdue, employeeTasks, doneTasks, quality, performance };
}

export function TeamPage({
  currentProfile,
  profiles,
  projects,
  tasks,
  compensation,
  ledger,
  canManagePayroll,
  onAddLedgerEntry,
  onSaveCompensation,
  onDeleteLedgerEntry,
}: {
  currentProfile?: Profile;
  profiles: Profile[];
  projects: Project[];
  tasks: Task[];
  compensation: EmployeeCompensation[];
  ledger: EmployeeLedgerEntry[];
  canManagePayroll: boolean;
  onAddLedgerEntry: (entry: Omit<EmployeeLedgerEntry, 'id' | 'created_at'>) => Promise<void>;
  onSaveCompensation?: (employeeId: string, updates: Partial<EmployeeCompensation>) => Promise<void>;
  onDeleteLedgerEntry?: (entryId: string) => Promise<void>;
}) {
  const { formatMoney, convertMoney, displayCurrency } = useCurrency();
  const [tab, setTab] = useState<Tab>(canManagePayroll ? 'payroll' : 'overview');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => normalizeMonth());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals state
  const [showAddEntryModal, setShowAddEntryModal] = useState(false);
  const [addEntryPrefill, setAddEntryPrefill] = useState<{
    employeeId?: string;
    type?: EmployeeLedgerEntry['entry_type'];
  }>({});

  const [paymentModalData, setPaymentModalData] = useState<{
    profile: Profile;
    suggestedAmount?: number;
  } | null>(null);

  const [salaryModalProfile, setSalaryModalProfile] = useState<Profile | null>(null);
  const [detailModalProfileId, setDetailModalProfileId] = useState<string | null>(null);

  const team = useMemo(() => profiles.filter((p) => !isClientRole(p.role)), [profiles]);
  const isEmployeeRole = currentProfile?.role === 'employee';

  // Visible team based on permissions
  const visibleTeam = useMemo(() => {
    if (isEmployeeRole && currentProfile) {
      return team.filter((p) => p.id === currentProfile.id);
    }
    return team;
  }, [team, isEmployeeRole, currentProfile]);

  const overviewRows = useMemo(
    () =>
      team.map((profile) => ({
        profile,
        metrics: employeeMetrics(profile, projects, tasks),
        compensation: compensation.find((c) => c.employee_id === profile.id),
      })),
    [team, projects, tasks, compensation],
  );

  // Calculate dynamic payroll data for selected month
  const { rows: payrollRows, stats: payrollStats } = useMemo(
    () =>
      calculatePayrollSummary(
        visibleTeam,
        compensation,
        ledger,
        selectedMonth,
        convertMoney,
        displayCurrency,
      ),
    [visibleTeam, compensation, ledger, selectedMonth, convertMoney, displayCurrency],
  );

  // Filtered rows for the payroll table
  const filteredPayrollRows = useMemo(() => {
    return payrollRows.filter((r) => {
      const matchesSearch =
        !searchQuery ||
        r.profile.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.profile.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [payrollRows, searchQuery, statusFilter]);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'payroll', label: 'Payroll & Dues' },
    { id: 'overview', label: 'Team Overview' },
    { id: 'employees', label: 'Employees' },
    { id: 'workload', label: 'Workload' },
  ];

  function openAddEntry(employeeId?: string, defaultType?: EmployeeLedgerEntry['entry_type']) {
    setAddEntryPrefill({ employeeId, type: defaultType });
    setShowAddEntryModal(true);
  }

  function openRecordPayment(employeeId: string, suggestedAmount?: number) {
    const profile = team.find((p) => p.id === employeeId);
    if (!profile) return;
    setPaymentModalData({ profile, suggestedAmount });
  }

  function openEditSalary(employeeId: string) {
    const profile = team.find((p) => p.id === employeeId);
    if (!profile) return;
    setSalaryModalProfile(profile);
  }

  const activeDetailProfile = detailModalProfileId ? team.find((p) => p.id === detailModalProfileId) : null;
  const activeDetailCompensation = detailModalProfileId
    ? compensation.find((c) => c.employee_id === detailModalProfileId)
    : undefined;

  return (
    <div className="space-y-6">
      {/* Top Header Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant={tab === item.id ? 'primary' : 'secondary'}
              onClick={() => setTab(item.id)}
              className="text-xs sm:text-sm"
            >
              {item.label}
            </Button>
          ))}
        </div>

        {tab === 'payroll' && canManagePayroll ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => openAddEntry()}
              className="text-xs sm:text-sm py-2 px-3"
            >
              <Plus className="h-4 w-4" />
              Add Payroll Entry
            </Button>
          </div>
        ) : null}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: PAYROLL & DUES */}
      {/* ========================================================================= */}
      {tab === 'payroll' && (
        <div className="space-y-6">
          {/* Month Selector Bar */}
          <Card className="p-4 bg-white">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold text-ink">Payroll & Dues Management</h2>
                <p className="text-xs text-muted mt-0.5">
                  Ledger calculations for {formatMonthLabel(selectedMonth)}. Advances & project commissions update in real-time.
                </p>
              </div>

              {/* Month Switcher Controls */}
              <div className="flex items-center gap-1.5 self-start sm:self-auto bg-ivory p-1 rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setSelectedMonth(getPreviousMonth(selectedMonth))}
                  className="p-1.5 rounded-md hover:bg-white text-muted hover:text-ink transition"
                  title="Previous Month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value || normalizeMonth())}
                  className="bg-transparent border-0 text-xs font-bold text-ink px-2 py-1 focus:ring-0 cursor-pointer"
                />

                <button
                  type="button"
                  onClick={() => setSelectedMonth(getNextMonth(selectedMonth))}
                  className="p-1.5 rounded-md hover:bg-white text-muted hover:text-ink transition"
                  title="Next Month"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedMonth(normalizeMonth())}
                  className="ml-1 text-[10px] font-bold uppercase tracking-wider bg-white hover:bg-gold/10 px-2 py-1 rounded border border-border text-ink transition"
                >
                  Current
                </button>
              </div>
            </div>
          </Card>

          {/* Top 4 Dynamic Summary Cards */}
          <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <Card className="p-4 bg-white border-l-4 border-l-gold">
              <div className="flex items-center justify-between text-muted mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wider">Total Payroll</span>
                <DollarSign className="h-4 w-4 text-gold" />
              </div>
              <p className="text-2xl font-bold text-ink mt-1">{formatMoney(payrollStats.totalPayroll, 'USD')}</p>
              <p className="text-[11px] text-muted mt-1">Payable for {formatMonthLabel(selectedMonth)}</p>
            </Card>

            <Card className="p-4 bg-white border-l-4 border-l-emerald-500">
              <div className="flex items-center justify-between text-muted mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wider">Total Paid</span>
                <Wallet className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="text-2xl font-bold text-emerald-700 mt-1">{formatMoney(payrollStats.totalPaid, 'USD')}</p>
              <p className="text-[11px] text-muted mt-1">Disbursed in {formatMonthLabel(selectedMonth)}</p>
            </Card>

            <Card className="p-4 bg-white border-l-4 border-l-amber-500">
              <div className="flex items-center justify-between text-muted mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wider">Outstanding</span>
                <CreditCard className="h-4 w-4 text-amber-600" />
              </div>
              <p className={`text-2xl font-bold mt-1 ${payrollStats.totalOutstanding > 0 ? 'text-amber-900' : 'text-ink'}`}>
                {formatMoney(payrollStats.totalOutstanding, 'USD')}
              </p>
              <p className="text-[11px] text-muted mt-1">
                {payrollStats.totalOutstanding === 0 ? 'All payrolls fully cleared' : 'Remaining balance due'}
              </p>
            </Card>

            <Card className="p-4 bg-white border-l-4 border-l-purple-500">
              <div className="flex items-center justify-between text-muted mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wider">Active Advances</span>
                <TrendingUp className="h-4 w-4 text-purple-600" />
              </div>
              <p className="text-2xl font-bold text-purple-800 mt-1">{formatMoney(payrollStats.totalAdvances, 'USD')}</p>
              <p className="text-[11px] text-muted mt-1">Advances recorded in {formatMonthLabel(selectedMonth)}</p>
            </Card>
          </section>

          {/* Main Payroll Table Card */}
          <Card className="p-4 sm:p-6 bg-white">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-border">
              <div>
                <h3 className="font-display text-lg font-bold text-ink">Employee Payroll Table</h3>
                <p className="text-xs text-muted">
                  Showing {filteredPayrollRows.length} team member{filteredPayrollRows.length === 1 ? '' : 's'} for {formatMonthLabel(selectedMonth)}
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px]">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
                  <input
                    type="text"
                    placeholder="Search employee..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8.5 w-full rounded-md border border-border bg-white pl-8 pr-3 text-xs placeholder:text-muted focus:border-gold focus:outline-none"
                  />
                </div>

                <SelectField
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8.5 text-xs sm:w-36"
                >
                  <option value="all">All Statuses</option>
                  <option value="Paid">Paid</option>
                  <option value="Partially Paid">Partially Paid</option>
                  <option value="Pending">Pending</option>
                  <option value="Overdue">Overdue</option>
                </SelectField>
              </div>
            </div>

            {/* Desktop Table (md and above) */}
            <div className="mt-4 hidden md:block overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-xs">
                <thead className="text-muted border-b border-border bg-ivory/40">
                  <tr>
                    <th className="py-3 px-2 font-bold">Employee</th>
                    <th className="py-3 font-bold">Monthly Salary</th>
                    <th className="py-3 font-bold">Project Earnings</th>
                    <th className="py-3 font-bold">Advances</th>
                    <th className="py-3 font-bold">Deductions</th>
                    <th className="py-3 font-bold">Payable</th>
                    <th className="py-3 font-bold">Paid</th>
                    <th className="py-3 font-bold">Outstanding</th>
                    <th className="py-3 font-bold">Status</th>
                    <th className="py-3 px-2 text-right font-bold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredPayrollRows.length ? (
                    filteredPayrollRows.map((row) => (
                      <tr key={row.profile.id} className="hover:bg-ivory/30 transition">
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-2.5">
                            <div className="grid h-8 w-8 place-items-center rounded-full bg-gold/20 font-bold text-ink text-xs shrink-0">
                              {initials(firstName(row.profile.full_name))}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-ink truncate">{row.profile.full_name}</p>
                              <p className="text-[10px] text-muted capitalize">{row.profile.role}</p>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 font-medium text-charcoal">
                          {formatMoney(row.baseSalary, 'USD')}
                          {row.salaryType !== 'Monthly' && (
                            <span className="block text-[10px] text-muted">{row.salaryType}</span>
                          )}
                        </td>

                        <td className="py-3 font-medium text-emerald-700">
                          {row.projectEarnings > 0 ? `+${formatMoney(row.projectEarnings, 'USD')}` : '$0'}
                          {row.bonuses > 0 ? (
                            <span className="block text-[10px] text-muted">+{formatMoney(row.bonuses, 'USD')} bonus</span>
                          ) : null}
                        </td>

                        <td className="py-3 font-medium text-purple-800">
                          {row.advances > 0 ? formatMoney(row.advances, 'USD') : '$0'}
                        </td>

                        <td className="py-3 font-medium text-danger">
                          {row.deductions > 0 ? `-${formatMoney(row.deductions, 'USD')}` : '$0'}
                        </td>

                        <td className="py-3 font-bold text-ink">{formatMoney(row.totalPayable, 'USD')}</td>

                        <td className="py-3 font-bold text-emerald-700">{formatMoney(row.totalPaid, 'USD')}</td>

                        <td className="py-3">
                          <span
                            className={`font-bold ${
                              row.outstanding > 0 ? 'text-amber-900 font-extrabold' : 'text-muted'
                            }`}
                          >
                            {formatMoney(row.outstanding, 'USD')}
                          </span>
                        </td>

                        <td className="py-3">
                          <PayrollStatusBadge status={row.status} />
                        </td>

                        <td className="py-3 px-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {canManagePayroll && row.outstanding > 0 ? (
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => openRecordPayment(row.profile.id, row.outstanding)}
                                className="text-[11px] py-1 px-2 text-emerald-800 border-emerald-300 hover:bg-emerald-50"
                                title="Record payment for this employee"
                              >
                                Pay
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => setDetailModalProfileId(row.profile.id)}
                              className="text-[11px] py-1 px-2.5"
                            >
                              <Eye className="h-3 w-3" /> View
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-muted">
                        No payroll records found matching your filters for {formatMonthLabel(selectedMonth)}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Layout (< md) */}
            <div className="mt-4 block md:hidden space-y-3">
              {filteredPayrollRows.length ? (
                filteredPayrollRows.map((row) => (
                  <div key={row.profile.id} className="rounded-lg border border-border bg-ivory/30 p-3.5 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-gold/20 font-bold text-ink text-xs shrink-0">
                          {initials(firstName(row.profile.full_name))}
                        </div>
                        <div>
                          <p className="font-bold text-ink">{row.profile.full_name}</p>
                          <RoleBadge role={row.profile.role} />
                        </div>
                      </div>
                      <PayrollStatusBadge status={row.status} />
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/60">
                      <div>
                        <span className="text-muted block text-[10px]">Monthly Salary</span>
                        <p className="font-semibold text-ink">{formatMoney(row.baseSalary, 'USD')}</p>
                      </div>
                      <div>
                        <span className="text-muted block text-[10px]">Project Earnings</span>
                        <p className="font-semibold text-emerald-700">+{formatMoney(row.projectEarnings, 'USD')}</p>
                      </div>
                      <div>
                        <span className="text-muted block text-[10px]">Total Payable</span>
                        <p className="font-bold text-ink">{formatMoney(row.totalPayable, 'USD')}</p>
                      </div>
                      <div>
                        <span className="text-muted block text-[10px]">Total Paid</span>
                        <p className="font-bold text-emerald-700">{formatMoney(row.totalPaid, 'USD')}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border/60">
                      <div>
                        <span className="text-muted block text-[10px]">Outstanding</span>
                        <span className={`font-bold ${row.outstanding > 0 ? 'text-amber-900 font-extrabold' : 'text-muted'}`}>
                          {formatMoney(row.outstanding, 'USD')}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        {canManagePayroll && row.outstanding > 0 ? (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => openRecordPayment(row.profile.id, row.outstanding)}
                            className="text-xs py-1 px-2 text-emerald-800"
                          >
                            Pay
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setDetailModalProfileId(row.profile.id)}
                          className="text-xs py-1 px-2.5"
                        >
                          View
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center py-6 text-muted text-xs">
                  No payroll records found for {formatMonthLabel(selectedMonth)}.
                </p>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: OVERVIEW */}
      {/* ========================================================================= */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Total Employees" value={team.length} icon={Users} />
            <StatCard
              label="Active Employees"
              value={team.filter((p) => p.status !== 'inactive').length}
              icon={Users}
            />
            <StatCard
              label="Projects Assigned"
              value={overviewRows.reduce((sum, row) => sum + row.metrics.active.length, 0)}
              icon={TrendingUp}
            />
            <StatCard
              label="Monthly Payroll"
              value={formatMoney(payrollStats.totalPayroll, 'USD')}
              icon={DollarSign}
            />
            <StatCard
              label="Outstanding Dues"
              value={formatMoney(payrollStats.totalOutstanding, 'USD')}
              icon={CreditCard}
            />
          </section>

          <PerformanceTable rows={overviewRows} />
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: EMPLOYEES */}
      {/* ========================================================================= */}
      {tab === 'employees' && (
        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {overviewRows.map(({ profile, metrics, compensation: pay }) => (
            <Card key={profile.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="grid h-12 w-12 place-items-center rounded-lg bg-gold/20 text-lg font-bold text-ink">
                    {initials(firstName(profile.full_name))}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-semibold text-ink">{profile.full_name}</h3>
                    <RoleBadge role={profile.role} />
                  </div>
                </div>

                {canManagePayroll ? (
                  <button
                    type="button"
                    onClick={() => openEditSalary(profile.id)}
                    className="text-muted hover:text-gold p-1"
                    title="Configure salary"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <MetricBox label="Active Projects" value={metrics.active.length} />
                <MetricBox label="Completed" value={metrics.completed.length} />
                <MetricBox label="Performance" value={`${metrics.performance}%`} />
              </div>

              <div className="mt-4 space-y-1.5 text-xs text-muted border-t border-border pt-3">
                <p className="flex items-center gap-2 text-charcoal">
                  <Mail className="h-3.5 w-3.5 text-gold" /> {profile.email}
                </p>
                {profile.phone ? (
                  <p className="flex items-center gap-2 text-charcoal">
                    <Phone className="h-3.5 w-3.5 text-gold" /> {profile.phone}
                  </p>
                ) : null}
                <div className="pt-1 flex items-center justify-between text-ink font-semibold">
                  <span>Monthly Salary:</span>
                  <span>{formatMoney(pay?.monthly_salary || 0, 'USD')}</span>
                </div>
                {pay?.per_project_rate ? (
                  <div className="flex items-center justify-between text-muted">
                    <span>Per Project Rate:</span>
                    <span>{formatMoney(pay.per_project_rate, 'USD')}</span>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 pt-3 border-t border-border flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDetailModalProfileId(profile.id)}
                  className="text-xs py-1 px-3"
                >
                  <Eye className="h-3.5 w-3.5" /> View Payroll Ledger
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: WORKLOAD */}
      {/* ========================================================================= */}
      {tab === 'workload' && (
        <section className="space-y-4">
          {overviewRows.map(({ profile, metrics }) => (
            <Card key={profile.id} className="p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border pb-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-gold/20 font-bold text-ink text-xs">
                    {initials(firstName(profile.full_name))}
                  </div>
                  <div>
                    <h3 className="font-semibold text-ink">{profile.full_name}</h3>
                    <p className="text-xs text-muted">
                      {metrics.active.length} active project{metrics.active.length === 1 ? '' : 's'} •{' '}
                      {metrics.doneTasks.length}/{metrics.employeeTasks.length} tasks completed
                    </p>
                  </div>
                </div>
                {metrics.overdue.length > 0 ? (
                  <span className="font-bold text-danger text-xs bg-red-50 px-2.5 py-1 rounded border border-red-200">
                    {metrics.overdue.length} overdue
                  </span>
                ) : (
                  <span className="text-xs text-success font-semibold">All tasks on track</span>
                )}
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                {metrics.active.length ? (
                  metrics.active.map((project) => (
                    <div key={project.id} className="rounded-md border border-border bg-ivory/50 p-2.5 text-xs">
                      <p className="font-bold text-ink truncate">{project.project_title}</p>
                      <p className="text-muted mt-0.5">
                        {project.current_stage || project.status} • Due {project.due_date}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted col-span-3 py-2">No active projects assigned currently.</p>
                )}
              </div>
            </Card>
          ))}
        </section>
      )}

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}

      {/* 1. Add Payroll Entry Modal */}
      {showAddEntryModal && (
        <AddPayrollEntryModal
          profiles={team}
          projects={projects}
          initialMonth={selectedMonth}
          initialEmployeeId={addEntryPrefill.employeeId}
          initialType={addEntryPrefill.type}
          onClose={() => setShowAddEntryModal(false)}
          onSave={async (entry) => {
            await onAddLedgerEntry(entry);
            setShowAddEntryModal(false);
          }}
        />
      )}

      {/* 2. Record Payment Modal */}
      {paymentModalData && (
        <RecordPayrollPaymentModal
          profile={paymentModalData.profile}
          payrollMonth={selectedMonth}
          suggestedAmount={paymentModalData.suggestedAmount}
          onClose={() => setPaymentModalData(null)}
          onRecordPayment={async (entry) => {
            await onAddLedgerEntry(entry);
            setPaymentModalData(null);
          }}
        />
      )}

      {/* 3. Edit Salary Modal */}
      {salaryModalProfile && (
        <EditEmployeeSalaryModal
          profile={salaryModalProfile}
          compensation={compensation.find((c) => c.employee_id === salaryModalProfile.id)}
          onClose={() => setSalaryModalProfile(null)}
          onSave={async (employeeId, updates) => {
            if (onSaveCompensation) {
              await onSaveCompensation(employeeId, updates);
            }
            setSalaryModalProfile(null);
          }}
        />
      )}

      {/* 4. Employee Detail Drawer Modal */}
      {activeDetailProfile && (
        <EmployeePayrollDetailModal
          profile={activeDetailProfile}
          compensation={activeDetailCompensation}
          ledger={ledger}
          projects={projects}
          selectedMonth={selectedMonth}
          canManage={canManagePayroll}
          onClose={() => setDetailModalProfileId(null)}
          onOpenAddEntry={(employeeId, defaultType) => {
            openAddEntry(employeeId, defaultType);
          }}
          onOpenRecordPayment={(employeeId, suggestedAmount) => {
            openRecordPayment(employeeId, suggestedAmount);
          }}
          onOpenEditSalary={(employeeId) => {
            openEditSalary(employeeId);
          }}
          onDeleteEntry={onDeleteLedgerEntry}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card className="p-4 bg-white">
      <div className="flex items-center justify-between text-muted mb-1">
        <span className="text-xs font-semibold">{label}</span>
        <Icon className="h-4 w-4 text-gold" />
      </div>
      <p className="text-2xl font-bold text-ink mt-1">{value}</p>
    </Card>
  );
}

function MetricBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-ivory/70 border border-border p-2">
      <p className="font-bold text-ink">{value}</p>
      <p className="text-[10px] text-muted">{label}</p>
    </div>
  );
}

function PerformanceTable({ rows }: { rows: Array<{ profile: Profile; metrics: ReturnType<typeof employeeMetrics> }> }) {
  return (
    <Card className="p-4 sm:p-6 bg-white">
      <h2 className="font-display text-xl font-bold text-ink">Employee Performance</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-xs">
          <thead className="text-muted border-b border-border">
            <tr>
              <th className="pb-3 px-2">Employee</th>
              <th className="pb-3">Active Projects</th>
              <th className="pb-3">Tasks Completed</th>
              <th className="pb-3">Overdue</th>
              <th className="pb-3">Task Completion Rate</th>
              <th className="pb-3">Performance Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ profile, metrics }) => {
              const taskRate = metrics.employeeTasks.length
                ? Math.round((metrics.doneTasks.length / metrics.employeeTasks.length) * 100)
                : 100;
              return (
                <tr key={profile.id} className="hover:bg-ivory/30">
                  <td className="py-3 px-2 font-semibold text-ink">{profile.full_name}</td>
                  <td>{metrics.assigned.length}</td>
                  <td>
                    {metrics.doneTasks.length} / {metrics.employeeTasks.length}
                  </td>
                  <td className={metrics.overdue.length ? 'font-bold text-danger' : 'text-muted'}>
                    {metrics.overdue.length}
                  </td>
                  <td>{taskRate}%</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{metrics.performance}%</span>
                      <div className="h-1.5 w-20 rounded bg-ivory overflow-hidden border border-border/40">
                        <div
                          className="h-full rounded bg-gold"
                          style={{ width: `${metrics.performance}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
