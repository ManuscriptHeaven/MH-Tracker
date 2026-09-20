-- Repair project-window messaging:
-- 1) project conversations are created through a hardened RPC instead of INSERT ... RETURNING
--    (which can fail under conversation SELECT RLS even when the INSERT is authorized);
-- 2) projects with an exact active client email are linked automatically when no client access exists;
-- 3) project-client conversations always include the linked client as a conversation member.

grant create on schema public to phase6_app_security_owner;
grant phase6_app_security_owner to postgres with set true;
set role phase6_app_security_owner;

create or replace function public.phase6_link_project_client_by_email(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_client_email text;
  v_client_id uuid;
  v_match_count integer;
begin
  select lower(pg_catalog.btrim(coalesce(p.client_email, '')))
    into v_client_email
    from public.projects p
   where p.id = p_project_id;

  if v_client_email is null or v_client_email = '' then
    return null;
  end if;

  if exists (
    select 1
      from public.client_project_access a
     where a.project_id = p_project_id
  ) then
    select a.client_id
      into v_client_id
      from public.client_project_access a
     where a.project_id = p_project_id
     order by a.created_at, a.id
     limit 1;
    return v_client_id;
  end if;

  select count(*), min(p.id)
    into v_match_count, v_client_id
    from public.profiles p
   where p.role::text = 'client'
     and p.status = 'active'
     and lower(pg_catalog.btrim(coalesce(p.email, ''))) = v_client_email;

  if v_match_count = 1 and v_client_id is not null then
    insert into public.client_project_access(client_id, project_id)
    values (v_client_id, p_project_id)
    on conflict (client_id, project_id) do nothing;
    return v_client_id;
  end if;

  return null;
end
$function$;

create or replace function public.phase6_sync_project_client_access()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  perform public.phase6_link_project_client_by_email(new.id);
  return new;
end
$function$;

create or replace function public.phase6_get_or_create_project_conversation(
  p_project_id uuid,
  p_is_internal boolean
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_actor_id uuid := public.phase6_auth_uid();
  v_actor_class text := public.phase6_app_actor_class();
  v_type text := case when p_is_internal then 'project_internal' else 'project_client' end;
  v_conversation_id uuid;
  v_client_count integer;
begin
  if v_actor_id is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'Project not found.' using errcode = '22023';
  end if;

  if p_is_internal then
    if v_actor_class = 'client' or not public.phase6_team_can_access_project(p_project_id) then
      raise exception 'You do not have access to this internal project discussion.' using errcode = '42501';
    end if;
  else
    if not (
      public.phase6_team_can_access_project(p_project_id)
      or public.phase6_client_can_access_project(p_project_id)
    ) then
      raise exception 'You do not have access to this client project discussion.' using errcode = '42501';
    end if;

    -- Managers/admins can safely repair missing portal access when the project
    -- email exactly matches one active client profile. Employees never grant access.
    if v_actor_class in ('admin', 'project_manager') then
      perform public.phase6_link_project_client_by_email(p_project_id);
    end if;

    select count(*)
      into v_client_count
      from public.client_project_access a
      join public.profiles p on p.id = a.client_id
     where a.project_id = p_project_id
       and p.role::text = 'client'
       and p.status = 'active';

    if v_actor_class <> 'client' and v_client_count = 0 then
      raise exception 'No active client portal account is linked to this project. Ask an Admin or Project Manager to link the client before sending a client message.'
        using errcode = 'P0001';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mh-project-conversation:' || p_project_id::text || ':' || v_type, 0)
  );

  select c.id
    into v_conversation_id
    from public.conversations c
   where c.project_id = p_project_id
     and c.type = v_type
   order by c.created_at, c.id
   limit 1;

  if v_conversation_id is null then
    insert into public.conversations(type, project_id, created_by)
    values (v_type, p_project_id, v_actor_id)
    returning id into v_conversation_id;
  end if;

  insert into public.conversation_members(conversation_id, user_id)
  values (v_conversation_id, v_actor_id)
  on conflict (conversation_id, user_id) do nothing;

  if not p_is_internal then
    insert into public.conversation_members(conversation_id, user_id)
    select v_conversation_id, a.client_id
      from public.client_project_access a
      join public.profiles p on p.id = a.client_id
     where a.project_id = p_project_id
       and p.role::text = 'client'
       and p.status = 'active'
    on conflict (conversation_id, user_id) do nothing;
  end if;

  return v_conversation_id;
end
$function$;

reset role;

revoke all on function public.phase6_link_project_client_by_email(uuid) from public;
revoke all on function public.phase6_link_project_client_by_email(uuid) from anon;
revoke all on function public.phase6_link_project_client_by_email(uuid) from authenticated;

revoke all on function public.phase6_sync_project_client_access() from public;
revoke all on function public.phase6_sync_project_client_access() from anon;
revoke all on function public.phase6_sync_project_client_access() from authenticated;

revoke all on function public.phase6_get_or_create_project_conversation(uuid, boolean) from public;
revoke all on function public.phase6_get_or_create_project_conversation(uuid, boolean) from anon;
grant execute on function public.phase6_get_or_create_project_conversation(uuid, boolean) to authenticated;

drop trigger if exists phase6_projects_sync_client_access on public.projects;
create trigger phase6_projects_sync_client_access
after insert or update of client_email on public.projects
for each row
execute function public.phase6_sync_project_client_access();

-- Repair existing projects only when there is no existing portal access and
-- the project email maps to exactly one active client profile.
with unique_client_emails as (
  select lower(pg_catalog.btrim(p.email)) as email, min(p.id) as client_id
  from public.profiles p
  where p.role::text = 'client'
    and p.status = 'active'
    and pg_catalog.btrim(coalesce(p.email, '')) <> ''
  group by lower(pg_catalog.btrim(p.email))
  having count(*) = 1
)
insert into public.client_project_access(client_id, project_id)
select u.client_id, p.id
from public.projects p
join unique_client_emails u
  on u.email = lower(pg_catalog.btrim(coalesce(p.client_email, '')))
where not exists (
  select 1 from public.client_project_access a where a.project_id = p.id
)
on conflict (client_id, project_id) do nothing;

-- Ensure any existing project-client conversation gets the linked client member.
insert into public.conversation_members(conversation_id, user_id)
select c.id, a.client_id
from public.conversations c
join public.client_project_access a on a.project_id = c.project_id
join public.profiles p on p.id = a.client_id
where c.type = 'project_client'
  and p.role::text = 'client'
  and p.status = 'active'
on conflict (conversation_id, user_id) do nothing;

grant phase6_app_security_owner to postgres with set false;
revoke create on schema public from phase6_app_security_owner;
