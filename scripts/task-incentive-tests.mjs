import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateEmployeePayroll } from '../src/lib/payrollUtils.ts';
import { calculateTeamPayments } from '../src/lib/financeUtils.ts';

const profile = { id: 'employee-1', full_name: 'Sample Employee', email: 'employee@example.invalid', role: 'employee', created_at: '2026-01-01' };
const compensation = { employee_id: profile.id, monthly_salary: 250, per_project_rate: 0, salary_type: 'Monthly', default_currency: 'USD', joining_date: '2026-01-01', responsibilities: '', performance_rating: null, updated_at: '2026-01-01' };
function entry(id, type, amount, reference = null) {
  return { id, employee_id: profile.id, entry_type: type, amount, currency: 'USD', reference, salary_month: '2026-10-01',
    payment_method: null, project_id: null, notes: '', paid_at: '2026-10-20', created_at: '2026-10-20' };
}
const ledger = [
  entry('b-1', 'Bonus', 12, 'TASK_INCENTIVE:task-1'),
  entry('b-2', 'Bonus', 18, 'TASK_INCENTIVE:task-2'),
  entry('old-advance', 'Advance', 40), // legacy entry: do not reinterpret old loans
  entry('salary-advance', 'Advance', 20, 'SALARY_ADVANCE'),
  entry('payment', 'Payment', 100),
  entry('deduction', 'Deduction', 10),
];
const convert = (amount) => amount;
const employee = calculateEmployeePayroll(profile, compensation, ledger, '2026-10', convert, 'USD');
assert.equal(employee.bonuses, 30);
assert.equal(employee.baseSalary, 250);
assert.equal(employee.totalPayable, 270);
assert.equal(employee.totalPaid, 100);
assert.equal(employee.advances, 60);
assert.equal(employee.outstanding, 150, 'Only classified salary prepayments reduce outstanding');
assert.equal(employee.status, 'Partially Paid');
const finance = calculateTeamPayments([profile], [compensation], ledger, '2026-10')[0];
assert.equal(finance.project_earnings, 30);
assert.equal(finance.outstanding, 150);

const migration = readFileSync('supabase/migrations/20261025114000_task_incentive_payroll.sql', 'utf8');
const taskModel = readFileSync('src/lib/types.ts', 'utf8');
const taskSource = readFileSync('src/lib/useTracker.ts', 'utf8');
const card = readFileSync('src/components/tasks/TaskIncentiveCard.tsx', 'utf8');
assert.match(migration, /alter table public\.task_incentives enable row level security/i);
assert.match(migration, /revoke all on public\.task_incentives from public, anon, authenticated/i);
assert.match(migration, /create policy task_incentives_admin_select/i);
assert.match(migration, /public\.phase6_app_actor_class\(\) = 'admin'/);
assert.doesNotMatch(migration, /task_incentives_(?:employee|manager|client)_select/);
assert.match(migration, /before insert or update on public\.task_incentives/);
assert.match(migration, /if v_task\.status <> 'Done'/);
assert.match(migration, /insert into public\.employee_ledger/);
assert.match(migration, /unique.*references public\.employee_ledger/i);
assert.match(migration, /if old\.status = 'approved' then/);
assert.match(taskSource, /profile\.role === 'admin'[\s\S]*?from\('task_incentives'\)/);
assert.match(card, /Private Task Bonus/);
assert.match(taskModel, /taskIncentives\?: TaskIncentive\[\]/);
assert.doesNotMatch(taskModel.split('export interface Task {')[1].split('export type TaskDraft')[0], /bonus_amount|incentive_amount/);
console.log('PASS: fixed salary, task bonus, classified advances, and private approval invariants');
