-- Task Collaboration Completion: versioned task files, @mentions, and realtime child tables.
-- Additive and backward-compatible with Phase 6 / Task Management V2.

begin;

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  logical_file_id uuid not null default gen_random_uuid(),
  version_number integer not null default 1 check (version_number > 0),
  file_name text not null check (length(btrim(file_name)) between 1 and 240),
  storage_path text not null unique,
  mime_type text null,
  file_size bigint not null default 0 check (file_size >= 0 and file_size <= 104857600),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (logical_file_id, version_number)
);

create index if not exists idx_task_attachments_task_created
  on public.task_attachments(task_id, created_at desc);
create index if not exists idx_task_attachments_logical_version
  on public.task_attachments(logical_file_id, version_number desc);

alter table public.task_attachments enable row level security;
revoke all on public.task_attachments from anon;
revoke all on public.task_attachments from authenticated;
grant select, insert on public.task_attachments to authenticated;

drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select
on public.task_attachments for select to authenticated
using (public.phase6_can_access_task(task_id));

drop policy if exists task_attachments_insert on public.task_attachments;
create policy task_attachments_insert
on public.task_attachments for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and public.phase6_can_access_task(task_id)
);

create table if not exists public.task_mentions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  comment_id uuid not null references public.task_comments(id) on delete cascade,
  mentioned_profile_id uuid not null references public.profiles(id) on delete cascade,
  mentioned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (comment_id, mentioned_profile_id)
);

create index if not exists idx_task_mentions_profile_created
  on public.task_mentions(mentioned_profile_id, created_at desc);
create index if not exists idx_task_mentions_task
  on public.task_mentions(task_id);

alter table public.task_mentions enable row level security;
revoke all on public.task_mentions from anon;
revoke all on public.task_mentions from authenticated;
grant select, insert, delete on public.task_mentions to authenticated;

drop policy if exists task_mentions_select on public.task_mentions;
create policy task_mentions_select
on public.task_mentions for select to authenticated
using (public.phase6_can_access_task(task_id));

drop policy if exists task_mentions_insert on public.task_mentions;
create policy task_mentions_insert
on public.task_mentions for insert to authenticated
with check (
  mentioned_by = (select auth.uid())
  and public.phase6_can_access_task(task_id)
  and public.phase6_collaboration_target_is_team(mentioned_profile_id)
  and exists (
    select 1
    from public.task_comments c
    where c.id = comment_id
      and c.task_id = task_mentions.task_id
      and c.user_id = (select auth.uid())
  )
);

drop policy if exists task_mentions_delete on public.task_mentions;
create policy task_mentions_delete
on public.task_mentions for delete to authenticated
using (
  public.phase6_can_access_task(task_id)
  and (
    mentioned_by = (select auth.uid())
    or public.phase6_app_actor_class() in ('admin','project_manager')
  )
);

create or replace function public.notify_task_mention()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_task_title text;
  v_project_id uuid;
begin
  if new.mentioned_profile_id = new.mentioned_by then
    return new;
  end if;

  select t.title, t.project_id
    into v_task_title, v_project_id
  from public.tasks t
  where t.id = new.task_id;

  insert into public.notifications(
    user_id,
    recipient_id,
    project_id,
    title,
    message,
    type,
    is_read
  )
  values (
    new.mentioned_profile_id,
    new.mentioned_profile_id,
    v_project_id,
    'Mentioned in a task',
    coalesce(v_task_title, 'A task') || ' has a new comment mentioning you.',
    'task_mention',
    false
  );

  return new;
end
$fn$;

revoke all on function public.notify_task_mention() from public, anon, authenticated;

drop trigger if exists notify_task_mention_trigger on public.task_mentions;
create trigger notify_task_mention_trigger
after insert on public.task_mentions
for each row execute function public.notify_task_mention();

insert into storage.buckets(id, name, public, file_size_limit)
values ('task-files', 'task-files', false, 104857600)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "Task members can read task files" on storage.objects;
create policy "Task members can read task files"
on storage.objects for select to authenticated
using (
  bucket_id = 'task-files'
  and public.phase6_can_access_task(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
      else null::uuid
    end
  )
);

drop policy if exists "Task members can upload task files" on storage.objects;
create policy "Task members can upload task files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'task-files'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and public.phase6_can_access_task(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
      else null::uuid
    end
  )
);

-- Cleanup is allowed only before an object is registered as an immutable version.
drop policy if exists "Uploaders can delete unregistered task files" on storage.objects;
create policy "Uploaders can delete unregistered task files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'task-files'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and public.phase6_can_access_task(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
      else null::uuid
    end
  )
  and not exists (
    select 1
    from public.task_attachments a
    where a.storage_path = storage.objects.name
  )
);

-- Realtime collaboration: all task-owned child records now refresh open sessions.
do $realtime$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array[
      'task_comments',
      'task_checklist_items',
      'task_dependencies',
      'task_attachments',
      'task_mentions'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end
$realtime$;

notify pgrst, 'reload schema';

commit;
