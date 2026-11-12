-- Security hardening from the 10 Nov 2026 review.
-- Additive and idempotent: safe to re-run.

-- 1. Size limit on the revision-files bucket (it had none).
update storage.buckets
   set file_size_limit = 52428800
 where id = 'revision-files'
   and file_size_limit is null;

-- 2. Pin search_path on the functions the Supabase linter flagged.
alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.add_business_days(date, integer) set search_path = public, pg_temp;
alter function public.timeline_progress(text) set search_path = public, pg_temp;
alter function public.project_production_days(public.projects) set search_path = public, pg_temp;
alter function public.is_client_user(uuid) set search_path = public, pg_temp;

-- 3. Role helper functions are only needed by signed-in users.
revoke execute on function public.can_manage_all_projects() from anon;
revoke execute on function public.current_user_is_client() from anon;
revoke execute on function public.current_user_role() from anon;
revoke execute on function public.project_is_visible(public.projects) from anon;

-- 4. Employees may update the projects assigned to them, but not the fields
--    that decide who the project belongs to or how it is billed.
--    Only direct API writes are checked; SECURITY DEFINER workflow RPCs run
--    as their owner role and are not affected.
create or replace function public.guard_employee_project_identity_update()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if public.phase6_app_actor_class() is distinct from 'employee' then
    return new;
  end if;
  if lower(btrim(coalesce(new.client_email, ''))) is distinct from lower(btrim(coalesce(old.client_email, '')))
     or new.client_profile_id is distinct from old.client_profile_id
     or new.assigned_to is distinct from old.assigned_to
     or new.project_manager is distinct from old.project_manager
     or new.created_by is distinct from old.created_by
     or btrim(coalesce(new.project_number, '')) is distinct from btrim(coalesce(old.project_number, ''))
     or coalesce(new.invoiced, false) is distinct from coalesce(old.invoiced, false)
     or new.invoice_id is distinct from old.invoice_id
     or new.invoiced_at is distinct from old.invoiced_at then
    raise exception 'project_identity_fields_denied'
      using errcode = '42501',
            hint = 'Only an admin or project manager can change client, assignment or invoice fields.';
  end if;
  return new;
end
$$;

drop trigger if exists guard_employee_project_identity_update on public.projects;
create trigger guard_employee_project_identity_update
  before update on public.projects
  for each row execute function public.guard_employee_project_identity_update();

-- 5. Sign-ups from unknown emails no longer become active accounts.
--    Active: an active team_members row (pre-provisioned staff or client),
--            or an email that is the client_email of an existing project.
--    Everything else is created inactive until an admin activates it.
create or replace function public.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_name text;
  v_role public.app_role := 'client';
  v_phone text;
  v_status text := 'inactive';
begin
  if new.email is null then return new; end if;

  select tm.full_name, tm.role, tm.phone, tm.status
    into v_name, v_role, v_phone, v_status
  from public.team_members tm
  where lower(tm.email) = lower(new.email) and tm.status = 'active'
  limit 1;

  if not found then
    v_name := coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));
    v_role := 'client';
    v_phone := null;
    if not exists (
         select 1 from public.team_members tm
          where lower(tm.email) = lower(new.email)
       )
       and exists (
         select 1 from public.projects p
          where lower(btrim(coalesce(p.client_email, ''))) = lower(btrim(new.email))
       ) then
      v_status := 'active';
    else
      v_status := 'inactive';
    end if;
  end if;

  insert into public.profiles(id, full_name, email, role, phone, status)
  values (new.id, v_name, new.email, v_role, v_phone, v_status)
  on conflict (id) do nothing;
  return new;
end
$$;
