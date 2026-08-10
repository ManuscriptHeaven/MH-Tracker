import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  DollarSign,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  HelpCircle,
  Landmark,
  Layers,
  PieChart,
  Plus,
  Printer,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tag,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  WalletCards,
  AlertTriangle,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, EmptyState, Field, Modal, SelectField, TextareaField } from '../components/ui';
import {
  DEFAULT_EXCHANGE_RATES,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  calculateCategoryBudgets,
  calculateClientReceivables,
  calculateProjectProfitability,
  calculateRecurringExpenses,
  calculateTeamPayroll,
  exportReportPDF,
  exportToCSV,
  formatCurrencyAmount,
  formatPKR,
  getConvertedPKR,
  isDateInRange,
  type DateFilterType,
} from '../lib/financeUtils';
import type {
  CurrencyCode,
  ExpenseCategory,
  FinanceBudget,
  FinanceTransaction,
  FinanceTransactionDraft,
  FinanceTransactionType,
  FinancialReportType,
  IncomeCategory,
  Profile,
  Project,
  RecurringStatus,
  EmployeeCompensation,
  EmployeeLedgerEntry,
} from '../lib/types';
import { errorMessage, firstName, isManagerRole } from '../lib/utils';

type FinanceTab =
  | 'overview'
  | 'income'
  | 'expenses'
  | 'ledger'
  | 'receivables'
  | 'payroll'
  | 'profitability'
  | 'budgets'
  | 'reports';

export function FinancePage({
  currentProfile,
  projects,
  profiles = [],
  employeeCompensation = [],
  employeeLedger = [],
  financeTransactions = [],
  financeBudgets = [],
  onCreateTransaction,
  onUpdateTransaction,
  onSoftDeleteTransaction,
  onSaveBudget,
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
  onSoftDeleteTransaction?: (id: string) => Promise<void>;
  onSaveBudget?: (category: string, monthlyBudgetPkr: number) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<FinanceTab>('overview');
  const [dateFilter, setDateFilter] = useState<DateFilterType>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [modalType, setModalType] = useState<FinanceTransactionType>('income');
  const [editingTransaction, setEditingTransaction] = useState<FinanceTransaction | null>(null);

  // Filters for Transactions Ledger
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [ledgerCategoryFilter, setLedgerCategoryFilter] = useState('all');
  const [ledgerClientFilter, setLedgerClientFilter] = useState('all');
  const [ledgerProjectFilter, setLedgerProjectFilter] = useState('all');
  const [ledgerCurrencyFilter, setLedgerCurrencyFilter] = useState('all');
  const [ledgerPaymentMethodFilter, setLedgerPaymentMethodFilter] = useState('all');

  // Selected Financial Report
  const [selectedReport, setSelectedReport] = useState<FinancialReportType>('pnl');

  const canManage = isManagerRole(currentProfile.role);

  // Active transactions (excluding soft-deleted)
  const activeTransactions = useMemo(() => {
    return financeTransactions.filter((t) => !t.is_soft_deleted);
  }, [financeTransactions]);

  // Date-filtered transactions
  const dateFilteredTransactions = useMemo(() => {
    return activeTransactions.filter((t) =>
      isDateInRange(t.transaction_date, dateFilter, customStart, customEnd),
    );
  }, [activeTransactions, dateFilter, customStart, customEnd]);

  // Filtered Projects based on date
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => isDateInRange(p.start_date || p.due_date, dateFilter, customStart, customEnd));
  }, [projects, dateFilter, customStart, customEnd]);

  // Key Financial Overview Metrics
  const financialTotals = useMemo(() => {
    const totalIncome = dateFilteredTransactions
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + Number(t.amount_pkr || 0), 0);

    const totalExpenses = dateFilteredTransactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + Number(t.amount_pkr || 0), 0);

    const netProfit = totalIncome - totalExpenses;
    const profitMargin = totalIncome > 0 ? Math.round((netProfit / totalIncome) * 100) : 0;

    // Accounts Receivable from Projects
    const receivablesList = calculateClientReceivables(projects);
    const totalReceivables = receivablesList.reduce((sum, r) => sum + r.outstanding_pkr, 0);

    // Accounts Payable from recurring & unbilled operational expenses
    const recurringList = calculateRecurringExpenses(activeTransactions);
    const totalPayables = recurringList.reduce((sum, r) => sum + r.monthly_cost_pkr, 0);

    // Team Payroll
    const payrollList = calculateTeamPayroll(profiles, employeeCompensation, employeeLedger);
    const totalPayrollDues = payrollList.reduce((sum, p) => sum + p.remaining_due_pkr, 0);
    const totalPayrollMonthly = payrollList.reduce((sum, p) => sum + p.net_payable_pkr, 0);

    // Total Cash in hand (all-time Income minus Expenses)
    const allTimeIncome = activeTransactions
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + Number(t.amount_pkr || 0), 0);
    const allTimeExpense = activeTransactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + Number(t.amount_pkr || 0), 0);
    const availableCash = allTimeIncome - allTimeExpense;

    return {
      availableCash,
      totalIncome,
      totalExpenses,
      netProfit,
      profitMargin,
      totalReceivables,
      totalPayables,
      totalPayrollMonthly,
      totalPayrollDues,
    };
  }, [dateFilteredTransactions, projects, activeTransactions, profiles, employeeCompensation, employeeLedger]);

  // Client Receivables Summary
  const receivables = useMemo(() => calculateClientReceivables(projects), [projects]);

  // Team Payroll Summary
  const payroll = useMemo(
    () => calculateTeamPayroll(profiles, employeeCompensation, employeeLedger),
    [profiles, employeeCompensation, employeeLedger],
  );

  // Project Profitability Summary
  const projectProfitability = useMemo(
    () => calculateProjectProfitability(projects, activeTransactions, employeeLedger),
    [projects, activeTransactions, employeeLedger],
  );

  // Category Budgets Summary
  const budgetsSummary = useMemo(
    () => calculateCategoryBudgets(activeTransactions, financeBudgets),
    [activeTransactions, financeBudgets],
  );

  // Recurring Expenses Summary
  const recurringExpenses = useMemo(
    () => calculateRecurringExpenses(activeTransactions),
    [activeTransactions],
  );

  // Ledger Filtered Transactions
  const ledgerFilteredTransactions = useMemo(() => {
    return activeTransactions.filter((t) => {
      if (ledgerTypeFilter !== 'all' && t.type !== ledgerTypeFilter) return false;
      if (ledgerCategoryFilter !== 'all' && t.category !== ledgerCategoryFilter) return false;
      if (ledgerClientFilter !== 'all' && t.client_name !== ledgerClientFilter) return false;
      if (ledgerProjectFilter !== 'all' && t.project_id !== ledgerProjectFilter) return false;
      if (ledgerCurrencyFilter !== 'all' && t.currency !== ledgerCurrencyFilter) return false;
      if (ledgerPaymentMethodFilter !== 'all' && t.payment_method !== ledgerPaymentMethodFilter)
        return false;

      if (!isDateInRange(t.transaction_date, dateFilter, customStart, customEnd)) return false;

      if (ledgerSearch.trim()) {
        const query = ledgerSearch.trim().toLowerCase();
        const haystack = [
          t.description,
          t.category,
          t.client_name,
          t.vendor,
          t.reference_no,
          t.payment_method,
          t.notes,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(query);
      }

      return true;
    });
  }, [
    activeTransactions,
    ledgerTypeFilter,
    ledgerCategoryFilter,
    ledgerClientFilter,
    ledgerProjectFilter,
    ledgerCurrencyFilter,
    ledgerPaymentMethodFilter,
    dateFilter,
    customStart,
    customEnd,
    ledgerSearch,
  ]);

  // Export handlers
  function handleExportCSV() {
    if (activeTab === 'receivables') {
      const headers = ['Client Name', 'Client Email', 'Projects', 'Total Invoiced (PKR)', 'Total Paid (PKR)', 'Outstanding (PKR)', 'Overdue (PKR)'];
      const rows = receivables.map((r) => [r.client_name, r.client_email, r.project_count, r.total_invoiced_pkr, r.total_paid_pkr, r.outstanding_pkr, r.overdue_pkr]);
      exportToCSV('Client_Receivables_Report', headers, rows);
      return;
    }

    if (activeTab === 'payroll') {
      const headers = ['Employee', 'Monthly Salary', 'Project Earnings', 'Advances', 'Paid', 'Net Payable', 'Remaining Due', 'Status'];
      const rows = payroll.map((p) => [p.employee_name, p.monthly_salary_pkr, p.bonus_pkr, p.advance_pkr, p.paid_pkr, p.net_payable_pkr, p.remaining_due_pkr, p.status]);
      exportToCSV('Team_Payroll_Report', headers, rows);
      return;
    }

    if (activeTab === 'profitability') {
      const headers = ['Project #', 'Project Title', 'Client', 'Revenue (PKR)', 'Team Cost (PKR)', 'Expenses (PKR)', 'Fees (PKR)', 'Net Profit (PKR)', 'Margin %'];
      const rows = projectProfitability.map((p) => [p.project_number, p.project_title, p.client_name, p.revenue_pkr, p.team_cost_pkr, p.direct_expenses_pkr, p.payment_fees_pkr, p.net_profit_pkr, `${p.profit_margin_percent}%`]);
      exportToCSV('Project_Profitability_Report', headers, rows);
      return;
    }

    // Default Transactions CSV
    const headers = ['Date', 'Type', 'Category', 'Description', 'Client/Vendor', 'Amount Native', 'Currency', 'Exchange Rate', 'Amount PKR', 'Payment Method', 'Ref #'];
    const rows = ledgerFilteredTransactions.map((t) => [t.transaction_date, t.type.toUpperCase(), t.category, t.description, t.client_name || t.vendor || '', t.amount, t.currency, t.exchange_rate, t.amount_pkr, t.payment_method, t.reference_no || '']);
    exportToCSV(`Financial_Transactions_${dateFilter}`, headers, rows);
  }

  function handleExportPDFReport() {
    if (selectedReport === 'pnl') {
      const headers = ['Financial Metric', 'Amount (PKR)'];
      const rows = [
        ['Total Gross Revenue', formatPKR(financialTotals.totalIncome)],
        ['Total Expenses', formatPKR(financialTotals.totalExpenses)],
        ['Team Payroll', formatPKR(financialTotals.totalPayrollMonthly)],
        ['Net Operating Profit', formatPKR(financialTotals.netProfit)],
        ['Overall Profit Margin', `${financialTotals.profitMargin}%`],
      ];
      exportReportPDF('Profit & Loss (P&L) Statement', `Financial Period: ${dateFilter.replace('_', ' ').toUpperCase()}`, headers, rows, [
        { label: 'Total Revenue', value: formatPKR(financialTotals.totalIncome) },
        { label: 'Total Expenses', value: formatPKR(financialTotals.totalExpenses) },
        { label: 'Net Profit', value: formatPKR(financialTotals.netProfit) },
      ]);
    } else if (selectedReport === 'receivables') {
      const headers = ['Client Name', 'Projects', 'Total Invoiced', 'Paid Amount', 'Outstanding Due', 'Overdue'];
      const rows = receivables.map((r) => [r.client_name, r.project_count, formatPKR(r.total_invoiced_pkr), formatPKR(r.total_paid_pkr), formatPKR(r.outstanding_pkr), formatPKR(r.overdue_pkr)]);
      exportReportPDF('Client Receivables Statement', 'Accounts Receivable Analysis', headers, rows, [
        { label: 'Total Outstanding', value: formatPKR(financialTotals.totalReceivables) },
      ]);
    } else if (selectedReport === 'payroll') {
      const headers = ['Employee Name', 'Monthly Salary', 'Bonus/Project', 'Total Paid', 'Remaining Dues', 'Status'];
      const rows = payroll.map((p) => [p.employee_name, formatPKR(p.monthly_salary_pkr), formatPKR(p.bonus_pkr), formatPKR(p.paid_pkr), formatPKR(p.remaining_due_pkr), p.status]);
      exportReportPDF('Team Payroll Summary', 'Employee Compensation & Dues', headers, rows, [
        { label: 'Outstanding Dues', value: formatPKR(financialTotals.totalPayrollDues) },
      ]);
    } else {
      const headers = ['Date', 'Type', 'Category', 'Description', 'Amount Native', 'Currency', 'Amount (PKR)'];
      const rows = dateFilteredTransactions.map((t) => [t.transaction_date, t.type.toUpperCase(), t.category, t.description, formatCurrencyAmount(t.amount, t.currency), t.currency, formatPKR(t.amount_pkr)]);
      exportReportPDF('Financial Transactions Report', `Transactions for ${dateFilter.replace('_', ' ')}`, headers, rows, [
        { label: 'Income', value: formatPKR(financialTotals.totalIncome) },
        { label: 'Expenses', value: formatPKR(financialTotals.totalExpenses) },
      ]);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between rounded-2xl border border-border bg-gradient-to-r from-ink via-ink/95 to-ink/90 p-6 text-white shadow-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-gold px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink">
              Enterprise ERP
            </span>
            <p className="text-xs font-medium text-white/70">Admin Financial Management</p>
          </div>
          <h2 className="mt-1 font-display text-3xl font-bold tracking-tight">Finance System</h2>
          <p className="mt-1 text-sm text-white/70">
            Real-time business accounts, client receivables, team payroll, project margins & expense budgets.
          </p>
        </div>

        {/* Action Controls & Date Filter */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded-lg bg-white/10 p-1.5 text-xs text-white backdrop-blur">
            <Calendar className="h-4 w-4 text-gold" />
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilterType)}
              className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer"
            >
              <option value="this_month" className="text-ink">This Month</option>
              <option value="last_month" className="text-ink">Last Month</option>
              <option value="this_quarter" className="text-ink">This Quarter</option>
              <option value="this_year" className="text-ink">This Year</option>
              <option value="all" className="text-ink">All Time</option>
              <option value="custom" className="text-ink">Custom Date Range</option>
            </select>
          </div>

          {dateFilter === 'custom' ? (
            <div className="flex items-center gap-1.5 text-xs">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-8 rounded-md border border-white/20 bg-white/10 px-2 text-white placeholder-white/50"
              />
              <span className="text-white/60">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-8 rounded-md border border-white/20 bg-white/10 px-2 text-white placeholder-white/50"
              />
            </div>
          ) : null}

          {canManage ? (
            <>
              <Button
                type="button"
                onClick={() => {
                  setEditingTransaction(null);
                  setModalType('income');
                  setShowTransactionModal(true);
                }}
                className="h-9 px-3 text-xs shadow-sm bg-emerald-600 hover:bg-emerald-700 text-white border-none"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Income
              </Button>

              <Button
                type="button"
                onClick={() => {
                  setEditingTransaction(null);
                  setModalType('expense');
                  setShowTransactionModal(true);
                }}
                className="h-9 px-3 text-xs shadow-sm bg-rose-600 hover:bg-rose-700 text-white border-none"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Expense
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* KPI Overview Cards */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <KpiCard
          label="Available Cash"
          value={formatPKR(financialTotals.availableCash)}
          icon={<WalletCards className="h-4 w-4 text-emerald-600" />}
          tone="text-ink"
        />
        <KpiCard
          label="Total Income"
          value={formatPKR(financialTotals.totalIncome)}
          icon={<ArrowDownRight className="h-4 w-4 text-emerald-600" />}
          tone="text-emerald-700"
        />
        <KpiCard
          label="Total Expenses"
          value={formatPKR(financialTotals.totalExpenses)}
          icon={<ArrowUpRight className="h-4 w-4 text-rose-600" />}
          tone="text-rose-700"
        />
        <KpiCard
          label="Net Profit"
          value={formatPKR(financialTotals.netProfit)}
          icon={<TrendingUp className="h-4 w-4 text-gold" />}
          tone={financialTotals.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}
        />
        <KpiCard
          label="Profit Margin"
          value={`${financialTotals.profitMargin}%`}
          icon={<BarChart3 className="h-4 w-4 text-blue-600" />}
          tone="text-blue-700"
        />
        <KpiCard
          label="Receivables"
          value={formatPKR(financialTotals.totalReceivables)}
          icon={<DollarSign className="h-4 w-4 text-amber-600" />}
          tone="text-amber-700"
        />
        <KpiCard
          label="Payables"
          value={formatPKR(financialTotals.totalPayables)}
          icon={<CreditCard className="h-4 w-4 text-purple-600" />}
          tone="text-purple-700"
        />
        <KpiCard
          label="Team Payroll"
          value={formatPKR(financialTotals.totalPayrollMonthly)}
          icon={<Users className="h-4 w-4 text-indigo-600" />}
          tone="text-indigo-700"
        />
      </section>

      {/* Main Tab Workspace Navigation */}
      <div className="flex flex-wrap items-center justify-between border-b border-border/80 pb-3 gap-2">
        <div className="flex flex-wrap gap-1.5">
          {([
            ['overview', '1. Overview', Landmark],
            ['income', '2. Income', ArrowDownRight],
            ['expenses', '3. Expenses', ArrowUpRight],
            ['ledger', '4. Transactions', Layers],
            ['receivables', '5. Receivables', DollarSign],
            ['payroll', '6. Team Payroll', Users],
            ['profitability', '7. Project Profitability', TrendingUp],
            ['budgets', '8. Budgets & Recurring', PieChart],
            ['reports', '9. Financial Reports', FileText],
          ] as const).map(([id, label, Icon]) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  active
                    ? 'bg-ink text-white shadow-sm'
                    : 'bg-white text-muted border border-border hover:bg-ivory hover:text-ink'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={handleExportCSV} className="h-8 px-2.5 text-xs gap-1.5">
            <Download className="h-3.5 w-3.5" />
            CSV Export
          </Button>

          <Button type="button" variant="secondary" onClick={handleExportPDFReport} className="h-8 px-2.5 text-xs gap-1.5">
            <Printer className="h-3.5 w-3.5" />
            Print Report
          </Button>
        </div>
      </div>

      {/* Tab 1: Overview Workspace */}
      {activeTab === 'overview' ? (
        <div className="space-y-6">
          {/* Charts Row */}
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Cash Flow Visual Chart */}
            <Card>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <h3 className="font-display text-lg font-bold text-ink">Cash Flow Analysis</h3>
                  <p className="text-xs text-muted">Money In (Income) vs. Money Out (Expenses)</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
                  {formatPKR(financialTotals.netProfit)} Net
                </span>
              </div>

              <div className="mt-4 flex h-48 items-end gap-3 pt-6 px-2 border-b border-border pb-2">
                <div className="flex h-full w-full flex-col justify-end gap-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-charcoal">
                    <span>Total Income</span>
                    <span className="text-emerald-700">{formatPKR(financialTotals.totalIncome)}</span>
                  </div>
                  <div className="h-6 w-full rounded-md bg-emerald-100 overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 transition-all duration-500"
                      style={{ width: `${financialTotals.totalIncome ? 100 : 0}%` }}
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs font-semibold text-charcoal">
                    <span>Total Expenses</span>
                    <span className="text-rose-700">{formatPKR(financialTotals.totalExpenses)}</span>
                  </div>
                  <div className="h-6 w-full rounded-md bg-rose-100 overflow-hidden">
                    <div
                      className="h-full bg-rose-600 transition-all duration-500"
                      style={{
                        width: `${
                          financialTotals.totalIncome
                            ? Math.min(
                                100,
                                Math.round((financialTotals.totalExpenses / financialTotals.totalIncome) * 100),
                              )
                            : financialTotals.totalExpenses
                              ? 100
                              : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-3 flex justify-between text-xs font-medium text-muted">
                <span>Margin: {financialTotals.profitMargin}%</span>
                <span>Available Cash: {formatPKR(financialTotals.availableCash)}</span>
              </div>
            </Card>

            {/* Expense Breakdown Progress */}
            <Card>
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <h3 className="font-display text-lg font-bold text-ink">Expense Categories</h3>
                  <p className="text-xs text-muted">Breakdown of operational & project costs</p>
                </div>
                <PieChart className="h-4 w-4 text-gold" />
              </div>

              <div className="mt-4 space-y-3 max-h-48 overflow-y-auto pr-1">
                {budgetsSummary
                  .filter((b) => b.actual_pkr > 0)
                  .map((b) => {
                    const percent = financialTotals.totalExpenses
                      ? Math.round((b.actual_pkr / financialTotals.totalExpenses) * 100)
                      : 0;

                    return (
                      <div key={b.category} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-medium">
                          <span className="text-ink font-semibold">{b.category}</span>
                          <span className="text-muted">
                            {formatPKR(b.actual_pkr)} ({percent}%)
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-ivory">
                          <div
                            className="h-full bg-gold transition-all duration-300"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                {!budgetsSummary.some((b) => b.actual_pkr > 0) ? (
                  <p className="text-xs text-muted py-8 text-center">No expense transactions recorded in this period.</p>
                ) : null}
              </div>
            </Card>
          </div>

          {/* Outstanding Summaries Row */}
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Receivables Table Preview */}
            <Card className="p-0 overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-ivory/50">
                <div>
                  <h3 className="font-display text-base font-bold text-ink">Client Receivables</h3>
                  <p className="text-xs text-muted">Outstanding project balances</p>
                </div>
                <Button type="button" variant="ghost" onClick={() => setActiveTab('receivables')} className="text-xs gap-1">
                  View All <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-ivory text-muted uppercase tracking-wider font-semibold border-b border-border/60">
                    <tr>
                      <th className="px-4 py-2.5">Client</th>
                      <th className="px-4 py-2.5">Projects</th>
                      <th className="px-4 py-2.5">Invoiced</th>
                      <th className="px-4 py-2.5">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {receivables.slice(0, 5).map((r) => (
                      <tr key={r.client_name} className="hover:bg-ivory/40">
                        <td className="px-4 py-3 font-semibold text-ink">{r.client_name}</td>
                        <td className="px-4 py-3 text-muted">{r.project_count}</td>
                        <td className="px-4 py-3 font-medium">{formatPKR(r.total_invoiced_pkr)}</td>
                        <td className="px-4 py-3 font-bold text-amber-700">{formatPKR(r.outstanding_pkr)}</td>
                      </tr>
                    ))}
                    {!receivables.length ? (
                      <tr>
                        <td colSpan={4} className="p-4 text-center text-muted">No client receivables found.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Team Payroll Preview */}
            <Card className="p-0 overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-ivory/50">
                <div>
                  <h3 className="font-display text-base font-bold text-ink">Team Payroll Summary</h3>
                  <p className="text-xs text-muted">Employee compensation & remaining dues</p>
                </div>
                <Button type="button" variant="ghost" onClick={() => setActiveTab('payroll')} className="text-xs gap-1">
                  View All <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-ivory text-muted uppercase tracking-wider font-semibold border-b border-border/60">
                    <tr>
                      <th className="px-4 py-2.5">Employee</th>
                      <th className="px-4 py-2.5">Monthly Salary</th>
                      <th className="px-4 py-2.5">Paid</th>
                      <th className="px-4 py-2.5">Dues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {payroll.slice(0, 5).map((p) => (
                      <tr key={p.employee_id} className="hover:bg-ivory/40">
                        <td className="px-4 py-3 font-semibold text-ink">{p.employee_name}</td>
                        <td className="px-4 py-3 text-muted">{formatPKR(p.monthly_salary_pkr)}</td>
                        <td className="px-4 py-3 font-medium text-emerald-700">{formatPKR(p.paid_pkr)}</td>
                        <td className="px-4 py-3 font-bold text-rose-700">{formatPKR(p.remaining_due_pkr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {/* Tab 2: Income Workspace */}
      {activeTab === 'income' ? (
        <Card className="p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-ivory/50">
            <div>
              <h3 className="font-display text-lg font-bold text-ink">Income Records</h3>
              <p className="text-xs text-muted">All incoming revenue streams, client payments & invoices</p>
            </div>
            {canManage ? (
              <Button
                type="button"
                onClick={() => {
                  setEditingTransaction(null);
                  setModalType('income');
                  setShowTransactionModal(true);
                }}
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Income
              </Button>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-ivory text-muted uppercase tracking-wider font-semibold border-b border-border/60">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Client / Project</th>
                  <th className="px-4 py-3">Native Amount</th>
                  <th className="px-4 py-3">Amount (PKR)</th>
                  <th className="px-4 py-3">Payment Method</th>
                  {canManage ? <th className="px-4 py-3 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {dateFilteredTransactions
                  .filter((t) => t.type === 'income')
                  .map((t) => (
                    <tr key={t.id} className="hover:bg-ivory/40">
                      <td className="px-4 py-3 font-medium text-muted">{t.transaction_date}</td>
                      <td className="px-4 py-3 font-semibold text-ink">{t.description}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 border border-emerald-200">
                          {t.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {t.client_name ? <p className="font-medium text-ink">{t.client_name}</p> : null}
                        {t.project_id ? (
                          <p className="text-[11px] text-muted">
                            {projects.find((p) => p.id === t.project_id)?.project_number}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-semibold text-emerald-700">
                        {formatCurrencyAmount(t.amount, t.currency)}
                      </td>
                      <td className="px-4 py-3 font-bold text-ink">{formatPKR(t.amount_pkr)}</td>
                      <td className="px-4 py-3 text-muted">{t.payment_method}</td>
                      {canManage ? (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm('Delete this income record?')) {
                                void onSoftDeleteTransaction?.(t.id);
                              }
                            }}
                            className="rounded p-1 text-muted hover:bg-rose-50 hover:text-rose-600"
                            title="Soft delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                {!dateFilteredTransactions.some((t) => t.type === 'income') ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted">
                      No income records logged for this period.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Tab 3: Expenses Workspace */}
      {activeTab === 'expenses' ? (
        <Card className="p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-ivory/50">
            <div>
              <h3 className="font-display text-lg font-bold text-ink">Expense Records</h3>
              <p className="text-xs text-muted">Operational expenses, software, vendors & team payouts</p>
            </div>
            {canManage ? (
              <Button
                type="button"
                onClick={() => {
                  setEditingTransaction(null);
                  setModalType('expense');
                  setShowTransactionModal(true);
                }}
                className="h-8 text-xs bg-rose-600 hover:bg-rose-700 text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Expense
              </Button>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-ivory text-muted uppercase tracking-wider font-semibold border-b border-border/60">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Vendor / Project</th>
                  <th className="px-4 py-3">Native Amount</th>
                  <th className="px-4 py-3">Amount (PKR)</th>
                  <th className="px-4 py-3">Recurring</th>
                  {canManage ? <th className="px-4 py-3 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {dateFilteredTransactions
                  .filter((t) => t.type === 'expense')
                  .map((t) => (
                    <tr key={t.id} className="hover:bg-ivory/40">
                      <td className="px-4 py-3 font-medium text-muted">{t.transaction_date}</td>
                      <td className="px-4 py-3 font-semibold text-ink">{t.description}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-800 border border-rose-200">
                          {t.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {t.vendor ? <p className="font-medium text-ink">{t.vendor}</p> : null}
                        {t.project_id ? (
                          <p className="text-[11px] text-muted">
                            {projects.find((p) => p.id === t.project_id)?.project_number}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-semibold text-rose-700">
                        {formatCurrencyAmount(t.amount, t.currency)}
                      </td>
                      <td className="px-4 py-3 font-bold text-ink">{formatPKR(t.amount_pkr)}</td>
                      <td className="px-4 py-3 text-muted capitalize">
                        {t.recurring_status && t.recurring_status !== 'none' ? (
                          <span className="rounded bg-gold/15 px-2 py-0.5 text-[10px] font-bold text-ink">
                            {t.recurring_status}
                          </span>
                        ) : (
                          'One-time'
                        )}
                      </td>
                      {canManage ? (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm('Delete this expense record?')) {
                                void onSoftDeleteTransaction?.(t.id);
                              }
                            }}
                            className="rounded p-1 text-muted hover:bg-rose-50 hover:text-rose-600"
                            title="Soft delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                {!dateFilteredTransactions.some((t) => t.type === 'expense') ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted">
                      No expense records logged for this period.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Tab 4: Transactions Ledger */}
      {activeTab === 'ledger' ? (
        <div className="space-y-4">
          {/* Multi-Filter Control Box */}
          <Card className="p-4 bg-white space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  placeholder="Search description, vendor, client, reference..."
                  className="h-10 w-full rounded-md border border-border bg-white pl-9 pr-3 text-xs focus:border-gold"
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <SelectField
                  value={ledgerTypeFilter}
                  onChange={(e) => setLedgerTypeFilter(e.target.value as any)}
                  className="h-10 text-xs w-32"
                >
                  <option value="all">All Types</option>
                  <option value="income">Income Only</option>
                  <option value="expense">Expenses Only</option>
                </SelectField>

                <SelectField
                  value={ledgerCurrencyFilter}
                  onChange={(e) => setLedgerCurrencyFilter(e.target.value)}
                  className="h-10 text-xs w-32"
                >
                  <option value="all">All Currencies</option>
                  <option value="PKR">PKR</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </SelectField>

                <SelectField
                  value={ledgerPaymentMethodFilter}
                  onChange={(e) => setLedgerPaymentMethodFilter(e.target.value)}
                  className="h-10 text-xs w-36"
                >
                  <option value="all">All Methods</option>
                  {PAYMENT_METHODS.map((pm) => (
                    <option key={pm} value={pm}>
                      {pm}
                    </option>
                  ))}
                </SelectField>
              </div>
            </div>
          </Card>

          {/* Full Transaction Table */}
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-ivory text-muted uppercase tracking-wider font-semibold border-b border-border/60">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Client / Vendor</th>
                    <th className="px-4 py-3">Native Amount</th>
                    <th className="px-4 py-3">Amount (PKR)</th>
                    <th className="px-4 py-3">Method</th>
                    {canManage ? <th className="px-4 py-3 text-right">Actions</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {ledgerFilteredTransactions.map((t) => (
                    <tr key={t.id} className="hover:bg-ivory/40">
                      <td className="px-4 py-3 font-medium text-muted">{t.transaction_date}</td>
                      <td className="px-4 py-3 font-semibold text-ink">
                        {t.description}
                        {t.reference_no ? (
                          <span className="block text-[10px] text-muted font-normal">Ref: {t.reference_no}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            t.type === 'income'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {t.type.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">{t.category}</td>
                      <td className="px-4 py-3 text-muted">{t.client_name || t.vendor || '—'}</td>
                      <td
                        className={`px-4 py-3 font-semibold ${
                          t.type === 'income' ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {formatCurrencyAmount(t.amount, t.currency)}
                      </td>
                      <td className="px-4 py-3 font-bold text-ink">{formatPKR(t.amount_pkr)}</td>
                      <td className="px-4 py-3 text-muted">{t.payment_method}</td>
                      {canManage ? (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm('Soft-delete this transaction?')) {
                                void onSoftDeleteTransaction?.(t.id);
                              }
                            }}
                            className="rounded p-1 text-muted hover:bg-rose-50 hover:text-rose-600"
                            title="Delete entry"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {!ledgerFilteredTransactions.length ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-muted">
                        No transactions found matching criteria.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {/* Tab 5: Client Receivables */}
      {activeTab === 'receivables' ? (
        <Card className="p-0 overflow-hidden space-y-4">
          <div className="p-5 border-b border-border bg-ivory/50">
            <h3 className="font-display text-lg font-bold text-ink">Client Accounts Receivable</h3>
            <p className="text-xs text-muted">Total invoiced revenue, payments received & pending client balances</p>
          </div>

          <div className="overflow-x-auto px-5 pb-5">
            <table className="w-full text-left text-xs">
              <thead className="bg-ivory text-muted uppercase tracking-wider font-semibold border-b border-border/60">
                <tr>
                  <th className="px-4 py-3">Client Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Projects</th>
                  <th className="px-4 py-3">Total Invoiced</th>
                  <th className="px-4 py-3">Total Paid</th>
                  <th className="px-4 py-3">Outstanding</th>
                  <th className="px-4 py-3">Overdue Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {receivables.map((r) => (
                  <tr key={r.client_name} className="hover:bg-ivory/40">
                    <td className="px-4 py-3 font-semibold text-ink">{r.client_name}</td>
                    <td className="px-4 py-3 text-muted">{r.client_email || '—'}</td>
                    <td className="px-4 py-3 font-medium">{r.project_count}</td>
                    <td className="px-4 py-3 font-medium">{formatPKR(r.total_invoiced_pkr)}</td>
                    <td className="px-4 py-3 font-semibold text-emerald-700">{formatPKR(r.total_paid_pkr)}</td>
                    <td className="px-4 py-3 font-bold text-amber-700">{formatPKR(r.outstanding_pkr)}</td>
                    <td className="px-4 py-3 font-bold text-rose-700">{formatPKR(r.overdue_pkr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Tab 6: Team Payroll */}
      {activeTab === 'payroll' ? (
        <Card className="p-0 overflow-hidden">
          <div className="p-5 border-b border-border bg-ivory/50">
            <h3 className="font-display text-lg font-bold text-ink">Team Payroll & Dues</h3>
            <p className="text-xs text-muted">Employee compensation, advances, deductions & outstanding payroll</p>
          </div>

          <div className="overflow-x-auto p-5">
            <table className="w-full text-left text-xs">
              <thead className="bg-ivory text-muted uppercase tracking-wider font-semibold border-b border-border/60">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Monthly Salary</th>
                  <th className="px-4 py-3">Project Earnings</th>
                  <th className="px-4 py-3">Advance</th>
                  <th className="px-4 py-3">Net Payable</th>
                  <th className="px-4 py-3">Total Paid</th>
                  <th className="px-4 py-3">Remaining Dues</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {payroll.map((p) => (
                  <tr key={p.employee_id} className="hover:bg-ivory/40">
                    <td className="px-4 py-3 font-semibold text-ink">{p.employee_name}</td>
                    <td className="px-4 py-3 text-muted">{formatPKR(p.monthly_salary_pkr)}</td>
                    <td className="px-4 py-3 text-muted">{formatPKR(p.bonus_pkr)}</td>
                    <td className="px-4 py-3 text-muted">{formatPKR(p.advance_pkr)}</td>
                    <td className="px-4 py-3 font-semibold text-ink">{formatPKR(p.net_payable_pkr)}</td>
                    <td className="px-4 py-3 font-semibold text-emerald-700">{formatPKR(p.paid_pkr)}</td>
                    <td className="px-4 py-3 font-bold text-rose-700">{formatPKR(p.remaining_due_pkr)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          p.status === 'Paid'
                            ? 'bg-emerald-100 text-emerald-800'
                            : p.status === 'Partial'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Tab 7: Project Profitability */}
      {activeTab === 'profitability' ? (
        <Card className="p-0 overflow-hidden">
          <div className="p-5 border-b border-border bg-ivory/50">
            <h3 className="font-display text-lg font-bold text-ink">Project Profitability Matrix</h3>
            <p className="text-xs text-muted">Per-project revenue, team costs, direct expenses & profit margins</p>
          </div>

          <div className="overflow-x-auto p-5">
            <table className="w-full text-left text-xs">
              <thead className="bg-ivory text-muted uppercase tracking-wider font-semibold border-b border-border/60">
                <tr>
                  <th className="px-4 py-3">Project #</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Revenue</th>
                  <th className="px-4 py-3">Team Cost</th>
                  <th className="px-4 py-3">Expenses</th>
                  <th className="px-4 py-3">Fees (2.5%)</th>
                  <th className="px-4 py-3">Net Profit</th>
                  <th className="px-4 py-3">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {projectProfitability.map((p) => (
                  <tr key={p.project_id} className="hover:bg-ivory/40">
                    <td className="px-4 py-3 font-semibold text-ink">{p.project_number}</td>
                    <td className="px-4 py-3 font-medium text-ink">{p.project_title}</td>
                    <td className="px-4 py-3 text-muted">{p.client_name}</td>
                    <td className="px-4 py-3 font-semibold text-emerald-700">{formatPKR(p.revenue_pkr)}</td>
                    <td className="px-4 py-3 text-muted">{formatPKR(p.team_cost_pkr)}</td>
                    <td className="px-4 py-3 text-muted">{formatPKR(p.direct_expenses_pkr)}</td>
                    <td className="px-4 py-3 text-muted">{formatPKR(p.payment_fees_pkr)}</td>
                    <td
                      className={`px-4 py-3 font-bold ${
                        p.net_profit_pkr >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {formatPKR(p.net_profit_pkr)}
                    </td>
                    <td className="px-4 py-3 font-bold text-ink">{p.profit_margin_percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Tab 8: Budgets & Recurring */}
      {activeTab === 'budgets' ? (
        <div className="space-y-6">
          {/* Category Budgets Grid */}
          <Card>
            <h3 className="font-display text-lg font-bold text-ink">Monthly Category Budgets</h3>
            <p className="text-xs text-muted">Spend limits vs actual spend for current month</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {budgetsSummary.map((b) => (
                <div key={b.category} className="rounded-xl border border-border bg-white p-4 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink text-xs">{b.category}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        b.status === 'exceeded'
                          ? 'bg-rose-100 text-rose-800'
                          : b.status === 'warning'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {b.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-bold text-ink">{formatPKR(b.actual_pkr)}</span>
                    <span className="text-muted">Budget: {formatPKR(b.budget_pkr)}</span>
                  </div>

                  <div className="h-2 w-full overflow-hidden rounded-full bg-ivory">
                    <div
                      className={`h-full transition-all duration-300 ${
                        b.status === 'exceeded' ? 'bg-rose-600' : b.status === 'warning' ? 'bg-amber-500' : 'bg-emerald-600'
                      }`}
                      style={{ width: `${Math.min(100, b.usage_percent)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Recurring Expenses Table */}
          <Card className="p-0 overflow-hidden">
            <div className="p-5 border-b border-border bg-ivory/50">
              <h3 className="font-display text-lg font-bold text-ink">Recurring Subscriptions</h3>
              <p className="text-xs text-muted">Software, hosting, domains & recurring services</p>
            </div>

            <div className="overflow-x-auto p-5">
              <table className="w-full text-left text-xs">
                <thead className="bg-ivory text-muted uppercase tracking-wider font-semibold border-b border-border/60">
                  <tr>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Vendor</th>
                    <th className="px-4 py-3">Monthly Cost</th>
                    <th className="px-4 py-3">Annual Cost</th>
                    <th className="px-4 py-3">Frequency</th>
                    <th className="px-4 py-3">Next Due Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {recurringExpenses.map((r) => (
                    <tr key={r.id} className="hover:bg-ivory/40">
                      <td className="px-4 py-3 font-semibold text-ink">{r.description}</td>
                      <td className="px-4 py-3 text-muted">{r.category}</td>
                      <td className="px-4 py-3 text-muted">{r.vendor}</td>
                      <td className="px-4 py-3 font-semibold text-ink">{formatPKR(r.monthly_cost_pkr)}</td>
                      <td className="px-4 py-3 font-medium text-muted">{formatPKR(r.annual_cost_pkr)}</td>
                      <td className="px-4 py-3 capitalize">{r.recurring_status}</td>
                      <td className="px-4 py-3 text-muted">{r.next_date || '—'}</td>
                    </tr>
                  ))}
                  {!recurringExpenses.length ? (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-muted">No active recurring subscriptions logged.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {/* Tab 9: Financial Reports */}
      {activeTab === 'reports' ? (
        <Card className="space-y-6">
          <div>
            <h3 className="font-display text-xl font-bold text-ink">Financial Reports Builder</h3>
            <p className="text-xs text-muted">Generate, print and export official company financial reports</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['pnl', 'Profit & Loss (P&L)', 'Statement of revenues and expenses'],
              ['receivables', 'Client Receivables', 'Accounts receivable statement'],
              ['payroll', 'Team Payroll', 'Employee compensation & dues'],
              ['profitability', 'Project Profitability', 'Margins by project'],
            ] as const).map(([id, label, desc]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedReport(id)}
                className={`rounded-xl border p-4 text-left transition ${
                  selectedReport === id
                    ? 'border-gold bg-gold/10 shadow-sm'
                    : 'border-border bg-white hover:border-gold/50'
                }`}
              >
                <p className="font-display text-sm font-bold text-ink">{label}</p>
                <p className="mt-1 text-xs text-muted">{desc}</p>
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-3 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={handleExportCSV} className="gap-1.5 text-xs">
              <FileSpreadsheet className="h-4 w-4" />
              Export Excel / CSV
            </Button>

            <Button type="button" onClick={handleExportPDFReport} className="gap-1.5 text-xs">
              <Printer className="h-4 w-4" />
              Print / Save PDF Report
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Add / Edit Transaction Modal */}
      {showTransactionModal ? (
        <TransactionModal
          type={modalType}
          projects={projects}
          profiles={profiles}
          onClose={() => setShowTransactionModal(false)}
          onSave={async (draft) => {
            await onCreateTransaction?.(draft);
            setShowTransactionModal(false);
          }}
        />
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-3.5 shadow-xs transition hover:shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <span className="rounded-md bg-ivory p-1.5">{icon}</span>
      </div>
      <p className={`mt-1.5 text-lg font-bold tracking-tight ${tone}`}>{value}</p>
    </div>
  );
}

function TransactionModal({
  type,
  projects,
  profiles,
  onClose,
  onSave,
}: {
  type: FinanceTransactionType;
  projects: Project[];
  profiles: Profile[];
  onClose: () => void;
  onSave: (draft: FinanceTransactionDraft) => Promise<void>;
}) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>('PKR');
  const [exchangeRate, setExchangeRate] = useState<number>(DEFAULT_EXCHANGE_RATES.PKR);
  const [category, setCategory] = useState<string>(
    type === 'income' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0],
  );
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [clientName, setClientName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [referenceNo, setReferenceNo] = useState('');
  const [vendor, setVendor] = useState('');
  const [recurringStatus, setRecurringStatus] = useState<RecurringStatus>('none');
  const [notes, setNotes] = useState('');
  const [expenseType, setExpenseType] = useState('Business Expense');
  const [paymentStatus, setPaymentStatus] = useState<'Paid' | 'Pending' | 'Partially Paid'>('Paid');
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [financialAccount, setFinancialAccount] = useState('');
  const [taxAmount, setTaxAmount] = useState('0');
  const [feeAmount, setFeeAmount] = useState('0');
  const [recurringEndDate, setRecurringEndDate] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  function handleCurrencyChange(code: CurrencyCode) {
    setCurrencyCode(code);
    setExchangeRate(DEFAULT_EXCHANGE_RATES[code] || 1.0);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim() || Number(amount) <= 0) {
      setError('Please provide a description and amount.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        type,
        category,
        description: description.trim(),
        amount: Number(amount) + Number(taxAmount || 0) + Number(feeAmount || 0),
        currency: currencyCode,
        exchange_rate: Number(exchangeRate || 1.0),
        transaction_date: date,
        client_name: clientName || null,
        project_id: projectId || null,
        payment_method: paymentMethod,
        reference_no: referenceNo || null,
        vendor: vendor || null,
        recurring_status: recurringStatus,
        notes: notes || null,
        expense_type: type === 'expense' ? expenseType : null,
        payment_status: type === 'expense' ? paymentStatus : null,
        paid_date: type === 'expense' && paymentStatus !== 'Pending' ? paidDate : null,
        financial_account: type === 'expense' ? financialAccount || null : null,
        tax_amount: Number(taxAmount || 0),
        fee_amount: Number(feeAmount || 0),
        recurring_end_date: recurringStatus !== 'none' ? recurringEndDate || null : null,
        attachment_url: receipt ? receipt.name : null,
      });
    } catch (err) {
      setError(errorMessage(err, 'Transaction could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-border bg-white p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h3 className="font-display text-xl font-bold text-ink">
              Add {type === 'income' ? 'Income Record' : 'Expense Record'}
            </h3>
            <p className="text-xs text-muted">Record financial entry into business ledger</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-ivory hover:text-ink transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-5 text-xs">
          {type === 'expense' ? <h4 className="font-display text-base font-bold text-ink">Expense Details</h4> : null}
          <Field
            label="Description"
            required
            placeholder={type === 'income' ? 'e.g. Client advance payment' : 'e.g. Adobe Creative Cloud subscription'}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className={`grid gap-4 ${currencyCode === 'PKR' ? 'sm:grid-cols-2' : 'sm:grid-cols-4'}`}>
            {currencyCode !== 'PKR' ? <Field
              label="Amount"
              type="number"
              step="any"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            /> : null}
            {currencyCode !== 'PKR' ? <div className="rounded-md border border-border bg-ivory px-3 py-2"><p className="text-muted">PKR Equivalent</p><p className="mt-1 font-bold text-ink">Rs. {((Number(amount || 0) + Number(taxAmount || 0) + Number(feeAmount || 0)) * Number(exchangeRate || 0)).toLocaleString()}</p></div> : null}

            <SelectField
              label="Currency"
              value={currencyCode}
              onChange={(e) => handleCurrencyChange(e.target.value as CurrencyCode)}
            >
              <option value="PKR">PKR (Rs.)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </SelectField>

            <Field
              label="Exchange Rate to PKR"
              type="number"
              step="any"
              value={exchangeRate}
              onChange={(e) => setExchangeRate(Number(e.target.value))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>

            <Field label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Project (Optional)"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                const proj = projects.find((p) => p.id === e.target.value);
                if (proj) setClientName(proj.client_name);
              }}
            >
              <option value="">No Project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_number} - {p.project_title}
                </option>
              ))}
            </SelectField>

            {type === 'income' ? (
              <Field
                label="Client Name"
                placeholder="e.g. John Doe"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            ) : (
              <Field
                label="Vendor Name"
                placeholder="e.g. Adobe / AWS / Office Supplies"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
              />
            )}
          </div>

          {type === 'expense' ? <><h4 className="font-display text-base font-bold text-ink">Payment</h4><div className="grid gap-4 sm:grid-cols-2"><SelectField label="Expense Type" value={expenseType} onChange={(e) => setExpenseType(e.target.value)}>{['Business Expense','Project Expense','Team Expense','Software/Subscription','Tax','Other'].map((item) => <option key={item}>{item}</option>)}</SelectField><SelectField label="Payment Status" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as typeof paymentStatus)}>{['Paid','Pending','Partially Paid'].map((item) => <option key={item}>{item}</option>)}</SelectField><Field label="Paid Date" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} disabled={paymentStatus === 'Pending'}/><Field label="Financial Account" placeholder="Bank, Cash, Wallet" value={financialAccount} onChange={(e) => setFinancialAccount(e.target.value)}/></div><h4 className="font-display text-base font-bold text-ink">Additional Information</h4><div className="grid gap-4 sm:grid-cols-2"><Field label="Tax" type="number" min="0" step="any" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)}/><Field label="Fees" type="number" min="0" step="any" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)}/><Field label="Final Total" readOnly value={(Number(amount || 0) + Number(taxAmount || 0) + Number(feeAmount || 0)).toFixed(2)}/><label className="grid gap-1.5 text-sm font-medium text-ink"><span>Receipt / Attachment</span><input type="file" onChange={(e) => setReceipt(e.target.files?.[0] || null)} className="min-h-11 rounded-md border border-border bg-white px-3 text-sm"/></label></div></> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Payment Method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              {PAYMENT_METHODS.map((pm) => (
                <option key={pm} value={pm}>
                  {pm}
                </option>
              ))}
            </SelectField>

            {type === 'expense' ? (
              <SelectField
                label="Recurring Status"
                value={recurringStatus}
                onChange={(e) => setRecurringStatus(e.target.value as RecurringStatus)}
              >
                <option value="none">One-time Expense</option>
                <option value="monthly">Monthly Subscription</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Annual Recurring</option>
              </SelectField>
            ) : (
              <Field
                label="Reference # / Transaction ID"
                placeholder="e.g. TXN-9941"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
              />
            )}
          </div>

          {type === 'expense' && recurringStatus !== 'none' ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Next Due Date" type="date" value={date} onChange={(e) => setDate(e.target.value)}/><Field label="End Date" type="date" value={recurringEndDate} onChange={(e) => setRecurringEndDate(e.target.value)}/></div> : null}

          <TextareaField
            label="Notes"
            placeholder="Additional notes or payment link details..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-16"
          />

          {error ? (
            <p className="rounded-md bg-rose-50 p-3 text-xs font-semibold text-rose-600 border border-rose-200">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Record'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
