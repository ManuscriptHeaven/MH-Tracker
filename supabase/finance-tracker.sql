-- Run this in the Supabase SQL editor after the base schema.
create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('income', 'expense')),
  category text not null,
  description text not null,
  amount numeric(12, 2) not null check (amount > 0),
  transaction_date date not null default current_date,
  project_id uuid references public.projects(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists finance_transactions_date_idx on public.finance_transactions(transaction_date desc);
create index if not exists finance_transactions_project_idx on public.finance_transactions(project_id);

alter table public.finance_transactions enable row level security;
grant select, insert, delete on public.finance_transactions to authenticated;
revoke all on public.finance_transactions from anon;

drop policy if exists "Admins can view finance transactions" on public.finance_transactions;
create policy "Admins can view finance transactions" on public.finance_transactions for select to authenticated using (public.current_user_role() = 'admin');
drop policy if exists "Admins can add finance transactions" on public.finance_transactions;
create policy "Admins can add finance transactions"
on public.finance_transactions
for insert
to authenticated
with check (public.current_user_role() = 'admin' and created_by = auth.uid());

drop policy if exists "Admins can delete finance transactions" on public.finance_transactions;
create policy "Admins can delete finance transactions"
on public.finance_transactions
for delete
to authenticated
using (public.current_user_role() = 'admin');

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'finance_transactions') then
    alter publication supabase_realtime add table public.finance_transactions;
  end if;
end $$;
