-- Run once to persist the expanded expense form fields.
alter table public.finance_transactions
  add column if not exists expense_type text,
  add column if not exists payment_status text check (payment_status in ('Paid', 'Pending', 'Partially Paid')),
  add column if not exists paid_date date,
  add column if not exists financial_account text,
  add column if not exists tax_amount numeric(12,2) not null default 0,
  add column if not exists fee_amount numeric(12,2) not null default 0,
  add column if not exists recurring_end_date date;
