-- Complete cross-role messaging and team-channel reliability.
-- Safe for the existing Phase 6 role model:
-- admin/project_manager/manager => manager class
-- employee/junior_assistant => employee class

-- Existing Phase 6 access functions are owned by this hardened role.
-- PostgreSQL 17 role memberships can disallow SET ROLE even with ADMIN OPTION,
-- so temporarily enable SET for this migration transaction and restore it below.
grant phase6_app_security_owner to postgres with set true;
set role phase6_app_security_owner;

create or replace function public.phase6_can_access_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select public.phase6_auth_uid() is not null and exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and case
        when c.type = 'project_internal' then
          c.project_id is not null
          and public.phase6_team_can_access_project(c.project_id)

        when c.type = 'project_client' then
          c.project_id is not null
          and (
            public.phase6_team_can_access_project(c.project_id)
            or public.phase6_client_can_access_project(c.project_id)
          )

        when c.type = 'task' then
          c.task_id is not null
          and public.phase6_can_access_task(c.task_id)

        when c.type = 'dm' then
          exists (
            select 1
            from public.conversation_members cm
            join public.profiles mp
              on mp.id = cm.user_id
             and mp.status = 'active'
            where cm.conversation_id = c.id
              and cm.user_id = public.phase6_auth_uid()
          )

        when c.type = 'team_channel' then
          public.phase6_app_actor_class() in ('admin', 'project_manager', 'employee')

        else false
      end
  )
$function$;

create or replace function public.phase6_get_or_create_team_channel(p_name text)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_actor_id uuid := public.phase6_auth_uid();
  v_name text := lower(pg_catalog.btrim(p_name));
  v_id uuid;
begin
  if v_actor_id is null
     or public.phase6_app_actor_class() not in ('admin', 'project_manager', 'employee') then
    raise exception 'phase6_team_channel_not_allowed' using errcode = '42501';
  end if;

  if v_name not in ('general', 'formatting', 'covers', 'qc', 'announcements') then
    raise exception 'phase6_invalid_team_channel' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mh-team-channel:' || v_name, 0)
  );

  select c.id
    into v_id
    from public.conversations c
   where c.type = 'team_channel'
     and lower(c.name) = v_name
   order by c.created_at, c.id
   limit 1;

  if v_id is null then
    insert into public.conversations(type, name, created_by)
    values ('team_channel', v_name, v_actor_id)
    returning id into v_id;
  end if;

  insert into public.conversation_members(conversation_id, user_id)
  select v_id, p.id
    from public.profiles p
   where p.status = 'active'
     and p.role::text in ('admin', 'project_manager', 'manager', 'employee', 'junior_assistant')
  on conflict (conversation_id, user_id) do nothing;

  return v_id;
end
$function$;

revoke all on function public.phase6_get_or_create_team_channel(text) from public;
grant execute on function public.phase6_get_or_create_team_channel(text) to authenticated;

-- Keep every active team member attached to team channels for unread tracking,
-- mentions, and newly provisioned accounts.
create or replace function public.phase6_sync_team_channel_membership()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.status = 'active'
     and new.role::text in ('admin', 'project_manager', 'manager', 'employee', 'junior_assistant') then
    insert into public.conversation_members(conversation_id, user_id)
    select c.id, new.id
      from public.conversations c
     where c.type = 'team_channel'
    on conflict (conversation_id, user_id) do nothing;
  end if;

  return new;
end
$function$;

reset role;

drop trigger if exists phase6_profiles_team_channel_membership on public.profiles;
create trigger phase6_profiles_team_channel_membership
after insert or update of role, status on public.profiles
for each row
execute function public.phase6_sync_team_channel_membership();

set role phase6_app_security_owner;

-- Create the standard team channels once.
insert into public.conversations(type, name, created_by)
select 'team_channel', channel_name, null
from (
  values
    ('general'),
    ('formatting'),
    ('covers'),
    ('qc'),
    ('announcements')
) as channels(channel_name)
where not exists (
  select 1
  from public.conversations c
  where c.type = 'team_channel'
    and lower(c.name) = channels.channel_name
);

-- Backfill current active team memberships.
insert into public.conversation_members(conversation_id, user_id)
select c.id, p.id
from public.conversations c
cross join public.profiles p
where c.type = 'team_channel'
  and p.status = 'active'
  and p.role::text in ('admin', 'project_manager', 'manager', 'employee', 'junior_assistant')
on conflict (conversation_id, user_id) do nothing;

reset role;

-- Ensure the records used by the messaging UI participate in Supabase Realtime.
do $block$
declare
  v_table text;
begin
  foreach v_table in array array[
    'conversations',
    'conversation_members',
    'messages',
    'message_attachments',
    'message_mentions',
    'message_reactions'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute pg_catalog.format(
        'alter publication supabase_realtime add table public.%I',
        v_table
      );
    end if;
  end loop;
end
$block$;

-- Restore the hardened membership setting after the migration.
grant phase6_app_security_owner to postgres with set false;
