-- Enterprise Financial ERP Database Upgrade for Manuscript Heaven Tracker
-- Run this script in the Supabase SQL Editor to support extended finance attributes, budgets, and audit tracking.

-- 1. Extend finance_transactions table columns safely
alter table public.finance_transactions add column if not exists currency text not null default 'PKR';
alter table public.finance_transactions add column if not exists exchange_rate numeric(10, 4) not null default 1.0;
alter table public.finance_transactions add column if not exists amount_pkr numeric(12, 2) not null default 0.0;
alter table public.finance_transactions add column if not exists client_name text;
alter table public.finance_transactions add column if not exists invoice_id text;
alter table public.finance_transactions add column if not exists payment_method text default 'Bank Transfer';
alter table public.finance_transactions add column if not exists reference_no text;
alter table public.finance_transactions add column if not exists vendor text;
alter table public.finance_transactions add column if not exists recurring_status text default 'none';
alter table public.finance_transactions add column if not exists next_recurring_date date;
alter table public.finance_transactions add column if not exists notes text;
alter table public.finance_transactions add column if not exists attachment_url text;
alter table public.finance_transactions add column if not exists is_soft_deleted boolean not null default false;
alter table public.finance_transactions add column if not exists updated_by uuid references public.profiles(id) on delete set null;
alter table public.finance_transactions add column if not exists updated_at timestamptz default now();

-- Populate amount_pkr for existing records
update public.finance_transactions set amount_pkr = amount * exchange_rate where amount_pkr = 0;

-- 2. Category Budgets Table
create table if not exists public.finance_budgets (
  category text primary key,
  monthly_budget_pkr numeric(12, 2) not null default 0.0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 3. Indexes for high-performance querying
create index if not exists finance_transactions_type_idx on public.finance_transactions(type);
create index if not exists finance_transactions_category_idx on public.finance_transactions(category);
create index if not exists finance_transactions_deleted_idx on public.finance_transactions(is_soft_deleted);

-- 4. Row Level Security for Finance Budgets
alter table public.finance_budgets enable row level security;
grant select, insert, update, delete on public.finance_budgets to authenticated;

drop policy if exists "Admins can manage finance budgets" on public.finance_budgets;
create policy "Admins can manage finance budgets"
on public.finance_budgets for all to authenticated
using (public.current_user_role() in ('admin', 'manager'));
