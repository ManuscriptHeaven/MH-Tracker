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

export const INCOME_CATEGORIES: IncomeCategory[] = [
  'Book Formatting',
  'eBook Formatting',
  'Cover Design',
  'Publishing Support',
  'Other Services',
  'Other Income',
];

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Office',
  'Software',
  'Adobe',
  'AI/API',
  'Hosting',
  'Domain',
  'Marketing',
  'Advertising',
  'Freelancers',
  'Team',
  'Equipment',
  'Internet',
  'Utilities',
  'Bank Fees',
  'Payment Processing Fees',
  'Taxes',
  'Miscellaneous',
];

export const PAYMENT_METHODS = [
  'Bank Transfer',
  'Stripe',
  'PayPal',
  'Payoneer',
  'Upwork',
  'Wise',
  'Cash',
  'Wire',
  'Other',
];

export type DateFilterType = 'this_month' | 'this_quarter' | 'this_year' | 'last_month' | 'all' | 'custom';

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

  if (filter === 'this_quarter') {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const targetQuarter = Math.floor(target.getMonth() / 3);
    return target.getFullYear() === now.getFullYear() && targetQuarter === currentQuarter;
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

export function calculateClientReceivables(projects: Project[]): ClientReceivableItem[] {
  const map = new Map<string, ClientReceivableItem>();

  projects.forEach((proj) => {
    const clientName = proj.client_name || 'Unknown Client';
    const email = proj.client_email || '';
    const total = Number(proj.total_price || 0);
    const paid = Number(proj.advance_paid || 0);
    const due = Math.max(total - paid, 0);

    const isOverdue =
      due > 0 && proj.due_date && new Date(`${proj.due_date}T23:59:59`) < new Date();

    const existing = map.get(clientName) || {
      client_name: clientName,
      client_email: email,
      total_invoiced_pkr: 0,
      total_paid_pkr: 0,
      outstanding_pkr: 0,
      overdue_pkr: 0,
      project_count: 0,
      invoices_count: proj.invoiced ? 1 : 0,
    };

    existing.total_invoiced_pkr += total;
    existing.total_paid_pkr += paid;
    existing.outstanding_pkr += due;
    if (isOverdue) existing.overdue_pkr += due;
    existing.project_count += 1;
    if (proj.invoiced && !map.has(clientName)) existing.invoices_count += 1;

    map.set(clientName, existing);
  });

  return Array.from(map.values()).sort((a, b) => b.outstanding_pkr - a.outstanding_pkr);
}

export function calculateTeamPayroll(
  profiles: Profile[],
  compensationList: EmployeeCompensation[],
  ledger: EmployeeLedgerEntry[],
): TeamPayrollItem[] {
  const team = profiles.filter((p) => p.role !== 'client');

  return team.map((employee) => {
    const comp = compensationList.find((c) => c.employee_id === employee.id);
    const entries = ledger.filter((l) => l.employee_id === employee.id);

    const monthlySalary = Number(comp?.monthly_salary || 0);
    const perProjectRate = Number(comp?.per_project_rate || 0);

    const sumType = (type: EmployeeLedgerEntry['entry_type']) =>
      entries.filter((e) => e.entry_type === type).reduce((s, e) => s + Number(e.amount || 0), 0);

    const salaryAdded = sumType('Salary');
    const projectPayments = sumType('Project Payment');
    const advance = sumType('Advance');
    const deduction = sumType('Deduction');
    const paid = sumType('Payment');

    const netPayable = monthlySalary + salaryAdded + projectPayments + advance - deduction;
    const remainingDue = Math.max(0, netPayable - paid);

    let status: 'Paid' | 'Partial' | 'Pending' = 'Pending';
    if (netPayable > 0 && remainingDue === 0) status = 'Paid';
    else if (paid > 0 && remainingDue > 0) status = 'Partial';

    const latestPayment = entries
      .filter((e) => e.entry_type === 'Payment')
      .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime())[0];

    return {
      employee_id: employee.id,
      employee_name: employee.full_name,
      monthly_salary_pkr: monthlySalary,
      per_project_rate_pkr: perProjectRate,
      advance_pkr: advance,
      bonus_pkr: projectPayments,
      deduction_pkr: deduction,
      paid_pkr: paid,
      net_payable_pkr: netPayable,
      remaining_due_pkr: remainingDue,
      payment_date: latestPayment ? latestPayment.paid_at : null,
      status,
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
