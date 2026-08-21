import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CreditCard,
  DollarSign,
  Edit2,
  FileText,
  History,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
  User,
} from 'lucide-react';
import { PayrollStatusBadge, RoleBadge } from '../Badges';
import { Button, Card, Modal } from '../ui';
import { useCurrency } from '../../lib/currency';
import {
  calculateEmployeePayroll,
  formatMonthLabel,
  getEmployeeAdvances,
  getEmployeeHistory,
} from '../../lib/payrollUtils';
import type { EmployeeCompensation, EmployeeLedgerEntry, Profile, Project } from '../../lib/types';
import { formatDate } from '../../lib/date';

export function EmployeePayrollDetailModal({
  profile,
  compensation,
  ledger,
  projects,
  selectedMonth,
  canManage,
  onClose,
  onOpenAddEntry,
  onOpenRecordPayment,
  onOpenEditSalary,
  onDeleteEntry,
}: {
  profile: Profile;
  compensation?: EmployeeCompensation;
  ledger: EmployeeLedgerEntry[];
  projects: Project[];
  selectedMonth: string;
  canManage: boolean;
  onClose: () => void;
  onOpenAddEntry: (employeeId: string, defaultType?: EmployeeLedgerEntry['entry_type']) => void;
  onOpenRecordPayment: (employeeId: string, suggestedAmount?: number) => void;
  onOpenEditSalary: (employeeId: string) => void;
  onDeleteEntry?: (entryId: string) => Promise<void>;
}) {
  const { formatMoney, convertMoney, displayCurrency } = useCurrency();
  const [activeTab, setActiveTab] = useState<'overview' | 'earnings' | 'advances' | 'deductions' | 'payments' | 'history'>('overview');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const row = useMemo(
    () => calculateEmployeePayroll(profile, compensation, ledger, selectedMonth, convertMoney, displayCurrency),
    [profile, compensation, ledger, selectedMonth, convertMoney, displayCurrency],
  );

  const history = useMemo(
    () => getEmployeeHistory(profile, compensation, ledger, convertMoney, displayCurrency, 6),
    [profile, compensation, ledger, convertMoney, displayCurrency],
  );

  const advancesList = useMemo(
    () => getEmployeeAdvances(profile.id, ledger, convertMoney, displayCurrency),
    [profile.id, ledger, convertMoney, displayCurrency],
  );

  const earningsEntries = useMemo(
    () => row.entries.filter((e) => e.entry_type === 'Project Payment' || e.entry_type === 'Bonus' || e.entry_type === 'Salary' || e.entry_type === 'Other'),
    [row.entries],
  );

  const deductionEntries = useMemo(
    () => row.entries.filter((e) => e.entry_type === 'Deduction'),
    [row.entries],
  );

  const paymentEntries = useMemo(
    () => row.entries.filter((e) => e.entry_type === 'Payment'),
    [row.entries],
  );

  async function handleDelete(entryId: string) {
    if (!onDeleteEntry) return;
    const confirmed = window.confirm('Are you sure you want to delete this payroll transaction?');
    if (!confirmed) return;
    try {
      setDeletingId(entryId);
      await onDeleteEntry(entryId);
    } finally {
      setDeletingId(null);
    }
  }

  function getProjectName(projectId?: string | null) {
    if (!projectId) return null;
    const p = projects.find((item) => item.id === projectId);
    return p ? `${p.project_number} (${p.project_title})` : null;
  }

  return (
    <Modal
      title={`${profile.full_name} — Payroll & Dues (${formatMonthLabel(selectedMonth)})`}
      onClose={onClose}
      width="max-w-4xl"
    >
      <div className="space-y-5">
        {/* Header Summary Strip */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 rounded-xl border border-border bg-ivory/60 p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-gold/20 font-bold text-ink text-lg">
              {profile.full_name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-lg font-bold text-ink">{profile.full_name}</h3>
                <RoleBadge role={profile.role} />
                <PayrollStatusBadge status={row.status} />
              </div>
              <p className="text-xs text-muted mt-0.5">
                {row.salaryType} Salary: <strong>{formatMoney(row.baseSalary, 'USD')}</strong>
                {compensation?.per_project_rate ? ` • Per Project Rate: ${formatMoney(compensation.per_project_rate, 'USD')}` : ''}
              </p>
            </div>
          </div>

          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenEditSalary(profile.id)}
                className="text-xs py-1.5 px-2.5"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit Salary
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenAddEntry(profile.id)}
                className="text-xs py-1.5 px-2.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Entry
              </Button>
              <Button
                type="button"
                onClick={() => onOpenRecordPayment(profile.id, row.outstanding)}
                className="text-xs py-1.5 px-3"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Record Payment
              </Button>
            </div>
          ) : null}
        </div>

        {/* 4-Stat Metric Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-3 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">Total Payable</span>
            <p className="text-lg font-bold text-ink mt-0.5">{formatMoney(row.totalPayable, 'USD')}</p>
          </Card>
          <Card className="p-3 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">Total Paid</span>
            <p className="text-lg font-bold text-emerald-700 mt-0.5">{formatMoney(row.totalPaid, 'USD')}</p>
          </Card>
          <Card className="p-3 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">Outstanding</span>
            <p className={`text-lg font-bold mt-0.5 ${row.outstanding > 0 ? 'text-amber-900' : 'text-muted'}`}>
              {formatMoney(row.outstanding, 'USD')}
            </p>
          </Card>
          <Card className="p-3 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">Advances</span>
            <p className="text-lg font-bold text-purple-800 mt-0.5">{formatMoney(row.advances, 'USD')}</p>
          </Card>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-border overflow-x-auto pb-1 text-xs">
          {([
            ['overview', 'Overview'],
            ['earnings', `Earnings (${earningsEntries.length})`],
            ['advances', `Advances (${advancesList.length})`],
            ['deductions', `Deductions (${deductionEntries.length})`],
            ['payments', `Payments (${paymentEntries.length})`],
            ['history', 'Multi-Month History'],
          ] as const).map(([tabKey, label]) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setActiveTab(tabKey)}
              className={`px-3 py-2 font-semibold rounded-t-lg transition shrink-0 ${
                activeTab === tabKey
                  ? 'border-b-2 border-gold text-ink bg-white font-bold'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-4 text-xs">
            <div className="rounded-lg border border-border bg-white p-4">
              <h4 className="font-display text-sm font-bold text-ink mb-3">Calculation Breakdown ({formatMonthLabel(selectedMonth)})</h4>
              <div className="space-y-2">
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted">Base Salary:</span>
                  <span className="font-semibold">{formatMoney(row.baseSalary, 'USD')}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted">+ Project Earnings:</span>
                  <span className="font-semibold text-emerald-700">+{formatMoney(row.projectEarnings, 'USD')}</span>
                </div>
                {row.bonuses > 0 ? (
                  <div className="flex justify-between py-1 border-b border-border/40">
                    <span className="text-muted">+ Bonuses / Extras:</span>
                    <span className="font-semibold text-emerald-700">+{formatMoney(row.bonuses, 'USD')}</span>
                  </div>
                ) : null}
                {row.otherEarnings > 0 ? (
                  <div className="flex justify-between py-1 border-b border-border/40">
                    <span className="text-muted">+ Other Payables:</span>
                    <span className="font-semibold text-emerald-700">+{formatMoney(row.otherEarnings, 'USD')}</span>
                  </div>
                ) : null}
                {row.deductions > 0 ? (
                  <div className="flex justify-between py-1 border-b border-border/40">
                    <span className="text-muted">- Deductions:</span>
                    <span className="font-semibold text-danger">-{formatMoney(row.deductions, 'USD')}</span>
                  </div>
                ) : null}
                <div className="flex justify-between py-1.5 border-t border-border font-bold text-sm bg-ivory/50 px-2 rounded">
                  <span>Total Payable:</span>
                  <span>{formatMoney(row.totalPayable, 'USD')}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted">- Total Paid:</span>
                  <span className="font-semibold text-emerald-700">-{formatMoney(row.totalPaid, 'USD')}</span>
                </div>
                <div className="flex justify-between py-2 border-t-2 border-border font-bold text-sm text-amber-900 bg-amber-50/50 px-2 rounded">
                  <span>Net Outstanding:</span>
                  <span>{formatMoney(row.outstanding, 'USD')}</span>
                </div>
              </div>
            </div>

            {/* Recent Entries */}
            <div className="rounded-lg border border-border bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-display text-sm font-bold text-ink">All Entries for {formatMonthLabel(selectedMonth)}</h4>
                {canManage ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => onOpenAddEntry(profile.id)}
                    className="text-xs py-1 px-2.5"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Entry
                  </Button>
                ) : null}
              </div>

              {row.entries.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted border-b border-border">
                      <tr>
                        <th className="pb-2">Date</th>
                        <th>Type</th>
                        <th>Project</th>
                        <th>Description</th>
                        <th className="text-right">Amount</th>
                        {canManage ? <th className="text-right">Actions</th> : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {row.entries.map((item) => (
                        <tr key={item.id} className="hover:bg-ivory/40">
                          <td className="py-2.5 font-medium">{formatDate(item.paid_at)}</td>
                          <td>
                            <span className="inline-block rounded px-2 py-0.5 text-[10px] font-semibold bg-ivory border border-border">
                              {item.entry_type}
                            </span>
                          </td>
                          <td className="text-muted">{getProjectName(item.project_id) || '—'}</td>
                          <td className="max-w-[200px] truncate text-charcoal">{item.notes || item.description || '—'}</td>
                          <td className="text-right font-bold text-ink">
                            {formatMoney(item.amount, item.currency || 'USD')}
                          </td>
                          {canManage ? (
                            <td className="text-right">
                              <button
                                type="button"
                                onClick={() => handleDelete(item.id)}
                                disabled={deletingId === item.id}
                                className="text-muted hover:text-danger p-1"
                                title="Delete entry"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted text-center py-4">No manual entries recorded for this month.</p>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: EARNINGS */}
        {activeTab === 'earnings' && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <p className="text-muted">Project earnings, bonuses, and milestone bonuses for {formatMonthLabel(selectedMonth)}.</p>
              {canManage ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onOpenAddEntry(profile.id, 'Project Payment')}
                  className="text-xs py-1 px-2.5"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Project Earning
                </Button>
              ) : null}
            </div>

            {earningsEntries.length ? (
              <div className="rounded-lg border border-border bg-white overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted border-b border-border bg-ivory/50">
                    <tr>
                      <th className="p-2.5">Date</th>
                      <th>Type</th>
                      <th>Linked Project</th>
                      <th>Description</th>
                      <th className="text-right p-2.5">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {earningsEntries.map((item) => (
                      <tr key={item.id} className="hover:bg-ivory/30">
                        <td className="p-2.5 font-medium">{formatDate(item.paid_at)}</td>
                        <td>{item.entry_type}</td>
                        <td className="text-muted">{getProjectName(item.project_id) || '—'}</td>
                        <td className="text-charcoal">{item.notes || item.description || '—'}</td>
                        <td className="text-right font-bold text-emerald-700 p-2.5">
                          +{formatMoney(item.amount, item.currency || 'USD')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-white p-6 text-center text-muted">
                No project earnings or bonuses recorded for {formatMonthLabel(selectedMonth)}.
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ADVANCES */}
        {activeTab === 'advances' && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <p className="text-muted">Complete advances ledger and repayment tracking.</p>
              {canManage ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onOpenAddEntry(profile.id, 'Advance')}
                  className="text-xs py-1 px-2.5"
                >
                  <Plus className="h-3.5 w-3.5" /> Record New Advance
                </Button>
              ) : null}
            </div>

            {advancesList.length ? (
              <div className="rounded-lg border border-border bg-white overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted border-b border-border bg-ivory/50">
                    <tr>
                      <th className="p-2.5">Date</th>
                      <th>Reason / Notes</th>
                      <th>Status</th>
                      <th className="text-right">Advance Amount</th>
                      <th className="text-right">Repaid</th>
                      <th className="text-right p-2.5">Remaining</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {advancesList.map((item) => (
                      <tr key={item.id} className="hover:bg-ivory/30">
                        <td className="p-2.5 font-medium">{formatDate(item.date)}</td>
                        <td className="text-charcoal">{item.reason}</td>
                        <td>
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold border ${
                              item.status === 'Fully Repaid'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : item.status === 'Partially Repaid'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-purple-50 text-purple-800 border-purple-200'
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="text-right font-semibold text-ink">{formatMoney(item.amount, item.currency)}</td>
                        <td className="text-right text-emerald-700">{formatMoney(item.repaid_amount, item.currency)}</td>
                        <td className="text-right font-bold text-amber-900 p-2.5">
                          {formatMoney(item.remaining_amount, item.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-white p-6 text-center text-muted">
                No advance history on record for this employee.
              </div>
            )}
          </div>
        )}

        {/* TAB 4: DEDUCTIONS */}
        {activeTab === 'deductions' && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <p className="text-muted">Recorded deductions and advance repayments for {formatMonthLabel(selectedMonth)}.</p>
              {canManage ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onOpenAddEntry(profile.id, 'Deduction')}
                  className="text-xs py-1 px-2.5"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Deduction
                </Button>
              ) : null}
            </div>

            {deductionEntries.length ? (
              <div className="rounded-lg border border-border bg-white overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted border-b border-border bg-ivory/50">
                    <tr>
                      <th className="p-2.5">Date</th>
                      <th>Reason / Description</th>
                      <th>Notes</th>
                      <th className="text-right p-2.5">Deduction Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {deductionEntries.map((item) => (
                      <tr key={item.id} className="hover:bg-ivory/30">
                        <td className="p-2.5 font-medium">{formatDate(item.paid_at)}</td>
                        <td className="text-ink font-semibold">{item.notes || item.description || 'Deduction'}</td>
                        <td className="text-muted">{item.notes || '—'}</td>
                        <td className="text-right font-bold text-danger p-2.5">
                          -{formatMoney(item.amount, item.currency || 'USD')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-white p-6 text-center text-muted">
                No deductions recorded for {formatMonthLabel(selectedMonth)}.
              </div>
            )}
          </div>
        )}

        {/* TAB 5: PAYMENTS */}
        {activeTab === 'payments' && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <p className="text-muted">Salary and dues payments recorded for {formatMonthLabel(selectedMonth)}.</p>
              {canManage ? (
                <Button
                  type="button"
                  onClick={() => onOpenRecordPayment(profile.id, row.outstanding)}
                  className="text-xs py-1 px-2.5"
                >
                  <CreditCard className="h-3.5 w-3.5" /> Record Payment
                </Button>
              ) : null}
            </div>

            {paymentEntries.length ? (
              <div className="rounded-lg border border-border bg-white overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted border-b border-border bg-ivory/50">
                    <tr>
                      <th className="p-2.5">Date</th>
                      <th>Payment Method</th>
                      <th>Reference</th>
                      <th>Notes</th>
                      <th className="text-right p-2.5">Amount Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paymentEntries.map((item) => (
                      <tr key={item.id} className="hover:bg-ivory/30">
                        <td className="p-2.5 font-medium">{formatDate(item.paid_at)}</td>
                        <td className="font-semibold text-ink">{item.payment_method || 'Bank Transfer'}</td>
                        <td className="text-muted font-mono">{item.reference || '—'}</td>
                        <td className="text-charcoal">{item.notes || '—'}</td>
                        <td className="text-right font-bold text-emerald-700 p-2.5">
                          {formatMoney(item.amount, item.currency || 'USD')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-white p-6 text-center text-muted">
                No payments recorded for {formatMonthLabel(selectedMonth)}.
              </div>
            )}
          </div>
        )}

        {/* TAB 6: MULTI-MONTH HISTORY */}
        {activeTab === 'history' && (
          <div className="space-y-3 text-xs">
            <p className="text-muted">Summary of previous 6 months payroll ledger and payment statuses.</p>
            <div className="rounded-lg border border-border bg-white overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted border-b border-border bg-ivory/50">
                  <tr>
                    <th className="p-2.5">Month</th>
                    <th>Base Salary</th>
                    <th>Earnings</th>
                    <th>Advances</th>
                    <th>Deductions</th>
                    <th>Total Payable</th>
                    <th>Total Paid</th>
                    <th>Outstanding</th>
                    <th className="text-right p-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((item) => (
                    <tr key={item.month} className="hover:bg-ivory/30">
                      <td className="p-2.5 font-bold text-ink">{item.monthLabel}</td>
                      <td>{formatMoney(item.baseSalary, 'USD')}</td>
                      <td>{formatMoney(item.projectEarnings, 'USD')}</td>
                      <td>{formatMoney(item.advances, 'USD')}</td>
                      <td>{formatMoney(item.deductions, 'USD')}</td>
                      <td className="font-semibold">{formatMoney(item.payable, 'USD')}</td>
                      <td className="text-emerald-700 font-semibold">{formatMoney(item.paid, 'USD')}</td>
                      <td className={`font-bold ${item.outstanding > 0 ? 'text-amber-900' : 'text-muted'}`}>
                        {formatMoney(item.outstanding, 'USD')}
                      </td>
                      <td className="text-right p-2.5">
                        <PayrollStatusBadge status={item.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="flex justify-end pt-3 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
