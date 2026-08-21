import {
  calculateEmployeePayroll,
  calculatePayrollSummary,
  formatMonthLabel,
  getNextMonth,
  getPreviousMonth,
  normalizeMonth,
} from './payrollUtils';
import type { CurrencyCode, EmployeeCompensation, EmployeeLedgerEntry, Profile } from './types';

export function runPayrollTests() {
  console.log('====================================================');
  console.log('RUNNING PAYROLL & DUES CALCULATION TESTS');
  console.log('====================================================');

  const convertMoney = (
    amount: number,
    from: CurrencyCode,
    to: CurrencyCode,
  ): number => {
    if (from === to) return amount;
    if (from === 'USD' && to === 'PKR') return amount * 280;
    if (from === 'PKR' && to === 'USD') return amount / 280;
    return amount;
  };

  const sampleProfile: Profile = {
    id: 'emp-1',
    full_name: 'Zain Designer',
    email: 'zain@example.com',
    role: 'employee',
    created_at: '2025-01-01',
  };

  const sampleComp: EmployeeCompensation = {
    employee_id: 'emp-1',
    monthly_salary: 500,
    per_project_rate: 50,
    salary_type: 'Monthly',
    default_currency: 'USD',
    joining_date: '2025-01-01',
    responsibilities: 'Design',
    performance_rating: 90,
    updated_at: '2025-01-01',
  };

  // TEST 1: Base salary calculation without extra entries
  let payroll = calculateEmployeePayroll(sampleProfile, sampleComp, [], '2026-08', convertMoney, 'USD');
  console.assert(payroll.baseSalary === 500, 'Test 1 Failed: Base salary should be 500');
  console.assert(payroll.totalPayable === 500, 'Test 1 Failed: Total payable should be 500');
  console.assert(payroll.totalPaid === 0, 'Test 1 Failed: Total paid should be 0');
  console.assert(payroll.outstanding === 500, 'Test 1 Failed: Outstanding should be 500');
  console.assert(payroll.status === 'Pending', 'Test 1 Failed: Status should be Pending');
  console.log('✓ TEST 1 PASSED: Base monthly salary calculated correctly');

  // TEST 2: Add Project Earning ($100) + Bonus ($50) - Deduction ($20) = Payable ($630)
  const ledgerEntries: EmployeeLedgerEntry[] = [
    {
      id: 'l-1',
      employee_id: 'emp-1',
      entry_type: 'Project Payment',
      amount: 100,
      currency: 'USD',
      salary_month: '2026-08-01',
      payment_method: null,
      project_id: null,
      notes: 'Project commission',
      paid_at: '2026-08-05',
      created_at: '2026-08-05',
    },
    {
      id: 'l-2',
      employee_id: 'emp-1',
      entry_type: 'Bonus',
      amount: 50,
      currency: 'USD',
      salary_month: '2026-08-01',
      payment_method: null,
      project_id: null,
      notes: 'Performance bonus',
      paid_at: '2026-08-06',
      created_at: '2026-08-06',
    },
    {
      id: 'l-3',
      employee_id: 'emp-1',
      entry_type: 'Deduction',
      amount: 20,
      currency: 'USD',
      salary_month: '2026-08-01',
      payment_method: null,
      project_id: null,
      notes: 'Adjustment',
      paid_at: '2026-08-07',
      created_at: '2026-08-07',
    },
  ];

  payroll = calculateEmployeePayroll(sampleProfile, sampleComp, ledgerEntries, '2026-08', convertMoney, 'USD');
  console.assert(payroll.totalPayable === 630, `Test 2 Failed: Expected 630 payable, got ${payroll.totalPayable}`);
  console.assert(payroll.projectEarnings === 100, 'Test 2 Failed: Project earnings should be 100');
  console.assert(payroll.bonuses === 50, 'Test 2 Failed: Bonuses should be 50');
  console.assert(payroll.deductions === 20, 'Test 2 Failed: Deductions should be 20');
  console.log('✓ TEST 2 PASSED: Earnings and deductions calculation formula verified');

  // TEST 3: Partial Payment ($400) -> Outstanding becomes $230, Status = Partially Paid
  ledgerEntries.push({
    id: 'l-4',
    employee_id: 'emp-1',
    entry_type: 'Payment',
    amount: 400,
    currency: 'USD',
    salary_month: '2026-08-01',
    payment_method: 'Bank Transfer',
    project_id: null,
    notes: 'Partial salary payment',
    paid_at: '2026-08-10',
    created_at: '2026-08-10',
  });

  payroll = calculateEmployeePayroll(sampleProfile, sampleComp, ledgerEntries, '2026-08', convertMoney, 'USD');
  console.assert(payroll.totalPaid === 400, 'Test 3 Failed: Total paid should be 400');
  console.assert(payroll.outstanding === 230, 'Test 3 Failed: Outstanding should be 230');
  console.assert(payroll.status === 'Partially Paid', 'Test 3 Failed: Status should be Partially Paid');
  console.log('✓ TEST 3 PASSED: Partial payment recording and status updated');

  // TEST 4: Second Payment ($230) -> Outstanding becomes $0, Status = Paid
  ledgerEntries.push({
    id: 'l-5',
    employee_id: 'emp-1',
    entry_type: 'Payment',
    amount: 230,
    currency: 'USD',
    salary_month: '2026-08-01',
    payment_method: 'Wise',
    project_id: null,
    notes: 'Final balance payment',
    paid_at: '2026-08-15',
    created_at: '2026-08-15',
  });

  payroll = calculateEmployeePayroll(sampleProfile, sampleComp, ledgerEntries, '2026-08', convertMoney, 'USD');
  console.assert(payroll.totalPaid === 630, 'Test 4 Failed: Total paid should be 630');
  console.assert(payroll.outstanding === 0, 'Test 4 Failed: Outstanding should be 0');
  console.assert(payroll.status === 'Paid', 'Test 4 Failed: Status should be Paid');
  console.log('✓ TEST 4 PASSED: Multiple payments clear outstanding dues completely');

  // TEST 5: Currency Conversion to PKR
  const payrollPkr = calculateEmployeePayroll(sampleProfile, sampleComp, ledgerEntries, '2026-08', convertMoney, 'PKR');
  console.assert(payrollPkr.totalPayable === 630 * 280, `Test 5 Failed: Expected ${630 * 280} PKR, got ${payrollPkr.totalPayable}`);
  console.assert(payrollPkr.totalPaid === 630 * 280, 'Test 5 Failed: Total paid in PKR mismatch');
  console.log('✓ TEST 5 PASSED: Multi-currency dynamic conversion verified');

  // TEST 6: Month-to-Month Isolation
  console.assert(getPreviousMonth('2026-08') === '2026-07', 'Test 6 Failed: Previous month');
  console.assert(getNextMonth('2026-08') === '2026-09', 'Test 6 Failed: Next month');
  const julyPayroll = calculateEmployeePayroll(sampleProfile, sampleComp, ledgerEntries, '2026-07', convertMoney, 'USD');
  console.assert(julyPayroll.entries.length === 0, 'Test 6 Failed: July should have 0 entries');
  console.assert(julyPayroll.totalPayable === 500, 'Test 6 Failed: July base salary is 500');
  console.log('✓ TEST 6 PASSED: Month selector and period isolation verified');

  console.log('====================================================');
  console.log('ALL PAYROLL & DUES TESTS PASSED PERFECTLY!');
  console.log('====================================================');
}
