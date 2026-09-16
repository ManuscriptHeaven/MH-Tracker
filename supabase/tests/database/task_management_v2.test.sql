-- ============================================================================
-- Task Management V2 PostgreSQL integration/RLS checks for verified staging.
-- Apply the authoritative Phase 6 chain through 00620 first.
--
-- SAFETY REQUIREMENT:
-- This test creates synthetic auth and team fixtures inside a rollback transaction.
-- It contains an executable fail-closed safety gate requiring BOTH:
--   1. Database-backed staging sentinel (public.phase6_test_environment_guard)
--   2. Explicit caller intent session GUC (task_v2.test_target = 'staging')
--
-- ONE-TIME STAGING SENTINEL SETUP:
--   psql -d <staging_db> -v ON_ERROR_STOP=1 -f supabase/tests/database/staging_environment_sentinel_setup.sql
--
-- EXECUTION ON STAGING:
--   psql -d <staging_db> -v ON_ERROR_STOP=1 -c "SET task_v2.test_target = 'staging';" -f supabase/tests/database/task_management_v2.test.sql
-- ============================================================================
begin;

create function pg_temp.task_v2_assert(p_ok boolean,p_label text) returns void
language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'Assertion failed: %',p_label; end if;
end $$;

do $$
#variable_conflict use_variable
declare
  admin_id uuid:=gen_random_uuid();
  pm_id uuid:=gen_random_uuid();
  employee_id uuid:=gen_random_uuid();
  collaborator_id uuid:=gen_random_uuid();
  outsider_id uuid:=gen_random_uuid();
  client_id uuid:=gen_random_uuid();
  project_one uuid;
  project_two uuid;
  task_id uuid:=gen_random_uuid();
  private_task_id uuid:=gen_random_uuid();
  dependency_id uuid:=gen_random_uuid();
  parent_id uuid:=gen_random_uuid();
  child_id uuid:=gen_random_uuid();
  comment_id uuid;
  checklist_id uuid;
  visible_rows integer;
  affected_rows integer;
  denied boolean;
  returned_task public.tasks%rowtype;
begin
  -- ============================================================================
  -- EXECUTABLE STAGING/TEST SAFETY GATE (FAIL-CLOSED)
  -- Requires BOTH:
  --   A. Database-backed non-production sentinel: public.phase6_test_environment_guard
  --      (Absent from production; cannot be bypassed by session settings alone)
  --   B. Explicit caller intent GUC: task_v2.test_target = 'staging'/'test'
  --      or phase6.local_disposable = 'on'
  -- ============================================================================

  -- 1. Explicit production indicators abort immediately
  if current_setting('app.environment', true) = 'production'
     or current_database() ilike '%prod%' then
    raise exception 'SAFETY ABORT: Execution against production database is forbidden.';
  end if;

  -- 2. REQUIREMENT A: Database-backed sentinel check.
  -- The sentinel table must exist in the database catalog.
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'phase6_test_environment_guard'
  ) then
    raise exception 'SAFETY ABORT: Database-backed staging sentinel public.phase6_test_environment_guard is missing. Refusing to run tests against an unverified target database.';
  end if;

  -- The sentinel table must confirm an approved non-production environment.
  if not exists (
    select 1
    from public.phase6_test_environment_guard
    where environment in ('staging', 'test')
  ) then
    raise exception 'SAFETY ABORT: public.phase6_test_environment_guard does not confirm a staging or test environment. Refusing execution.';
  end if;

  -- 3. REQUIREMENT B: Explicit caller intent GUC. Session GUC alone is never enough, but required as confirmation.
  if current_setting('phase6.local_disposable', true) is distinct from 'on'
     and current_setting('task_v2.test_target', true) is distinct from 'staging'
     and current_setting('task_v2.test_target', true) is distinct from 'test' then
    raise exception 'SAFETY ABORT: task_management_v2.test.sql requires explicit caller intent setting in addition to database sentinel. Run with SET task_v2.test_target = ''staging''; or SET phase6.local_disposable = ''on'';';
  end if;

  select id into project_one from public.projects order by id limit 1;
  select id into project_two from public.projects where id<>project_one order by id limit 1;
  perform pg_temp.task_v2_assert(project_one is not null and project_two is not null,
    'staging supplies two projects for project-integrity checks');

  -- Team-member provisioning is the Phase 6-supported path to synthetic profiles.
  insert into public.team_members(full_name,email,role,status) values
    ('Task V2 Admin',admin_id||'@task-v2.invalid','admin','active'),
    ('Task V2 PM',pm_id||'@task-v2.invalid','project_manager','active'),
    ('Task V2 Employee',employee_id||'@task-v2.invalid','employee','active'),
    ('Task V2 Collaborator',collaborator_id||'@task-v2.invalid','employee','active'),
    ('Task V2 Outsider',outsider_id||'@task-v2.invalid','employee','active'),
    ('Task V2 Client',client_id||'@task-v2.invalid','client','active');
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values
    (admin_id,'authenticated','authenticated',admin_id||'@task-v2.invalid','{}','{"full_name":"Task V2 Admin"}',now(),now()),
    (pm_id,'authenticated','authenticated',pm_id||'@task-v2.invalid','{}','{"full_name":"Task V2 PM"}',now(),now()),
    (employee_id,'authenticated','authenticated',employee_id||'@task-v2.invalid','{}','{"full_name":"Task V2 Employee"}',now(),now()),
    (collaborator_id,'authenticated','authenticated',collaborator_id||'@task-v2.invalid','{}','{"full_name":"Task V2 Collaborator"}',now(),now()),
    (outsider_id,'authenticated','authenticated',outsider_id||'@task-v2.invalid','{}','{"full_name":"Task V2 Outsider"}',now(),now()),
    (client_id,'authenticated','authenticated',client_id||'@task-v2.invalid','{}','{"full_name":"Task V2 Client"}',now(),now());
  perform pg_temp.task_v2_assert((select count(*)=6 from public.profiles
    where id in (admin_id,pm_id,employee_id,collaborator_id,outsider_id,client_id)),
    'synthetic role fixtures are provisioned');

  -- Admin creates team/private tasks; assigned_to is mirrored as one primary row.
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  insert into public.tasks(id,title,description,project_id,assigned_to,created_by,status,priority,visibility)
  values(task_id,'Task V2 team task','fixture',project_one,employee_id,admin_id,'To Do','Normal','team');
  insert into public.tasks(id,title,description,project_id,assigned_to,created_by,status,priority,visibility)
  values(private_task_id,'Task V2 private task','fixture',project_one,employee_id,admin_id,'To Do','Normal','private');

  -- Admin creates task assigned to PM with RETURNING * (exercises 00620 insert returning RLS fix)
  insert into public.tasks(title,description,project_id,assigned_to,created_by,status,priority,visibility)
  values('Admin task for PM with RETURNING','fixture',project_one,pm_id,admin_id,'To Do','Normal','team')
  returning * into returned_task;
  execute 'reset role';
  perform pg_temp.task_v2_assert(returned_task.id is not null and returned_task.assigned_to = pm_id,
    'Admin can insert task assigned to PM with RETURNING under RLS (00620 fix)');
  perform pg_temp.task_v2_assert((select count(*)=1 from public.task_assignees
    where task_assignees.task_id=task_id and profile_id=employee_id and assignment_role='primary'),
    'create with assigned_to mirrors exactly one primary');

  -- Primary changes and clears stay unambiguous; direct primary manipulation cannot diverge.
  execute 'set local role authenticated';
  update public.tasks set assigned_to=pm_id where id=task_id;
  execute 'reset role';
  perform pg_temp.task_v2_assert((select count(*)=1 from public.task_assignees
    where task_assignees.task_id=task_id and profile_id=pm_id and assignment_role='primary')
    and (select count(*)=1 from public.task_assignees
      where task_assignees.task_id=task_id and assignment_role='primary'),
    'changing primary A to B leaves exactly one primary');
  perform pg_temp.task_v2_assert((select count(*)=1 from public.activity_logs
    where activity_logs.task_id=task_id and action='task_assigned' and new_value=pm_id::text),
    'primary synchronization emits one assignment event');

  execute 'set local role authenticated';
  update public.tasks set assigned_to=null where id=task_id;
  execute 'reset role';
  perform pg_temp.task_v2_assert((select count(*)=0 from public.task_assignees
    where task_assignees.task_id=task_id and assignment_role='primary'),
    'clearing assigned_to removes the primary');
  denied:=false;
  execute 'set local role authenticated';
  begin
    insert into public.task_assignees(task_id,profile_id,assignment_role,assigned_by)
    values(task_id,pm_id,'primary',admin_id);
  exception when insufficient_privilege or check_violation or unique_violation then denied:=true; end;
  execute 'reset role';
  perform pg_temp.task_v2_assert(denied,'a direct primary insert cannot diverge from assigned_to');
  execute 'set local role authenticated';
  update public.tasks set assigned_to=employee_id where id=task_id;
  delete from public.task_assignees where task_assignees.task_id=task_id
    and profile_id=employee_id and assignment_role='primary';
  get diagnostics affected_rows=row_count;
  execute 'reset role';
  perform pg_temp.task_v2_assert(affected_rows=0 and exists(select 1 from public.task_assignees
    where task_assignees.task_id=task_id and profile_id=employee_id and assignment_role='primary'),
    'canonical primary cannot be removed directly');

  -- PM can manage an accessible team task, and duplicates are rejected.
  perform set_config('request.jwt.claim.sub',pm_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pm_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into visible_rows from public.tasks where id=task_id;
  insert into public.task_assignees(task_id,profile_id,assignment_role,assigned_by)
    values(task_id,collaborator_id,'collaborator',pm_id);
  denied:=false;
  begin
    insert into public.task_assignees(task_id,profile_id,assignment_role,assigned_by)
      values(task_id,collaborator_id,'collaborator',pm_id);
  exception when unique_violation then denied:=true; end;
  execute 'reset role';
  perform pg_temp.task_v2_assert(visible_rows=1,'project manager reads an authorized team task');
  perform pg_temp.task_v2_assert(denied,'duplicate assignee is rejected');

  -- A collaborator gains explicit private access only after an authorized assignment.
  perform set_config('request.jwt.claim.sub',collaborator_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',collaborator_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into visible_rows from public.tasks where id=private_task_id;
  execute 'reset role';
  perform pg_temp.task_v2_assert(visible_rows=0,'unassigned collaborator cannot read a private task');
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  insert into public.task_assignees(task_id,profile_id,assignment_role,assigned_by)
    values(private_task_id,collaborator_id,'collaborator',admin_id);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',collaborator_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',collaborator_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into visible_rows from public.tasks where id=private_task_id;
  insert into public.task_comments(task_id,user_id,comment)
    values(private_task_id,collaborator_id,'private fixture secret') returning id into comment_id;
  insert into public.task_checklist_items(task_id,title)
    values(private_task_id,'Verify private output') returning id into checklist_id;
  update public.task_checklist_items set completed=true where id=checklist_id;
  execute 'reset role';
  perform pg_temp.task_v2_assert(visible_rows=1,'authorized collaborator reads private task');
  perform pg_temp.task_v2_assert((select completed and completed_by=collaborator_id and completed_at is not null
    from public.task_checklist_items where id=checklist_id),'collaborator can complete checklist with ownership metadata');
  perform pg_temp.task_v2_assert(not exists(select 1 from public.activity_logs
    where activity_logs.task_id=private_task_id and new_value like '%private fixture secret%'),
    'private comment body is not copied into activity logs');

  -- An uninvolved employee cannot see the private task or self-assign into it.
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into visible_rows from public.tasks where id=private_task_id;
  denied:=false;
  begin
    insert into public.task_assignees(task_id,profile_id,assignment_role,assigned_by)
      values(private_task_id,outsider_id,'collaborator',outsider_id);
  exception when insufficient_privilege or check_violation then denied:=true; end;
  update public.task_comments set comment='hijacked' where id=comment_id;
  get diagnostics affected_rows=row_count;
  execute 'reset role';
  perform pg_temp.task_v2_assert(visible_rows=0 and denied,
    'non-collaborating employee cannot read or self-assign to private task');
  perform pg_temp.task_v2_assert(affected_rows=0,'employee cannot edit another user private comment');

  -- Employee self-assignment with RETURNING * vs disallowed other-assignment
  perform set_config('request.jwt.claim.sub',employee_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',employee_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  insert into public.tasks(title,description,project_id,assigned_to,created_by,status,priority,visibility)
  values('Employee self task with RETURNING','fixture',project_one,employee_id,employee_id,'To Do','Normal','team')
  returning * into returned_task;
  denied:=false;
  begin
    insert into public.tasks(title,description,project_id,assigned_to,created_by,status,priority,visibility)
    values('Employee invalid task for PM','fixture',project_one,pm_id,employee_id,'To Do','Normal','team')
    returning * into returned_task;
  exception when insufficient_privilege or check_violation then denied:=true; end;
  execute 'reset role';
  perform pg_temp.task_v2_assert(returned_task.id is not null and returned_task.assigned_to = employee_id,
    'Employee can insert self-assigned task with RETURNING');
  perform pg_temp.task_v2_assert(denied,
    'Employee is denied inserting task assigned to PM');

  -- Clients have no internal task-table access.
  perform set_config('request.jwt.claim.sub',client_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',client_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into visible_rows from public.tasks where id in (task_id,private_task_id);
  denied:=false;
  begin
    insert into public.task_comments(task_id,user_id,comment) values(task_id,client_id,'not allowed');
  exception when insufficient_privilege or check_violation then denied:=true; end;
  execute 'reset role';
  perform pg_temp.task_v2_assert(visible_rows=0 and denied,'client cannot read or mutate internal task tables');

  -- Dependency constraints, RLS, parent project integrity, archive, and delete behavior.
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  insert into public.tasks(id,title,project_id,assigned_to,created_by,status,priority,visibility)
    values(dependency_id,'Dependency',project_one,employee_id,admin_id,'To Do','Normal','team');
  insert into public.task_dependencies(task_id,depends_on_task_id) values(private_task_id,dependency_id);
  denied:=false;
  begin insert into public.task_dependencies(task_id,depends_on_task_id) values(private_task_id,dependency_id);
  exception when unique_violation then denied:=true; end;
  perform pg_temp.task_v2_assert(denied,'duplicate dependency is rejected');
  denied:=false;
  begin insert into public.task_dependencies(task_id,depends_on_task_id) values(dependency_id,private_task_id);
  exception when check_violation then denied:=true; end;
  perform pg_temp.task_v2_assert(denied,'direct reverse dependency is rejected');
  denied:=false;
  begin insert into public.task_dependencies(task_id,depends_on_task_id) values(task_id,task_id);
  exception when check_violation then denied:=true; end;
  perform pg_temp.task_v2_assert(denied,'self dependency is rejected');
  insert into public.tasks(id,title,project_id,assigned_to,created_by,status,priority,visibility)
    values(parent_id,'Parent',project_one,employee_id,admin_id,'To Do','Normal','team');
  insert into public.tasks(id,title,project_id,assigned_to,created_by,status,priority,visibility,parent_task_id)
    values(child_id,'Child',project_one,employee_id,admin_id,'To Do','Normal','team',parent_id);
  denied:=false;
  begin
    update public.tasks set project_id=project_two where id=child_id;
  exception when check_violation then denied:=true; end;
  perform pg_temp.task_v2_assert(denied,'parent and child cannot have different non-null projects');
  update public.tasks set archived_at=clock_timestamp() where id=private_task_id;
  execute 'reset role';
  perform pg_temp.task_v2_assert(exists(select 1 from public.tasks where id=private_task_id and archived_at is not null)
    and exists(select 1 from public.task_assignees where task_assignees.task_id=private_task_id),
    'archive preserves the task and its assignments');

  -- Status changes create one specific event, not redundant task_updated variants.
  execute 'set local role authenticated';
  update public.tasks set status='Blocked',blocked_reason='Waiting for input' where id=task_id;
  execute 'reset role';
  perform pg_temp.task_v2_assert((select count(*)=1 from public.activity_logs
    where activity_logs.task_id=task_id and action='task_blocked')
    and (select count(*)=0 from public.activity_logs
      where activity_logs.task_id=task_id and action='task_status_changed'),
    'one Blocked transition creates one meaningful status event');

  -- PostgreSQL FK actions are exercised under the transaction owner.
  delete from public.tasks where id=dependency_id;
  perform pg_temp.task_v2_assert(not exists(select 1 from public.task_dependencies
    where depends_on_task_id=dependency_id),'deleting a dependency task cascades relation rows safely');
  delete from public.tasks where id=parent_id;
  perform pg_temp.task_v2_assert((select parent_task_id is null from public.tasks where id=child_id),
    'deleting a parent keeps the child and clears parent_task_id');

  raise notice 'PASS: Task V2 admin, PM, employee, collaborator, outsider, client, ownership, integrity, archive, and audit cases.';
end $$;

rollback;
