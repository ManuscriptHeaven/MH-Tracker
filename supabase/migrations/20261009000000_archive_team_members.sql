begin;

-- Keep historical foreign keys and Auth users. Access is controlled by the
-- active profile, while team_members remains the trusted provisioning record.
-- An archived pre-provisioned email must not sign up as an active client.
create or replace function public.create_profile_for_new_auth_user()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_name text;
  v_role public.app_role := 'client';
  v_phone text;
  v_status text := 'active';
begin
  if new.email is null then return new; end if;
  select tm.full_name, tm.role, tm.phone, tm.status
    into v_name, v_role, v_phone, v_status
  from public.team_members tm
  where pg_catalog.lower(tm.email) = pg_catalog.lower(new.email)
  limit 1;
  if not found then
    v_name := coalesce(nullif(pg_catalog.btrim(new.raw_user_meta_data->>'full_name'), ''), pg_catalog.split_part(new.email, '@', 1));
    v_role := 'client';
    v_phone := null;
    v_status := 'active';
  end if;
  insert into public.profiles(id, full_name, email, role, phone, status)
  values (new.id, v_name, new.email, v_role, v_phone, v_status)
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create or replace function public.set_team_member_active(p_profile_id uuid, p_active boolean)
returns void
language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_actor uuid := auth.uid();
  v_target public.profiles%rowtype;
  v_status text := case when p_active then 'active' else 'inactive' end;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor and p.role::text = 'admin' and p.status = 'active'
  ) then
    raise exception 'Only an active admin can change team access.' using errcode = '42501';
  end if;
  if p_profile_id is null or p_active is null then
    raise exception 'A team member and access state are required.' using errcode = '22023';
  end if;
  if p_profile_id = v_actor then
    raise exception 'You cannot change your own team access.' using errcode = '42501';
  end if;

  -- Serialize admin changes so concurrent archives cannot remove every admin.
  perform pg_catalog.pg_advisory_xact_lock(717737, 1009);
  select * into v_target from public.profiles p where p.id = p_profile_id for update;
  if not found or v_target.role::text = 'client' then
    raise exception 'Team member not found.' using errcode = '22023';
  end if;
  if not p_active and v_target.role::text = 'admin' and v_target.status = 'active'
    and (select count(*) from public.profiles p where p.role::text = 'admin' and p.status = 'active') <= 1 then
    raise exception 'The last active admin cannot be archived.' using errcode = '42501';
  end if;

  update public.team_members t set status = v_status
  where pg_catalog.lower(t.email) = pg_catalog.lower(v_target.email);
  update public.profiles p set status = v_status where p.id = p_profile_id;
end;
$fn$;

revoke all on function public.set_team_member_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_team_member_active(uuid, boolean) to authenticated;

-- Direct profile edits must not accidentally lock out the acting or last admin.
create or replace function public.guard_last_team_admin()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if old.role::text = 'admin' and old.status = 'active'
    and (new.role::text <> 'admin' or new.status <> 'active') then
    if old.id = auth.uid() then
      raise exception 'You cannot remove your own admin access.' using errcode = '42501';
    end if;
    if (select count(*) from public.profiles p where p.role::text = 'admin' and p.status = 'active') <= 1 then
      raise exception 'The last active admin cannot be removed.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$fn$;
revoke all on function public.guard_last_team_admin() from public, anon, authenticated;
drop trigger if exists guard_last_team_admin on public.profiles;
create trigger guard_last_team_admin before update of role, status on public.profiles
for each row execute function public.guard_last_team_admin();

-- A retained JWT may still authenticate at Auth, but it grants no application
-- table access after the profile status changes. Own profile SELECT is kept so
-- the client can detect the archived status and sign out.
create policy archived_profile_cannot_update on public.profiles as restrictive
for update to authenticated
using ((select public.phase6_app_actor_class()) is not null)
with check ((select public.phase6_app_actor_class()) is not null);

do $policies$
declare v_table record;
begin
  for v_table in
    select c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relrowsecurity and c.relname <> 'profiles'
  loop
    execute pg_catalog.format(
      'create policy archived_member_denied on public.%I as restrictive for all to authenticated using ((select public.phase6_app_actor_class()) is not null) with check ((select public.phase6_app_actor_class()) is not null)',
      v_table.relname
    );
  end loop;
end;
$policies$;

create policy archived_member_storage_denied on storage.objects as restrictive
for all to authenticated
using ((select public.phase6_app_actor_class()) is not null)
with check ((select public.phase6_app_actor_class()) is not null);

-- RLS cannot cover SECURITY DEFINER RPCs. Reject retained JWTs at the Data
-- API boundary as well; anonymous sign-in and public Auth endpoints are not
-- affected. Storage remains protected by the restrictive policy above.
create or replace function public.enforce_active_app_profile()
returns void language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if auth.uid() is not null and not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active'
  ) then
    raise exception 'This account is archived or unavailable.' using errcode = '42501';
  end if;
end;
$fn$;
revoke all on function public.enforce_active_app_profile() from public, anon, authenticated;
grant execute on function public.enforce_active_app_profile() to anon, authenticated, authenticator;
alter role authenticator set pgrst.db_pre_request = 'public.enforce_active_app_profile';
notify pgrst, 'reload config';

-- The application no longer needs destructive member/profile deletion.
revoke delete on public.profiles, public.team_members from authenticated;
drop policy if exists phase6_profiles_admin_delete on public.profiles;
drop policy if exists phase6_team_members_admin_delete on public.team_members;
commit;
