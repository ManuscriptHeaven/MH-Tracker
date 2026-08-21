import type { CurrencyCode, EmployeeCompensation, EmployeeLedgerEntry, PayrollStatus, Profile, SalaryType } from './types';

export interface EmployeePayrollRow {
  profile: Profile;
  compensation?: EmployeeCompensation;
  salaryType: SalaryType;
  baseSalary: number;
  projectEarnings: number;
  bonuses: number;
  otherEarnings: number;
  advances: number;
  deductions: number;
  totalPayable: number;
  totalPaid: number;
  outstanding: number;
  status: PayrollStatus;
  entriesCount: number;
  entries: EmployeeLedgerEntry[];
  latestPaymentDate: string | null;
}

export interface PayrollSummaryStats {
  totalPayroll: number;
  totalPaid: number;
  totalOutstanding: number;
  totalAdvances: number;
  employeeCount: number;
  paidCount: number;
  partiallyPaidCount: number;
  pendingCount: number;
  overdueCount: number;
}

export interface EmployeeMonthHistory {
  month: string;
  monthLabel: string;
  baseSalary: number;
  projectEarnings: number;
  bonuses: number;
  advances: number;
  deductions: number;
  payable: number;
  paid: number;
  outstanding: number;
  status: PayrollStatus;
}

export interface AdvanceItem {
  id: string;
  employee_id: string;
  amount: number;
  original_amount: number;
  currency: CurrencyCode;
  date: string;
  reason: string;
  status: 'Active' | 'Partially Repaid' | 'Fully Repaid';
  repaid_amount: number;
  remaining_amount: number;
  notes: string;
}

/**
 * Normalizes any date string or month to YYYY-MM format.
 */
export function normalizeMonth(monthString?: string | null): string {
  if (!monthString) {
    return new Date().toISOString().slice(0, 7);
  }
  return monthString.slice(0, 7);
}

/**
 * Returns user-friendly month label (e.g. "August 2026").
 */
export function formatMonthLabel(monthString: string): string {
  const [yearStr, monthStr] = normalizeMonth(monthString).split('-');
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  if (isNaN(year) || isNaN(month) || month < 0 || month > 11) {
    return monthString;
  }
  const date = new Date(year, month, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Navigates to previous month (YYYY-MM).
 */
export function getPreviousMonth(monthString: string): string {
  const [yearStr, monthStr] = normalizeMonth(monthString).split('-');
  let year = Number(yearStr);
  let month = Number(monthStr) - 1; // 0-based
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Navigates to next month (YYYY-MM).
 */
export function getNextMonth(monthString: string): string {
  const [yearStr, monthStr] = normalizeMonth(monthString).split('-');
  let year = Number(yearStr);
  let month = Number(monthStr) + 1; // 1-based next
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Determines whether a given YYYY-MM is before the current month.
 */
export function isPastMonth(monthString: string): boolean {
  const currentMonth = new Date().toISOString().slice(0, 7);
  return normalizeMonth(monthString) < currentMonth;
}

/**
 * Calculates complete payroll breakdown for a single employee in a given month.
 */
export function calculateEmployeePayroll(
  profile: Profile,
  compensation: EmployeeCompensation | undefined,
  ledger: EmployeeLedgerEntry[],
  selectedMonth: string,
  convertMoney: (amount: number, from: CurrencyCode, to: CurrencyCode) => number,
  targetCurrency: CurrencyCode = 'USD',
): EmployeePayrollRow {
  const normMonth = normalizeMonth(selectedMonth);
  const employeeEntries = ledger.filter((entry) => entry.employee_id === profile.id);

  // Filter entries for the selected month
  const monthEntries = employeeEntries.filter((entry) => {
    const entryMonth = (entry.salary_month || entry.paid_at || '').slice(0, 7);
    return entryMonth === normMonth;
  });

  // Base monthly salary from compensation record
  const compCurrency: CurrencyCode = compensation?.default_currency || 'USD';
  const rawBaseSalary = Number(compensation?.monthly_salary || 0);
  const baseSalary = convertMoney(rawBaseSalary, compCurrency, targetCurrency);
  const salaryType: SalaryType = compensation?.salary_type || 'Monthly';

  // Calculate sum of entry types in target currency
  let projectEarnings = 0;
  let bonuses = 0;
  let otherEarnings = 0;
  let advances = 0;
  let deductions = 0;
  let totalPaid = 0;

  for (const entry of monthEntries) {
    const entryCurr: CurrencyCode = entry.currency || 'USD';
    const convertedAmount = convertMoney(Number(entry.amount || 0), entryCurr, targetCurrency);

    switch (entry.entry_type) {
      case 'Project Payment':
        projectEarnings += convertedAmount;
        break;
      case 'Bonus':
        bonuses += convertedAmount;
        break;
      case 'Salary':
      case 'Other':
        otherEarnings += convertedAmount;
        break;
      case 'Advance':
        advances += convertedAmount;
        break;
      case 'Deduction':
        deductions += convertedAmount;
        break;
      case 'Payment':
        totalPaid += convertedAmount;
        break;
      default:
        break;
    }
  }

  // Formula: BASE PAY + PROJECT EARNINGS + BONUSES + OTHER - DEDUCTIONS = TOTAL PAYABLE
  const effectiveBase = salaryType === 'Per Project' ? 0 : baseSalary;
  const totalPayable = Math.max(0, effectiveBase + projectEarnings + bonuses + otherEarnings - deductions);

  // OUTSTANDING = TOTAL PAYABLE - TOTAL PAID
  const outstanding = Math.max(0, totalPayable - totalPaid);

  // Determine Status
  let status: PayrollStatus = 'Pending';
  if (totalPayable > 0 && outstanding === 0) {
    status = 'Paid';
  } else if (totalPaid > 0 && outstanding > 0) {
    status = 'Partially Paid';
  } else if (totalPayable === 0 && totalPaid === 0) {
    status = 'Paid';
  } else if (outstanding > 0 && isPastMonth(normMonth)) {
    status = 'Overdue';
  } else {
    status = 'Pending';
  }

  // Latest payment date for selected month
  const paymentEntries = monthEntries
    .filter((e) => e.entry_type === 'Payment')
    .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
  const latestPaymentDate = paymentEntries.length ? paymentEntries[0].paid_at : null;

  return {
    profile,
    compensation,
    salaryType,
    baseSalary: effectiveBase,
    projectEarnings,
    bonuses,
    otherEarnings,
    advances,
    deductions,
    totalPayable,
    totalPaid,
    outstanding,
    status,
    entriesCount: monthEntries.length,
    entries: monthEntries.sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime()),
    latestPaymentDate,
  };
}

/**
 * Calculates top-level aggregated payroll summary across all active team members for a given month.
 */
export function calculatePayrollSummary(
  profiles: Profile[],
  compensationList: EmployeeCompensation[],
  ledger: EmployeeLedgerEntry[],
  selectedMonth: string,
  convertMoney: (amount: number, from: CurrencyCode, to: CurrencyCode) => number,
  targetCurrency: CurrencyCode = 'USD',
): { rows: EmployeePayrollRow[]; stats: PayrollSummaryStats } {
  const teamProfiles = profiles.filter((p) => p.role !== 'client');
  const normMonth = normalizeMonth(selectedMonth);

  const rows = teamProfiles.map((profile) => {
    const comp = compensationList.find((c) => c.employee_id === profile.id);
    return calculateEmployeePayroll(profile, comp, ledger, normMonth, convertMoney, targetCurrency);
  });

  const stats: PayrollSummaryStats = {
    totalPayroll: rows.reduce((sum, r) => sum + r.totalPayable, 0),
    totalPaid: rows.reduce((sum, r) => sum + r.totalPaid, 0),
    totalOutstanding: rows.reduce((sum, r) => sum + r.outstanding, 0),
    totalAdvances: rows.reduce((sum, r) => sum + r.advances, 0),
    employeeCount: rows.length,
    paidCount: rows.filter((r) => r.status === 'Paid').length,
    partiallyPaidCount: rows.filter((r) => r.status === 'Partially Paid').length,
    pendingCount: rows.filter((r) => r.status === 'Pending').length,
    overdueCount: rows.filter((r) => r.status === 'Overdue').length,
  };

  return { rows, stats };
}

/**
 * Calculates multi-month history for a specific employee.
 */
export function getEmployeeHistory(
  profile: Profile,
  compensation: EmployeeCompensation | undefined,
  ledger: EmployeeLedgerEntry[],
  convertMoney: (amount: number, from: CurrencyCode, to: CurrencyCode) => number,
  targetCurrency: CurrencyCode = 'USD',
  monthsCount: number = 6,
): EmployeeMonthHistory[] {
  const history: EmployeeMonthHistory[] = [];
  let current = normalizeMonth();

  for (let i = 0; i < monthsCount; i++) {
    const row = calculateEmployeePayroll(profile, compensation, ledger, current, convertMoney, targetCurrency);
    history.push({
      month: current,
      monthLabel: formatMonthLabel(current),
      baseSalary: row.baseSalary,
      projectEarnings: row.projectEarnings,
      bonuses: row.bonuses,
      advances: row.advances,
      deductions: row.deductions,
      payable: row.totalPayable,
      paid: row.totalPaid,
      outstanding: row.outstanding,
      status: row.status,
    });
    current = getPreviousMonth(current);
  }

  return history;
}

/**
 * Returns structured advance records for an employee across all time.
 */
export function getEmployeeAdvances(
  employeeId: string,
  ledger: EmployeeLedgerEntry[],
  convertMoney: (amount: number, from: CurrencyCode, to: CurrencyCode) => number,
  targetCurrency: CurrencyCode = 'USD',
): AdvanceItem[] {
  const advanceEntries = ledger
    .filter((entry) => entry.employee_id === employeeId && entry.entry_type === 'Advance')
    .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());

  // Check deduction entries for advance repayments
  const deductionEntries = ledger.filter(
    (entry) =>
      entry.employee_id === employeeId &&
      entry.entry_type === 'Deduction' &&
      (entry.notes || '').toLowerCase().includes('advance'),
  );

  const totalDeductedRepayments = deductionEntries.reduce((sum, d) => {
    const curr: CurrencyCode = d.currency || 'USD';
    return sum + convertMoney(Number(d.amount || 0), curr, targetCurrency);
  }, 0);

  let remainingRepaymentPool = totalDeductedRepayments;

  return advanceEntries.map((item) => {
    const curr: CurrencyCode = item.currency || 'USD';
    const convertedAmount = convertMoney(Number(item.amount || 0), curr, targetCurrency);

    let repaid = 0;
    if (remainingRepaymentPool >= convertedAmount) {
      repaid = convertedAmount;
      remainingRepaymentPool -= convertedAmount;
    } else if (remainingRepaymentPool > 0) {
      repaid = remainingRepaymentPool;
      remainingRepaymentPool = 0;
    }

    const remaining = Math.max(0, convertedAmount - repaid);
    let status: 'Active' | 'Partially Repaid' | 'Fully Repaid' = 'Active';
    if (remaining === 0 && convertedAmount > 0) {
      status = 'Fully Repaid';
    } else if (repaid > 0) {
      status = 'Partially Repaid';
    }

    return {
      id: item.id,
      employee_id: item.employee_id,
      amount: convertedAmount,
      original_amount: Number(item.amount || 0),
      currency: curr,
      date: item.paid_at,
      reason: item.notes || item.description || 'Employee Advance',
      status,
      repaid_amount: repaid,
      remaining_amount: remaining,
      notes: item.notes || '',
    };
  });
}
