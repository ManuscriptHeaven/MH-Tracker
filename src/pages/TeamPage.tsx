import React, { useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  DollarSign,
  Edit2,
  Eye,
  Mail,
  Phone,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { PayrollStatusBadge, RoleBadge } from '../components/Badges';
import { Button, Card, Field, SelectField } from '../components/ui';
import { UserAvatar } from '../components/UserAvatar';
import { AvatarUploadModal } from '../components/AvatarUploadModal';
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
import type { EmployeeCompensation, EmployeeLedgerEntry, Profile, Project, Role, Task } from '../lib/types';
import { firstName, initials, isClientRole } from '../lib/utils';
import { AddPayrollEntryModal } from '../components/payroll/AddPayrollEntryModal';
import { RecordPayrollPaymentModal } from '../components/payroll/RecordPayrollPaymentModal';
import { EditEmployeeSalaryModal } from '../components/payroll/EditEmployeeSalaryModal';
import { EmployeePayrollDetailModal } from '../components/payroll/EmployeePayrollDetailModal';

type Tab = 'payroll' | 'directory';

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
  onUpdateProfile,
  onAddEmployee,
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
  onUpdateProfile?: (
    profileId: string,
    updates: { full_name?: string; avatar_url?: string | null; phone?: string | null }
  ) => Promise<string | void>;
  onAddEmployee?: (employeeData: { fullName: string; email: string; phone?: string; role: Role }) => Promise<string>;
}) {
  const { formatMoney, convertMoney, displayCurrency } = useCurrency();
  const [tab, setTab] = useState<Tab>(() => canManagePayroll ? 'payroll' : 'directory');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => normalizeMonth());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [avatarTargetProfile, setAvatarTargetProfile] = useState<Profile | null>(null);

  // Modals
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
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEmployeeEmail, setNewEmployeeEmail] = useState('');
  const [newEmployeePhone, setNewEmployeePhone] = useState('');
  const [newEmployeeRole, setNewEmployeeRole] = useState<Role>('employee');
  const [addEmployeeLoading, setAddEmployeeLoading] = useState(false);
  const [addEmployeeError, setAddEmployeeError] = useState<string | null>(null);
  const [provisionSuccess, setProvisionSuccess] = useState<string | null>(null);

  const team = useMemo(() => profiles.filter((p) => !isClientRole(p.role)), [profiles]);
  const isEmployeeRole = currentProfile?.role === 'employee';

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

  const payrollCompletion =
    payrollStats.totalPayroll > 0
      ? Math.min(100, Math.round((payrollStats.totalPaid / payrollStats.totalPayroll) * 100))
      : 100;
  const unsettledPeople =
    payrollStats.pendingCount + payrollStats.partiallyPaidCount + payrollStats.overdueCount;

  return (
    <div className="mx-auto max-w-[1480px] space-y-5 px-0.5 pb-8">
      {/* Team workspace navigation */}
      <section className="rounded-2xl border border-border bg-white p-2 shadow-xs">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className={`grid gap-1 rounded-xl bg-[#f7f4ec] p-1 sm:inline-grid sm:w-auto ${canManagePayroll ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {canManagePayroll ? (
              <button
                type="button"
                onClick={() => setTab('payroll')}
                className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 text-xs font-bold transition sm:min-w-[150px] ${
                  tab === 'payroll'
                    ? 'bg-white text-ink shadow-sm'
                    : 'text-muted hover:bg-white/70 hover:text-ink'
                }`}
              >
                <DollarSign className="h-4 w-4 text-gold" />
                Payroll & Dues
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setTab('directory')}
              className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 text-xs font-bold transition sm:min-w-[190px] ${
                tab === 'directory'
                  ? 'bg-white text-ink shadow-sm'
                  : 'text-muted hover:bg-white/70 hover:text-ink'
              }`}
            >
              <Users className="h-4 w-4 text-gold" />
              Team & Workload
            </button>
          </div>

          {canManagePayroll ? (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setAddEmployeeError(null);
                  setProvisionSuccess(null);
                  setShowAddEmployeeModal(true);
                }}
                className="min-h-10 justify-center px-3 text-xs sm:px-4"
              >
                <UserPlus className="h-4 w-4" />
                Add Team Member
              </Button>
              <Button
                type="button"
                onClick={() => openAddEntry()}
                className="min-h-10 justify-center px-3 text-xs sm:px-4"
              >
                <Plus className="h-4 w-4" />
                Add Payroll Entry
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      {provisionSuccess && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{provisionSuccess}</span>
        </div>
      )}

      {canManagePayroll && tab === 'payroll' && (
        <div className="space-y-4">
          {/* Payroll control bar */}
          <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-xs">
            <div className="flex flex-col gap-4 p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#7a5518]">
                    <Sparkles className="h-3.5 w-3.5" />
                    Payroll Command Center
                  </span>
                  <span className="text-[10px] font-semibold text-muted">
                    {payrollStats.employeeCount} team members
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedMonth(getPreviousMonth(selectedMonth))}
                    className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-[#faf9f6] text-muted transition hover:border-gold/60 hover:bg-white hover:text-ink"
                    title="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  <div className="min-w-[180px] rounded-xl border border-border bg-[#faf9f6] px-4 py-2 text-center sm:min-w-[210px]">
                    <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">
                      Payroll Period
                    </p>
                    <p className="mt-0.5 font-display text-base font-bold text-ink sm:text-lg">
                      {formatMonthLabel(selectedMonth)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedMonth(getNextMonth(selectedMonth))}
                    className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-[#faf9f6] text-muted transition hover:border-gold/60 hover:bg-white hover:text-ink"
                    title="Next month"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedMonth(normalizeMonth())}
                    className="rounded-lg px-2 py-1.5 text-[10px] font-bold text-[#7a5518] transition hover:bg-gold/10"
                  >
                    Jump to current month
                  </button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_150px] xl:w-[470px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    placeholder="Search employee..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-11 w-full rounded-xl border border-border bg-[#faf9f6] pl-10 pr-3 text-xs text-ink outline-none transition placeholder:text-muted focus:border-gold focus:bg-white"
                  />
                </div>
                <SelectField
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-11 rounded-xl text-xs"
                >
                  <option value="all">All Statuses</option>
                  <option value="Paid">Paid</option>
                  <option value="Partially Paid">Partially Paid</option>
                  <option value="Pending">Pending</option>
                  <option value="Overdue">Overdue</option>
                </SelectField>
              </div>
            </div>
          </section>

          {/* Payroll summary */}
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Card className="relative overflow-hidden rounded-2xl border-border bg-white p-4 sm:p-5">
              <div className="absolute right-0 top-0 h-20 w-20 rounded-bl-[44px] bg-gold/[0.07]" />
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">
                    Total Payroll
                  </p>
                  <p className="mt-2 font-display text-2xl font-bold text-ink sm:text-3xl">
                    {formatMoney(payrollStats.totalPayroll, 'USD')}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted">
                    {formatMonthLabel(selectedMonth)}
                  </p>
                </div>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-[#7a5518]">
                  <Wallet className="h-4 w-4" />
                </span>
              </div>
              <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-[#eee9dd]">
                <div
                  className="h-full rounded-full bg-[#b8954f] transition-all"
                  style={{ width: `${payrollCompletion}%` }}
                />
              </div>
              <p className="relative mt-2 text-[10px] font-semibold text-muted">
                {payrollCompletion}% disbursed
              </p>
            </Card>

            <Card className="relative overflow-hidden rounded-2xl border-border bg-white p-4 sm:p-5">
              <div className="absolute right-0 top-0 h-20 w-20 rounded-bl-[44px] bg-emerald-500/[0.06]" />
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">
                    Paid This Month
                  </p>
                  <p className="mt-2 font-display text-2xl font-bold text-emerald-700 sm:text-3xl">
                    {formatMoney(payrollStats.totalPaid, 'USD')}
                  </p>
                  <p className="mt-1 text-[10px] text-muted">
                    {payrollStats.paidCount} fully settled
                  </p>
                </div>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
              </div>
              <div className="relative mt-4 flex items-center gap-2 text-[10px] font-semibold text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Payments recorded for selected month
              </div>
            </Card>

            <Card className="relative overflow-hidden rounded-2xl border-border bg-white p-4 sm:p-5">
              <div className="absolute right-0 top-0 h-20 w-20 rounded-bl-[44px] bg-amber-500/[0.07]" />
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">
                    Outstanding
                  </p>
                  <p className={`mt-2 font-display text-2xl font-bold sm:text-3xl ${
                    payrollStats.totalOutstanding > 0 ? 'text-amber-800' : 'text-ink'
                  }`}>
                    {formatMoney(payrollStats.totalOutstanding, 'USD')}
                  </p>
                  <p className="mt-1 text-[10px] text-muted">
                    {unsettledPeople} team member{unsettledPeople === 1 ? '' : 's'} to settle
                  </p>
                </div>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700">
                  <Clock3 className="h-4 w-4" />
                </span>
              </div>
              <p className="relative mt-4 text-[10px] font-semibold text-amber-800">
                {payrollStats.totalOutstanding > 0 ? 'Action required before payroll closes' : 'All payroll is clear'}
              </p>
            </Card>

            <Card className="relative overflow-hidden rounded-2xl border-border bg-white p-4 sm:p-5">
              <div className="absolute right-0 top-0 h-20 w-20 rounded-bl-[44px] bg-violet-500/[0.06]" />
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">
                    Advances
                  </p>
                  <p className="mt-2 font-display text-2xl font-bold text-violet-800 sm:text-3xl">
                    {formatMoney(payrollStats.totalAdvances, 'USD')}
                  </p>
                  <p className="mt-1 text-[10px] text-muted">
                    Advances recorded this month
                  </p>
                </div>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
                  <CreditCard className="h-4 w-4" />
                </span>
              </div>
              <button
                type="button"
                onClick={() => openAddEntry(undefined, 'Advance')}
                className="relative mt-4 text-[10px] font-bold text-[#7a5518] hover:underline"
              >
                Record an advance
              </button>
            </Card>
          </section>

          {/* Employee payroll register */}
          <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-xs">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 className="font-display text-lg font-bold text-ink">
                  Employee Payroll
                </h2>
                <p className="mt-0.5 text-[11px] text-muted">
                  {filteredPayrollRows.length} visible · {payrollStats.paidCount} paid · {unsettledPeople} unsettled
                </p>
              </div>
              {canManagePayroll ? (
                <button
                  type="button"
                  onClick={() => openAddEntry()}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-border bg-[#faf9f6] px-3 text-[11px] font-bold text-ink transition hover:border-gold/60 hover:bg-white"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Bonus / Deduction / Advance
                </button>
              ) : null}
            </div>

            {/* Desktop register */}
            <div className="hidden lg:block">
              <div className="grid grid-cols-[minmax(240px,1.5fr)_0.75fr_0.9fr_0.8fr_0.8fr_0.8fr_110px_190px] items-center gap-3 border-b border-border bg-[#faf9f6] px-5 py-2.5 text-[9px] font-bold uppercase tracking-[0.1em] text-muted">
                <span>Team Member</span>
                <span>Base</span>
                <span>Extras</span>
                <span>Payable</span>
                <span>Paid</span>
                <span>Due</span>
                <span>Status</span>
                <span className="text-right">Actions</span>
              </div>

              <div className="divide-y divide-border">
                {filteredPayrollRows.length ? (
                  filteredPayrollRows.map((row) => {
                    const extras = row.projectEarnings + row.bonuses + row.otherEarnings;
                    return (
                      <div
                        key={row.profile.id}
                        className="grid grid-cols-[minmax(240px,1.5fr)_0.75fr_0.9fr_0.8fr_0.8fr_0.8fr_110px_190px] items-center gap-3 px-5 py-4 transition hover:bg-[#fcfbf8]"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar profile={row.profile} size="sm" showRoleRing />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-ink">{row.profile.full_name}</p>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="truncate text-[10px] capitalize text-muted">
                                {row.profile.role.replace('_', ' ')}
                              </span>
                              <span className="text-[9px] text-muted/60">·</span>
                              <span className="text-[9px] text-muted">
                                {row.entriesCount} entr{row.entriesCount === 1 ? 'y' : 'ies'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <p className="text-xs font-semibold text-charcoal">
                          {formatMoney(row.baseSalary, 'USD')}
                        </p>

                        <div>
                          <p className={`text-xs font-semibold ${extras > 0 ? 'text-emerald-700' : 'text-muted'}`}>
                            {extras > 0 ? '+' + formatMoney(extras, 'USD') : '—'}
                          </p>
                          {row.deductions > 0 ? (
                            <p className="mt-0.5 text-[9px] font-semibold text-rose-700">
                              −{formatMoney(row.deductions, 'USD')} deduction
                            </p>
                          ) : null}
                        </div>

                        <p className="font-display text-sm font-bold text-ink">
                          {formatMoney(row.totalPayable, 'USD')}
                        </p>

                        <p className="text-xs font-bold text-emerald-700">
                          {formatMoney(row.totalPaid, 'USD')}
                        </p>

                        <p className={`text-xs font-extrabold ${
                          row.outstanding > 0 ? 'text-amber-800' : 'text-muted'
                        }`}>
                          {formatMoney(row.outstanding, 'USD')}
                        </p>

                        <PayrollStatusBadge status={row.status} />

                        <div className="flex items-center justify-end gap-1.5">
                          {canManagePayroll && row.outstanding > 0 ? (
                            <button
                              type="button"
                              onClick={() => openRecordPayment(row.profile.id, row.outstanding)}
                              className="min-h-8 rounded-lg bg-emerald-700 px-2.5 text-[10px] font-bold text-white transition hover:bg-emerald-800"
                            >
                              Pay {formatMoney(row.outstanding, 'USD')}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setDetailModalProfileId(row.profile.id)}
                            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-white text-muted transition hover:border-gold/60 hover:text-ink"
                            title="Open payroll ledger"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {canManagePayroll ? (
                            <button
                              type="button"
                              onClick={() => openEditSalary(row.profile.id)}
                              className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-white text-muted transition hover:border-gold/60 hover:text-[#7a5518]"
                              title="Edit compensation"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-5 py-12 text-center">
                    <Users className="mx-auto h-7 w-7 text-muted/40" />
                    <p className="mt-2 text-sm font-semibold text-ink">No payroll records found</p>
                    <p className="mt-1 text-xs text-muted">Try another team member name or payroll status.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Tablet / mobile payroll cards */}
            <div className="grid gap-3 p-3 sm:p-4 lg:hidden">
              {filteredPayrollRows.length ? (
                filteredPayrollRows.map((row) => {
                  const extras = row.projectEarnings + row.bonuses + row.otherEarnings;
                  return (
                    <article
                      key={row.profile.id}
                      className="rounded-2xl border border-border bg-[#fcfbf8] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar profile={row.profile} size="sm" showRoleRing />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-ink">{row.profile.full_name}</p>
                            <p className="mt-0.5 text-[10px] capitalize text-muted">
                              {row.profile.role.replace('_', ' ')} · {row.entriesCount} payroll entr{row.entriesCount === 1 ? 'y' : 'ies'}
                            </p>
                          </div>
                        </div>
                        <PayrollStatusBadge status={row.status} />
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-xl border border-border bg-white p-2.5">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted">Payable</p>
                          <p className="mt-1 text-sm font-bold text-ink">{formatMoney(row.totalPayable, 'USD')}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-white p-2.5">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted">Paid</p>
                          <p className="mt-1 text-sm font-bold text-emerald-700">{formatMoney(row.totalPaid, 'USD')}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-white p-2.5">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted">Outstanding</p>
                          <p className={`mt-1 text-sm font-bold ${row.outstanding > 0 ? 'text-amber-800' : 'text-muted'}`}>
                            {formatMoney(row.outstanding, 'USD')}
                          </p>
                        </div>
                        <div className="rounded-xl border border-border bg-white p-2.5">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted">Extras</p>
                          <p className={`mt-1 text-sm font-bold ${extras > 0 ? 'text-emerald-700' : 'text-muted'}`}>
                            {extras > 0 ? '+' + formatMoney(extras, 'USD') : '—'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                        <div className="text-[10px] text-muted">
                          Base <span className="font-bold text-ink">{formatMoney(row.baseSalary, 'USD')}</span>
                          {row.deductions > 0 ? (
                            <span className="ml-2 font-semibold text-rose-700">
                              · −{formatMoney(row.deductions, 'USD')} deduction
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {canManagePayroll && row.outstanding > 0 ? (
                            <button
                              type="button"
                              onClick={() => openRecordPayment(row.profile.id, row.outstanding)}
                              className="min-h-9 rounded-lg bg-emerald-700 px-3 text-[10px] font-bold text-white"
                            >
                              Pay {formatMoney(row.outstanding, 'USD')}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setDetailModalProfileId(row.profile.id)}
                            className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-white text-muted"
                            title="Open payroll ledger"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {canManagePayroll ? (
                            <button
                              type="button"
                              onClick={() => openEditSalary(row.profile.id)}
                              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-white text-muted"
                              title="Edit compensation"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="py-10 text-center text-xs text-muted">
                  No payroll records match the current filters.
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: TEAM DIRECTORY & WORKLOAD */}
      {/* ========================================================================= */}
      {tab === 'directory' && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {overviewRows.map(({ profile, metrics, compensation: pay }) => (
              <Card key={profile.id} className="p-4 bg-white space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setAvatarTargetProfile(profile)}
                      className="relative group cursor-pointer"
                      title="Click to update DP"
                    >
                      <UserAvatar profile={profile} size="lg" showRoleRing showStatusDot />
                      <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-gold text-[9px] font-bold text-ink opacity-90 group-hover:scale-110 transition-transform">
                        <Camera className="h-2.5 w-2.5" />
                      </span>
                    </button>
                    <div>
                      <h4 className="font-display font-bold text-sm text-ink">{profile.full_name}</h4>
                      <RoleBadge role={profile.role} />
                    </div>
                  </div>
                  {canManagePayroll ? (
                    <button
                      type="button"
                      onClick={() => openEditSalary(profile.id)}
                      className="text-muted hover:text-gold p-1 rounded"
                      title="Edit Salary"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>

                <div className="space-y-1 text-xs text-muted pt-2 border-t border-border">
                  <p className="flex items-center gap-2 text-charcoal">
                    <Mail className="h-3.5 w-3.5 text-gold" /> {profile.email}
                  </p>
                  {profile.phone ? (
                    <p className="flex items-center gap-2 text-charcoal">
                      <Phone className="h-3.5 w-3.5 text-gold" /> {profile.phone}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs bg-ivory/50 p-2 rounded border border-border">
                  <div>
                    <span className="text-[10px] text-muted block">Active</span>
                    <span className="font-bold text-ink">{metrics.active.length}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block">Done Tasks</span>
                    <span className="font-bold text-emerald-700">{metrics.doneTasks.length}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block">Performance</span>
                    <span className="font-bold text-ink">{metrics.performance}%</span>
                  </div>
                </div>

                {canManagePayroll ? (
                  <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
                    <span className="text-muted">
                      Salary: <strong className="text-ink">{formatMoney(pay?.monthly_salary || 0, 'USD')}</strong>
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setDetailModalProfileId(profile.id)}
                      className="text-[11px] py-1 px-2.5"
                    >
                      <Eye className="h-3 w-3" /> View Ledger
                    </Button>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}
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

      {avatarTargetProfile && (
        <AvatarUploadModal
          isOpen={!!avatarTargetProfile}
          onClose={() => setAvatarTargetProfile(null)}
          profile={avatarTargetProfile}
          onSaveProfile={onUpdateProfile || (async () => {})}
        />
      )}

      {showAddEmployeeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-xl font-semibold flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-gold" />
                Add New Team Member
              </h3>
              <button
                type="button"
                onClick={() => setShowAddEmployeeModal(false)}
                className="text-muted hover:text-ink text-sm font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-muted mb-4">
              Pre-provision the team member's role. Ask them to sign up normally with this exact email and choose their own password.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!onAddEmployee) return;
                setAddEmployeeLoading(true);
                setAddEmployeeError(null);
                try {
                  const message = await onAddEmployee({
                    fullName: newEmployeeName,
                    email: newEmployeeEmail,
                    phone: newEmployeePhone,
                    role: newEmployeeRole,
                  });
                  setProvisionSuccess(message || 'Team member pre-provisioned. Ask them to sign up using this email.');
                  setNewEmployeeName('');
                  setNewEmployeeEmail('');
                  setNewEmployeePhone('');
                  setShowAddEmployeeModal(false);
                } catch (err: any) {
                  setAddEmployeeError(err.message || 'Failed to add team member.');
                } finally {
                  setAddEmployeeLoading(false);
                }
              }}
              className="space-y-4"
            >
              <Field
                label="Full Name"
                value={newEmployeeName}
                onChange={(e) => setNewEmployeeName(e.target.value)}
                placeholder="e.g. Usman Ali"
                required
              />
              <Field
                label="Email Address"
                type="email"
                value={newEmployeeEmail}
                onChange={(e) => setNewEmployeeEmail(e.target.value)}
                placeholder="e.g. usman@example.com"
                required
              />
              <SelectField
                label="Role"
                value={newEmployeeRole}
                onChange={(e) => setNewEmployeeRole(e.target.value as Role)}
              >
                <option value="employee">Book Formatter</option>
                <option value="project_manager">Manager</option>
                <option value="junior_assistant">Team Member</option>
              </SelectField>
              <Field
                label="Phone (optional)"
                type="tel"
                value={newEmployeePhone}
                onChange={(e) => setNewEmployeePhone(e.target.value)}
                placeholder="e.g. +92 300 1234567"
              />

              {addEmployeeError && (
                <p className="rounded-md bg-red-50 p-2.5 text-xs text-danger">{addEmployeeError}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowAddEmployeeModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={addEmployeeLoading}>
                  {addEmployeeLoading ? 'Pre-provisioning...' : 'Pre-provision Team Member'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

    </div>
  );
}
