-- Task Incentive Pay: task pricing remains separate from employee-visible tasks.
-- Production migration requires schema parity + payroll/RLS role smoke before cutover.
create table if not exists public.task_incentives (
  task_id uuid primary key references public.tasks(id) on delete restrict,
  employee_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'draft' check (status in ('draft','approved')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  ledger_entry_id uuid unique references public.employee_ledger(id) on delete restrict,
  constraint task_incentive_approval_consistency check (
    (status = 'draft' and approved_by is null and approved_at is null and ledger_entry_id is null)
    or (status = 'approved' and approved_by is not null and approved_at is not null and ledger_entry_id is not null)
  )
);

alter table public.task_incentives enable row level security;
revoke all on public.task_incentives from public, anon, authenticated;
grant select, insert, update on public.task_incentives to authenticated;

create policy task_incentives_admin_select on public.task_incentives for select to authenticated
  using (public.phase6_app_actor_class() = 'admin');
create policy task_incentives_admin_insert on public.task_incentives for insert to authenticated
  with check (public.phase6_app_actor_class() = 'admin' and created_by = (select auth.uid()));
create policy task_incentives_admin_update on public.task_incentives for update to authenticated
  using (public.phase6_app_actor_class() = 'admin')
  with check (public.phase6_app_actor_class() = 'admin');

-- The trigger runs as the actual logged-in Admin, not a bypass-RLS owner.
-- Approval and creation of the payroll row are one atomic statement.
create or replace function public.task_incentive_guard_and_award()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_task public.tasks%rowtype;
  v_ledger_id uuid;
begin
  if public.phase6_app_actor_class() <> 'admin' or auth.uid() is null then
    raise exception 'Only an active Admin can set task incentives' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'approved' then
      raise exception 'Approved task incentives are immutable; use an audited payroll adjustment' using errcode = '23514';
    end if;
    if new.task_id is distinct from old.task_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Task incentive identity and creation history cannot change' using errcode = '23514';
    end if;
  else
    if new.created_by is distinct from auth.uid() then
      raise exception 'Creator must be the signed-in Admin' using errcode = '42501';
    end if;
    if new.status <> 'draft' then
      raise exception 'Create the proposed incentive before approving it' using errcode = '23514';
    end if;
  end if;

  if new.currency <> 'USD' or new.amount <= 0 then
    raise exception 'Use a positive USD incentive' using errcode = '23514';
  end if;
  if new.approved_by is not null or new.approved_at is not null or new.ledger_entry_id is not null then
    raise exception 'Approval metadata is server-controlled' using errcode = '23514';
  end if;

  select * into v_task from public.tasks where id = new.task_id;
  if not found or v_task.archived_at is not null or v_task.project_id is null then
    raise exception 'Incentive requires an active, project-linked task' using errcode = '23514';
  end if;
  if v_task.assigned_to is distinct from new.employee_id then
    raise exception 'Task assignee changed; refresh the incentive before approval' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = new.employee_id
      and p.role::text in ('employee','junior_assistant')
  ) then
    raise exception 'Incentives must belong to production team employees' using errcode = '23514';
  end if;

  if new.status = 'approved' then
    if tg_op <> 'UPDATE' or old.status <> 'draft' then
      raise exception 'Only proposed incentives may be approved' using errcode = '23514';
    end if;
    if v_task.status <> 'Done' then
      raise exception 'Complete and review the task before approving its incentive' using errcode = '23514';
    end if;
    insert into public.employee_ledger
      (employee_id, entry_type, amount, currency, salary_month, payment_method,
       project_id, notes, paid_at, reference, status, description)
    values
      (new.employee_id, 'Bonus', new.amount, 'USD',
       date_trunc('month', timezone('Asia/Karachi', now()))::date, null,
       v_task.project_id, 'Approved task incentive: ' || v_task.title,
       timezone('Asia/Karachi', now())::date,
       'TASK_INCENTIVE:' || new.task_id::text, 'Pending', 'Task incentive')
    returning id into v_ledger_id;

    new.ledger_entry_id := v_ledger_id;
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.task_incentive_guard_and_award() from public, anon, authenticated;
create trigger task_incentive_guard_and_award
  before insert or update on public.task_incentives
  for each row execute function public.task_incentive_guard_and_award();

-- A duplicate payroll credit must never be created by a repeated approval.
create unique index if not exists employee_ledger_unique_task_incentive_reference
  on public.employee_ledger(reference) where reference like 'TASK_INCENTIVE:%';

comment on table public.task_incentives is 'Admin-only proposed task incentive. Approved row is immutable and linked to one employee_ledger bonus.';
