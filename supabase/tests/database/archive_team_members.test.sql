-- Run on a disposable migrated database with the Phase 6 synthetic fixtures.
-- The whole test rolls back, including status changes.
begin;

create function pg_temp.assert_true(ok boolean, label text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Assertion failed: %', label; end if;
end $$;

do $$
declare
  v_admin uuid;
  v_employee uuid;
  v_project_count bigint;
  v_task_count bigint;
  v_denied boolean;
  v_visible bigint;
begin
  perform pg_temp.assert_true(has_function_privilege('authenticated', 'public.set_team_member_active(uuid,boolean)', 'execute'), 'authenticated can call archive RPC');
  perform pg_temp.assert_true(not has_function_privilege('anon', 'public.set_team_member_active(uuid,boolean)', 'execute'), 'anonymous cannot call archive RPC');
  perform pg_temp.assert_true(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'), 'direct profile deletion is denied');
  perform pg_temp.assert_true(not has_table_privilege('authenticated', 'public.team_members', 'DELETE'), 'direct provisioning deletion is denied');
  perform pg_temp.assert_true(exists (
    select 1 from pg_catalog.pg_policy where polrelid = 'public.projects'::regclass and polname = 'archived_member_denied' and not polpermissive
  ), 'projects have restrictive archived-member policy');
  perform pg_temp.assert_true(exists (
    select 1 from pg_catalog.pg_policy where polrelid = 'storage.objects'::regclass and polname = 'archived_member_storage_denied' and not polpermissive
  ), 'storage has restrictive archived-member policy');

  if current_setting('phase6.local_disposable', true) is distinct from 'on'
    or nullif(current_setting('phase6.test_admin', true), '') is null
    or nullif(current_setting('phase6.test_employee', true), '') is null then
    raise notice 'SKIP runtime scenarios: disposable synthetic Auth fixtures are required.';
    return;
  end if;
  v_admin := current_setting('phase6.test_admin')::uuid;
  v_employee := current_setting('phase6.test_employee')::uuid;
  perform pg_temp.assert_true(exists(select 1 from public.profiles where id = v_admin and role::text = 'admin' and status = 'active'), 'active admin fixture');
  perform pg_temp.assert_true(exists(select 1 from public.profiles where id = v_employee and role::text in ('employee','junior_assistant') and status = 'active'), 'active employee fixture');
  select count(*) into v_project_count from public.projects where assigned_to = v_employee;
  select count(*) into v_task_count from public.tasks where assigned_to = v_employee;

  perform set_config('request.jwt.claim.sub', v_employee::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_employee)::text, true);
  v_denied := false;
  begin
    perform public.set_team_member_active(v_admin, false);
  exception when sqlstate '42501' then v_denied := true;
  end;
  perform pg_temp.assert_true(v_denied, 'employee cannot archive admin');

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin)::text, true);
  v_denied := false;
  begin
    perform public.set_team_member_active(v_admin, false);
  exception when sqlstate '42501' then v_denied := true;
  end;
  perform pg_temp.assert_true(v_denied, 'admin cannot archive self');

  perform public.set_team_member_active(v_employee, false);
  perform pg_temp.assert_true((select status = 'inactive' from public.profiles where id = v_employee), 'profile archived');
  perform pg_temp.assert_true(not exists(select 1 from public.team_members where lower(email) = lower((select email from public.profiles where id = v_employee)) and status <> 'inactive'), 'provisioning record archived');
  perform pg_temp.assert_true((select count(*) from public.projects where assigned_to = v_employee) = v_project_count, 'project assignments retained');
  perform pg_temp.assert_true((select count(*) from public.tasks where assigned_to = v_employee) = v_task_count, 'task assignments retained');

  perform set_config('request.jwt.claim.sub', v_employee::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_employee)::text, true);
  v_denied := false;
  begin
    perform public.enforce_active_app_profile();
  exception when sqlstate '42501' then v_denied := true;
  end;
  perform pg_temp.assert_true(v_denied, 'retained JWT denied by Data API guard');
  execute 'set local role authenticated';
  select count(*) into v_visible from public.projects;
  execute 'reset role';
  perform pg_temp.assert_true(v_visible = 0, 'archived account cannot read projects through RLS');

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin)::text, true);
  perform public.set_team_member_active(v_employee, true);
  perform pg_temp.assert_true((select status = 'active' from public.profiles where id = v_employee), 'profile restored');
  perform pg_temp.assert_true(not exists(select 1 from public.team_members where lower(email) = lower((select email from public.profiles where id = v_employee)) and status <> 'active'), 'provisioning record restored');
  raise notice 'PASS: archive, access revocation, preserved assignments, and restore.';
end $$;

rollback;
