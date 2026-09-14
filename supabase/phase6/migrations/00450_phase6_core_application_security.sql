begin;

-- Phase 6 Step 3D.2A: core collaboration security. The final cutover remains
-- reserved for 20260907000500_phase6_cutover_and_validation.sql.

do $phase6$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname='phase6_app_security_owner') then
    create role phase6_app_security_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$phase6$;

alter role phase6_app_security_owner
  nologin noinherit nocreatedb nocreaterole noreplication;
revoke phase6_app_security_owner from anon, authenticated;
do $phase6$
declare v_role pg_catalog.pg_roles%rowtype;
begin
  select * into v_role from pg_catalog.pg_roles
  where rolname='phase6_app_security_owner';
  if not found or v_role.rolsuper or v_role.rolbypassrls or v_role.rolcanlogin
     or v_role.rolinherit or v_role.rolcreatedb or v_role.rolcreaterole
     or v_role.rolreplication then
    raise exception 'phase6_app_security_owner_unsafe_attributes';
  end if;
end
$phase6$;

grant usage on schema public to phase6_app_security_owner;
grant execute on function public.phase6_auth_uid() to phase6_app_security_owner;

-- Active application-role normalization is independent from the workflow owner.
create or replace function public.phase6_app_actor_class()
returns text language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select case p.role::text
    when 'admin' then 'admin'
    when 'project_manager' then 'project_manager'
    when 'manager' then 'project_manager'
    when 'employee' then 'employee'
    when 'junior_assistant' then 'employee'
    when 'client' then 'client'
    else null end
  from public.profiles p
  where p.id=public.phase6_auth_uid() and p.status='active'
  limit 1
$fn$;

create or replace function public.phase6_team_can_access_project(p_project_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select public.phase6_auth_uid() is not null and exists (
    select 1 from public.projects p where p.id=p_project_id and (
      public.phase6_app_actor_class() in ('admin','project_manager')
      or (public.phase6_app_actor_class()='employee' and p.assigned_to=public.phase6_auth_uid())
    )
  )
$fn$;

create or replace function public.phase6_client_can_access_project(p_project_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select public.phase6_auth_uid() is not null
    and public.phase6_app_actor_class()='client'
    and exists (
      select 1 from public.projects p where p.id=p_project_id and (
        p.client_profile_id=public.phase6_auth_uid()
        or exists (select 1 from public.client_project_access a
          where a.project_id=p.id and a.client_id=public.phase6_auth_uid())
      )
    )
$fn$;

create or replace function public.phase6_collaboration_target_is_team(p_user_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select public.phase6_auth_uid() is not null
    and public.phase6_app_actor_class() in ('admin','project_manager','employee')
    and exists (select 1 from public.profiles p
      where p.id=p_user_id and p.status='active'
        and p.role::text in ('admin','project_manager','manager','employee','junior_assistant'))
$fn$;

create or replace function public.phase6_can_access_task(p_task_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select public.phase6_auth_uid() is not null and exists (
    select 1 from public.tasks t where t.id=p_task_id and (
      public.phase6_app_actor_class() in ('admin','project_manager')
      or (public.phase6_app_actor_class()='employee' and (
        t.assigned_to=public.phase6_auth_uid() or t.created_by=public.phase6_auth_uid()
        or (t.project_id is not null and public.phase6_team_can_access_project(t.project_id))
      ))
    )
  )
$fn$;

create or replace function public.phase6_can_access_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select public.phase6_auth_uid() is not null and exists (
    select 1 from public.conversations c where c.id=p_conversation_id and case
      when c.type='project_internal' then c.project_id is not null
        and public.phase6_team_can_access_project(c.project_id)
      when c.type='project_client' then c.project_id is not null and (
        public.phase6_team_can_access_project(c.project_id)
        or public.phase6_client_can_access_project(c.project_id))
      when c.type='task' then c.task_id is not null
        and public.phase6_can_access_task(c.task_id)
      when c.type in ('dm','team_channel') then exists (
        select 1 from public.conversation_members cm
        join public.profiles mp on mp.id=cm.user_id and mp.status='active'
        where cm.conversation_id=c.id and cm.user_id=public.phase6_auth_uid())
      else false
    end
  )
$fn$;

create or replace function public.phase6_can_access_message(p_message_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select public.phase6_auth_uid() is not null and exists (
    select 1 from public.messages m
    where m.id=p_message_id and public.phase6_can_access_conversation(m.conversation_id)
  )
$fn$;

create or replace function public.phase6_can_attach_to_message(p_message_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select public.phase6_auth_uid() is not null and exists (
    select 1 from public.messages m where m.id=p_message_id
      and m.sender_id=public.phase6_auth_uid()
      and public.phase6_can_access_conversation(m.conversation_id)
  )
$fn$;

create or replace function public.phase6_parent_message_matches(
  p_parent_message_id uuid, p_conversation_id uuid
) returns boolean language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select public.phase6_auth_uid() is not null
    and public.phase6_can_access_conversation(p_conversation_id)
    and exists (select 1 from public.messages m
      where m.id=p_parent_message_id and m.conversation_id=p_conversation_id)
$fn$;

create or replace function public.phase6_conversation_target_eligible(
  p_conversation_id uuid, p_target_user_id uuid
) returns boolean language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select public.phase6_auth_uid() is not null
    and public.phase6_can_access_conversation(p_conversation_id)
    and exists (
      select 1
      from public.conversations c
      join public.profiles target on target.id=p_target_user_id and target.status='active'
      where c.id=p_conversation_id and case
        when c.type='project_internal' then c.project_id is not null
          and target.role::text in ('admin','project_manager','manager','employee','junior_assistant')
          and (target.role::text in ('admin','project_manager','manager')
            or exists (select 1 from public.projects p where p.id=c.project_id
              and p.assigned_to=target.id))
        when c.type='project_client' then c.project_id is not null and (
          (target.role::text in ('admin','project_manager','manager'))
          or (target.role::text in ('employee','junior_assistant')
            and exists (select 1 from public.projects p where p.id=c.project_id
              and p.assigned_to=target.id))
          or (target.role::text='client' and exists (
            select 1 from public.projects p where p.id=c.project_id and (
              p.client_profile_id=target.id or exists (
                select 1 from public.client_project_access a
                where a.project_id=p.id and a.client_id=target.id)))))
        when c.type='task' then c.task_id is not null
          and target.role::text in ('admin','project_manager','manager','employee','junior_assistant')
          and exists (select 1 from public.tasks t where t.id=c.task_id and (
            target.role::text in ('admin','project_manager','manager')
            or t.assigned_to=target.id or t.created_by=target.id
            or (t.project_id is not null and exists (
              select 1 from public.projects p where p.id=t.project_id
                and p.assigned_to=target.id))))
        when c.type in ('dm','team_channel') then exists (
          select 1 from public.conversation_members cm
          where cm.conversation_id=c.id and cm.user_id=target.id)
        else false
      end
    )
$fn$;

-- Fixed, active, non-client directory. Email, phone, status, auth metadata and
-- employment/payroll fields are deliberately absent.
create or replace function public.get_collaboration_directory()
returns table (id uuid, full_name text, role public.app_role, avatar_url text)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select p.id,p.full_name,p.role,p.avatar_url
  from public.profiles p
  where public.phase6_auth_uid() is not null
    and public.phase6_app_actor_class() in ('admin','project_manager','employee')
    and p.status='active'
    and p.role::text in ('admin','project_manager','manager','employee','junior_assistant')
  order by p.full_name,p.id
$fn$;

-- DM creation must atomically establish the exact two eligible team members.
create or replace function public.phase6_create_direct_conversation(p_other_user_id uuid)
returns uuid language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_id uuid;
  v_actor_id uuid := public.phase6_auth_uid();
  v_pair_key text;
begin
  if p_other_user_id is null or p_other_user_id=v_actor_id
     or not public.phase6_collaboration_target_is_team(p_other_user_id) then
    raise exception 'phase6_invalid_direct_conversation' using errcode='42501';
  end if;

  v_pair_key := least(v_actor_id,p_other_user_id)::text || ':'
    || greatest(v_actor_id,p_other_user_id)::text;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_pair_key,0)
  );

  select c.id into v_id from public.conversations c
  where c.type='dm'
    and exists (select 1 from public.conversation_members x
      where x.conversation_id=c.id and x.user_id=v_actor_id)
    and exists (select 1 from public.conversation_members x
      where x.conversation_id=c.id and x.user_id=p_other_user_id)
    and (select count(*) from public.conversation_members x
      where x.conversation_id=c.id)=2
  order by c.created_at,c.id limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.conversations(type,created_by)
  values ('dm',v_actor_id) returning id into v_id;
  insert into public.conversation_members(conversation_id,user_id)
  values (v_id,v_actor_id),(v_id,p_other_user_id);
  return v_id;
end
$fn$;

-- Ignore caller-controlled role metadata at signup. Exact active team-member
-- provisioning may supply a role; otherwise a new identity is a Client with no
-- project access until an Admin creates an exact access link.
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
  select tm.full_name,tm.role,tm.phone,tm.status
    into v_name,v_role,v_phone,v_status
  from public.team_members tm
  where lower(tm.email)=lower(new.email) and tm.status='active'
  limit 1;
  if not found then
    v_name := coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1));
    v_role := 'client';
    v_phone := null;
    v_status := 'active';
  end if;
  insert into public.profiles(id,full_name,email,role,phone,status)
  values (new.id,v_name,new.email,v_role,v_phone,v_status)
  on conflict (id) do nothing;
  return new;
end
$fn$;

-- Team members are the trusted pre-provisioning record. If Auth/profile creation
-- happened first, reconcile the existing profile without changing identity.
create or replace function public.phase6_sync_profile_from_team_member()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  update public.profiles p
  set full_name=new.full_name,
      role=new.role,
      phone=new.phone,
      status=new.status
  where pg_catalog.lower(p.email)=pg_catalog.lower(new.email);
  return new;
end
$fn$;
revoke all on function public.phase6_sync_profile_from_team_member()
  from public,anon,authenticated;

create or replace function public.phase6_guard_profile_update()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if current_user='phase6_app_security_owner' then return new; end if;
  if public.phase6_app_actor_class()='admin' then return new; end if;
  if old.id is distinct from auth.uid()
     or new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.created_at is distinct from old.created_at then
    raise exception 'phase6_profile_security_fields_denied' using errcode='42501';
  end if;
  return new;
end
$fn$;

create or replace function public.phase6_guard_task_update()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if current_user='phase6_app_security_owner' then return new; end if;
  if public.phase6_app_actor_class()='employee' and (
    new.assigned_to is distinct from old.assigned_to
    or new.project_id is distinct from old.project_id
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'phase6_task_security_fields_denied' using errcode='42501';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$fn$;

-- Preserve migration 00400's project metadata rules and additionally prevent
-- an Employee from creating authority by changing projects.project_manager.
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

  new.updated_at := clock_timestamp();
  return new;
end
$fn$;
revoke all on function public.phase6_touch_project_metadata_updated_at()
  from public,anon,authenticated;

create or replace function public.phase6_notify_message_mention()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_body text;
  v_sender text;
  v_project_id uuid;
  v_conversation_id uuid;
begin
  select m.body,p.full_name,c.project_id,c.id
    into v_body,v_sender,v_project_id,v_conversation_id
  from public.messages m
  join public.conversations c on c.id=m.conversation_id
  join public.profiles p on p.id=m.sender_id
  where m.id=new.message_id;
  if v_body is null then raise exception 'phase6_invalid_message_mention'; end if;
  if not public.phase6_conversation_target_eligible(v_conversation_id,new.user_id) then
    raise exception 'phase6_invalid_message_mention_target' using errcode='42501';
  end if;
  insert into public.notifications(recipient_id,project_id,type,title,message,is_read,created_at)
  values (new.user_id,v_project_id,'mention',
    coalesce(v_sender,'A conversation member') || ' mentioned you',
    left(v_body,80),false,clock_timestamp());
  return new;
end
$fn$;

-- Give the separate NOLOGIN owner only the dependencies required above.
grant phase6_app_security_owner to postgres;
grant create on schema public to phase6_app_security_owner;

alter function public.phase6_app_actor_class() owner to phase6_app_security_owner;
alter function public.phase6_team_can_access_project(uuid) owner to phase6_app_security_owner;
alter function public.phase6_client_can_access_project(uuid) owner to phase6_app_security_owner;
alter function public.phase6_collaboration_target_is_team(uuid) owner to phase6_app_security_owner;
alter function public.phase6_can_access_task(uuid) owner to phase6_app_security_owner;
alter function public.phase6_can_access_conversation(uuid) owner to phase6_app_security_owner;
alter function public.phase6_can_access_message(uuid) owner to phase6_app_security_owner;
alter function public.phase6_can_attach_to_message(uuid) owner to phase6_app_security_owner;
alter function public.phase6_parent_message_matches(uuid,uuid) owner to phase6_app_security_owner;
alter function public.phase6_conversation_target_eligible(uuid,uuid) owner to phase6_app_security_owner;
alter function public.get_collaboration_directory() owner to phase6_app_security_owner;
alter function public.phase6_create_direct_conversation(uuid) owner to phase6_app_security_owner;
alter function public.create_profile_for_new_auth_user() owner to phase6_app_security_owner;
alter function public.phase6_notify_message_mention() owner to phase6_app_security_owner;

revoke all on function public.phase6_app_actor_class() from public,anon,authenticated;
revoke all on function public.phase6_team_can_access_project(uuid) from public,anon,authenticated;
revoke all on function public.phase6_client_can_access_project(uuid) from public,anon,authenticated;
revoke all on function public.phase6_collaboration_target_is_team(uuid) from public,anon,authenticated;
revoke all on function public.phase6_can_access_task(uuid) from public,anon,authenticated;
revoke all on function public.phase6_can_access_conversation(uuid) from public,anon,authenticated;
revoke all on function public.phase6_can_access_message(uuid) from public,anon,authenticated;
revoke all on function public.phase6_can_attach_to_message(uuid) from public,anon,authenticated;
revoke all on function public.phase6_parent_message_matches(uuid,uuid) from public,anon,authenticated;
revoke all on function public.phase6_conversation_target_eligible(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_collaboration_directory() from public,anon,authenticated;
revoke all on function public.phase6_create_direct_conversation(uuid) from public,anon,authenticated;
revoke all on function public.create_profile_for_new_auth_user() from public,anon,authenticated;
revoke all on function public.phase6_guard_profile_update() from public,anon,authenticated;
revoke all on function public.phase6_guard_task_update() from public,anon,authenticated;
revoke all on function public.phase6_notify_message_mention() from public,anon,authenticated;
revoke all on function public.phase6_sync_profile_from_team_member() from public,anon,authenticated;

grant execute on function public.phase6_app_actor_class() to authenticated;
grant execute on function public.phase6_team_can_access_project(uuid) to authenticated;
grant execute on function public.phase6_client_can_access_project(uuid) to authenticated;
grant execute on function public.phase6_collaboration_target_is_team(uuid) to authenticated;
grant execute on function public.phase6_can_access_task(uuid) to authenticated;
grant execute on function public.phase6_can_access_conversation(uuid) to authenticated;
grant execute on function public.phase6_can_access_message(uuid) to authenticated;
grant execute on function public.phase6_can_attach_to_message(uuid) to authenticated;
grant execute on function public.phase6_parent_message_matches(uuid,uuid) to authenticated;
grant execute on function public.phase6_conversation_target_eligible(uuid,uuid) to authenticated;
grant execute on function public.get_collaboration_directory() to authenticated;
grant execute on function public.phase6_create_direct_conversation(uuid) to authenticated;

-- These historical profile/communication helpers exposed either arbitrary role
-- classification or an email resolver. Their former policies are replaced and
-- name-based email discovery is no longer application-callable.
do $phase6$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('is_client_user','find_login_email')
  loop execute format('revoke all on function %s from public, anon, authenticated',r.signature); end loop;
end
$phase6$;

grant select on public.projects,public.tasks,public.conversations,public.conversation_members,
  public.messages,public.client_project_access,public.team_members to phase6_app_security_owner;
grant select (id,full_name,email,role,avatar_url,phone,status,created_at),
  insert (id,full_name,email,role,phone,status)
  on public.profiles to phase6_app_security_owner;
grant insert on public.conversations,public.conversation_members,public.notifications
  to phase6_app_security_owner;

drop trigger if exists create_profile_after_auth_user_created on auth.users;
create trigger create_profile_after_auth_user_created
after insert on auth.users for each row
execute function public.create_profile_for_new_auth_user();
drop trigger if exists phase6_sync_profile_from_team_member on public.team_members;
create trigger phase6_sync_profile_from_team_member
after insert or update of full_name,email,role,phone,status on public.team_members
for each row execute function public.phase6_sync_profile_from_team_member();
drop trigger if exists phase6_guard_profile_update on public.profiles;
create trigger phase6_guard_profile_update before update on public.profiles
for each row execute function public.phase6_guard_profile_update();
drop trigger if exists phase6_guard_task_update on public.tasks;
create trigger phase6_guard_task_update before update on public.tasks
for each row execute function public.phase6_guard_task_update();
drop trigger if exists phase6_notify_message_mention on public.message_mentions;
create trigger phase6_notify_message_mention after insert on public.message_mentions
for each row execute function public.phase6_notify_message_mention();

-- ACLs and RLS are both required. No application role receives broad mutation.
revoke all on public.profiles,public.notifications,public.conversations,
  public.conversation_members,public.messages,public.message_attachments,
  public.message_mentions,public.message_reactions,public.tasks,
  public.revision_notes,public.project_notes,public.activity_logs,public.team_members
  from public,anon,authenticated;
grant select,insert,delete on public.profiles to authenticated;
grant update (full_name,avatar_url,phone,role,status) on public.profiles to authenticated;
grant select,delete on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;
grant select,insert on public.conversations,public.conversation_members,public.messages,
  public.message_attachments,public.message_mentions to authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;
grant select,insert,delete on public.message_reactions to authenticated;
grant select,insert on public.tasks,public.revision_notes,public.project_notes,public.activity_logs
  to authenticated;
grant select,insert,update,delete on public.team_members to authenticated;
grant update (title,description,project_id,assigned_to,status,priority,due_date,completed_at,updated_at)
  on public.tasks to authenticated;

-- Remove every historical policy variant on the owned tables.
do $phase6$
declare r record;
begin
  for r in
    select n.nspname,c.relname,p.polname
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid=p.polrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any(array[
      'profiles','notifications','conversations','conversation_members','messages',
      'message_attachments','message_mentions','message_reactions','tasks',
      'revision_notes','project_notes','activity_logs','team_members'
    ])
  loop execute format('drop policy %I on %I.%I',r.polname,r.nspname,r.relname); end loop;
end
$phase6$;

alter table public.profiles enable row level security;
alter table public.notifications enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_mentions enable row level security;
alter table public.message_reactions enable row level security;
alter table public.tasks enable row level security;
alter table public.revision_notes enable row level security;
alter table public.project_notes enable row level security;
alter table public.activity_logs enable row level security;
alter table public.team_members enable row level security;

-- Dependency policies for the app-security owner; migration 4 project/client
-- policies remain intact and workflow-owner notification/profile access returns.
drop policy if exists phase6_profiles_app_security_select on public.profiles;
create policy phase6_profiles_app_security_select on public.profiles for select to phase6_app_security_owner
using (current_user='phase6_app_security_owner');
create policy phase6_profiles_app_security_insert on public.profiles for insert to phase6_app_security_owner
with check (current_user='phase6_app_security_owner');
create policy phase6_profiles_workflow_owner_select on public.profiles for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
drop policy if exists phase6_projects_app_security_select on public.projects;
create policy phase6_projects_app_security_select on public.projects for select to phase6_app_security_owner
using (current_user='phase6_app_security_owner');
drop policy if exists phase6_access_app_security_select on public.client_project_access;
create policy phase6_access_app_security_select on public.client_project_access for select to phase6_app_security_owner
using (current_user='phase6_app_security_owner');
drop policy if exists phase6_team_members_app_security_select on public.team_members;
create policy phase6_team_members_app_security_select on public.team_members for select to phase6_app_security_owner
using (current_user='phase6_app_security_owner');
create policy phase6_team_members_admin_select on public.team_members for select to authenticated
using (public.phase6_app_actor_class()='admin');
create policy phase6_team_members_admin_insert on public.team_members for insert to authenticated
with check (public.phase6_app_actor_class()='admin');
create policy phase6_team_members_admin_update on public.team_members for update to authenticated
using (public.phase6_app_actor_class()='admin') with check (public.phase6_app_actor_class()='admin');
create policy phase6_team_members_admin_delete on public.team_members for delete to authenticated
using (public.phase6_app_actor_class()='admin');

create policy phase6_profiles_self_select on public.profiles for select to authenticated
using (id=auth.uid());
create policy phase6_profiles_admin_select on public.profiles for select to authenticated
using (public.phase6_app_actor_class()='admin');
create policy phase6_profiles_self_update on public.profiles for update to authenticated
using (id=auth.uid()) with check (id=auth.uid());
create policy phase6_profiles_admin_update on public.profiles for update to authenticated
using (public.phase6_app_actor_class()='admin') with check (public.phase6_app_actor_class()='admin');
create policy phase6_profiles_admin_insert on public.profiles for insert to authenticated
with check (public.phase6_app_actor_class()='admin');
create policy phase6_profiles_admin_delete on public.profiles for delete to authenticated
using (public.phase6_app_actor_class()='admin');

create policy phase6_notifications_recipient_select on public.notifications for select to authenticated
using (recipient_id=auth.uid());
create policy phase6_notifications_recipient_update on public.notifications for update to authenticated
using (recipient_id=auth.uid()) with check (recipient_id=auth.uid());
create policy phase6_notifications_recipient_delete on public.notifications for delete to authenticated
using (recipient_id=auth.uid());
create policy phase6_notifications_workflow_owner_select on public.notifications for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
create policy phase6_notifications_workflow_owner_insert on public.notifications for insert to phase6_workflow_rpc_owner
with check (current_user='phase6_workflow_rpc_owner');
create policy phase6_notifications_app_security_insert on public.notifications for insert to phase6_app_security_owner
with check (current_user='phase6_app_security_owner');

create policy phase6_conversations_app_security_select on public.conversations for select to phase6_app_security_owner
using (current_user='phase6_app_security_owner');
create policy phase6_conversations_app_security_insert on public.conversations for insert to phase6_app_security_owner
with check (current_user='phase6_app_security_owner');
create policy phase6_conversations_member_select on public.conversations for select to authenticated
using (public.phase6_can_access_conversation(id));
create policy phase6_conversations_eligible_insert on public.conversations for insert to authenticated
with check (
  created_by=auth.uid() and (
    (type='project_internal' and project_id is not null and task_id is null
      and public.phase6_team_can_access_project(project_id))
    or (type='project_client' and project_id is not null and task_id is null and (
      public.phase6_team_can_access_project(project_id)
      or public.phase6_client_can_access_project(project_id)))
    or (type='task' and task_id is not null and project_id is null
      and public.phase6_can_access_task(task_id))
  )
);

create policy phase6_members_app_security_select on public.conversation_members for select to phase6_app_security_owner
using (current_user='phase6_app_security_owner');
create policy phase6_members_app_security_insert on public.conversation_members for insert to phase6_app_security_owner
with check (current_user='phase6_app_security_owner');
create policy phase6_members_conversation_select on public.conversation_members for select to authenticated
using (public.phase6_can_access_conversation(conversation_id));
create policy phase6_members_self_insert on public.conversation_members for insert to authenticated
with check (user_id=auth.uid() and public.phase6_can_access_conversation(conversation_id));
create policy phase6_members_self_read_update on public.conversation_members for update to authenticated
using (user_id=auth.uid() and public.phase6_can_access_conversation(conversation_id))
with check (user_id=auth.uid() and public.phase6_can_access_conversation(conversation_id));

create policy phase6_messages_app_security_select on public.messages for select to phase6_app_security_owner
using (current_user='phase6_app_security_owner');
create policy phase6_messages_member_select on public.messages for select to authenticated
using (public.phase6_can_access_conversation(conversation_id));
create policy phase6_messages_member_insert on public.messages for insert to authenticated
with check (
  sender_id=auth.uid()
  and public.phase6_can_access_conversation(conversation_id)
  and (parent_message_id is null
    or public.phase6_parent_message_matches(parent_message_id,conversation_id))
);

create policy phase6_attachments_member_select on public.message_attachments for select to authenticated
using (public.phase6_can_access_message(message_id));
create policy phase6_attachments_sender_insert on public.message_attachments for insert to authenticated
with check (public.phase6_can_attach_to_message(message_id));
create policy phase6_mentions_member_select on public.message_mentions for select to authenticated
using (public.phase6_can_access_message(message_id));
create policy phase6_mentions_sender_insert on public.message_mentions for insert to authenticated
with check (public.phase6_can_attach_to_message(message_id)
  and public.phase6_conversation_target_eligible(
    (select m.conversation_id from public.messages m where m.id=message_id),user_id));
create policy phase6_reactions_member_select on public.message_reactions for select to authenticated
using (public.phase6_can_access_message(message_id));
create policy phase6_reactions_self_insert on public.message_reactions for insert to authenticated
with check (user_id=auth.uid() and public.phase6_can_access_message(message_id));
create policy phase6_reactions_self_delete on public.message_reactions for delete to authenticated
using (user_id=auth.uid() and public.phase6_can_access_message(message_id));

create policy phase6_tasks_app_security_select on public.tasks for select to phase6_app_security_owner
using (current_user='phase6_app_security_owner');
create policy phase6_tasks_team_select on public.tasks for select to authenticated
using (public.phase6_can_access_task(id));
create policy phase6_tasks_team_insert on public.tasks for insert to authenticated
with check (
  created_by=auth.uid()
  and public.phase6_app_actor_class() in ('admin','project_manager','employee')
  and (project_id is null or public.phase6_team_can_access_project(project_id))
  and (assigned_to is null or public.phase6_collaboration_target_is_team(assigned_to))
  and (public.phase6_app_actor_class() in ('admin','project_manager') or assigned_to=auth.uid())
);
create policy phase6_tasks_team_update on public.tasks for update to authenticated
using (public.phase6_can_access_task(id))
with check (
  public.phase6_can_access_task(id)
  and (project_id is null or public.phase6_team_can_access_project(project_id))
  and (assigned_to is null or public.phase6_collaboration_target_is_team(assigned_to))
);

create policy phase6_revision_notes_team_select on public.revision_notes for select to authenticated
using (public.phase6_team_can_access_project(project_id));
create policy phase6_revision_notes_team_insert on public.revision_notes for insert to authenticated
with check (added_by=auth.uid() and public.phase6_team_can_access_project(project_id));
create policy phase6_project_notes_team_select on public.project_notes for select to authenticated
using (public.phase6_team_can_access_project(project_id));
create policy phase6_project_notes_team_insert on public.project_notes for insert to authenticated
with check (added_by=auth.uid() and public.phase6_team_can_access_project(project_id));
create policy phase6_activity_logs_team_select on public.activity_logs for select to authenticated
using ((project_id is not null and public.phase6_team_can_access_project(project_id))
  or (project_id is null and public.phase6_app_actor_class() in ('admin','project_manager')));
create policy phase6_activity_logs_team_insert on public.activity_logs for insert to authenticated
with check (user_id=auth.uid() and (
  (project_id is not null and public.phase6_team_can_access_project(project_id))
  or (project_id is null and public.phase6_app_actor_class() in ('admin','project_manager'))));

revoke create on schema public from phase6_app_security_owner;
revoke phase6_app_security_owner from postgres;

notify pgrst, 'reload schema';
commit;
