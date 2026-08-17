import type {
  ClientReceivableItem,
  CurrencyCode,
  ExpenseCategory,
  FinanceBudget,
  FinanceTransaction,
  IncomeCategory,
  Profile,
  Project,
  ProjectProfitabilityItem,
  TeamPayrollItem,
  EmployeeCompensation,
  EmployeeLedgerEntry,
} from './types';
import { currency } from './utils';

export const DEFAULT_EXCHANGE_RATES: Record<CurrencyCode, number> = {
  PKR: 1.0,
  USD: 278.5,
  EUR: 302.0,
  GBP: 354.0,
};

export const INCOME_CATEGORIES: string[] = [
  'Book Formatting',
  'eBook Formatting',
  'Cover Design',
  'Publishing Support',
  'Project Payment',
  'Other Services',
  'Other Income',
];

export const EXPENSE_CATEGORIES: string[] = [
  'Software',
  'Office',
  'Internet',
  'Marketing',
  'Equipment',
  'Freelancer',
  'Salary',
  'Travel',
  'Utilities',
  'Other',
];

export const PAYMENT_METHODS = [
  'Bank Transfer',
  'Cash',
  'Easypaisa',
  'JazzCash',
  'PayPal',
  'Card',
  'Stripe',
  'Upwork',
  'Other',
];

export type DateFilterType = 'this_month' | 'last_month' | 'this_year' | 'custom' | 'all';

export function formatPKR(amount: number): string {
  return currency(amount || 0);
}

export function formatCurrencyAmount(amount: number, code: CurrencyCode = 'PKR'): string {
  const symbols: Record<CurrencyCode, string> = {
    PKR: 'Rs. ',
    USD: '$',
    EUR: '€',
    GBP: '£',
  };

  const formattedNumber = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount || 0);

  return `${symbols[code] || ''}${formattedNumber} ${code !== 'PKR' ? code : ''}`.trim();
}

export function getConvertedPKR(amount: number, code: CurrencyCode, rateOverride?: number): number {
  const rate = rateOverride && rateOverride > 0 ? rateOverride : DEFAULT_EXCHANGE_RATES[code] || 1.0;
  return Math.round(Number(amount || 0) * rate);
}

export function isDateInRange(
  dateStr: string | null | undefined,
  filter: DateFilterType,
  customStart?: string,
  customEnd?: string,
): boolean {
  if (!dateStr) return filter === 'all';
  if (filter === 'all') return true;

  const target = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  const now = new Date();

  if (filter === 'this_month') {
    return target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth();
  }

  if (filter === 'last_month') {
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return target.getFullYear() === lastMonthDate.getFullYear() && target.getMonth() === lastMonthDate.getMonth();
  }

  if (filter === 'this_year') {
    return target.getFullYear() === now.getFullYear();
  }

  if (filter === 'custom' && customStart && customEnd) {
    const start = new Date(`${customStart}T00:00:00`);
    const end = new Date(`${customEnd}T23:59:59`);
    return target >= start && target <= end;
  }

  return true;
}

export interface ClientBalanceProjectItem {
  id: string;
  project_number: string;
  project_title: string;
  total_price: number;
  advance_paid: number;
  outstanding: number;
  payment_status: string;
  due_date: string | null;
  payment_date: string | null;
}

export interface ClientBalanceSummary {
  client_name: string;
  client_email: string;
  project_count: number;
  total_invoiced: number;
  total_paid: number;
  outstanding: number;
  last_payment_date: string | null;
  projects: ClientBalanceProjectItem[];
}

export function calculateClientBalances(
  projects: Project[],
  transactions: FinanceTransaction[] = [],
): ClientBalanceSummary[] {
  const map = new Map<string, ClientBalanceSummary>();

  projects.forEach((proj) => {
    const clientName = (proj.client_name || '').trim() || 'Unknown Client';
    const email = proj.client_email || '';
    const total = Number(proj.total_price || 0);
    const paid = Number(proj.advance_paid || 0);
    const due = Math.max(total - paid, 0);

    const existing = map.get(clientName) || {
      client_name: clientName,
      client_email: email,
      project_count: 0,
      total_invoiced: 0,
      total_paid: 0,
      outstanding: 0,
      last_payment_date: null,
      projects: [],
    };

    existing.total_invoiced += total;
    existing.total_paid += paid;
    existing.outstanding += due;
    existing.project_count += 1;

    if (proj.payment_date) {
      if (!existing.last_payment_date || proj.payment_date > existing.last_payment_date) {
        existing.last_payment_date = proj.payment_date;
      }
    }

    existing.projects.push({
      id: proj.id,
      project_number: proj.project_number,
      project_title: proj.project_title,
      total_price: total,
      advance_paid: paid,
      outstanding: due,
      payment_status: proj.payment_status || (due === 0 && total > 0 ? 'Fully Paid' : paid > 0 ? 'Partially Paid' : 'Not Started'),
      due_date: proj.due_date || null,
      payment_date: proj.payment_date || null,
    });

    map.set(clientName, existing);
  });

  // Check transactions for any latest payment dates
  transactions
    .filter((t) => t.type === 'income' && !t.is_soft_deleted && t.client_name)
    .forEach((t) => {
      const clientName = (t.client_name || '').trim();
      const existing = map.get(clientName);
      if (existing && t.transaction_date) {
        if (!existing.last_payment_date || t.transaction_date > existing.last_payment_date) {
          existing.last_payment_date = t.transaction_date;
        }
      }
    });

  return Array.from(map.values()).sort((a, b) => b.outstanding - a.outstanding || b.total_invoiced - a.total_invoiced);
}

export function calculateClientReceivables(projects: Project[]): ClientReceivableItem[] {
  const balances = calculateClientBalances(projects);
  return balances.map((b) => ({
    client_name: b.client_name,
    client_email: b.client_email,
    total_invoiced_pkr: b.total_invoiced,
    total_paid_pkr: b.total_paid,
    outstanding_pkr: b.outstanding,
    overdue_pkr: b.projects.filter((p) => p.outstanding > 0 && p.due_date && new Date(`${p.due_date}T23:59:59`) < new Date()).reduce((s, p) => s + p.outstanding, 0),
    project_count: b.project_count,
    invoices_count: b.project_count,
  }));
}

export interface TeamPaymentSummary {
  employee_id: string;
  employee_name: string;
  role: string;
  monthly_salary: number;
  per_project_rate: number;
  project_earnings: number;
  advances: number;
  deductions: number;
  paid: number;
  other_payables: number;
  net_payable: number;
  outstanding: number;
  payment_date: string | null;
  status: 'Paid' | 'Partial' | 'Pending';
  entries: EmployeeLedgerEntry[];
}

export function calculateTeamPayments(
  profiles: Profile[],
  compensationList: EmployeeCompensation[],
  ledger: EmployeeLedgerEntry[],
  selectedMonth?: string,
): TeamPaymentSummary[] {
  const team = profiles.filter((p) => p.role !== 'client');

  return team.map((employee) => {
    const comp = compensationList.find((c) => c.employee_id === employee.id);
    const monthlySalary = Number(comp?.monthly_salary || 0);
    const perProjectRate = Number(comp?.per_project_rate || 0);

    const allEmployeeEntries = ledger.filter((l) => l.employee_id === employee.id);
    const monthEntries = selectedMonth
      ? allEmployeeEntries.filter((l) => (l.salary_month || l.paid_at || '').startsWith(selectedMonth))
      : allEmployeeEntries;

    const sumType = (type: EmployeeLedgerEntry['entry_type']) =>
      monthEntries.filter((e) => e.entry_type === type).reduce((s, e) => s + Number(e.amount || 0), 0);

    const salaryBonus = sumType('Salary');
    const projectEarnings = sumType('Project Payment') + sumType('Bonus');
    const advances = sumType('Advance');
    const deductions = sumType('Deduction');
    const paid = sumType('Payment');
    const other = sumType('Other');

    const totalEarnings = monthlySalary + salaryBonus + projectEarnings + other;
    const netPayable = Math.max(0, totalEarnings - deductions);
    const outstanding = Math.max(0, netPayable - (paid + advances));

    let status: 'Paid' | 'Partial' | 'Pending' = 'Pending';
    if (netPayable > 0 && outstanding === 0) status = 'Paid';
    else if ((paid > 0 || advances > 0) && outstanding > 0) status = 'Partial';
    else if (netPayable === 0 && outstanding === 0) status = 'Paid';

    const latestPayment = monthEntries
      .filter((e) => e.entry_type === 'Payment' || e.entry_type === 'Advance')
      .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime())[0];

    return {
      employee_id: employee.id,
      employee_name: employee.full_name,
      role: employee.role,
      monthly_salary: monthlySalary,
      per_project_rate: perProjectRate,
      project_earnings: projectEarnings,
      advances,
      deductions,
      paid,
      other_payables: salaryBonus + other,
      net_payable: netPayable,
      outstanding,
      payment_date: latestPayment ? latestPayment.paid_at : null,
      status,
      entries: monthEntries.sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime()),
    };
  });
}

export function calculateTeamPayroll(
  profiles: Profile[],
  compensationList: EmployeeCompensation[],
  ledger: EmployeeLedgerEntry[],
): TeamPayrollItem[] {
  const list = calculateTeamPayments(profiles, compensationList, ledger);
  return list.map((item) => ({
    employee_id: item.employee_id,
    employee_name: item.employee_name,
    monthly_salary_pkr: item.monthly_salary,
    per_project_rate_pkr: item.per_project_rate,
    advance_pkr: item.advances,
    bonus_pkr: item.project_earnings,
    deduction_pkr: item.deductions,
    paid_pkr: item.paid,
    net_payable_pkr: item.net_payable,
    remaining_due_pkr: item.outstanding,
    payment_date: item.payment_date,
    status: item.status,
  }));
}

export interface MonthlyFinancialReportItem {
  month_index: number;
  month_name: string;
  month_key: string;
  income: number;
  expenses: number;
  profit: number;
}

export function calculateMonthlyReports(
  transactions: FinanceTransaction[],
  year: number,
): MonthlyFinancialReportItem[] {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return monthNames.map((name, idx) => {
    const monthKey = `${year}-${String(idx + 1).padStart(2, '0')}`;
    const monthTx = transactions.filter(
      (t) => !t.is_soft_deleted && t.transaction_date && t.transaction_date.startsWith(monthKey),
    );

    const income = monthTx
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const expenses = monthTx
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    return {
      month_index: idx,
      month_name: name,
      month_key: monthKey,
      income,
      expenses,
      profit: income - expenses,
    };
  });
}

export function calculateProjectProfitability(
  projects: Project[],
  transactions: FinanceTransaction[],
  ledger: EmployeeLedgerEntry[],
): ProjectProfitabilityItem[] {
  return projects.map((proj) => {
    const revenue = Number(proj.advance_paid || proj.total_price || 0);

    // Direct expenses linked to project
    const projExpenses = transactions
      .filter((t) => t.project_id === proj.id && t.type === 'expense' && !t.is_soft_deleted)
      .reduce((s, t) => s + Number(t.amount_pkr || 0), 0);

    // Team cost linked to project from ledger
    const teamCost = ledger
      .filter((l) => l.project_id === proj.id)
      .reduce((s, l) => s + Number(l.amount || 0), 0);

    // Estimate 2.5% payment processing fee on revenue
    const paymentFees = Math.round(revenue * 0.025);
    const totalCost = teamCost + projExpenses + paymentFees;
    const netProfit = revenue - totalCost;
    const margin = revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0;

    return {
      project_id: proj.id,
      project_number: proj.project_number,
      project_title: proj.project_title,
      client_name: proj.client_name,
      revenue_pkr: revenue,
      team_cost_pkr: teamCost,
      direct_expenses_pkr: projExpenses,
      payment_fees_pkr: paymentFees,
      total_cost_pkr: totalCost,
      net_profit_pkr: netProfit,
      profit_margin_percent: margin,
    };
  }).sort((a, b) => b.revenue_pkr - a.revenue_pkr);
}

export function calculateCategoryBudgets(
  transactions: FinanceTransaction[],
  budgets: FinanceBudget[],
): Array<{
  category: string;
  actual_pkr: number;
  budget_pkr: number;
  usage_percent: number;
  status: 'normal' | 'warning' | 'exceeded';
}> {
  const currentMonth = new Date().toISOString().slice(0, 7);

  const monthExpenses = transactions.filter(
    (t) => t.type === 'expense' && !t.is_soft_deleted && t.transaction_date.startsWith(currentMonth),
  );

  return EXPENSE_CATEGORIES.map((cat) => {
    const actual = monthExpenses
      .filter((t) => t.category === cat)
      .reduce((s, t) => s + Number(t.amount_pkr || 0), 0);

    const bRecord = budgets.find((b) => b.category === cat);
    const budget = Number(bRecord?.monthly_budget_pkr || 0);

    const usage = budget > 0 ? Math.round((actual / budget) * 100) : 0;
    let status: 'normal' | 'warning' | 'exceeded' = 'normal';
    if (budget > 0 && actual > budget) status = 'exceeded';
    else if (budget > 0 && usage >= 85) status = 'warning';

    return {
      category: cat,
      actual_pkr: actual,
      budget_pkr: budget,
      usage_percent: usage,
      status,
    };
  });
}

export function calculateRecurringExpenses(transactions: FinanceTransaction[]): Array<{
  id: string;
  description: string;
  category: string;
  vendor: string;
  monthly_cost_pkr: number;
  annual_cost_pkr: number;
  recurring_status: string;
  next_date: string | null;
}> {
  const recurring = transactions.filter(
    (t) => t.type === 'expense' && !t.is_soft_deleted && t.recurring_status && t.recurring_status !== 'none',
  );

  return recurring.map((t) => {
    const pkr = Number(t.amount_pkr || 0);
    let monthlyCost = pkr;
    if (t.recurring_status === 'quarterly') monthlyCost = Math.round(pkr / 3);
    if (t.recurring_status === 'yearly') monthlyCost = Math.round(pkr / 12);

    return {
      id: t.id,
      description: t.description,
      category: t.category,
      vendor: t.vendor || 'Subscription Provider',
      monthly_cost_pkr: monthlyCost,
      annual_cost_pkr: monthlyCost * 12,
      recurring_status: t.recurring_status || 'monthly',
      next_date: t.next_recurring_date || null,
    };
  });
}

export function exportToCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escapeCell = (val: string | number) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const csvContent = [
    headers.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportReportPDF(
  title: string,
  subtitle: string,
  headers: string[],
  rows: (string | number)[][],
  summaryStats?: Array<{ label: string; value: string }>,
) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const statsHTML = summaryStats?.length
    ? `<div style="display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap;">
        ${summaryStats
          .map(
            (s) => `
          <div style="border: 1px solid #e2e8f0; background: #faf8f5; padding: 12px 16px; border-radius: 8px; flex: 1; min-width: 140px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">${s.label}</div>
            <div style="font-size: 18px; font-weight: 700; color: #1e293b; margin-top: 4px;">${s.value}</div>
          </div>
        `,
          )
          .join('')}
      </div>`
    : '';

  const tableHeaderHTML = headers.map((h) => `<th style="border-bottom: 2px solid #cbd5e1; padding: 10px; text-align: left; font-size: 12px; font-weight: 700; color: #334155; background: #f1f5f9;">${h}</th>`).join('');

  const tableRowsHTML = rows
    .map(
      (row) => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        ${row.map((cell) => `<td style="padding: 10px; font-size: 12px; color: #1e293b;">${cell}</td>`).join('')}
      </tr>
    `,
    )
    .join('');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title} - Manuscript Heaven</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 30px; color: #1e293b; }
          .header { border-bottom: 2px solid #c5a059; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
          .brand { font-size: 24px; font-weight: 700; color: #1e293b; }
          .subbrand { font-size: 12px; text-transform: uppercase; tracking: 2px; color: #c5a059; font-weight: 600; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          .footer { margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: center; border-t: 1px solid #e2e8f0; padding-top: 15px; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">Manuscript Heaven</div>
            <div class="subbrand">Financial ERP System</div>
          </div>
          <div style="text-align: right;">
            <h2 style="margin: 0; font-size: 20px; color: #1e293b;">${title}</h2>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${subtitle} · ${new Date().toLocaleDateString()}</div>
          </div>
        </div>

        ${statsHTML}

        <table>
          <thead>
            <tr>${tableHeaderHTML}</tr>
          </thead>
          <tbody>
            ${tableRowsHTML}
          </tbody>
        </table>

        <div class="footer">
          Generated automatically by Manuscript Heaven Tracker Financial ERP System on ${new Date().toLocaleString()}
        </div>
        <script>
          window.onload = function() { window.print(); };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}
