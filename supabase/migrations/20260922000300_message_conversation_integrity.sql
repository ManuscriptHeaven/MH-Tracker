-- Messaging integrity hardening:
-- 1) merge historical duplicate DM/project conversation shells into the
--    canonical earliest conversation without losing messages/read state;
-- 2) prevent duplicate project/task/channel conversation keys;
-- 3) make malformed/group-like legacy DMs inaccessible through ordinary app
--    access instead of presenting them as a one-to-one direct message;
-- 4) require both sides of a newly created DM to be active team accounts.

create temporary table mh_conversation_dedup_map (
  extra_id uuid primary key,
  canonical_id uuid not null
) on commit drop;

-- Project conversations are canonical by (project_id, type), matching the
-- get-or-create RPC's ORDER BY created_at, id behavior.
insert into mh_conversation_dedup_map(extra_id, canonical_id)
select id, canonical_id
from (
  select
    c.id,
    first_value(c.id) over (
      partition by c.project_id, c.type
      order by c.created_at, c.id
      rows between unbounded preceding and unbounded following
    ) as canonical_id
  from public.conversations c
  where c.type in ('project_internal', 'project_client')
    and c.project_id is not null
) ranked
where id is distinct from canonical_id;

-- Valid one-to-one DMs are canonical by their exact two-member pair.
with dm_pairs as (
  select
    c.id,
    c.created_at,
    string_agg(cm.user_id::text, ':' order by cm.user_id::text) as pair_key
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id = c.id
  where c.type = 'dm'
  group by c.id, c.created_at
  having count(*) = 2
     and count(distinct cm.user_id) = 2
),
ranked as (
  select
    id,
    first_value(id) over (
      partition by pair_key
      order by created_at, id
      rows between unbounded preceding and unbounded following
    ) as canonical_id
  from dm_pairs
)
insert into mh_conversation_dedup_map(extra_id, canonical_id)
select id, canonical_id
from ranked
where id is distinct from canonical_id
on conflict (extra_id) do nothing;

-- Moving a message does not move its private storage object path, which embeds
-- the conversation ID. Refuse an automatic merge if an extra conversation has
-- file-backed messages so those files can never be orphaned silently.
do $block$
begin
  if exists (
    select 1
    from mh_conversation_dedup_map map
    join public.messages m
      on m.conversation_id = map.extra_id
    join public.message_attachments a
      on a.message_id = m.id
  ) then
    raise exception 'message_conversation_dedup_has_attachments';
  end if;
end
$block$;

-- Preserve the strongest read state for every member before removing extras.
insert into public.conversation_members(
  conversation_id,
  user_id,
  last_read_at,
  created_at
)
select
  map.canonical_id,
  cm.user_id,
  max(cm.last_read_at),
  min(cm.created_at)
from mh_conversation_dedup_map map
join public.conversation_members cm
  on cm.conversation_id = map.extra_id
group by map.canonical_id, cm.user_id
on conflict (conversation_id, user_id) do update
set last_read_at = greatest(
      public.conversation_members.last_read_at,
      excluded.last_read_at
    ),
    created_at = least(
      public.conversation_members.created_at,
      excluded.created_at
    );

-- Messages keep their IDs, replies, reactions, mentions, and attachment rows.
-- Current production extras have no attachments (enforced above).
update public.messages m
set conversation_id = map.canonical_id
from mh_conversation_dedup_map map
where m.conversation_id = map.extra_id;

delete from public.conversation_members cm
using mh_conversation_dedup_map map
where cm.conversation_id = map.extra_id;

delete from public.conversations c
using mh_conversation_dedup_map map
where c.id = map.extra_id;

-- Structural uniqueness for conversation classes that have a natural key.
create unique index if not exists conversations_project_type_unique
  on public.conversations(project_id, type)
  where project_id is not null
    and type in ('project_internal', 'project_client');

create unique index if not exists conversations_task_unique
  on public.conversations(task_id)
  where task_id is not null
    and type = 'task';

create unique index if not exists conversations_team_channel_name_unique
  on public.conversations((lower(name)))
  where type = 'team_channel'
    and name is not null;

-- A DM is valid only when it has exactly two distinct active team members,
-- one of whom is the signed-in actor. This hides the single historical
-- three-member DM from ordinary app access without deleting its message.
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
          public.phase6_app_actor_class() in ('admin', 'project_manager', 'employee')
          and (
            select count(*)
            from public.conversation_members cm
            where cm.conversation_id = c.id
          ) = 2
          and (
            select count(*)
            from public.conversation_members cm
            join public.profiles mp
              on mp.id = cm.user_id
             and mp.status = 'active'
             and mp.role::text in (
               'admin',
               'project_manager',
               'manager',
               'employee',
               'junior_assistant'
             )
            where cm.conversation_id = c.id
          ) = 2
          and exists (
            select 1
            from public.conversation_members cm
            where cm.conversation_id = c.id
              and cm.user_id = public.phase6_auth_uid()
          )

        when c.type = 'team_channel' then
          public.phase6_app_actor_class() in ('admin', 'project_manager', 'employee')

        else false
      end
  )
$function$;

-- Direct conversations may only be created by active app team actors, and the
-- target must also be an active team account. Advisory locking plus the
-- canonical two-member lookup prevents racing duplicate DMs.
create or replace function public.phase6_create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_actor_id uuid := public.phase6_auth_uid();
  v_pair_key text;
begin
  if v_actor_id is null
     or public.phase6_app_actor_class() not in ('admin', 'project_manager', 'employee')
     or p_other_user_id is null
     or p_other_user_id = v_actor_id
     or not public.phase6_collaboration_target_is_team(p_other_user_id) then
    raise exception 'phase6_invalid_direct_conversation' using errcode = '42501';
  end if;

  v_pair_key := least(v_actor_id, p_other_user_id)::text || ':'
    || greatest(v_actor_id, p_other_user_id)::text;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_pair_key, 0)
  );

  select c.id
    into v_id
    from public.conversations c
   where c.type = 'dm'
     and exists (
       select 1
       from public.conversation_members x
       where x.conversation_id = c.id
         and x.user_id = v_actor_id
     )
     and exists (
       select 1
       from public.conversation_members x
       where x.conversation_id = c.id
         and x.user_id = p_other_user_id
     )
     and (
       select count(*)
       from public.conversation_members x
       where x.conversation_id = c.id
     ) = 2
   order by c.created_at, c.id
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations(type, created_by)
  values ('dm', v_actor_id)
  returning id into v_id;

  insert into public.conversation_members(conversation_id, user_id)
  values
    (v_id, v_actor_id),
    (v_id, p_other_user_id);

  return v_id;
end
$function$;

revoke all on function public.phase6_create_direct_conversation(uuid) from public;
revoke all on function public.phase6_create_direct_conversation(uuid) from anon;
grant execute on function public.phase6_create_direct_conversation(uuid) to authenticated;
