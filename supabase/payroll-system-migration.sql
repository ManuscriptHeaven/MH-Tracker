-- ============================================================================
-- MH TRACKER: PAYROLL & DUES SYSTEM MIGRATION
-- ============================================================================

-- 1. Ensure employee_compensation table exists with enhanced fields
create table if not exists public.employee_compensation (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  monthly_salary numeric(12, 2) not null default 0 check (monthly_salary >= 0),
  per_project_rate numeric(12, 2) not null default 0 check (per_project_rate >= 0),
  salary_type text not null default 'Monthly' check (salary_type in ('Monthly', 'Per Project', 'Per Task')),
  default_currency text not null default 'USD' check (default_currency in ('USD', 'PKR')),
  joining_date date,
  responsibilities text not null default '',
  performance_rating numeric(5, 2) check (performance_rating between 0 and 100),
  updated_at timestamptz not null default now()
);

-- Add optional columns if table already existed
alter table public.employee_compensation add column if not exists salary_type text not null default 'Monthly';
alter table public.employee_compensation add column if not exists default_currency text not null default 'USD';

-- 2. Ensure employee_ledger table exists with enhanced fields
create table if not exists public.employee_ledger (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  entry_type text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'USD' check (currency in ('USD', 'PKR')),
  salary_month date,
  payment_method text,
  reference text,
  status text not null default 'Pending',
  project_id uuid references public.projects(id) on delete set null,
  description text not null default '',
  notes text not null default '',
  paid_at date not null default current_date,
  created_at timestamptz not null default now()
);

-- Add optional columns if table already existed
alter table public.employee_ledger add column if not exists currency text not null default 'USD';
alter table public.employee_ledger add column if not exists reference text;
alter table public.employee_ledger add column if not exists status text not null default 'Pending';
alter table public.employee_ledger add column if not exists description text not null default '';

-- Update entry_type constraint
alter table public.employee_ledger drop constraint if exists employee_ledger_entry_type_check;
alter table public.employee_ledger add constraint employee_ledger_entry_type_check
  check (entry_type in ('Salary', 'Project Payment', 'Bonus', 'Advance', 'Deduction', 'Payment', 'Other'));

-- Create indices for fast lookup by employee and date/month
create index if not exists employee_ledger_employee_paid_at_idx on public.employee_ledger(employee_id, paid_at desc);
create index if not exists employee_ledger_salary_month_idx on public.employee_ledger(salary_month);

-- 3. Row Level Security Policies
alter table public.employee_compensation enable row level security;
alter table public.employee_ledger enable row level security;

grant select, insert, update, delete on public.employee_compensation to authenticated;
grant select, insert, update, delete on public.employee_ledger to authenticated;

-- Admins can do everything on compensation & ledger
drop policy if exists "Admins manage employee compensation" on public.employee_compensation;
create policy "Admins manage employee compensation" on public.employee_compensation
for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

drop policy if exists "Admins manage employee payroll" on public.employee_ledger;
create policy "Admins manage employee payroll" on public.employee_ledger
for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

-- Employees can view their own compensation and ledger entries
drop policy if exists "Employees view own compensation" on public.employee_compensation;
create policy "Employees view own compensation" on public.employee_compensation
for select to authenticated using (employee_id = auth.uid());

drop policy if exists "Employees view own payroll ledger" on public.employee_ledger;
create policy "Employees view own payroll ledger" on public.employee_ledger
for select to authenticated using (employee_id = auth.uid());
