begin;

-- Restore the reporting/payment metadata columns defined by supabase/schema.sql.
-- Production drifted to the older core-only project_payments shape, while the
-- current frontend writes these fields when a payment is created or updated.
alter table public.project_payments
  add column if not exists due_date date,
  add column if not exists payment_month text,
  add column if not exists payment_year integer,
  add column if not exists payment_date date,
  add column if not exists notes text not null default '';

-- Backfill report scheduling metadata from the canonical project due date.
-- payment_date and notes have no authoritative legacy source, so leave them
-- null/empty rather than inventing historical values.
update public.project_payments pp
set
  due_date = p.due_date,
  payment_month = to_char(p.due_date, 'YYYY-MM'),
  payment_year = extract(year from p.due_date)::integer
from public.projects p
where p.id = pp.project_id
  and pp.due_date is null
  and p.due_date is not null;

-- Phase 6 intentionally uses column-level UPDATE grants for this table.
-- Extend that exact model to the restored columns; RLS continues to restrict
-- UPDATE to Admin/Project Manager actors.
revoke update (due_date, payment_month, payment_year, payment_date, notes)
  on public.project_payments from public, anon;
grant update (due_date, payment_month, payment_year, payment_date, notes)
  on public.project_payments to authenticated;

do $verify$
declare
  v_column text;
begin
  foreach v_column in array array['due_date','payment_month','payment_year','payment_date','notes']
  loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'project_payments'
        and column_name = v_column
    ) then
      raise exception 'project_payments_schema_parity_failed: missing column %', v_column;
    end if;

    if not has_column_privilege('authenticated', 'public.project_payments', v_column, 'UPDATE') then
      raise exception 'project_payments_schema_parity_failed: authenticated lacks UPDATE on %', v_column;
    end if;

    if has_column_privilege('anon', 'public.project_payments', v_column, 'UPDATE') then
      raise exception 'project_payments_schema_parity_failed: anon unexpectedly has UPDATE on %', v_column;
    end if;
  end loop;
end
$verify$;

-- Ask PostgREST to pick up the restored columns immediately.
notify pgrst, 'reload schema';

commit;
