begin;

-- Phase 6 Step 3D.2B: business-finance is Admin/PM; payroll is Admin/self.
-- Final cutover remains reserved for 20260907000500.

-- The signup owner needs only exact provisioning evidence. team_members has no
-- compensation columns, but email and phone remain private provisioning data.
revoke select on public.team_members from phase6_app_security_owner;
grant select (email,full_name,role,phone,status)
  on public.team_members to phase6_app_security_owner;

-- Preserve the accepted project metadata guard and add finance-field control.
create or replace function public.phase6_touch_project_metadata_updated_at()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if current_user='phase6_workflow_rpc_owner' then
    return new;
  end if;

  if new.client_profile_id is distinct from old.client_profile_id
     and public.phase6_current_actor_class() not in ('admin','project_manager') then
    raise exception 'workflow_project_client_access_denied' using errcode='42501';
  end if;

  if new.project_manager is distinct from old.project_manager
     and public.phase6_current_actor_class()='employee' then
    raise exception 'phase6_project_manager_change_denied' using errcode='42501';
  end if;

  if (new.invoiced is distinct from old.invoiced
      or new.invoice_id is distinct from old.invoice_id
      or new.invoiced_at is distinct from old.invoiced_at)
     and public.phase6_current_actor_class() not in ('admin','project_manager') then
    raise exception 'phase6_project_invoice_metadata_denied' using errcode='42501';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end
$fn$;
revoke all on function public.phase6_touch_project_metadata_updated_at()
  from public,anon,authenticated;

create or replace function public.phase6_guard_project_payment()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if tg_op='INSERT' then
    new.updated_by := auth.uid();
    new.created_at := clock_timestamp();
  elsif new.id is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.created_at is distinct from old.created_at then
    raise exception 'phase6_project_payment_linkage_denied' using errcode='42501';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  return new;
end
$fn$;

create or replace function public.phase6_guard_finance_transaction()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if tg_op='INSERT' then
    if new.created_by is distinct from auth.uid() then
      raise exception 'phase6_finance_creator_denied' using errcode='42501';
    end if;
    new.created_at := clock_timestamp();
  else
    if new.id is distinct from old.id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'phase6_finance_audit_identity_denied' using errcode='42501';
    end if;
    if new.project_id is distinct from old.project_id
       and public.phase6_app_actor_class()<>'admin' then
      raise exception 'phase6_finance_project_relink_denied' using errcode='42501';
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  new.amount_pkr := round(new.amount * new.exchange_rate,2);
  return new;
end
$fn$;

create or replace function public.phase6_guard_finance_budget()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if tg_op='UPDATE' and new.category is distinct from old.category then
    raise exception 'phase6_finance_budget_category_denied' using errcode='42501';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  return new;
end
$fn$;

create or replace function public.phase6_guard_employee_compensation()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if tg_op='UPDATE' and new.employee_id is distinct from old.employee_id then
    raise exception 'phase6_compensation_employee_denied' using errcode='42501';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$fn$;

create or replace function public.phase6_stamp_employee_ledger_insert()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  new.created_at := clock_timestamp();
  return new;
end
$fn$;

revoke all on function public.phase6_guard_project_payment() from public,anon,authenticated;
revoke all on function public.phase6_guard_finance_transaction() from public,anon,authenticated;
revoke all on function public.phase6_guard_finance_budget() from public,anon,authenticated;
revoke all on function public.phase6_guard_employee_compensation() from public,anon,authenticated;
revoke all on function public.phase6_stamp_employee_ledger_insert() from public,anon,authenticated;

drop trigger if exists touch_project_payments_updated_at on public.project_payments;
drop trigger if exists phase6_guard_project_payment on public.project_payments;
create trigger phase6_guard_project_payment before insert or update on public.project_payments
for each row execute function public.phase6_guard_project_payment();
drop trigger if exists phase6_guard_finance_transaction on public.finance_transactions;
create trigger phase6_guard_finance_transaction before insert or update on public.finance_transactions
for each row execute function public.phase6_guard_finance_transaction();
drop trigger if exists phase6_guard_finance_budget on public.finance_budgets;
create trigger phase6_guard_finance_budget before insert or update on public.finance_budgets
for each row execute function public.phase6_guard_finance_budget();
drop trigger if exists phase6_guard_employee_compensation on public.employee_compensation;
create trigger phase6_guard_employee_compensation before insert or update on public.employee_compensation
for each row execute function public.phase6_guard_employee_compensation();
drop trigger if exists phase6_stamp_employee_ledger_insert on public.employee_ledger;
create trigger phase6_stamp_employee_ledger_insert before insert on public.employee_ledger
for each row execute function public.phase6_stamp_employee_ledger_insert();

-- Remove table- and column-level application grants before rebuilding the ACL.
revoke all on public.project_payments,public.finance_transactions,public.finance_budgets,
  public.employee_compensation,public.employee_ledger from public,anon,authenticated;
do $phase6$
declare r record; v_columns text;
begin
  for r in select unnest(array[
    'project_payments','finance_transactions','finance_budgets',
    'employee_compensation','employee_ledger'
  ]) as relation_name loop
    select string_agg(format('%I',a.attname),',' order by a.attnum) into v_columns
    from pg_catalog.pg_attribute a
    where a.attrelid=format('public.%I',r.relation_name)::regclass
      and a.attnum>0 and not a.attisdropped;
    execute format('revoke select (%s) on public.%I from public,anon,authenticated',v_columns,r.relation_name);
    execute format('revoke insert (%s) on public.%I from public,anon,authenticated',v_columns,r.relation_name);
    execute format('revoke update (%s) on public.%I from public,anon,authenticated',v_columns,r.relation_name);
    execute format('revoke references (%s) on public.%I from public,anon,authenticated',v_columns,r.relation_name);
  end loop;
end
$phase6$;

grant select,insert,delete on public.project_payments to authenticated;
grant update (project_id,total_price,advance_paid,payment_status,updated_by)
  on public.project_payments to authenticated;
grant select,insert,delete on public.finance_transactions to authenticated;
grant update (type,category,description,amount,transaction_date,project_id,currency,
  exchange_rate,amount_pkr,client_name,invoice_id,payment_method,reference_no,vendor,
  recurring_status,next_recurring_date,notes,attachment_url,is_soft_deleted,updated_by,
  updated_at)
  on public.finance_transactions to authenticated;
grant select,insert,delete on public.finance_budgets to authenticated;
grant update (category,monthly_budget_pkr,updated_by,updated_at)
  on public.finance_budgets to authenticated;
grant select,insert,delete on public.employee_compensation to authenticated;
grant update (employee_id,monthly_salary,per_project_rate,joining_date,responsibilities,
  performance_rating,updated_at)
  on public.employee_compensation to authenticated;
grant select,insert,delete on public.employee_ledger to authenticated;

-- Historical policy names vary across installs; replace the complete set.
do $phase6$
declare r record;
begin
  for r in
    select n.nspname,c.relname,p.polname
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid=p.polrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any(array[
      'project_payments','finance_transactions','finance_budgets',
      'employee_compensation','employee_ledger'
    ])
  loop execute format('drop policy %I on %I.%I',r.polname,r.nspname,r.relname); end loop;
end
$phase6$;

alter table public.project_payments enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.finance_budgets enable row level security;
alter table public.employee_compensation enable row level security;
alter table public.employee_ledger enable row level security;

create policy phase6_project_payments_finance_select on public.project_payments
for select to authenticated
using (public.phase6_app_actor_class() in ('admin','project_manager'));
create policy phase6_project_payments_finance_insert on public.project_payments
for insert to authenticated
with check (public.phase6_app_actor_class() in ('admin','project_manager')
  and updated_by=auth.uid());
create policy phase6_project_payments_finance_update on public.project_payments
for update to authenticated
using (public.phase6_app_actor_class() in ('admin','project_manager'))
with check (public.phase6_app_actor_class() in ('admin','project_manager')
  and updated_by=auth.uid());
create policy phase6_project_payments_admin_delete on public.project_payments
for delete to authenticated using (public.phase6_app_actor_class()='admin');

create policy phase6_finance_transactions_finance_select on public.finance_transactions
for select to authenticated
using (public.phase6_app_actor_class() in ('admin','project_manager'));
create policy phase6_finance_transactions_finance_insert on public.finance_transactions
for insert to authenticated
with check (public.phase6_app_actor_class() in ('admin','project_manager')
  and created_by=auth.uid() and updated_by=auth.uid());
create policy phase6_finance_transactions_finance_update on public.finance_transactions
for update to authenticated
using (public.phase6_app_actor_class() in ('admin','project_manager'))
with check (public.phase6_app_actor_class() in ('admin','project_manager')
  and updated_by=auth.uid());
create policy phase6_finance_transactions_finance_delete on public.finance_transactions
for delete to authenticated
using (public.phase6_app_actor_class() in ('admin','project_manager'));

create policy phase6_finance_budgets_finance_select on public.finance_budgets
for select to authenticated
using (public.phase6_app_actor_class() in ('admin','project_manager'));
create policy phase6_finance_budgets_finance_insert on public.finance_budgets
for insert to authenticated
with check (public.phase6_app_actor_class() in ('admin','project_manager')
  and updated_by=auth.uid());
create policy phase6_finance_budgets_finance_update on public.finance_budgets
for update to authenticated
using (public.phase6_app_actor_class() in ('admin','project_manager'))
with check (public.phase6_app_actor_class() in ('admin','project_manager')
  and updated_by=auth.uid());
create policy phase6_finance_budgets_admin_delete on public.finance_budgets
for delete to authenticated using (public.phase6_app_actor_class()='admin');

create policy phase6_compensation_admin_select on public.employee_compensation
for select to authenticated using (public.phase6_app_actor_class()='admin');
create policy phase6_compensation_self_select on public.employee_compensation
for select to authenticated
using (public.phase6_app_actor_class()='employee' and employee_id=auth.uid());
create policy phase6_compensation_admin_insert on public.employee_compensation
for insert to authenticated with check (public.phase6_app_actor_class()='admin');
create policy phase6_compensation_admin_update on public.employee_compensation
for update to authenticated
using (public.phase6_app_actor_class()='admin')
with check (public.phase6_app_actor_class()='admin');
create policy phase6_compensation_admin_delete on public.employee_compensation
for delete to authenticated using (public.phase6_app_actor_class()='admin');

create policy phase6_ledger_admin_select on public.employee_ledger
for select to authenticated using (public.phase6_app_actor_class()='admin');
create policy phase6_ledger_self_select on public.employee_ledger
for select to authenticated
using (public.phase6_app_actor_class()='employee' and employee_id=auth.uid());
create policy phase6_ledger_admin_insert on public.employee_ledger
for insert to authenticated with check (public.phase6_app_actor_class()='admin');
create policy phase6_ledger_admin_delete on public.employee_ledger
for delete to authenticated using (public.phase6_app_actor_class()='admin');

notify pgrst, 'reload schema';
commit;
