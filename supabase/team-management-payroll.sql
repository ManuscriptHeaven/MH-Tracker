-- Run once in the Supabase SQL editor to enable Team Management payroll.

create table if not exists public.employee_compensation (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  monthly_salary numeric(12, 2) not null default 0 check (monthly_salary >= 0),
  per_project_rate numeric(12, 2) not null default 0 check (per_project_rate >= 0),
  joining_date date,
  responsibilities text not null default '',
  performance_rating numeric(5, 2) check (performance_rating between 0 and 100),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_ledger (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  entry_type text not null check (entry_type in ('Salary', 'Project Payment', 'Advance', 'Deduction', 'Payment')),
  amount numeric(12, 2) not null check (amount >= 0),
  salary_month date,
  payment_method text,
  project_id uuid references public.projects(id) on delete set null,
  notes text not null default '',
  paid_at date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists employee_ledger_employee_paid_at_idx on public.employee_ledger(employee_id, paid_at desc);

alter table public.employee_compensation enable row level security;
alter table public.employee_ledger enable row level security;

grant select, insert, update, delete on public.employee_compensation to authenticated;
grant select, insert, update, delete on public.employee_ledger to authenticated;

drop policy if exists "Admins manage employee compensation" on public.employee_compensation;
create policy "Admins manage employee compensation" on public.employee_compensation
for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

drop policy if exists "Admins manage employee payroll" on public.employee_ledger;
create policy "Admins manage employee payroll" on public.employee_ledger
for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
