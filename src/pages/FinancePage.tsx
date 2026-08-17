import {
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  ChevronRight,
  DollarSign,
  Download,
  Plus,
  Printer,
  Search,
  TrendingUp,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, Field, Modal, SelectField, TextareaField } from '../components/ui';
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  calculateClientBalances,
  calculateMonthlyReports,
  calculateTeamPayments,
  exportReportPDF,
  exportToCSV,
  isDateInRange,
  type ClientBalanceSummary,
  type DateFilterType,
} from '../lib/financeUtils';
import type {
  EmployeeCompensation,
  EmployeeLedgerEntry,
  FinanceBudget,
  FinanceTransaction,
  FinanceTransactionDraft,
  Profile,
  Project,
} from '../lib/types';
import { currency, errorMessage, isManagerRole } from '../lib/utils';

export type FinanceTab =
  | 'overview'
  | 'income'
  | 'expenses'
  | 'client_balances'
  | 'team_payments'
  | 'reports';

export function FinancePage({
  currentProfile,
  projects,
  profiles = [],
  employeeCompensation = [],
  employeeLedger = [],
  financeTransactions = [],
  onCreateTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  onSoftDeleteTransaction,
  onUpdateProject,
  onAddLedgerEntry,
  onDeleteLedgerEntry,
}: {
  currentProfile: Profile;
  projects: Project[];
  profiles?: Profile[];
  employeeCompensation?: EmployeeCompensation[];
  employeeLedger?: EmployeeLedgerEntry[];
  financeTransactions?: FinanceTransaction[];
  financeBudgets?: FinanceBudget[];
  onCreateTransaction?: (draft: FinanceTransactionDraft) => Promise<FinanceTransaction | void>;
  onUpdateTransaction?: (id: string, updates: Partial<FinanceTransaction>) => Promise<void>;
  onDeleteTransaction?: (id: string) => Promise<void>;
  onSoftDeleteTransaction?: (id: string) => Promise<void>;
  onUpdateProject?: (projectId: string, updates: Partial<Project>) => Promise<unknown>;
  onAddLedgerEntry?: (entry: Omit<EmployeeLedgerEntry, 'id' | 'created_at'>) => Promise<void>;
  onDeleteLedgerEntry?: (entryId: string) => Promise<void>;
  onSaveBudget?: (category: string, monthlyBudgetPkr: number) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<FinanceTab>('overview');
  const [dateFilter, setDateFilter] = useState<DateFilterType>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Selected Month for Team Payments & Reports
  const currentMonthString = new Date().toISOString().slice(0, 7); // e.g. "2026-08"
  const currentYearNumber = new Date().getFullYear();
  const [selectedTeamMonth, setSelectedTeamMonth] = useState<string>(currentMonthString);
  const [selectedReportYear, setSelectedReportYear] = useState<number>(currentYearNumber);

  // Modals state
  const [showAddIncomeModal, setShowAddIncomeModal] = useState(false);
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<FinanceTransaction | null>(null);
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);

  // Client Details Modal
  const [selectedClientName, setSelectedClientName] = useState<string | null>(null);
  // Employee Details Modal
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  // Quick Project Payment Modal (from client modal or overview)
  const [projectToPay, setProjectToPay] = useState<Project | null>(null);

  // Team Ledger Entry Submodal
  const [showLedgerEntryModal, setShowLedgerEntryModal] = useState(false);
  const [ledgerModalEmployeeId, setLedgerModalEmployeeId] = useState<string | null>(null);
  const [ledgerModalDefaultType, setLedgerModalDefaultType] = useState<EmployeeLedgerEntry['entry_type']>('Payment');

  // Income Tab Filters
  const [incomeSearch, setIncomeSearch] = useState('');
  const [incomeClientFilter, setIncomeClientFilter] = useState('all');
  const [incomeProjectFilter, setIncomeProjectFilter] = useState('all');
  const [incomeStatusFilter, setIncomeStatusFilter] = useState('all');

  // Expense Tab Filters
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('all');
  const [expenseMethodFilter, setExpenseMethodFilter] = useState('all');

  // Client Balances Tab Filters
  const [clientSearch, setClientSearch] = useState('');

  const canManage = isManagerRole(currentProfile?.role);

  // Active non-deleted transactions
  const activeTransactions = useMemo(() => {
    return financeTransactions.filter((t) => !t.is_soft_deleted);
  }, [financeTransactions]);

  // Date-filtered transactions
  const dateFilteredTransactions = useMemo(() => {
    return activeTransactions.filter((t) =>
      isDateInRange(t.transaction_date, dateFilter, customStart, customEnd),
    );
  }, [activeTransactions, dateFilter, customStart, customEnd]);

  // Client Balances across projects
  const clientBalances = useMemo(() => {
    return calculateClientBalances(projects, activeTransactions);
  }, [projects, activeTransactions]);

  // Team Payments for selected month
  const teamPayments = useMemo(() => {
    return calculateTeamPayments(profiles, employeeCompensation, employeeLedger, selectedTeamMonth);
  }, [profiles, employeeCompensation, employeeLedger, selectedTeamMonth]);

  // 4 Top KPI Cards metrics based on active period
  const kpiData = useMemo(() => {
    const income = dateFilteredTransactions
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const expenses = dateFilteredTransactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const netProfit = income - expenses;

    // Total outstanding receivables from clients
    const totalReceivable = clientBalances.reduce((sum, c) => sum + c.outstanding, 0);

    // Total team dues for selected month
    const totalTeamDues = teamPayments.reduce((sum, p) => sum + p.outstanding, 0);

    return {
      income,
      expenses,
      netProfit,
      receivable: totalReceivable,
      teamDues: totalTeamDues,
    };
  }, [dateFilteredTransactions, clientBalances, teamPayments]);

  // Recent 10 transactions for Overview
  const recentTransactions = useMemo(() => {
    return [...activeTransactions]
      .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime())
      .slice(0, 10);
  }, [activeTransactions]);

  // Income transactions list
  const incomeList = useMemo(() => {
    return activeTransactions
      .filter((t) => t.type === 'income')
      .filter((t) => isDateInRange(t.transaction_date, dateFilter, customStart, customEnd))
      .filter((t) => {
        if (incomeClientFilter !== 'all' && t.client_name !== incomeClientFilter) return false;
        if (incomeProjectFilter !== 'all' && t.project_id !== incomeProjectFilter) return false;
        if (incomeStatusFilter !== 'all' && t.payment_status !== incomeStatusFilter) return false;
        if (incomeSearch.trim()) {
          const q = incomeSearch.toLowerCase();
          const target = [t.description, t.client_name, t.payment_method, t.notes]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return target.includes(q);
        }
        return true;
      })
      .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime());
  }, [
    activeTransactions,
    dateFilter,
    customStart,
    customEnd,
    incomeClientFilter,
    incomeProjectFilter,
    incomeStatusFilter,
    incomeSearch,
  ]);

  // Expense transactions list
  const expenseList = useMemo(() => {
    return activeTransactions
      .filter((t) => t.type === 'expense')
      .filter((t) => isDateInRange(t.transaction_date, dateFilter, customStart, customEnd))
      .filter((t) => {
        if (expenseCategoryFilter !== 'all' && t.category !== expenseCategoryFilter) return false;
        if (expenseMethodFilter !== 'all' && t.payment_method !== expenseMethodFilter) return false;
        if (expenseSearch.trim()) {
          const q = expenseSearch.toLowerCase();
          const target = [t.description, t.category, t.vendor, t.payment_method, t.notes]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return target.includes(q);
        }
        return true;
      })
      .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime());
  }, [
    activeTransactions,
    dateFilter,
    customStart,
    customEnd,
    expenseCategoryFilter,
    expenseMethodFilter,
    expenseSearch,
  ]);

  // Monthly reports for selected year
  const monthlyReports = useMemo(() => {
    return calculateMonthlyReports(activeTransactions, selectedReportYear);
  }, [activeTransactions, selectedReportYear]);

  // Filtered Client Balances table
  const filteredClientBalances = useMemo(() => {
    return clientBalances.filter((c) => {
      if (!clientSearch.trim()) return true;
      const q = clientSearch.toLowerCase();
      return c.client_name.toLowerCase().includes(q) || c.client_email.toLowerCase().includes(q);
    });
  }, [clientBalances, clientSearch]);

  // Active client object for client detail modal
  const activeClientDetail = useMemo(() => {
    if (!selectedClientName) return null;
    return clientBalances.find((c) => c.client_name === selectedClientName) || null;
  }, [selectedClientName, clientBalances]);

  // Active employee object for employee detail modal
  const activeEmployeeDetail = useMemo(() => {
    if (!selectedEmployeeId) return null;
    return teamPayments.find((e) => e.employee_id === selectedEmployeeId) || null;
  }, [selectedEmployeeId, teamPayments]);

  // Handlers for transactions
  async function handleDeleteTransaction(id: string) {
    if (!onDeleteTransaction && !onSoftDeleteTransaction) return;
    try {
      if (onDeleteTransaction) {
        await onDeleteTransaction(id);
      } else if (onSoftDeleteTransaction) {
        await onSoftDeleteTransaction(id);
      }
      setDeletingTransactionId(null);
    } catch (err) {
      alert(errorMessage(err, 'Failed to delete transaction.'));
    }
  }

  // Export CSV Handler for Reports
  function handleExportReportsCSV() {
    const headers = ['Month', 'Income', 'Expenses', 'Net Profit'];
    const rows = monthlyReports.map((r) => [
      `${r.month_name} ${selectedReportYear}`,
      r.income,
      r.expenses,
      r.profit,
    ]);
    exportToCSV(`Manuscript_Heaven_Finance_${selectedReportYear}`, headers, rows);
  }

  // Print Report Handler
  function handlePrintReport() {
    const headers = ['Month', 'Income', 'Expenses', 'Net Profit'];
    const rows = monthlyReports.map((r) => [
      `${r.month_name} ${selectedReportYear}`,
      currency(r.income),
      currency(r.expenses),
      currency(r.profit),
    ]);
    const totalIncome = monthlyReports.reduce((s, r) => s + r.income, 0);
    const totalExp = monthlyReports.reduce((s, r) => s + r.expenses, 0);
    const net = totalIncome - totalExp;

    exportReportPDF(
      `Financial Report (${selectedReportYear})`,
      'Annual Income, Expense and Net Profit Performance',
      headers,
      rows,
      [
        { label: 'Total Income', value: currency(totalIncome) },
        { label: 'Total Expenses', value: currency(totalExp) },
        { label: 'Net Profit', value: currency(net) },
        { label: 'Client Receivables', value: currency(kpiData.receivable) },
      ],
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* ========================================================================= */}
      {/* TOP HEADER */}
      {/* ========================================================================= */}
      <header className="flex flex-col justify-between gap-4 border-b border-border/80 pb-5 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Finance</h1>
          <p className="mt-1 text-sm text-muted">
            Business income, expenses, client balances and team payments.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Period selector */}
          <div className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-1.5 shadow-xs">
            <Calendar className="h-4 w-4 text-gold" />
            <select
              aria-label="Filter by period"
              className="bg-transparent text-sm font-medium text-ink focus:outline-hidden cursor-pointer"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilterType)}
            >
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
              <option value="this_year">This Year</option>
              <option value="custom">Custom Range</option>
              <option value="all">All Time</option>
            </select>
          </div>

          {dateFilter === 'custom' && (
            <div className="flex items-center gap-1.5 text-sm">
              <input
                type="date"
                className="rounded-md border border-border bg-white px-2 py-1 text-xs"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              <span className="text-muted">to</span>
              <input
                type="date"
                className="rounded-md border border-border bg-white px-2 py-1 text-xs"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
          )}

          {canManage && (
            <>
              <Button
                variant="primary"
                onClick={() => {
                  setEditingTransaction(null);
                  setShowAddIncomeModal(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Income
              </Button>

              <Button
                variant="secondary"
                onClick={() => {
                  setEditingTransaction(null);
                  setShowAddExpenseModal(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Expense
              </Button>
            </>
          )}
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 6 MAIN TABS NAVIGATION */}
      {/* ========================================================================= */}
      <nav className="flex flex-wrap gap-2 border-b border-border/70 pb-3" aria-label="Finance navigation tabs">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'income', label: 'Income' },
          { id: 'expenses', label: 'Expenses' },
          { id: 'client_balances', label: 'Client Balances' },
          { id: 'team_payments', label: 'Team Payments' },
          { id: 'reports', label: 'Reports' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as FinanceTab)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition cursor-pointer ${
              activeTab === tab.id
                ? 'bg-gold text-ink font-semibold shadow-xs'
                : 'bg-white border border-border text-muted hover:border-gold hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ========================================================================= */}
      {/* TOP 4 KPI CARDS */}
      {/* ========================================================================= */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. Income */}
        <Card className="flex flex-col justify-between border-l-4 border-l-emerald-600 bg-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Income</span>
            <div className="rounded-md bg-emerald-50 p-2 text-emerald-700">
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <p className="font-display text-2xl font-bold text-ink">{currency(kpiData.income)}</p>
            <p className="mt-1 text-xs text-muted">
              {dateFilter === 'this_month' ? 'Received this month' : 'In selected period'}
            </p>
          </div>
        </Card>

        {/* 2. Expenses */}
        <Card className="flex flex-col justify-between border-l-4 border-l-slate-400 bg-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Expenses</span>
            <div className="rounded-md bg-slate-100 p-2 text-slate-700">
              <ArrowDownRight className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <p className="font-display text-2xl font-bold text-ink">{currency(kpiData.expenses)}</p>
            <p className="mt-1 text-xs text-muted">
              {dateFilter === 'this_month' ? 'Spent this month' : 'In selected period'}
            </p>
          </div>
        </Card>

        {/* 3. Net Profit */}
        <Card
          className={`flex flex-col justify-between border-l-4 ${
            kpiData.netProfit >= 0 ? 'border-l-emerald-600' : 'border-l-rose-600'
          } bg-white`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Net Profit</span>
            <div
              className={`rounded-md p-2 ${
                kpiData.netProfit >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <p
              className={`font-display text-2xl font-bold ${
                kpiData.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {currency(kpiData.netProfit)}
            </p>
            <p className="mt-1 text-xs text-muted">Income minus Expenses</p>
          </div>
        </Card>

        {/* 4. Receivable */}
        <Card
          className={`flex flex-col justify-between border-l-4 ${
            kpiData.receivable > 0 ? 'border-l-rose-500' : 'border-l-emerald-500'
          } bg-white`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Receivable</span>
            <div
              className={`rounded-md p-2 ${
                kpiData.receivable > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <p
              className={`font-display text-2xl font-bold ${
                kpiData.receivable > 0 ? 'text-rose-700' : 'text-emerald-700'
              }`}
            >
              {currency(kpiData.receivable)}
            </p>
            <p className="mt-1 text-xs text-muted">Unpaid client balances</p>
          </div>
        </Card>
      </section>

      {/* ========================================================================= */}
      {/* TAB 1: OVERVIEW */}
      {/* ========================================================================= */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* SECTION 1: RECENT TRANSACTIONS */}
          <Card>
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">Recent Transactions</h2>
                <p className="text-xs text-muted">Latest financial movements across income and expenses.</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('income')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-gold hover:underline cursor-pointer"
              >
                View All Transactions <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border/80 text-xs font-semibold uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-2.5">Date</th>
                    <th>Description</th>
                    <th>Client / Vendor</th>
                    <th>Type</th>
                    <th className="text-right">Amount</th>
                    <th className="text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {recentTransactions.length > 0 ? (
                    recentTransactions.map((tx) => {
                      const isIncome = tx.type === 'income';
                      const isPartial = tx.payment_status === 'Partially Paid';
                      return (
                        <tr key={tx.id} className="hover:bg-ivory/60 transition">
                          <td className="py-3 text-muted text-xs whitespace-nowrap">{tx.transaction_date}</td>
                          <td className="font-medium text-ink">{tx.description}</td>
                          <td className="text-muted text-xs">{tx.client_name || tx.vendor || '—'}</td>
                          <td>
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                isIncome ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'
                              }`}
                            >
                              {isIncome ? 'Income' : 'Expense'}
                            </span>
                          </td>
                          <td
                            className={`text-right font-semibold whitespace-nowrap ${
                              isIncome ? 'text-emerald-700' : 'text-slate-800'
                            }`}
                          >
                            {isIncome ? `+${currency(tx.amount)}` : `-${currency(tx.amount)}`}
                          </td>
                          <td className="text-center">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                tx.payment_status === 'Paid'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : isPartial
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {tx.payment_status || 'Paid'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-sm text-muted">
                        No transactions recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* TWO COLUMN GRID: CLIENT BALANCES & TEAM PAYMENTS */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* SECTION 2: CLIENT BALANCES (COMPACT) */}
            <Card>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <h2 className="font-display text-lg font-semibold text-ink">Client Balances</h2>
                  <p className="text-xs text-muted">Who owes Manuscript Heaven money.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('client_balances')}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-gold hover:underline cursor-pointer"
                >
                  View All Clients <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border/80 text-xs font-semibold uppercase tracking-wider text-muted">
                    <tr>
                      <th className="py-2">Client</th>
                      <th className="text-center">Projects</th>
                      <th className="text-right">Invoiced</th>
                      <th className="text-right">Paid</th>
                      <th className="text-right">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {clientBalances.slice(0, 6).map((client) => (
                      <tr
                        key={client.client_name}
                        onClick={() => setSelectedClientName(client.client_name)}
                        className="cursor-pointer hover:bg-ivory/60 transition"
                      >
                        <td className="py-2.5 font-medium text-ink">{client.client_name}</td>
                        <td className="text-center text-xs text-muted">{client.project_count}</td>
                        <td className="text-right text-xs text-muted">{currency(client.total_invoiced)}</td>
                        <td className="text-right text-xs text-muted">{currency(client.total_paid)}</td>
                        <td
                          className={`text-right font-bold ${
                            client.outstanding > 0 ? 'text-rose-700' : 'text-emerald-700'
                          }`}
                        >
                          {currency(client.outstanding)}
                        </td>
                      </tr>
                    ))}
                    {clientBalances.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-xs text-muted">
                          No client data found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* SECTION 3: TEAM PAYMENTS (COMPACT) */}
            <Card>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <h2 className="font-display text-lg font-semibold text-ink">Team Payments</h2>
                  <p className="text-xs text-muted">Salaries and employee dues snapshot.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('team_payments')}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-gold hover:underline cursor-pointer"
                >
                  View Team Payments <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border/80 text-xs font-semibold uppercase tracking-wider text-muted">
                    <tr>
                      <th className="py-2">Employee</th>
                      <th className="text-right">Monthly Salary</th>
                      <th className="text-right">Paid</th>
                      <th className="text-right">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {teamPayments.map((emp) => (
                      <tr
                        key={emp.employee_id}
                        onClick={() => setSelectedEmployeeId(emp.employee_id)}
                        className="cursor-pointer hover:bg-ivory/60 transition"
                      >
                        <td className="py-2.5 font-medium text-ink">{emp.employee_name}</td>
                        <td className="text-right text-xs text-muted">{currency(emp.monthly_salary)}</td>
                        <td className="text-right text-xs text-muted">{currency(emp.paid)}</td>
                        <td
                          className={`text-right font-bold ${
                            emp.outstanding > 0 ? 'text-rose-700' : 'text-emerald-700'
                          }`}
                        >
                          {currency(emp.outstanding)}
                        </td>
                      </tr>
                    ))}
                    {teamPayments.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-xs text-muted">
                          No team members found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: INCOME */}
      {/* ========================================================================= */}
      {activeTab === 'income' && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">Income Transactions</h2>
                <p className="text-xs text-muted">Project payments and client income records.</p>
              </div>

              {canManage && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditingTransaction(null);
                    setShowAddIncomeModal(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add Income
                </Button>
              )}
            </div>

            {/* Filter controls */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted" />
                <input
                  type="text"
                  placeholder="Search description, client..."
                  value={incomeSearch}
                  onChange={(e) => setIncomeSearch(e.target.value)}
                  className="min-h-10 w-full rounded-md border border-border bg-white pl-9 pr-3 text-sm focus:border-gold focus:outline-hidden"
                />
              </div>

              <select
                aria-label="Filter by client"
                value={incomeClientFilter}
                onChange={(e) => setIncomeClientFilter(e.target.value)}
                className="min-h-10 rounded-md border border-border bg-white px-3 text-sm focus:border-gold focus:outline-hidden"
              >
                <option value="all">All Clients</option>
                {clientBalances.map((c) => (
                  <option key={c.client_name} value={c.client_name}>
                    {c.client_name}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by project"
                value={incomeProjectFilter}
                onChange={(e) => setIncomeProjectFilter(e.target.value)}
                className="min-h-10 rounded-md border border-border bg-white px-3 text-sm focus:border-gold focus:outline-hidden"
              >
                <option value="all">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_number} - {p.project_title}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by payment status"
                value={incomeStatusFilter}
                onChange={(e) => setIncomeStatusFilter(e.target.value)}
                className="min-h-10 rounded-md border border-border bg-white px-3 text-sm focus:border-gold focus:outline-hidden"
              >
                <option value="all">All Statuses</option>
                <option value="Paid">Paid</option>
                <option value="Partially Paid">Partially Paid</option>
                <option value="Pending">Pending</option>
              </select>
            </div>

            {/* Income Table */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-2.5">Date</th>
                    <th>Client</th>
                    <th>Project</th>
                    <th>Description</th>
                    <th className="text-right">Amount</th>
                    <th>Method</th>
                    <th className="text-center">Status</th>
                    {canManage && <th className="text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {incomeList.length > 0 ? (
                    incomeList.map((item) => {
                      const linkedProject = projects.find((p) => p.id === item.project_id);
                      const isPartial = item.payment_status === 'Partially Paid';
                      return (
                        <tr key={item.id} className="hover:bg-ivory/60 transition">
                          <td className="py-3 text-xs text-muted whitespace-nowrap">{item.transaction_date}</td>
                          <td className="font-semibold text-ink">{item.client_name || '—'}</td>
                          <td className="text-xs text-muted">
                            {linkedProject ? (
                              <span className="font-medium text-ink">{linkedProject.project_title}</span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="text-ink">{item.description}</td>
                          <td className="text-right font-bold text-emerald-700 whitespace-nowrap">
                            +{currency(item.amount)}
                          </td>
                          <td className="text-xs text-muted">{item.payment_method || 'Bank Transfer'}</td>
                          <td className="text-center">
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                item.payment_status === 'Paid'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : isPartial
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {item.payment_status || 'Paid'}
                            </span>
                          </td>
                          {canManage && (
                            <td className="text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTransaction(item);
                                    setShowAddIncomeModal(true);
                                  }}
                                  className="text-xs font-semibold text-muted hover:text-ink cursor-pointer"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingTransactionId(item.id)}
                                  className="text-xs font-semibold text-rose-600 hover:text-rose-800 cursor-pointer"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-sm text-muted">
                        No income records found for this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: EXPENSES */}
      {/* ========================================================================= */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">Business Expenses</h2>
                <p className="text-xs text-muted">Track software, utilities, office supplies, and team overheads.</p>
              </div>

              <div className="flex items-center gap-3">
                <span className="rounded-md bg-ivory px-3 py-1.5 text-xs font-semibold text-ink border border-border">
                  Period Total: <strong className="text-slate-900">{currency(kpiData.expenses)}</strong>
                </span>

                {canManage && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setEditingTransaction(null);
                      setShowAddExpenseModal(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Add Expense
                  </Button>
                )}
              </div>
            </div>

            {/* Filter controls */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted" />
                <input
                  type="text"
                  placeholder="Search description, vendor..."
                  value={expenseSearch}
                  onChange={(e) => setExpenseSearch(e.target.value)}
                  className="min-h-10 w-full rounded-md border border-border bg-white pl-9 pr-3 text-sm focus:border-gold focus:outline-hidden"
                />
              </div>

              <select
                aria-label="Filter by expense category"
                value={expenseCategoryFilter}
                onChange={(e) => setExpenseCategoryFilter(e.target.value)}
                className="min-h-10 rounded-md border border-border bg-white px-3 text-sm focus:border-gold focus:outline-hidden"
              >
                <option value="all">All Categories</option>
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by expense payment method"
                value={expenseMethodFilter}
                onChange={(e) => setExpenseMethodFilter(e.target.value)}
                className="min-h-10 rounded-md border border-border bg-white px-3 text-sm focus:border-gold focus:outline-hidden"
              >
                <option value="all">All Payment Methods</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* Expenses Table */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-2.5">Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Vendor</th>
                    <th className="text-right">Amount</th>
                    <th>Method</th>
                    {canManage && <th className="text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {expenseList.length > 0 ? (
                    expenseList.map((item) => (
                      <tr key={item.id} className="hover:bg-ivory/60 transition">
                        <td className="py-3 text-xs text-muted whitespace-nowrap">{item.transaction_date}</td>
                        <td className="font-semibold text-ink">{item.description}</td>
                        <td>
                          <span className="inline-block rounded-md bg-ivory px-2 py-0.5 text-xs text-muted border border-border">
                            {item.category || 'Other'}
                          </span>
                        </td>
                        <td className="text-xs text-muted">{item.vendor || '—'}</td>
                        <td className="text-right font-bold text-slate-800 whitespace-nowrap">
                          -{currency(item.amount)}
                        </td>
                        <td className="text-xs text-muted">{item.payment_method || 'Card'}</td>
                        {canManage && (
                          <td className="text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTransaction(item);
                                  setShowAddExpenseModal(true);
                                }}
                                className="text-xs font-semibold text-muted hover:text-ink cursor-pointer"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingTransactionId(item.id)}
                                className="text-xs font-semibold text-rose-600 hover:text-rose-800 cursor-pointer"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-muted">
                        No expense records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: CLIENT BALANCES */}
      {/* ========================================================================= */}
      {activeTab === 'client_balances' && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">Client Balances</h2>
                <p className="text-xs text-muted">
                  Who owes Manuscript Heaven money — automatically calculated from project payments.
                </p>
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted" />
                <input
                  type="text"
                  placeholder="Search client..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="min-h-10 w-full rounded-md border border-border bg-white pl-9 pr-3 text-sm focus:border-gold focus:outline-hidden"
                />
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-2.5">Client</th>
                    <th className="text-center">Projects</th>
                    <th className="text-right">Total Invoiced</th>
                    <th className="text-right">Total Paid</th>
                    <th className="text-right">Outstanding</th>
                    <th>Last Payment</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredClientBalances.map((client) => (
                    <tr
                      key={client.client_name}
                      onClick={() => setSelectedClientName(client.client_name)}
                      className="cursor-pointer hover:bg-ivory/60 transition"
                    >
                      <td className="py-3 font-semibold text-ink">{client.client_name}</td>
                      <td className="text-center text-xs text-muted">{client.project_count}</td>
                      <td className="text-right font-medium text-ink">{currency(client.total_invoiced)}</td>
                      <td className="text-right text-muted">{currency(client.total_paid)}</td>
                      <td
                        className={`text-right font-bold ${
                          client.outstanding > 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {currency(client.outstanding)}
                      </td>
                      <td className="text-xs text-muted">{client.last_payment_date || '—'}</td>
                      <td className="text-right">
                        <Button
                          variant="secondary"
                          className="text-xs py-1 px-3 min-h-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedClientName(client.client_name);
                          }}
                        >
                          View Details
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filteredClientBalances.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-muted">
                        No clients found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: TEAM PAYMENTS */}
      {/* ========================================================================= */}
      {activeTab === 'team_payments' && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">Team Payments</h2>
                <p className="text-xs text-muted">
                  Salaries, project earnings, advances and employee dues connected to Team Management.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold text-muted">Period:</label>
                <input
                  type="month"
                  value={selectedTeamMonth}
                  onChange={(e) => setSelectedTeamMonth(e.target.value)}
                  className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-ink focus:border-gold"
                />
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-2.5">Employee</th>
                    <th className="text-right">Monthly Salary</th>
                    <th className="text-right">Project Earnings</th>
                    <th className="text-right">Advances</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Outstanding</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {teamPayments.map((emp) => (
                    <tr
                      key={emp.employee_id}
                      onClick={() => setSelectedEmployeeId(emp.employee_id)}
                      className="cursor-pointer hover:bg-ivory/60 transition"
                    >
                      <td className="py-3 font-semibold text-ink">{emp.employee_name}</td>
                      <td className="text-right text-ink font-medium">{currency(emp.monthly_salary)}</td>
                      <td className="text-right text-muted">{currency(emp.project_earnings)}</td>
                      <td className="text-right text-muted">{currency(emp.advances)}</td>
                      <td className="text-right text-muted">{currency(emp.paid)}</td>
                      <td
                        className={`text-right font-bold ${
                          emp.outstanding > 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {currency(emp.outstanding)}
                      </td>
                      <td className="text-right">
                        <Button
                          variant="secondary"
                          className="text-xs py-1 px-3 min-h-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEmployeeId(emp.employee_id);
                          }}
                        >
                          View Details
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {teamPayments.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-muted">
                        No team payroll records found for this month.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 6: REPORTS */}
      {/* ========================================================================= */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">Financial Reports</h2>
                <p className="text-xs text-muted">Annual summary and monthly performance breakdown.</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium">
                  <span className="text-xs text-muted">Year:</span>
                  <select
                    aria-label="Filter by report year"
                    value={selectedReportYear}
                    onChange={(e) => setSelectedReportYear(Number(e.target.value))}
                    className="bg-transparent text-ink font-semibold focus:outline-hidden cursor-pointer"
                  >
                    {[currentYearNumber, currentYearNumber - 1, currentYearNumber - 2].map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </div>

                <Button variant="secondary" onClick={handleExportReportsCSV}>
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>

                <Button variant="secondary" onClick={handlePrintReport}>
                  <Printer className="h-4 w-4" />
                  Print Report
                </Button>
              </div>
            </div>

            {/* Financial Summary Box */}
            <div className="mt-6 grid gap-4 rounded-lg border border-border bg-ivory/80 p-5 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Year Income</p>
                <p className="mt-1 font-display text-2xl font-bold text-ink">
                  {currency(monthlyReports.reduce((s, r) => s + r.income, 0))}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Year Expenses</p>
                <p className="mt-1 font-display text-2xl font-bold text-slate-800">
                  {currency(monthlyReports.reduce((s, r) => s + r.expenses, 0))}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Net Profit</p>
                <p className="mt-1 font-display text-2xl font-bold text-emerald-700">
                  {currency(
                    monthlyReports.reduce((s, r) => s + r.income, 0) -
                      monthlyReports.reduce((s, r) => s + r.expenses, 0),
                  )}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Outstanding Clients</p>
                <p className="mt-1 font-display text-2xl font-bold text-rose-700">
                  {currency(kpiData.receivable)}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Team Dues</p>
                <p className="mt-1 font-display text-2xl font-bold text-rose-700">
                  {currency(kpiData.teamDues)}
                </p>
              </div>
            </div>

            {/* Monthly Summary Table */}
            <div className="mt-8">
              <h3 className="font-display text-lg font-semibold text-ink">Monthly Summary ({selectedReportYear})</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted">
                    <tr>
                      <th className="py-2.5">Month</th>
                      <th className="text-right">Income</th>
                      <th className="text-right">Expenses</th>
                      <th className="text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {monthlyReports.map((row) => (
                      <tr key={row.month_key} className="hover:bg-ivory/60 transition">
                        <td className="py-2.5 font-medium text-ink">
                          {row.month_name} {selectedReportYear}
                        </td>
                        <td className="text-right text-emerald-700 font-semibold">{currency(row.income)}</td>
                        <td className="text-right text-slate-800">{currency(row.expenses)}</td>
                        <td
                          className={`text-right font-bold ${
                            row.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {currency(row.profit)}
                        </td>
                      </tr>
                    ))}
                    {/* Totals Row */}
                    <tr className="border-t-2 border-border font-bold bg-ivory/40">
                      <td className="py-3 font-display text-ink">Total {selectedReportYear}</td>
                      <td className="text-right text-emerald-700">
                        {currency(monthlyReports.reduce((s, r) => s + r.income, 0))}
                      </td>
                      <td className="text-right text-slate-800">
                        {currency(monthlyReports.reduce((s, r) => s + r.expenses, 0))}
                      </td>
                      <td className="text-right text-emerald-700">
                        {currency(
                          monthlyReports.reduce((s, r) => s + r.income, 0) -
                            monthlyReports.reduce((s, r) => s + r.expenses, 0),
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADD / EDIT INCOME MODAL */}
      {/* ========================================================================= */}
      {showAddIncomeModal && (
        <IncomeFormModal
          transaction={editingTransaction}
          projects={projects}
          clientBalances={clientBalances}
          onClose={() => {
            setShowAddIncomeModal(false);
            setEditingTransaction(null);
          }}
          onSave={async (draft, linkToProjectId) => {
            if (editingTransaction && onUpdateTransaction) {
              await onUpdateTransaction(editingTransaction.id, draft);
            } else if (onCreateTransaction) {
              await onCreateTransaction(draft);
            }

            // Sync with project if selected
            if (linkToProjectId && onUpdateProject) {
              const proj = projects.find((p) => p.id === linkToProjectId);
              if (proj) {
                const newPaid = Number(proj.advance_paid || 0) + Number(draft.amount || 0);
                const total = Number(proj.total_price || 0);
                await onUpdateProject(proj.id, {
                  advance_paid: newPaid,
                  payment_status: newPaid >= total ? 'Fully Paid' : newPaid > 0 ? 'Partially Paid' : 'Not Started',
                  payment_date: draft.transaction_date,
                });
              }
            }

            setShowAddIncomeModal(false);
            setEditingTransaction(null);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* ADD / EDIT EXPENSE MODAL */}
      {/* ========================================================================= */}
      {showAddExpenseModal && (
        <ExpenseFormModal
          transaction={editingTransaction}
          projects={projects}
          onClose={() => {
            setShowAddExpenseModal(false);
            setEditingTransaction(null);
          }}
          onSave={async (draft) => {
            if (editingTransaction && onUpdateTransaction) {
              await onUpdateTransaction(editingTransaction.id, draft);
            } else if (onCreateTransaction) {
              await onCreateTransaction(draft);
            }
            setShowAddExpenseModal(false);
            setEditingTransaction(null);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* DELETE TRANSACTION CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {deletingTransactionId && (
        <Modal
          title="Delete Transaction"
          onClose={() => setDeletingTransactionId(null)}
          width="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-sm text-ink">
              Are you sure you want to delete this transaction? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setDeletingTransactionId(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                type="button"
                onClick={() => handleDeleteTransaction(deletingTransactionId)}
              >
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* CLIENT FINANCIAL DETAIL MODAL */}
      {/* ========================================================================= */}
      {activeClientDetail && (
        <Modal
          title={`${activeClientDetail.client_name} — Financial Detail`}
          onClose={() => setSelectedClientName(null)}
          width="max-w-3xl"
        >
          <div className="space-y-6">
            {/* Top 3 KPI stats */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-ivory p-3.5 text-center">
                <p className="text-xs uppercase tracking-wider text-muted font-semibold">Total Invoiced</p>
                <p className="mt-1 font-display text-xl font-bold text-ink">
                  {currency(activeClientDetail.total_invoiced)}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-ivory p-3.5 text-center">
                <p className="text-xs uppercase tracking-wider text-muted font-semibold">Total Paid</p>
                <p className="mt-1 font-display text-xl font-bold text-emerald-700">
                  {currency(activeClientDetail.total_paid)}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-ivory p-3.5 text-center">
                <p className="text-xs uppercase tracking-wider text-muted font-semibold">Outstanding</p>
                <p
                  className={`mt-1 font-display text-xl font-bold ${
                    activeClientDetail.outstanding > 0 ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {currency(activeClientDetail.outstanding)}
                </p>
              </div>
            </div>

            {/* Project Payments Table */}
            <div>
              <h3 className="font-display text-base font-semibold text-ink border-b border-border pb-2">
                Project Payments
              </h3>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted">
                    <tr>
                      <th className="py-2">Project</th>
                      <th className="text-right">Price</th>
                      <th className="text-right">Paid</th>
                      <th className="text-right">Outstanding</th>
                      <th className="text-center">Status</th>
                      {canManage && <th className="text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {activeClientDetail.projects.map((proj) => (
                      <tr key={proj.id} className="hover:bg-ivory/50">
                        <td className="py-2.5">
                          <p className="font-medium text-ink">{proj.project_title}</p>
                          <p className="text-xs text-muted">{proj.project_number}</p>
                        </td>
                        <td className="text-right font-medium text-ink">{currency(proj.total_price)}</td>
                        <td className="text-right text-muted">{currency(proj.advance_paid)}</td>
                        <td
                          className={`text-right font-bold ${
                            proj.outstanding > 0 ? 'text-rose-700' : 'text-emerald-700'
                          }`}
                        >
                          {currency(proj.outstanding)}
                        </td>
                        <td className="text-center">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              proj.outstanding === 0
                                ? 'bg-emerald-100 text-emerald-800'
                                : proj.advance_paid > 0
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {proj.outstanding === 0 ? 'Paid' : `${currency(proj.outstanding)} Due`}
                          </span>
                        </td>
                        {canManage && (
                          <td className="text-right">
                            {proj.outstanding > 0 && (
                              <Button
                                variant="secondary"
                                className="text-xs py-1 px-2.5 min-h-7"
                                onClick={() => {
                                  const realProject = projects.find((p) => p.id === proj.id);
                                  if (realProject) setProjectToPay(realProject);
                                }}
                              >
                                Record Payment
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setSelectedClientName(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* EMPLOYEE FINANCIAL DETAIL MODAL */}
      {/* ========================================================================= */}
      {activeEmployeeDetail && (
        <Modal
          title={`${activeEmployeeDetail.employee_name} — Financial Detail`}
          onClose={() => setSelectedEmployeeId(null)}
          width="max-w-3xl"
        >
          <div className="space-y-6">
            {/* KPI grid */}
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 text-center">
              <div className="rounded-lg border border-border bg-ivory p-2.5">
                <p className="text-[10px] uppercase font-semibold text-muted">Monthly Salary</p>
                <p className="mt-1 font-display text-lg font-bold text-ink">
                  {currency(activeEmployeeDetail.monthly_salary)}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-ivory p-2.5">
                <p className="text-[10px] uppercase font-semibold text-muted">Earnings</p>
                <p className="mt-1 font-display text-lg font-bold text-ink">
                  {currency(activeEmployeeDetail.project_earnings)}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-ivory p-2.5">
                <p className="text-[10px] uppercase font-semibold text-muted">Advances</p>
                <p className="mt-1 font-display text-lg font-bold text-muted">
                  {currency(activeEmployeeDetail.advances)}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-ivory p-2.5">
                <p className="text-[10px] uppercase font-semibold text-muted">Deductions</p>
                <p className="mt-1 font-display text-lg font-bold text-rose-700">
                  {currency(activeEmployeeDetail.deductions)}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-ivory p-2.5">
                <p className="text-[10px] uppercase font-semibold text-muted">Paid</p>
                <p className="mt-1 font-display text-lg font-bold text-emerald-700">
                  {currency(activeEmployeeDetail.paid)}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-ivory p-2.5">
                <p className="text-[10px] uppercase font-semibold text-muted">Outstanding</p>
                <p
                  className={`mt-1 font-display text-lg font-bold ${
                    activeEmployeeDetail.outstanding > 0 ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {currency(activeEmployeeDetail.outstanding)}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            {canManage && (
              <div className="flex flex-wrap items-center gap-2 border-y border-border py-3">
                <Button
                  variant="primary"
                  className="text-xs py-1 px-3 min-h-8"
                  onClick={() => {
                    setLedgerModalEmployeeId(activeEmployeeDetail.employee_id);
                    setLedgerModalDefaultType('Payment');
                    setShowLedgerEntryModal(true);
                  }}
                >
                  Record Payment
                </Button>

                <Button
                  variant="secondary"
                  className="text-xs py-1 px-3 min-h-8"
                  onClick={() => {
                    setLedgerModalEmployeeId(activeEmployeeDetail.employee_id);
                    setLedgerModalDefaultType('Advance');
                    setShowLedgerEntryModal(true);
                  }}
                >
                  Add Advance
                </Button>

                <Button
                  variant="secondary"
                  className="text-xs py-1 px-3 min-h-8"
                  onClick={() => {
                    setLedgerModalEmployeeId(activeEmployeeDetail.employee_id);
                    setLedgerModalDefaultType('Deduction');
                    setShowLedgerEntryModal(true);
                  }}
                >
                  Add Deduction
                </Button>
              </div>
            )}

            {/* Payment History */}
            <div>
              <h3 className="font-display text-base font-semibold text-ink border-b border-border pb-2">
                Payment History ({selectedTeamMonth})
              </h3>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted">
                    <tr>
                      <th className="py-2">Date</th>
                      <th>Type</th>
                      <th>Notes</th>
                      <th className="text-right">Amount</th>
                      {canManage && onDeleteLedgerEntry && <th className="text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {activeEmployeeDetail.entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-ivory/50">
                        <td className="py-2.5 text-xs text-muted">{entry.paid_at}</td>
                        <td>
                          <span className="inline-block rounded-md bg-ivory px-2 py-0.5 text-xs font-semibold text-ink border border-border">
                            {entry.entry_type}
                          </span>
                        </td>
                        <td className="text-xs text-muted">{entry.notes || '—'}</td>
                        <td className="text-right font-bold text-ink">{currency(entry.amount)}</td>
                        {canManage && onDeleteLedgerEntry && (
                          <td className="text-right">
                            <button
                              type="button"
                              onClick={async () => {
                                if (confirm('Delete this ledger entry?')) {
                                  await onDeleteLedgerEntry(entry.id);
                                }
                              }}
                              className="text-xs text-rose-600 hover:text-rose-800 cursor-pointer"
                            >
                              Delete
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {activeEmployeeDetail.entries.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-xs text-muted">
                          No ledger records for this month.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setSelectedEmployeeId(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* QUICK PROJECT PAYMENT MODAL */}
      {/* ========================================================================= */}
      {projectToPay && (
        <QuickProjectPaymentModal
          project={projectToPay}
          onClose={() => setProjectToPay(null)}
          onSave={async (amount, method, date, notes) => {
            const numAmount = Number(amount);
            // 1. Create income transaction
            if (onCreateTransaction) {
              await onCreateTransaction({
                type: 'income',
                category: 'Project Payment',
                description: `${projectToPay.client_name} – ${projectToPay.project_title}`,
                amount: numAmount,
                currency: 'USD',
                exchange_rate: 1.0,
                transaction_date: date,
                client_name: projectToPay.client_name,
                project_id: projectToPay.id,
                payment_method: method,
                payment_status: 'Paid',
                notes,
              });
            }

            // 2. Update project advance paid
            if (onUpdateProject) {
              const newPaid = Number(projectToPay.advance_paid || 0) + numAmount;
              const total = Number(projectToPay.total_price || 0);
              await onUpdateProject(projectToPay.id, {
                advance_paid: newPaid,
                payment_status: newPaid >= total ? 'Fully Paid' : newPaid > 0 ? 'Partially Paid' : 'Not Started',
                payment_date: date,
                payment_notes: notes || projectToPay.payment_notes,
              });
            }

            setProjectToPay(null);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* ADD LEDGER ENTRY MODAL (PAYMENT / ADVANCE / DEDUCTION) */}
      {/* ========================================================================= */}
      {showLedgerEntryModal && ledgerModalEmployeeId && onAddLedgerEntry && (
        <PayrollLedgerEntryModal
          employeeId={ledgerModalEmployeeId}
          profiles={profiles}
          projects={projects}
          month={selectedTeamMonth}
          defaultType={ledgerModalDefaultType}
          onClose={() => {
            setShowLedgerEntryModal(false);
            setLedgerModalEmployeeId(null);
          }}
          onSave={async (entry) => {
            await onAddLedgerEntry(entry);
            setShowLedgerEntryModal(false);
            setLedgerModalEmployeeId(null);
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// SUBCOMPONENTS / MODALS
// =============================================================================

function IncomeFormModal({
  transaction,
  projects,
  clientBalances,
  onClose,
  onSave,
}: {
  transaction: FinanceTransaction | null;
  projects: Project[];
  clientBalances: ClientBalanceSummary[];
  onClose: () => void;
  onSave: (draft: FinanceTransactionDraft, linkToProjectId?: string) => Promise<void>;
}) {
  const [clientName, setClientName] = useState(transaction?.client_name || '');
  const [projectId, setProjectId] = useState(transaction?.project_id || '');
  const [description, setDescription] = useState(transaction?.description || '');
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '');
  const [date, setDate] = useState(transaction?.transaction_date || new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState(transaction?.payment_method || 'Bank Transfer');
  const [paymentStatus, setPaymentStatus] = useState<'Paid' | 'Partially Paid' | 'Pending'>(
    (transaction?.payment_status as 'Paid' | 'Partially Paid' | 'Pending') || 'Paid',
  );
  const [notes, setNotes] = useState(transaction?.notes || '');
  const [syncToProject, setSyncToProject] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter projects by selected client name
  const clientProjects = useMemo(() => {
    if (!clientName.trim()) return projects;
    return projects.filter(
      (p) => (p.client_name || '').toLowerCase() === clientName.trim().toLowerCase(),
    );
  }, [projects, clientName]);

  function handleSelectProject(projId: string) {
    setProjectId(projId);
    const proj = projects.find((p) => p.id === projId);
    if (proj) {
      if (!clientName) setClientName(proj.client_name);
      if (!description) setDescription(`${proj.client_name} – ${proj.project_title}`);
      if (!amount) {
        const remaining = Math.max(0, Number(proj.total_price || 0) - Number(proj.advance_paid || 0));
        if (remaining > 0) setAmount(String(remaining));
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientName.trim() && !description.trim()) {
      setError('Please provide a client name or description.');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError('Please enter a valid amount.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      await onSave(
        {
          type: 'income',
          category: 'Project Payment',
          description: description.trim() || `${clientName} Payment`,
          amount: Number(amount),
          currency: 'USD',
          exchange_rate: 1.0,
          transaction_date: date,
          client_name: clientName.trim() || null,
          project_id: projectId || null,
          payment_method: paymentMethod,
          payment_status: paymentStatus,
          notes: notes.trim() || null,
        },
        syncToProject ? projectId : undefined,
      );
    } catch (err) {
      setError(errorMessage(err, 'Failed to save income.'));
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={transaction ? 'Edit Income' : 'Add Income'} onClose={onClose} width="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Client * */}
          <div>
            <label className="grid gap-1 text-sm font-medium text-ink">
              <span>Client *</span>
              <input
                type="text"
                list="client-suggestions"
                required
                placeholder="e.g. BCH, Shara, Fiverr"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="min-h-10 rounded-md border border-border bg-white px-3 text-sm focus:border-gold"
              />
              <datalist id="client-suggestions">
                {clientBalances.map((c) => (
                  <option key={c.client_name} value={c.client_name} />
                ))}
              </datalist>
            </label>
          </div>

          {/* Project (Optional) */}
          <SelectField
            label="Project (Optional)"
            value={projectId}
            onChange={(e) => handleSelectProject(e.target.value)}
          >
            <option value="">No specific project</option>
            {clientProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} - {p.project_title}
              </option>
            ))}
          </SelectField>
        </div>

        <Field
          label="Description *"
          required
          placeholder="e.g. QAI Reformatting Milestone Payment"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Amount ($) *"
            type="number"
            min="0.01"
            step="any"
            required
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          <Field
            label="Date *"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Payment Method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Status"
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value as 'Paid' | 'Partially Paid' | 'Pending')}
          >
            <option value="Paid">Paid</option>
            <option value="Partially Paid">Partially Paid</option>
            <option value="Pending">Pending</option>
          </SelectField>
        </div>

        {projectId && !transaction && (
          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={syncToProject}
              onChange={(e) => setSyncToProject(e.target.checked)}
              className="rounded border-border text-gold focus:ring-gold"
            />
            <span>Also update project paid amount (+{amount ? currency(Number(amount)) : '$0'})</span>
          </label>
        )}

        <TextareaField
          label="Notes (Optional)"
          placeholder="Payment transaction details or reference..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Income'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ExpenseFormModal({
  transaction,
  projects,
  onClose,
  onSave,
}: {
  transaction: FinanceTransaction | null;
  projects: Project[];
  onClose: () => void;
  onSave: (draft: FinanceTransactionDraft) => Promise<void>;
}) {
  const [description, setDescription] = useState(transaction?.description || '');
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '');
  const [category, setCategory] = useState(transaction?.category || 'Software');
  const [date, setDate] = useState(transaction?.transaction_date || new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState(transaction?.payment_method || 'Card');
  const [vendor, setVendor] = useState(transaction?.vendor || '');
  const [projectId, setProjectId] = useState(transaction?.project_id || '');
  const [notes, setNotes] = useState(transaction?.notes || '');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      setError('Please provide a description.');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError('Please enter a valid amount.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      await onSave({
        type: 'expense',
        category,
        description: description.trim(),
        amount: Number(amount),
        currency: 'USD',
        exchange_rate: 1.0,
        transaction_date: date,
        payment_method: paymentMethod,
        vendor: vendor.trim() || null,
        project_id: projectId || null,
        payment_status: 'Paid',
        notes: notes.trim() || null,
      });
    } catch (err) {
      setError(errorMessage(err, 'Failed to save expense.'));
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={transaction ? 'Edit Expense' : 'Add Expense'} onClose={onClose} width="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

        <Field
          label="Description *"
          required
          placeholder="e.g. Adobe Creative Cloud, Office Internet"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Amount ($) *"
            type="number"
            min="0.01"
            step="any"
            required
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          <SelectField
            label="Category *"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Date *"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />

          <SelectField
            label="Payment Method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Vendor (Optional)"
            placeholder="e.g. Adobe, PTCL, Amazon"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
          />

          <SelectField
            label="Project (Optional)"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">No Project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} - {p.project_title}
              </option>
            ))}
          </SelectField>
        </div>

        <TextareaField
          label="Notes (Optional)"
          placeholder="Optional invoice number, notes..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Expense'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function QuickProjectPaymentModal({
  project,
  onClose,
  onSave,
}: {
  project: Project;
  onClose: () => void;
  onSave: (amount: string, method: string, date: string, notes: string) => Promise<void>;
}) {
  const remaining = Math.max(0, Number(project.total_price || 0) - Number(project.advance_paid || 0));
  const [amount, setAmount] = useState(String(remaining || project.total_price || ''));
  const [method, setMethod] = useState('Bank Transfer');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(`Payment for ${project.project_title}`);
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <Modal title={`Record Payment — ${project.project_title}`} onClose={onClose} width="max-w-md">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (Number(amount) <= 0) return;
          setIsSubmitting(true);
          await onSave(amount, method, date, notes);
        }}
        className="space-y-4"
      >
        <div className="rounded-md bg-ivory p-3 text-xs text-muted border border-border">
          <p>
            Client: <strong className="text-ink">{project.client_name}</strong>
          </p>
          <p>
            Total Price: <strong className="text-ink">{currency(project.total_price)}</strong> · Paid:{' '}
            <strong className="text-emerald-700">{currency(project.advance_paid)}</strong> · Remaining Due:{' '}
            <strong className="text-rose-700">{currency(remaining)}</strong>
          </p>
        </div>

        <Field
          label="Payment Amount ($) *"
          type="number"
          min="0.01"
          step="any"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectField>

          <Field label="Date *" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <Field label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Recording...' : 'Record Payment'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PayrollLedgerEntryModal({
  employeeId,
  profiles,
  projects,
  month,
  defaultType,
  onClose,
  onSave,
}: {
  employeeId: string;
  profiles: Profile[];
  projects: Project[];
  month: string;
  defaultType: EmployeeLedgerEntry['entry_type'];
  onClose: () => void;
  onSave: (entry: Omit<EmployeeLedgerEntry, 'id' | 'created_at'>) => Promise<void>;
}) {
  const employee = profiles.find((p) => p.id === employeeId);
  const [type, setType] = useState<EmployeeLedgerEntry['entry_type']>(defaultType);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('Bank Transfer');
  const [projectId, setProjectId] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  return (
    <Modal title={`Record Entry — ${employee?.full_name || 'Employee'}`} onClose={onClose} width="max-w-md">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!amount || Number(amount) <= 0) {
            setError('Please enter a valid amount.');
            return;
          }
          try {
            setIsSubmitting(true);
            setError('');
            await onSave({
              employee_id: employeeId,
              entry_type: type,
              amount: Number(amount),
              salary_month: `${month}-01`,
              payment_method: method,
              project_id: projectId || null,
              notes: notes.trim(),
              paid_at: date,
            });
          } catch (err) {
            setError(errorMessage(err, 'Failed to save entry.'));
            setIsSubmitting(false);
          }
        }}
        className="space-y-4"
      >
        {error && <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

        <SelectField
          label="Entry Type *"
          value={type}
          onChange={(e) => setType(e.target.value as EmployeeLedgerEntry['entry_type'])}
        >
          <option value="Payment">Payment</option>
          <option value="Advance">Advance</option>
          <option value="Deduction">Deduction</option>
          <option value="Project Payment">Project Payment</option>
          <option value="Bonus">Bonus</option>
          <option value="Other">Other</option>
        </SelectField>

        <Field
          label="Amount ($) *"
          type="number"
          min="0.01"
          step="any"
          required
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date *" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          <SelectField label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectField>
        </div>

        {(type === 'Project Payment' || type === 'Bonus') && (
          <SelectField
            label="Project (Optional)"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">No Project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} - {p.project_title}
              </option>
            ))}
          </SelectField>
        )}

        <TextareaField
          label="Notes"
          placeholder="e.g. August salary disbursement, partial advance..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Entry'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
