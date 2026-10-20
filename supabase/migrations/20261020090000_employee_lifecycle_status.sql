begin;

-- Employee lifecycle is separate from attendance presence.
-- Do not delete auth users, profiles, assignments, attendance or payroll history.
alter table public.profiles
  add column if not exists employment_condition text not null default 'active',
  add column if not exists condition_start_date date,
  add column if not exists condition_end_date date;
alter table public.profiles drop constraint if exists profiles_employment_condition_check;
alter table public.profiles add constraint profiles_employment_condition_check
  check (employment_condition in ('active', 'holiday', 'leave', 'resigned', 'retired', 'terminated'));
alter table public.profiles drop constraint if exists profiles_condition_dates_check;
alter table public.profiles add constraint profiles_condition_dates_check
  check (condition_end_date is null or condition_start_date is null or condition_end_date >= condition_start_date);

create table if not exists public.employee_condition_audit (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete restrict,
  changed_by uuid not null references public.profiles(id) on delete restrict,
  from_condition text not null,
  to_condition text not null,
  condition_start_date date,
  condition_end_date date,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists employee_condition_audit_employee_idx
  on public.employee_condition_audit(employee_id, created_at desc);
alter table public.employee_condition_audit enable row level security;
revoke all on public.employee_condition_audit from public, anon, authenticated;
grant select on public.employee_condition_audit to authenticated;
drop policy if exists employee_condition_audit_admin_read on public.employee_condition_audit;
create policy employee_condition_audit_admin_read on public.employee_condition_audit
  for select to authenticated using (public.phase6_app_actor_class() = 'admin');

-- SECURITY DEFINER provides a single atomic, audited mutation. Clients have no
-- direct UPDATE grant on the new profile fields and no audit INSERT grant.
create or replace function public.admin_set_team_employment_condition(
  p_employee_id uuid,
  p_condition text,
  p_start_date date default null,
  p_end_date date default null,
  p_reason text default null
)
returns public.profiles
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_target public.profiles%rowtype;
  v_updated public.profiles%rowtype;
  v_access_status text;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
begin
  if public.phase6_app_actor_class() is distinct from 'admin' then
    raise exception 'Only an active admin can change team employment status.' using errcode = '42501';
  end if;
  if p_employee_id is null or p_employee_id = auth.uid() then
    raise exception 'An admin cannot change their own employment status.' using errcode = '42501';
  end if;
  select * into v_target from public.profiles where id = p_employee_id for update;
  if not found then
    raise exception 'Team member not found.' using errcode = 'P0002';
  end if;
  if v_target.role::text not in ('employee', 'junior_assistant', 'manager', 'project_manager') then
    raise exception 'Admin and client profiles cannot be managed from the Team status dialog.' using errcode = '42501';
  end if;
  if p_condition is null or p_condition not in
    ('active', 'holiday', 'leave', 'resigned', 'retired', 'terminated') then
    raise exception 'Invalid employment condition.' using errcode = '22023';
  end if;
  if p_condition in ('holiday', 'leave') then
    if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
      raise exception 'Leave and holiday dates must be a valid date range.' using errcode = '22023';
    end if;
  elsif p_start_date is not null or p_end_date is not null then
    raise exception 'Dates apply only to holiday or leave.' using errcode = '22023';
  end if;

  if p_condition in ('resigned', 'retired', 'terminated') then
    if pg_catalog.length(v_reason) < 3 then
      raise exception 'A reason is required to archive an employee.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.tasks t
      where t.assigned_to = p_employee_id and t.status::text <> 'Done'
        and t.archived_at is null
    ) or exists (
      select 1 from public.projects p
      where (p.assigned_to = p_employee_id or p.project_manager = p_employee_id)
        and p.status::text not in ('Delivered', 'Completed', 'Archived', 'Cancelled')
    ) then
      raise exception 'Reassign the employee''s open tasks and active projects before archiving.' using errcode = '23514';
    end if;
  end if;

  v_access_status := case
    when p_condition in ('resigned', 'retired', 'terminated') then 'inactive'
    else 'active'
  end;

  -- Match the pre-provisioning record too, so its sync trigger cannot later
  -- reactivate an offboarded profile with stale status.
  update public.team_members
     set status = v_access_status
   where pg_catalog.lower(email) = pg_catalog.lower(v_target.email);

  update public.profiles
     set status = v_access_status,
         employment_condition = p_condition,
         condition_start_date = case when p_condition in ('holiday','leave') then p_start_date else null end,
         condition_end_date = case when p_condition in ('holiday','leave') then p_end_date else null end
   where id = p_employee_id
   returning * into v_updated;

  insert into public.employee_condition_audit(
    employee_id, changed_by, from_condition, to_condition,
    condition_start_date, condition_end_date, reason
  ) values (
    p_employee_id, auth.uid(), v_target.employment_condition, p_condition,
    v_updated.condition_start_date, v_updated.condition_end_date, v_reason
  );
  return v_updated;
end;
$function$;

revoke all on function public.admin_set_team_employment_condition(uuid,text,date,date,text)
  from public, anon, authenticated;
grant execute on function public.admin_set_team_employment_condition(uuid,text,date,date,text)
  to authenticated;

commit;
