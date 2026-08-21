import React, { useMemo, useState } from 'react';
import {
  CreditCard,
  Edit2,
  Plus,
  Trash2,
} from 'lucide-react';
import { PayrollStatusBadge, RoleBadge } from '../Badges';
import { Button, Card, Modal } from '../ui';
import { useCurrency } from '../../lib/currency';
import {
  calculateEmployeePayroll,
  formatMonthLabel,
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
  const [filterType, setFilterType] = useState<'all' | 'earnings' | 'advances' | 'payments'>('all');
  const [showHistoryTable, setShowHistoryTable] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const row = useMemo(
    () => calculateEmployeePayroll(profile, compensation, ledger, selectedMonth, convertMoney, displayCurrency),
    [profile, compensation, ledger, selectedMonth, convertMoney, displayCurrency],
  );

  const history = useMemo(
    () => getEmployeeHistory(profile, compensation, ledger, convertMoney, displayCurrency, 6),
    [profile, compensation, ledger, convertMoney, displayCurrency],
  );

  const filteredEntries = useMemo(() => {
    if (filterType === 'earnings') {
      return row.entries.filter((e) => e.entry_type === 'Project Payment' || e.entry_type === 'Bonus' || e.entry_type === 'Salary');
    }
    if (filterType === 'advances') {
      return row.entries.filter((e) => e.entry_type === 'Advance' || e.entry_type === 'Deduction');
    }
    if (filterType === 'payments') {
      return row.entries.filter((e) => e.entry_type === 'Payment');
    }
    return row.entries;
  }, [row.entries, filterType]);

  async function handleDelete(entryId: string) {
    if (!onDeleteEntry) return;
    const confirmed = window.confirm('Delete this entry?');
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
    return p ? `${p.project_number}` : null;
  }

  return (
    <Modal
      title={`${profile.full_name} — Details & Ledger (${formatMonthLabel(selectedMonth)})`}
      onClose={onClose}
      width="max-w-3xl"
    >
      <div className="space-y-4 text-xs">
        {/* Header Profile & Quick Action Strip */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-border bg-ivory/50 p-3.5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-gold/20 font-bold text-ink text-base">
              {profile.full_name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base font-bold text-ink">{profile.full_name}</h3>
                <RoleBadge role={profile.role} />
                <PayrollStatusBadge status={row.status} />
              </div>
              <p className="text-[11px] text-muted mt-0.5">
                Base Monthly: <strong className="text-ink">{formatMoney(row.baseSalary, 'USD')}</strong>
                {compensation?.per_project_rate ? ` • Per Project: ${formatMoney(compensation.per_project_rate, 'USD')}` : ''}
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
                <Edit2 className="h-3 w-3" /> Edit Salary
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenAddEntry(profile.id)}
                className="text-xs py-1.5 px-2.5"
              >
                <Plus className="h-3 w-3" /> Add Entry
              </Button>
              {row.outstanding > 0 ? (
                <Button
                  type="button"
                  onClick={() => onOpenRecordPayment(profile.id, row.outstanding)}
                  className="text-xs py-1.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white"
                >
                  <CreditCard className="h-3 w-3" /> Pay {formatMoney(row.outstanding, 'USD')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 4 Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <Card className="p-3 bg-white">
            <span className="text-[10px] text-muted uppercase font-bold">Base Pay</span>
            <p className="text-base font-bold text-ink mt-0.5">{formatMoney(row.baseSalary, 'USD')}</p>
          </Card>
          <Card className="p-3 bg-white">
            <span className="text-[10px] text-muted uppercase font-bold">Commissions & Extra</span>
            <p className="text-base font-bold text-emerald-700 mt-0.5">
              +{formatMoney(row.projectEarnings + row.bonuses + row.otherEarnings, 'USD')}
            </p>
          </Card>
          <Card className="p-3 bg-white">
            <span className="text-[10px] text-muted uppercase font-bold">Total Paid</span>
            <p className="text-base font-bold text-emerald-700 mt-0.5">{formatMoney(row.totalPaid, 'USD')}</p>
          </Card>
          <Card className="p-3 bg-white border border-amber-300 bg-amber-50/40">
            <span className="text-[10px] text-amber-900 uppercase font-bold">Outstanding Due</span>
            <p className={`text-base font-extrabold mt-0.5 ${row.outstanding > 0 ? 'text-amber-900' : 'text-muted'}`}>
              {formatMoney(row.outstanding, 'USD')}
            </p>
          </Card>
        </div>

        {/* Ledger & Transactions Section */}
        <div className="rounded-xl border border-border bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <h4 className="font-bold text-ink text-sm">
              Transactions for {formatMonthLabel(selectedMonth)}
            </h4>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 bg-ivory p-1 rounded-lg border border-border/60">
              {(
                [
                  ['all', 'All'],
                  ['earnings', 'Earnings'],
                  ['advances', 'Advances & Deductions'],
                  ['payments', 'Payments'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterType(key)}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition ${
                    filterType === key
                      ? 'bg-white shadow-xs text-ink font-bold'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {filteredEntries.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted border-b border-border bg-ivory/30">
                  <tr>
                    <th className="py-2 px-2">Date</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Details</th>
                    <th className="py-2 text-right">Amount</th>
                    {canManage ? <th className="py-2 text-right px-2">Action</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredEntries.map((item) => {
                    const isPayment = item.entry_type === 'Payment';
                    const isDeduction = item.entry_type === 'Deduction';
                    const isAdvance = item.entry_type === 'Advance';
                    const isEarning =
                      item.entry_type === 'Project Payment' ||
                      item.entry_type === 'Bonus' ||
                      item.entry_type === 'Salary';

                    const projName = getProjectName(item.project_id);

                    return (
                      <tr key={item.id} className="hover:bg-ivory/20 transition">
                        <td className="py-2.5 px-2 font-medium">{formatDate(item.paid_at)}</td>
                        <td className="py-2.5">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold border ${
                              isPayment
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : isAdvance
                                  ? 'bg-purple-50 text-purple-800 border-purple-200'
                                  : isDeduction
                                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                                    : 'bg-gold/10 text-ink border-gold/30'
                            }`}
                          >
                            {item.entry_type}
                          </span>
                        </td>
                        <td className="py-2.5 text-charcoal">
                          <span>{item.notes || item.description || '—'}</span>
                          {projName ? (
                            <span className="ml-1.5 text-[10px] bg-ivory px-1.5 py-0.5 rounded border border-border text-muted">
                              Proj: {projName}
                            </span>
                          ) : null}
                          {item.payment_method ? (
                            <span className="ml-1.5 text-[10px] text-muted">via {item.payment_method}</span>
                          ) : null}
                        </td>
                        <td
                          className={`py-2.5 text-right font-bold ${
                            isDeduction
                              ? 'text-danger'
                              : isPayment || isEarning
                                ? 'text-emerald-700'
                                : 'text-ink'
                          }`}
                        >
                          {isDeduction ? '-' : isEarning ? '+' : ''}
                          {formatMoney(item.amount, item.currency || 'USD')}
                        </td>
                        {canManage ? (
                          <td className="py-2.5 text-right px-2">
                            <button
                              type="button"
                              onClick={() => handleDelete(item.id)}
                              disabled={deletingId === item.id}
                              className="text-muted hover:text-danger p-1"
                              title="Delete entry"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-6 text-center text-muted">
              No transactions recorded in this category for {formatMonthLabel(selectedMonth)}.
            </div>
          )}
        </div>

        {/* Multi-Month History Accordion */}
        <div className="rounded-xl border border-border bg-white p-3">
          <button
            type="button"
            onClick={() => setShowHistoryTable(!showHistoryTable)}
            className="flex w-full items-center justify-between font-bold text-xs text-ink hover:text-gold transition"
          >
            <span>📅 Past 6 Months Summary</span>
            <span className="text-[11px] text-muted">{showHistoryTable ? '▲ Hide' : '▼ Show'}</span>
          </button>

          {showHistoryTable && (
            <div className="mt-3 overflow-x-auto pt-2 border-t border-border">
              <table className="w-full text-left text-xs">
                <thead className="text-muted border-b border-border bg-ivory/30">
                  <tr>
                    <th className="py-2 px-2">Month</th>
                    <th>Base Pay</th>
                    <th>Commissions</th>
                    <th>Payable</th>
                    <th>Paid</th>
                    <th>Outstanding</th>
                    <th className="text-right px-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((h) => (
                    <tr key={h.month} className="hover:bg-ivory/20">
                      <td className="py-2 px-2 font-bold text-ink">{h.monthLabel}</td>
                      <td>{formatMoney(h.baseSalary, 'USD')}</td>
                      <td>+{formatMoney(h.projectEarnings + h.bonuses, 'USD')}</td>
                      <td className="font-semibold text-ink">{formatMoney(h.payable, 'USD')}</td>
                      <td className="text-emerald-700 font-semibold">{formatMoney(h.paid, 'USD')}</td>
                      <td className={`font-bold ${h.outstanding > 0 ? 'text-amber-900' : 'text-muted'}`}>
                        {formatMoney(h.outstanding, 'USD')}
                      </td>
                      <td className="text-right px-2">
                        <PayrollStatusBadge status={h.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
