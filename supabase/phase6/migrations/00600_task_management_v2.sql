begin;

-- Task Management V2, phase 1. This migration is intentionally additive:
-- tasks.assigned_to remains the legacy/primary assignee source of truth.

alter table public.tasks
  add column if not exists start_date date,
  add column if not exists parent_task_id uuid,
  add column if not exists estimated_minutes integer,
  add column if not exists actual_minutes integer,
  add column if not exists blocked_reason text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists task_type text not null default 'task',
  add column if not exists visibility text not null default 'team',
  add column if not exists archived_at timestamptz;

do $task_v2$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.tasks'::regclass and conname='tasks_parent_task_id_fkey'
  ) then
    alter table public.tasks add constraint tasks_parent_task_id_fkey
      foreign key (parent_task_id) references public.tasks(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.tasks'::regclass and conname='tasks_not_own_parent_check'
  ) then
    alter table public.tasks add constraint tasks_not_own_parent_check
      check (parent_task_id is null or parent_task_id <> id) not valid;
    alter table public.tasks validate constraint tasks_not_own_parent_check;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.tasks'::regclass and conname='tasks_estimated_minutes_check'
  ) then
    alter table public.tasks add constraint tasks_estimated_minutes_check
      check (estimated_minutes is null or estimated_minutes >= 0) not valid;
    alter table public.tasks validate constraint tasks_estimated_minutes_check;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.tasks'::regclass and conname='tasks_actual_minutes_check'
  ) then
    alter table public.tasks add constraint tasks_actual_minutes_check
      check (actual_minutes is null or actual_minutes >= 0) not valid;
    alter table public.tasks validate constraint tasks_actual_minutes_check;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.tasks'::regclass and conname='tasks_visibility_check'
  ) then
    alter table public.tasks add constraint tasks_visibility_check
      check (visibility in ('team','private')) not valid;
    alter table public.tasks validate constraint tasks_visibility_check;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.tasks'::regclass and conname='tasks_task_type_check'
  ) then
    alter table public.tasks add constraint tasks_task_type_check
      check (btrim(task_type) <> '') not valid;
    alter table public.tasks validate constraint tasks_task_type_check;
  end if;
end
$task_v2$;

-- Safely widen the existing text status check without converting it to an enum.
do $task_v2$
declare r record;
begin
  for r in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid='public.tasks'::regclass
      and c.contype='c'
      and pg_catalog.pg_get_constraintdef(c.oid) ~* 'status'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'To Do'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'In Progress'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'Done'
      and pg_catalog.pg_get_constraintdef(c.oid) !~ 'Blocked'
  loop
    execute format('alter table public.tasks drop constraint %I',r.conname);
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.tasks'::regclass and conname='tasks_status_v2_check'
  ) then
    alter table public.tasks add constraint tasks_status_v2_check
      check (status in ('To Do','In Progress','Blocked','Done')) not valid;
    alter table public.tasks validate constraint tasks_status_v2_check;
  end if;
end
$task_v2$;

create table if not exists public.task_assignees (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  assignment_role text not null default 'collaborator'
    check (assignment_role in ('primary','collaborator','reviewer')),
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique (task_id,profile_id)
);

create index if not exists task_assignees_profile_id_idx
  on public.task_assignees(profile_id,task_id);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  comment text not null check (btrim(comment) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_comments_task_id_idx
  on public.task_comments(task_id,created_at);

create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  completed boolean not null default false,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  check (
    (completed and completed_at is not null and completed_by is not null)
    or (not completed and completed_at is null and completed_by is null)
  )
);
create index if not exists task_checklist_items_task_id_idx
  on public.task_checklist_items(task_id,position,id);

create table if not exists public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  dependency_type text not null default 'blocks' check (dependency_type in ('blocks')),
  created_at timestamptz not null default now(),
  check (task_id <> depends_on_task_id),
  unique (task_id,depends_on_task_id)
);
create index if not exists task_dependencies_depends_on_idx
  on public.task_dependencies(depends_on_task_id,task_id);

alter table public.activity_logs add column if not exists task_id uuid;
do $task_v2$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.activity_logs'::regclass and conname='activity_logs_task_id_fkey'
  ) then
    alter table public.activity_logs add constraint activity_logs_task_id_fkey
      foreign key (task_id) references public.tasks(id) on delete cascade;
  end if;
end
$task_v2$;
create index if not exists activity_logs_task_id_idx
  on public.activity_logs(task_id,created_at desc);
create index if not exists tasks_parent_task_id_idx
  on public.tasks(parent_task_id,sort_order,id);
create index if not exists tasks_active_due_date_idx
  on public.tasks(due_date,id) where archived_at is null and status <> 'Done';
create index if not exists tasks_project_active_idx
  on public.tasks(project_id,status,sort_order,id) where archived_at is null;

-- The established Phase 6 helper is extended so collaborators can see tasks,
-- while private tasks remain limited to directly involved users.
-- Phase 6 intentionally revokes the migration executor's membership afterward;
-- membership is restored only for the owner-controlled replacement and is
-- revoked again before this transaction can commit.
grant phase6_app_security_owner to postgres;
grant create on schema public to phase6_app_security_owner;
grant select on public.task_assignees to phase6_app_security_owner;
alter table public.task_assignees enable row level security;
drop policy if exists task_v2_assignees_app_security_select on public.task_assignees;
create policy task_v2_assignees_app_security_select on public.task_assignees
for select to phase6_app_security_owner
using (current_user='phase6_app_security_owner');

create or replace function public.phase6_can_access_task(p_task_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select public.phase6_auth_uid() is not null and exists (
    select 1 from public.tasks t where t.id=p_task_id and (
      (
        public.phase6_app_actor_class() in ('admin','project_manager')
        and (
          coalesce(t.visibility,'team')='team'
          or t.created_by=public.phase6_auth_uid()
          or t.assigned_to=public.phase6_auth_uid()
          or exists (select 1 from public.task_assignees a
            where a.task_id=t.id and a.profile_id=public.phase6_auth_uid())
        )
      )
      or (
        public.phase6_app_actor_class()='employee'
        and (
          t.assigned_to=public.phase6_auth_uid()
          or t.created_by=public.phase6_auth_uid()
          or exists (select 1 from public.task_assignees a
            where a.task_id=t.id and a.profile_id=public.phase6_auth_uid())
          or (
            coalesce(t.visibility,'team')='team'
            and t.project_id is not null
            and public.phase6_team_can_access_project(t.project_id)
          )
        )
      )
    )
  )
$fn$;
alter function public.phase6_can_access_task(uuid) owner to phase6_app_security_owner;
revoke all on function public.phase6_can_access_task(uuid) from public,anon,authenticated;
grant execute on function public.phase6_can_access_task(uuid) to authenticated;

create or replace function public.task_v2_guard_dependency_cycle()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if new.task_id=new.depends_on_task_id then
    raise exception 'task_dependency_self_reference' using errcode='23514';
  end if;
  if exists (
    select 1 from public.task_dependencies d
    where d.task_id=new.depends_on_task_id and d.depends_on_task_id=new.task_id
      and d.id is distinct from new.id
  ) then
    raise exception 'task_dependency_direct_cycle' using errcode='23514';
  end if;
  return new;
end
$fn$;
revoke all on function public.task_v2_guard_dependency_cycle() from public,anon,authenticated;

-- A trigger is required because a CHECK constraint cannot inspect the parent row.
-- It is a narrowly scoped definer so the integrity check cannot miss a private
-- parent/child hidden from the caller by RLS. It is not exposed as an RPC.
create or replace function public.task_v2_guard_parent_project()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare v_parent_project_id uuid;
begin
  if new.parent_task_id is not null then
    select t.project_id into v_parent_project_id
    from public.tasks t where t.id=new.parent_task_id;
    if not found then
      raise exception 'task_parent_not_found' using errcode='23503';
    end if;
    if new.project_id is not null and v_parent_project_id is not null
       and new.project_id <> v_parent_project_id then
      raise exception 'task_parent_project_mismatch' using errcode='23514';
    end if;
  end if;

  if tg_op='UPDATE' and new.project_id is distinct from old.project_id
     and new.project_id is not null and exists (
       select 1 from public.tasks child
       where child.parent_task_id=new.id and child.project_id is not null
         and child.project_id <> new.project_id
     ) then
    raise exception 'task_child_project_mismatch' using errcode='23514';
  end if;
  return new;
end
$fn$;
alter function public.task_v2_guard_parent_project() owner to phase6_app_security_owner;
revoke all on function public.task_v2_guard_parent_project() from public,anon,authenticated;

create or replace function public.task_v2_set_checklist_completion()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if new.completed then
    if not old.completed or new.completed_at is null or new.completed_by is null then
      new.completed_at := clock_timestamp();
      new.completed_by := auth.uid();
    end if;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end
$fn$;
revoke all on function public.task_v2_set_checklist_completion() from public,anon,authenticated;

create or replace function public.task_v2_sync_primary_assignee()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if tg_op='UPDATE' and old.assigned_to is not distinct from new.assigned_to then
    return new;
  end if;
  delete from public.task_assignees
  where task_id=new.id and assignment_role='primary';
  if new.assigned_to is not null then
    delete from public.task_assignees
    where task_id=new.id and profile_id=new.assigned_to;
    insert into public.task_assignees(task_id,profile_id,assignment_role,assigned_by)
    values(new.id,new.assigned_to,'primary',auth.uid());
  end if;
  return new;
end
$fn$;
revoke all on function public.task_v2_sync_primary_assignee() from public,anon,authenticated;

create or replace function public.task_v2_log_activity()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
declare v_task_id uuid; v_action text; v_old text; v_new text;
begin
  if tg_table_name='tasks' then
    v_task_id := new.id;
    if tg_op='INSERT' then
      insert into public.activity_logs(task_id,project_id,action,activity_type,description,user_id)
      values(new.id,new.project_id,'task_created','task_created','task_created',auth.uid());
      return new;
    end if;
    if old.status is distinct from new.status then
      v_action := case when new.status='Done' then 'task_completed'
        when new.status='Blocked' then 'task_blocked' else 'task_status_changed' end;
      insert into public.activity_logs(task_id,project_id,action,activity_type,description,old_value,new_value,user_id)
      values(new.id,new.project_id,v_action,v_action,v_action,old.status,new.status,auth.uid());
    end if;
    if old.assigned_to is distinct from new.assigned_to then
      v_action := case when new.assigned_to is null then 'task_unassigned' else 'task_assigned' end;
      insert into public.activity_logs(task_id,project_id,action,activity_type,description,old_value,new_value,user_id)
      values(new.id,new.project_id,v_action,v_action,v_action,old.assigned_to::text,new.assigned_to::text,auth.uid());
    end if;
    if old.status is not distinct from new.status
       and old.assigned_to is not distinct from new.assigned_to then
      insert into public.activity_logs(task_id,project_id,action,activity_type,description,user_id)
      values(new.id,new.project_id,'task_updated','task_updated','task_updated',auth.uid());
    end if;
    return new;
  elsif tg_table_name='task_comments' then
    v_task_id := new.task_id; v_action := 'comment_added';
  elsif tg_table_name='task_assignees' then
    if (tg_op='INSERT' and new.assignment_role='primary')
       or (tg_op='DELETE' and old.assignment_role='primary') then
      if tg_op='DELETE' then return old; end if;
      return new;
    end if;
    v_task_id := coalesce(new.task_id,old.task_id);
    v_action := case when tg_op='DELETE' then 'task_unassigned' else 'task_assigned' end;
    v_new := case when tg_op='DELETE' then old.profile_id::text else new.profile_id::text end;
  elsif tg_table_name='task_checklist_items' then
    v_task_id := new.task_id; v_action := 'checklist_completed';
  end if;
  insert into public.activity_logs(task_id,project_id,action,activity_type,description,old_value,new_value,user_id)
  select v_task_id,t.project_id,v_action,v_action,v_action,v_old,v_new,auth.uid()
  from public.tasks t where t.id=v_task_id;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$fn$;
revoke all on function public.task_v2_log_activity() from public,anon,authenticated;

drop trigger if exists task_v2_dependency_cycle on public.task_dependencies;
create trigger task_v2_dependency_cycle before insert or update on public.task_dependencies
for each row execute function public.task_v2_guard_dependency_cycle();
drop trigger if exists task_v2_parent_project_integrity on public.tasks;
create trigger task_v2_parent_project_integrity before insert or update of parent_task_id,project_id on public.tasks
for each row execute function public.task_v2_guard_parent_project();
drop trigger if exists task_v2_checklist_completion on public.task_checklist_items;
create trigger task_v2_checklist_completion before update of completed on public.task_checklist_items
for each row execute function public.task_v2_set_checklist_completion();

-- Populate legacy assignments before installing the ongoing sync trigger.
-- assigned_to remains authoritative: demote only inconsistent legacy primary
-- rows, retain the person as a collaborator, then upsert the canonical primary.
update public.task_assignees a set assignment_role='collaborator'
from public.tasks t
where a.task_id=t.id and a.assignment_role='primary'
  and a.profile_id is distinct from t.assigned_to;
insert into public.task_assignees(task_id,profile_id,assignment_role,assigned_by,assigned_at)
select t.id,t.assigned_to,'primary',coalesce(t.created_by,t.assigned_to),t.created_at
from public.tasks t
where t.assigned_to is not null
on conflict (task_id,profile_id) do update set assignment_role='primary';
create unique index if not exists task_assignees_one_primary_idx
  on public.task_assignees(task_id) where assignment_role='primary';

drop trigger if exists task_v2_sync_primary_assignee on public.tasks;
create trigger task_v2_sync_primary_assignee after insert or update of assigned_to on public.tasks
for each row execute function public.task_v2_sync_primary_assignee();
drop trigger if exists task_v2_log_task_activity on public.tasks;
create trigger task_v2_log_task_activity after insert or update on public.tasks
for each row execute function public.task_v2_log_activity();
drop trigger if exists task_v2_log_comment_activity on public.task_comments;
create trigger task_v2_log_comment_activity after insert on public.task_comments
for each row execute function public.task_v2_log_activity();
drop trigger if exists task_v2_log_assignee_activity on public.task_assignees;
create trigger task_v2_log_assignee_activity after insert or delete on public.task_assignees
for each row execute function public.task_v2_log_activity();
drop trigger if exists task_v2_log_checklist_activity on public.task_checklist_items;
create trigger task_v2_log_checklist_activity after update of completed on public.task_checklist_items
for each row when (new.completed and not old.completed)
execute function public.task_v2_log_activity();

-- New public tables are explicitly exposed to authenticated users and protected
-- by row-level authorization. Clients fail every policy through the task helper.
revoke all on public.task_assignees,public.task_comments,public.task_checklist_items,
  public.task_dependencies from public,anon,authenticated;
grant select,insert,delete on public.task_assignees to authenticated;
grant select,insert,delete on public.task_comments to authenticated;
grant update (comment,updated_at) on public.task_comments to authenticated;
grant select,insert,delete on public.task_checklist_items to authenticated;
grant update (title,completed,position) on public.task_checklist_items to authenticated;
grant select,insert,delete on public.task_dependencies to authenticated;
grant update (title,description,project_id,assigned_to,status,priority,start_date,due_date,
  parent_task_id,estimated_minutes,actual_minutes,blocked_reason,sort_order,task_type,
  visibility,archived_at,completed_at,updated_at) on public.tasks to authenticated;

alter table public.task_comments enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_dependencies enable row level security;

drop policy if exists task_v2_assignees_select on public.task_assignees;
create policy task_v2_assignees_select on public.task_assignees for select to authenticated
using (public.phase6_can_access_task(task_id));
drop policy if exists task_v2_assignees_insert on public.task_assignees;
create policy task_v2_assignees_insert on public.task_assignees for insert to authenticated
with check (
  public.phase6_can_access_task(task_id)
  and public.phase6_collaboration_target_is_team(profile_id)
  and (
    public.phase6_app_actor_class() in ('admin','project_manager')
    or exists (select 1 from public.tasks t where t.id=task_id
      and (t.created_by=auth.uid() or t.assigned_to=auth.uid()))
  )
  and (assignment_role <> 'primary' or exists (
    select 1 from public.tasks t where t.id=task_id and t.assigned_to=profile_id
  ))
);
drop policy if exists task_v2_assignees_delete on public.task_assignees;
create policy task_v2_assignees_delete on public.task_assignees for delete to authenticated
using (
  public.phase6_can_access_task(task_id)
  and not (assignment_role='primary' and exists (
    select 1 from public.tasks t where t.id=task_id and t.assigned_to=profile_id
  ))
  and (
    public.phase6_app_actor_class() in ('admin','project_manager')
    or exists (select 1 from public.tasks t where t.id=task_id
      and (t.created_by=auth.uid() or t.assigned_to=auth.uid()))
  )
);

drop policy if exists task_v2_comments_select on public.task_comments;
create policy task_v2_comments_select on public.task_comments for select to authenticated
using (public.phase6_can_access_task(task_id));
drop policy if exists task_v2_comments_insert on public.task_comments;
create policy task_v2_comments_insert on public.task_comments for insert to authenticated
with check (user_id=auth.uid() and public.phase6_can_access_task(task_id));
drop policy if exists task_v2_comments_update on public.task_comments;
create policy task_v2_comments_update on public.task_comments for update to authenticated
using (public.phase6_can_access_task(task_id) and (
  user_id=auth.uid() or public.phase6_app_actor_class() in ('admin','project_manager')
)) with check (public.phase6_can_access_task(task_id) and (
  user_id=auth.uid() or public.phase6_app_actor_class() in ('admin','project_manager')
));
drop policy if exists task_v2_comments_delete on public.task_comments;
create policy task_v2_comments_delete on public.task_comments for delete to authenticated
using (public.phase6_can_access_task(task_id) and (
  user_id=auth.uid() or public.phase6_app_actor_class() in ('admin','project_manager')
));

drop policy if exists task_v2_checklist_select on public.task_checklist_items;
create policy task_v2_checklist_select on public.task_checklist_items for select to authenticated
using (public.phase6_can_access_task(task_id));
drop policy if exists task_v2_checklist_insert on public.task_checklist_items;
create policy task_v2_checklist_insert on public.task_checklist_items for insert to authenticated
with check (public.phase6_can_access_task(task_id));
drop policy if exists task_v2_checklist_update on public.task_checklist_items;
create policy task_v2_checklist_update on public.task_checklist_items for update to authenticated
using (public.phase6_can_access_task(task_id))
with check (public.phase6_can_access_task(task_id));
drop policy if exists task_v2_checklist_delete on public.task_checklist_items;
create policy task_v2_checklist_delete on public.task_checklist_items for delete to authenticated
using (public.phase6_can_access_task(task_id));

drop policy if exists task_v2_dependencies_select on public.task_dependencies;
create policy task_v2_dependencies_select on public.task_dependencies for select to authenticated
using (public.phase6_can_access_task(task_id) and public.phase6_can_access_task(depends_on_task_id));
drop policy if exists task_v2_dependencies_insert on public.task_dependencies;
create policy task_v2_dependencies_insert on public.task_dependencies for insert to authenticated
with check (
  public.phase6_can_access_task(task_id)
  and public.phase6_can_access_task(depends_on_task_id)
  and task_id <> depends_on_task_id
);
drop policy if exists task_v2_dependencies_delete on public.task_dependencies;
create policy task_v2_dependencies_delete on public.task_dependencies for delete to authenticated
using (public.phase6_can_access_task(task_id) and public.phase6_can_access_task(depends_on_task_id));

-- Parent tasks must be visible to the caller. Existing rows remain valid because
-- parent_task_id is null after the additive column creation.
drop policy if exists phase6_tasks_team_insert on public.tasks;
create policy phase6_tasks_team_insert on public.tasks for insert to authenticated
with check (
  created_by=auth.uid()
  and public.phase6_app_actor_class() in ('admin','project_manager','employee')
  and (project_id is null or public.phase6_team_can_access_project(project_id))
  and (assigned_to is null or public.phase6_collaboration_target_is_team(assigned_to))
  and (public.phase6_app_actor_class() in ('admin','project_manager') or assigned_to=auth.uid())
  and (parent_task_id is null or public.phase6_can_access_task(parent_task_id))
);
drop policy if exists phase6_tasks_team_update on public.tasks;
create policy phase6_tasks_team_update on public.tasks for update to authenticated
using (public.phase6_can_access_task(id))
with check (
  public.phase6_can_access_task(id)
  and (project_id is null or public.phase6_team_can_access_project(project_id))
  and (assigned_to is null or public.phase6_collaboration_target_is_team(assigned_to))
  and (parent_task_id is null or public.phase6_can_access_task(parent_task_id))
);

-- Activity logs remain the single audit stream; task_id scopes task-only events.
drop policy if exists phase6_activity_logs_team_select on public.activity_logs;
create policy phase6_activity_logs_team_select on public.activity_logs for select to authenticated
using (
  (task_id is not null and public.phase6_can_access_task(task_id))
  or (task_id is null and project_id is not null and public.phase6_team_can_access_project(project_id))
  or (task_id is null and project_id is null and public.phase6_app_actor_class() in ('admin','project_manager'))
);
drop policy if exists phase6_activity_logs_team_insert on public.activity_logs;
create policy phase6_activity_logs_team_insert on public.activity_logs for insert to authenticated
with check (user_id=auth.uid() and (
  (task_id is not null and public.phase6_can_access_task(task_id))
  or (task_id is null and project_id is not null and public.phase6_team_can_access_project(project_id))
  or (task_id is null and project_id is null and public.phase6_app_actor_class() in ('admin','project_manager'))
));

-- Keep comment timestamps reliable without introducing privileged code.
drop trigger if exists touch_task_comments_updated_at on public.task_comments;
create trigger touch_task_comments_updated_at before update on public.task_comments
for each row execute function public.touch_updated_at();

revoke create on schema public from phase6_app_security_owner;
revoke phase6_app_security_owner from postgres;
notify pgrst, 'reload schema';
commit;
