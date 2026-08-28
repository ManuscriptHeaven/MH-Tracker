import React, { useMemo, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  DollarSign,
  Edit2,
  Eye,
  Mail,
  Phone,
  Plus,
  Search,
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
  onAddEmployee?: (employeeData: { fullName: string; email: string; password: string; role: Role }) => Promise<void>;
}) {
  const { formatMoney, convertMoney, displayCurrency } = useCurrency();
  const [tab, setTab] = useState<Tab>('payroll');
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
  const [newEmployeePassword, setNewEmployeePassword] = useState('');
  const [newEmployeeRole, setNewEmployeeRole] = useState<Role>('employee');
  const [addEmployeeLoading, setAddEmployeeLoading] = useState(false);
  const [addEmployeeError, setAddEmployeeError] = useState<string | null>(null);

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

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* 1. Sleek Navigation Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-3 rounded-xl border border-border">
        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 bg-ivory p-1 rounded-lg border border-border/60">
          <button
            type="button"
            onClick={() => setTab('payroll')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-bold transition ${
              tab === 'payroll'
                ? 'bg-white text-ink shadow-xs'
                : 'text-muted hover:text-ink'
            }`}
          >
            <DollarSign className="h-3.5 w-3.5 text-gold" />
            Payroll & Dues
          </button>
          <button
            type="button"
            onClick={() => setTab('directory')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-bold transition ${
              tab === 'directory'
                ? 'bg-white text-ink shadow-xs'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Users className="h-3.5 w-3.5 text-gold" />
            Team Directory & Workload
          </button>
        </div>

        {/* Global Action Buttons */}
        {canManagePayroll ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAddEmployeeError(null);
                setShowAddEmployeeModal(true);
              }}
              className="text-xs py-2 px-3.5 shadow-sm"
            >
              <UserPlus className="h-3.5 w-3.5" />
              + Add New Employee
            </Button>
            <Button
              type="button"
              onClick={() => openAddEntry()}
              className="text-xs py-2 px-3.5 shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              + Add Entry / Bonus / Advance
            </Button>
          </div>
        ) : null}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: PAYROLL & DUES (EASY TO USE) */}
      {/* ========================================================================= */}
      {tab === 'payroll' && (
        <div className="space-y-4">
          {/* Top Month Selector Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-3.5 rounded-xl border border-border">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-muted uppercase tracking-wider">Payroll Period:</span>
              <div className="flex items-center gap-1 bg-ivory px-2 py-1 rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setSelectedMonth(getPreviousMonth(selectedMonth))}
                  className="p-1 rounded hover:bg-white text-muted hover:text-ink transition"
                  title="Previous Month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="font-display font-bold text-sm text-ink px-2">
                  {formatMonthLabel(selectedMonth)}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedMonth(getNextMonth(selectedMonth))}
                  className="p-1 rounded hover:bg-white text-muted hover:text-ink transition"
                  title="Next Month"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMonth(normalizeMonth())}
                className="text-[11px] font-semibold text-gold hover:underline px-1"
              >
                Current Month
              </button>
            </div>

            {/* Quick Search */}
            <div className="relative min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
              <input
                type="text"
                placeholder="Search team member..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-ivory/50 pl-8 pr-3 text-xs focus:bg-white focus:border-gold focus:outline-none"
              />
            </div>
          </div>

          {/* 4 Clear Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-3.5 bg-white border-l-4 border-l-gold">
              <span className="text-[10px] uppercase font-bold text-muted tracking-wider block">Total Payroll</span>
              <p className="text-xl font-bold text-ink mt-0.5">{formatMoney(payrollStats.totalPayroll, 'USD')}</p>
              <span className="text-[10px] text-muted">What is owed for {formatMonthLabel(selectedMonth)}</span>
            </Card>

            <Card className="p-3.5 bg-white border-l-4 border-l-emerald-500">
              <span className="text-[10px] uppercase font-bold text-muted tracking-wider block">Total Paid</span>
              <p className="text-xl font-bold text-emerald-700 mt-0.5">{formatMoney(payrollStats.totalPaid, 'USD')}</p>
              <span className="text-[10px] text-muted">Disbursed this month</span>
            </Card>

            <Card className="p-3.5 bg-white border-l-4 border-l-amber-500">
              <span className="text-[10px] uppercase font-bold text-amber-900 tracking-wider block">Outstanding Dues</span>
              <p className={`text-xl font-extrabold mt-0.5 ${payrollStats.totalOutstanding > 0 ? 'text-amber-900' : 'text-muted'}`}>
                {formatMoney(payrollStats.totalOutstanding, 'USD')}
              </p>
              <span className="text-[10px] text-muted">
                {payrollStats.totalOutstanding === 0 ? 'All cleared' : 'Remaining to disburse'}
              </span>
            </Card>

            <Card className="p-3.5 bg-white border-l-4 border-l-purple-500">
              <span className="text-[10px] uppercase font-bold text-muted tracking-wider block">Advances</span>
              <p className="text-xl font-bold text-purple-800 mt-0.5">{formatMoney(payrollStats.totalAdvances, 'USD')}</p>
              <span className="text-[10px] text-muted">Active loans/advances</span>
            </Card>
          </div>

          {/* Clean Main Table */}
          <Card className="p-0 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-ivory/30 flex items-center justify-between">
              <span className="font-bold text-xs text-ink">
                Team Member Payrolls ({filteredPayrollRows.length})
              </span>
              <SelectField
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-7 text-[11px] w-32"
              >
                <option value="all">All Statuses</option>
                <option value="Paid">Paid</option>
                <option value="Partially Paid">Partially Paid</option>
                <option value="Pending">Pending</option>
                <option value="Overdue">Overdue</option>
              </SelectField>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted border-b border-border bg-ivory/10">
                  <tr>
                    <th className="py-2.5 px-4 font-bold">Employee</th>
                    <th className="py-2.5 font-bold">Base Pay</th>
                    <th className="py-2.5 font-bold">Commissions & Extra</th>
                    <th className="py-2.5 font-bold">Total Payable</th>
                    <th className="py-2.5 font-bold">Total Paid</th>
                    <th className="py-2.5 font-bold">Outstanding</th>
                    <th className="py-2.5 font-bold">Status</th>
                    <th className="py-2.5 px-4 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredPayrollRows.length ? (
                    filteredPayrollRows.map((row) => (
                      <tr key={row.profile.id} className="hover:bg-ivory/20 transition">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <UserAvatar profile={row.profile} size="sm" showRoleRing />
                            <div>
                              <p className="font-bold text-ink">{row.profile.full_name}</p>
                              <p className="text-[10px] text-muted capitalize">{row.profile.role}</p>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 font-semibold text-charcoal">
                          {formatMoney(row.baseSalary, 'USD')}
                        </td>

                        <td className="py-3 text-emerald-700 font-semibold">
                          {row.projectEarnings + row.bonuses > 0
                            ? `+${formatMoney(row.projectEarnings + row.bonuses, 'USD')}`
                            : '—'}
                          {row.deductions > 0 ? (
                            <span className="block text-[10px] text-danger">-{formatMoney(row.deductions, 'USD')} ded.</span>
                          ) : null}
                        </td>

                        <td className="py-3 font-bold text-ink">{formatMoney(row.totalPayable, 'USD')}</td>

                        <td className="py-3 font-bold text-emerald-700">{formatMoney(row.totalPaid, 'USD')}</td>

                        <td className="py-3">
                          <span
                            className={`font-extrabold ${
                              row.outstanding > 0 ? 'text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200' : 'text-muted'
                            }`}
                          >
                            {formatMoney(row.outstanding, 'USD')}
                          </span>
                        </td>

                        <td className="py-3">
                          <PayrollStatusBadge status={row.status} />
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {canManagePayroll && row.outstanding > 0 ? (
                              <button
                                type="button"
                                onClick={() => openRecordPayment(row.profile.id, row.outstanding)}
                                className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] px-2.5 py-1 rounded shadow-xs transition"
                                title={`Record payment for ${row.profile.full_name}`}
                              >
                                Pay {formatMoney(row.outstanding, 'USD')}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => setDetailModalProfileId(row.profile.id)}
                              className="bg-ivory hover:bg-white text-ink border border-border font-semibold text-[11px] px-2.5 py-1 rounded transition"
                              title="View Ledger & History"
                            >
                              Ledger
                            </button>
                            {canManagePayroll ? (
                              <button
                                type="button"
                                onClick={() => openEditSalary(row.profile.id)}
                                className="p-1 text-muted hover:text-gold rounded hover:bg-ivory transition"
                                title="Edit salary configuration"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted">
                        No team payroll records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="block md:hidden divide-y divide-border">
              {filteredPayrollRows.map((row) => (
                <div key={row.profile.id} className="p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <UserAvatar profile={row.profile} size="sm" showRoleRing />
                      <div>
                        <p className="font-bold text-ink text-xs">{row.profile.full_name}</p>
                        <p className="text-[10px] text-muted capitalize">{row.profile.role}</p>
                      </div>
                    </div>
                    <PayrollStatusBadge status={row.status} />
                  </div>

                  <div className="grid grid-cols-3 gap-2 bg-ivory/50 p-2 rounded border border-border text-[11px]">
                    <div>
                      <span className="text-muted block text-[10px]">Payable</span>
                      <span className="font-bold text-ink">{formatMoney(row.totalPayable, 'USD')}</span>
                    </div>
                    <div>
                      <span className="text-muted block text-[10px]">Paid</span>
                      <span className="font-bold text-emerald-700">{formatMoney(row.totalPaid, 'USD')}</span>
                    </div>
                    <div>
                      <span className="text-muted block text-[10px]">Due</span>
                      <span className={`font-bold ${row.outstanding > 0 ? 'text-amber-900' : 'text-muted'}`}>
                        {formatMoney(row.outstanding, 'USD')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    {canManagePayroll && row.outstanding > 0 ? (
                      <button
                        type="button"
                        onClick={() => openRecordPayment(row.profile.id, row.outstanding)}
                        className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs px-3 py-1 rounded shadow-xs"
                      >
                        Pay {formatMoney(row.outstanding, 'USD')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setDetailModalProfileId(row.profile.id)}
                      className="bg-ivory hover:bg-white text-ink border border-border font-semibold text-xs px-2.5 py-1 rounded"
                    >
                      Ledger
                    </button>
                    {canManagePayroll ? (
                      <button
                        type="button"
                        onClick={() => openEditSalary(row.profile.id)}
                        className="p-1 text-muted hover:text-gold border border-border rounded"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Card>
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
                Add New Employee
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
              Create a new employee account. This will create their profile in Supabase so they can log in.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!onAddEmployee) return;
                setAddEmployeeLoading(true);
                setAddEmployeeError(null);
                try {
                  await onAddEmployee({
                    fullName: newEmployeeName,
                    email: newEmployeeEmail,
                    password: newEmployeePassword,
                    role: newEmployeeRole,
                  });
                  setNewEmployeeName('');
                  setNewEmployeeEmail('');
                  setNewEmployeePassword('');
                  setShowAddEmployeeModal(false);
                } catch (err: any) {
                  setAddEmployeeError(err.message || 'Failed to add employee.');
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
                <option value="employee">Employee / Staff Member</option>
                <option value="project_manager">Project Manager</option>
                <option value="junior_assistant">Junior Assistant</option>
                <option value="admin">Administrator</option>
              </SelectField>
              <Field
                label="Password"
                type="password"
                value={newEmployeePassword}
                onChange={(e) => setNewEmployeePassword(e.target.value)}
                placeholder="Initial password for employee"
                required
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
                  {addEmployeeLoading ? 'Creating...' : 'Create Employee'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
