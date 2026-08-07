-- Enterprise Financial ERP Database Upgrade for Manuscript Heaven Tracker
-- Run this in the Supabase SQL Editor to support extended finance attributes, budgets, and audit tracking.

-- 1. Extend finance_transactions table if missing columns
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'currency') then
    alter table public.finance_transactions add column currency text not null default 'PKR';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'exchange_rate') then
    alter table public.finance_transactions add column exchange_rate numeric(10, 4) not null default 1.0;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'amount_pkr') then
    alter table public.finance_transactions add column amount_pkr numeric(12, 2) not null default 0.0;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'client_name') then
    alter table public.finance_transactions add column client_name text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'invoice_id') then
    alter table public.finance_transactions add column invoice_id text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'payment_method') then
    alter table public.finance_transactions add column payment_method text default 'Bank Transfer';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'reference_no') then
    alter table public.finance_transactions add column reference_no text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'vendor') then
    alter table public.finance_transactions add column vendor text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'recurring_status') then
    alter table public.finance_transactions add column recurring_status text default 'none';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'next_recurring_date') then
    alter table public.finance_transactions add column next_recurring_date date;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'notes') then
    alter table public.finance_transactions add column notes text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'attachment_url') then
    alter table public.finance_transactions add column attachment_url text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'is_soft_deleted') then
    alter table public.finance_transactions add column is_soft_deleted boolean not null default false;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'updated_by') then
    alter table public.finance_transactions add column updated_by uuid references public.profiles(id) on delete set null;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'updated_at') then
    alter table public.finance_transactions add column updated_at timestamptz default now();
  end if;
end $$;

-- Update existing amount_pkr where zero
update public.finance_transactions set amount_pkr = amount * exchange_rate where amount_pkr = 0;

-- 2. Category Budgets Table
create table if not exists public.finance_budgets (
  category text primary key,
  monthly_budget_pkr numeric(12, 2) not null default 0.0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Indexes for performance
create index if not exists finance_transactions_type_idx on public.finance_transactions(type);
create index if not exists finance_transactions_category_idx on public.finance_transactions(category);
create index if not exists finance_transactions_deleted_idx on public.finance_transactions(is_soft_deleted);

-- Row Level Security for Finance Budgets
alter table public.finance_budgets enable row level security;
grant select, insert, update, delete on public.finance_budgets to authenticated;

drop policy if exists "Admins can manage finance budgets" on public.finance_budgets;
create policy "Admins can manage finance budgets"
on public.finance_budgets for all to authenticated
using (public.current_user_role() in ('admin', 'manager'));
