-- Phase 6 Step 3D.2A core security tests for an unlinked disposable database.
-- Apply migrations 00100-00450 first. No real Auth users or emails are created.
begin;

create function pg_temp.p6_core_assert(p_ok boolean,p_label text) returns void
language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'Assertion failed: %',p_label; end if;
end $$;

do $$
declare
  owner_oid oid;
  d text;
  n text;
  f record;
  scope_tables text[] := array[
    'profiles','notifications','conversations','conversation_members','messages',
    'message_attachments','message_mentions','message_reactions','tasks',
    'revision_notes','project_notes','activity_logs','team_members'
  ];
  definer_names text[] := array[
    'phase6_app_actor_class','phase6_team_can_access_project',
    'phase6_client_can_access_project','phase6_collaboration_target_is_team',
    'phase6_can_access_task','phase6_can_access_conversation',
    'phase6_can_access_message','phase6_can_attach_to_message',
    'phase6_parent_message_matches','phase6_conversation_target_eligible',
    'get_collaboration_directory','phase6_create_direct_conversation',
    'create_profile_for_new_auth_user','phase6_notify_message_mention'
  ];
begin
  select oid into owner_oid from pg_catalog.pg_roles where rolname='phase6_app_security_owner';
  perform pg_temp.p6_core_assert(owner_oid is not null,'separate app-security owner exists');
  perform pg_temp.p6_core_assert((select not rolcanlogin and not rolsuper and not rolinherit
    and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls
    from pg_catalog.pg_roles where oid=owner_oid),'app-security owner is NOLOGIN/NOINHERIT/nonprivileged/no BYPASSRLS');
  perform pg_temp.p6_core_assert(not exists(
    select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid=m.member
    where m.roleid=owner_oid and r.rolname in ('anon','authenticated')),
    'application roles are not app-security owner members');

  foreach n in array definer_names loop
    select p.* into strict f from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname=n;
    perform pg_temp.p6_core_assert(f.proowner=owner_oid,n || ' owned by app-security owner');
    perform pg_temp.p6_core_assert(f.prosecdef,n || ' is SECURITY DEFINER');
    perform pg_temp.p6_core_assert('search_path=pg_catalog, pg_temp'=any(f.proconfig),n || ' fixed search_path');
    perform pg_temp.p6_core_assert(not has_function_privilege('anon',f.oid,'EXECUTE'),n || ' anon denied');
    perform pg_temp.p6_core_assert(not exists(select 1 from pg_catalog.aclexplode(f.proacl) a
      where a.grantee=0 and a.privilege_type='EXECUTE'),n || ' PUBLIC denied');
    select pg_get_functiondef(f.oid) into d;
    perform pg_temp.p6_core_assert(d !~* 'auth\.jwt\s*\(',n || ' has no JWT role authorization');
    perform pg_temp.p6_core_assert(f.prosrc !~* 'auth\.uid\s*\(',
      n || ' SECURITY DEFINER body uses private identity bridge');
  end loop;

  perform pg_temp.p6_core_assert((select count(*)=14 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname=any(definer_names) and p.proowner=owner_oid and p.prosecdef),
    'exact app-security definer inventory');

  select pg_get_functiondef(p.oid) into d from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname='get_collaboration_directory';
  perform pg_temp.p6_core_assert(d ~* 'returns table\(id uuid, full_name text, role (public\.)?app_role, avatar_url text\)'
    and d !~* 'p\.\*' and d !~* '\bemail\b|\bphone\b|created_at',
    'directory has fixed safe fields');
  perform pg_temp.p6_core_assert(d ~* 'p\.status\s*=\s*''active'''
    and d !~* '''client''\s*\)', 'directory is active internal team only');

  select pg_get_functiondef(p.oid) into d from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname='phase6_guard_profile_update';
  perform pg_temp.p6_core_assert(d ~* 'phase6_app_actor_class\(\)\s*=\s*''admin'''
    and d ~* 'new\.role\s+is\s+distinct\s+from\s+old\.role'
    and d ~* 'new\.status\s+is\s+distinct\s+from\s+old\.status'
    and d ~* 'new\.email\s+is\s+distinct\s+from\s+old\.email',
    'profile trigger prevents self privilege/identity changes');

  select pg_get_functiondef(p.oid) into d from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname='create_profile_for_new_auth_user';
  perform pg_temp.p6_core_assert(d !~* 'raw_user_meta_data\s*->>\s*''role'''
    and d ~* 'v_role\s*:=\s*''client''',
    'signup does not trust caller-supplied role metadata');

  foreach n in array scope_tables loop
    perform pg_temp.p6_core_assert((select c.relrowsecurity from pg_catalog.pg_class c
      join pg_catalog.pg_namespace s on s.oid=c.relnamespace
      where s.nspname='public' and c.relname=n),n || ' RLS enabled');
    perform pg_temp.p6_core_assert(not exists(
      select 1 from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid=p.polrelid
      join pg_catalog.pg_namespace s on s.oid=c.relnamespace
      where s.nspname='public' and c.relname=n and (
        coalesce(pg_get_expr(p.polqual,p.polrelid),'') ~* '^\(?true\)?$'
        or coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') ~* '^\(?true\)?$'
        or coalesce(pg_get_expr(p.polqual,p.polrelid),'') ~* 'auth\.jwt\s*\('
        or coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') ~* 'auth\.jwt\s*\(')),
      n || ' has no unconditional/JWT policy');
  end loop;
end
$$;

-- Trigger entry points are invoked by PostgreSQL and are not application RPCs.
select pg_temp.p6_core_assert(
  not has_function_privilege('authenticated','public.phase6_guard_profile_update()','EXECUTE'),
  'authenticated cannot execute profile guard directly');
select pg_temp.p6_core_assert(
  not has_function_privilege('authenticated','public.phase6_guard_task_update()','EXECUTE'),
  'authenticated cannot execute task guard directly');
select pg_temp.p6_core_assert(
  not has_function_privilege('authenticated','public.create_profile_for_new_auth_user()','EXECUTE'),
  'authenticated cannot execute signup trigger directly');
select pg_temp.p6_core_assert(
  not has_function_privilege('authenticated','public.phase6_notify_message_mention()','EXECUTE'),
  'authenticated cannot execute mention trigger directly');

do $$
declare f record; d text; trigger_d text;
begin
  select p.* into strict f from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='phase6_sync_profile_from_team_member'
      and p.pronargs=0;
  perform pg_temp.p6_core_assert(f.prorettype='trigger'::regtype,
    'team-member profile reconciliation is a trigger function');
  perform pg_temp.p6_core_assert(not f.prosecdef,
    'team-member profile reconciliation is SECURITY INVOKER');
  perform pg_temp.p6_core_assert('search_path=pg_catalog, pg_temp'=any(f.proconfig),
    'team-member profile reconciliation has fixed search_path');
  perform pg_temp.p6_core_assert(not has_function_privilege('authenticated',f.oid,'EXECUTE')
    and not has_function_privilege('anon',f.oid,'EXECUTE')
    and not exists(select 1 from pg_catalog.aclexplode(f.proacl) a
      where a.grantee=0 and a.privilege_type='EXECUTE'),
    'team-member profile reconciliation direct EXECUTE is denied');
  d:=lower(f.prosrc);
  perform pg_temp.p6_core_assert(d ~ 'update public\.profiles p[\s\S]*set full_name\s*=\s*new\.full_name,\s*role\s*=\s*new\.role,\s*phone\s*=\s*new\.phone,\s*status\s*=\s*new\.status'
    and d ~ 'lower\(p\.email\)\s*=\s*pg_catalog\.lower\(new\.email\)'
    and d !~ '\bid\s*=\s*new\.' and d !~ '\bemail\s*=\s*new\.'
    and d !~ '\bcreated_at\s*=\s*new\.',
    'team-member reconciliation updates only profile name/role/phone/status by case-insensitive email');
  select lower(pg_get_triggerdef(t.oid)) into strict trigger_d
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='team_members'
    and t.tgname='phase6_sync_profile_from_team_member' and not t.tgisinternal
    and t.tgfoid='public.phase6_sync_profile_from_team_member()'::regprocedure;
  perform pg_temp.p6_core_assert(trigger_d ~ 'after insert or update of full_name, email, role, phone, status on public\.team_members'
    and trigger_d ~ 'for each row execute function (public\.)?phase6_sync_profile_from_team_member\(\)',
    'team-member reconciliation trigger covers the exact AFTER INSERT/UPDATE columns');
end $$;

-- Profiles: raw full rows are only self/Admin; team collaboration uses the fixed RPC.
select pg_temp.p6_core_assert(has_table_privilege('authenticated','public.profiles','SELECT'),
  'authenticated may request profiles subject to RLS');
select pg_temp.p6_core_assert((select count(*)=2 from pg_catalog.pg_policy p
  join pg_catalog.pg_class c on c.oid=p.polrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='profiles' and p.polcmd='r'
    and p.polroles @> array[(select oid from pg_catalog.pg_roles where rolname='authenticated')]),
  'authenticated profile SELECT has only self and Admin policies');
select pg_temp.p6_core_assert(has_column_privilege('authenticated','public.profiles','full_name','UPDATE')
  and has_column_privilege('authenticated','public.profiles','avatar_url','UPDATE')
  and has_column_privilege('authenticated','public.profiles','phone','UPDATE')
  and not has_column_privilege('authenticated','public.profiles','email','UPDATE')
  and not has_column_privilege('authenticated','public.profiles','created_at','UPDATE'),
  'profile column ACL limits ordinary update surface');

-- Notifications: recipient-only RLS plus is_read-only ACL; read_at does not exist.
select pg_temp.p6_core_assert(not has_table_privilege('authenticated','public.notifications','INSERT'),
  'authenticated arbitrary notification INSERT denied');
select pg_temp.p6_core_assert(not has_table_privilege('authenticated','public.notifications','UPDATE')
  and has_column_privilege('authenticated','public.notifications','is_read','UPDATE'),
  'notification UPDATE is column-scoped to is_read');
select pg_temp.p6_core_assert(not exists(select 1 from information_schema.columns
  where table_schema='public' and table_name='notifications' and column_name='read_at'),
  'no nonexistent notification read_at column invented');
select pg_temp.p6_core_assert((select count(*)=3 from pg_catalog.pg_policy p
  join pg_catalog.pg_class c on c.oid=p.polrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='notifications'
    and p.polname in ('phase6_notifications_recipient_select','phase6_notifications_recipient_update','phase6_notifications_recipient_delete')
    and coalesce(pg_get_expr(p.polqual,p.polrelid),'') ~* 'recipient_id\s*=\s*auth\.uid\(\)'
    and (p.polcmd<>'w' or pg_get_expr(p.polwithcheck,p.polrelid) ~* 'recipient_id\s*=\s*auth\.uid\(\)')),
  'notification user policies are recipient-only');
select pg_temp.p6_core_assert(has_table_privilege('phase6_workflow_rpc_owner','public.notifications','SELECT,INSERT')
  and not has_table_privilege('phase6_workflow_rpc_owner','public.notifications','UPDATE,DELETE'),
  'workflow notification owner remains SELECT/INSERT only');

-- Conversations/messages/read receipts are all membership or deterministic-access scoped.
select pg_temp.p6_core_assert(not has_table_privilege('authenticated','public.conversations','UPDATE,DELETE'),
  'conversation direct UPDATE/DELETE denied');
select pg_temp.p6_core_assert(not has_table_privilege('authenticated','public.conversation_members','DELETE')
  and not has_table_privilege('authenticated','public.conversation_members','UPDATE')
  and has_column_privilege('authenticated','public.conversation_members','last_read_at','UPDATE')
  and not has_column_privilege('authenticated','public.conversation_members','user_id','UPDATE'),
  'read receipt is self last_read_at only');
select pg_temp.p6_core_assert(not has_table_privilege('authenticated','public.messages','UPDATE,DELETE'),
  'message editing/deletion denied');
select pg_temp.p6_core_assert((select pg_get_expr(p.polwithcheck,p.polrelid)
  from pg_catalog.pg_policy p where p.polrelid='public.messages'::regclass
    and p.polname='phase6_messages_member_insert') ~* 'sender_id\s*=\s*auth\.uid\(\)'
  and (select pg_get_expr(p.polwithcheck,p.polrelid)
  from pg_catalog.pg_policy p where p.polrelid='public.messages'::regclass
    and p.polname='phase6_messages_member_insert') ~* 'phase6_can_access_conversation',
  'message INSERT binds sender and conversation access');
select pg_temp.p6_core_assert(not has_table_privilege('authenticated','public.message_attachments','UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.message_mentions','UPDATE,DELETE'),
  'message children are immutable to ordinary users');

-- Tasks permit normal content/status edits while the trigger protects linkage.
select pg_temp.p6_core_assert(not has_table_privilege('authenticated','public.tasks','DELETE')
  and has_column_privilege('authenticated','public.tasks','status','UPDATE')
  and has_column_privilege('authenticated','public.tasks','assigned_to','UPDATE')
  and not has_column_privilege('authenticated','public.tasks','created_by','UPDATE'),
  'task ACL preserves workflow and protects creator identity');
select pg_temp.p6_core_assert((select pg_get_functiondef(p.oid) from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='phase6_guard_task_update')
  ~* 'phase6_app_actor_class\(\)\s*=\s*''employee''[\s\S]*new\.assigned_to\s+is\s+distinct\s+from\s+old\.assigned_to[\s\S]*new\.project_id\s+is\s+distinct\s+from\s+old\.project_id',
  'Employee cannot reassign or relink tasks');

-- Notes and activity are project-scoped; audit rows are append-only.
select pg_temp.p6_core_assert(not has_table_privilege('authenticated','public.revision_notes','UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.project_notes','UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.activity_logs','UPDATE,DELETE'),
  'notes/activity append-only to authenticated');
select pg_temp.p6_core_assert((select count(*)=6 from pg_catalog.pg_policy p
  where p.polrelid in ('public.revision_notes'::regclass,'public.project_notes'::regclass,'public.activity_logs'::regclass)
    and coalesce(pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),'')
      !~* 'phase6_client_can_access_project|''client'''),
  'internal notes/activity have no Client policy branch');
select pg_temp.p6_core_assert((select count(*)=4 from pg_catalog.pg_policy p
  where p.polrelid='public.team_members'::regclass
    and p.polname in ('phase6_team_members_admin_select','phase6_team_members_admin_insert',
      'phase6_team_members_admin_update','phase6_team_members_admin_delete')
    and coalesce(pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),'')
      ~* 'phase6_app_actor_class\(\)\s*=\s*''admin'''),
  'team-member provisioning is Admin-only');

-- Step 3D.2A.1 source/catalog contracts for current-scope authorization.
do $$
declare d text; target_d text; mention_d text; dm_d text; guard_d text; insert_policy text;
begin
  select lower(pg_get_functiondef(p.oid)) into d from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='phase6_can_access_conversation';
  perform pg_temp.p6_core_assert(d ~ 'case[\s\S]*when c\.type\s*=\s*''project_internal'' then[\s\S]*phase6_team_can_access_project'
    and d ~ 'when c\.type\s*=\s*''project_client'' then[\s\S]*phase6_team_can_access_project[\s\S]*phase6_client_can_access_project'
    and d ~ 'when c\.type\s*=\s*''task'' then[\s\S]*phase6_can_access_task'
    and d ~ 'when c\.type in \(''dm''\s*,\s*''team_channel''\) then[\s\S]*conversation_members'
    and d ~ 'else false',
    'scoped conversations require current scope; membership is DM/team-channel state only');

  select lower(pg_get_functiondef(p.oid)) into target_d from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='phase6_conversation_target_eligible';
  perform pg_temp.p6_core_assert(target_d ~ 'case[\s\S]*when c\.type\s*=\s*''project_internal'''
    and target_d ~ 'when c\.type\s*=\s*''project_client'''
    and target_d ~ 'when c\.type\s*=\s*''task'''
    and target_d ~ 'when c\.type in \(''dm''\s*,\s*''team_channel''\) then[\s\S]*conversation_members'
    and target_d !~ 'p\.project_manager\s*=\s*target\.id',
    'mention target eligibility is current-scope and assigned-to-only for project employees');

  select lower(pg_get_functiondef(p.oid)) into mention_d from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='phase6_notify_message_mention';
  perform pg_temp.p6_core_assert(mention_d ~ 'phase6_conversation_target_eligible\(v_conversation_id,\s*new\.user_id\)'
    and position('phase6_conversation_target_eligible' in mention_d)<position('insert into public.notifications' in mention_d),
    'mention trigger revalidates target before notification insert');

  select lower(pg_get_functiondef(p.oid)) into d from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='phase6_team_can_access_project';
  perform pg_temp.p6_core_assert(d ~ 'phase6_app_actor_class\(\)\s*=\s*''employee''[\s\S]*p\.assigned_to\s*=\s*public\.phase6_auth_uid\(\)'
    and d !~ 'auth\.uid\(\)'
    and d !~ 'p\.project_manager',
    'Employee project authority is assigned_to only');

  select lower(pg_get_functiondef(p.oid)) into guard_d from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='phase6_touch_project_metadata_updated_at';
  perform pg_temp.p6_core_assert(guard_d ~ 'current_user\s*=\s*''phase6_workflow_rpc_owner''[\s\S]*return new'
    and guard_d ~ 'new\.client_profile_id is distinct from old\.client_profile_id'
    and guard_d ~ 'new\.project_manager is distinct from old\.project_manager[\s\S]*phase6_current_actor_class\(\)\s*=\s*''employee'''
    and guard_d ~ 'new\.updated_at := clock_timestamp\(\)',
    'project guard preserves migration-4 rules and denies Employee project_manager changes');

  select lower(pg_get_functiondef(p.oid)) into dm_d from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='phase6_create_direct_conversation';
  perform pg_temp.p6_core_assert(dm_d ~ 'least\(v_actor_id,\s*p_other_user_id\).*greatest\(v_actor_id,\s*p_other_user_id\)'
    and dm_d ~ 'pg_advisory_xact_lock\([\s\S]*hashtextextended\(v_pair_key,\s*0\)'
    and position('pg_advisory_xact_lock' in dm_d)<position('select c.id into v_id' in dm_d),
    'DM RPC locks canonical unordered pair before existing-DM lookup');
  select lower(pg_get_expr(p.polwithcheck,p.polrelid)) into insert_policy
  from pg_catalog.pg_policy p where p.polrelid='public.conversations'::regclass
    and p.polname='phase6_conversations_eligible_insert';
  perform pg_temp.p6_core_assert(insert_policy !~ 'type\s*=\s*''dm''',
    'direct authenticated DM INSERT remains denied');
end $$;

-- Fixture-dependent revoked-access scenarios. The harness supplies existing,
-- disposable active profiles only; this test creates no Auth users or emails.
do $$
declare
  a uuid; pm uuid; e uuid; e2 uuid; c uuid;
  client_project uuid := gen_random_uuid(); employee_project uuid := gen_random_uuid();
  guard_project uuid := gen_random_uuid(); client_conversation uuid := gen_random_uuid();
  employee_conversation uuid := gen_random_uuid(); client_message uuid := gen_random_uuid();
  employee_message uuid := gen_random_uuid(); denied boolean := false;
  visible_rows bigint; touched_rows bigint;
begin
  if current_setting('phase6.local_disposable',true) is distinct from 'on'
    or nullif(current_setting('phase6.test_admin',true),'') is null
    or nullif(current_setting('phase6.test_manager',true),'') is null
    or nullif(current_setting('phase6.test_employee',true),'') is null
    or nullif(current_setting('phase6.test_other_employee',true),'') is null
    or nullif(current_setting('phase6.test_client',true),'') is null then
    raise notice 'SKIP/UNEXECUTED: Client-revocation, Employee-reassignment and project_manager runtime scenarios require disposable synthetic Auth fixtures.';
    raise notice 'SKIP/UNEXECUTED: TWO-SESSION DM CONCURRENCY TEST REQUIRED IN STAGING.';
    return;
  end if;

  a:=current_setting('phase6.test_admin')::uuid;
  pm:=current_setting('phase6.test_manager')::uuid;
  e:=current_setting('phase6.test_employee')::uuid;
  e2:=current_setting('phase6.test_other_employee')::uuid;
  c:=current_setting('phase6.test_client')::uuid;
  perform pg_temp.p6_core_assert(exists(select 1 from public.profiles where id=a and status='active' and role::text='admin'),'synthetic Admin fixture');
  perform pg_temp.p6_core_assert(exists(select 1 from public.profiles where id=pm and status='active' and role::text in ('project_manager','manager')),'synthetic PM fixture');
  perform pg_temp.p6_core_assert(exists(select 1 from public.profiles where id=e and status='active' and role::text in ('employee','junior_assistant')),'synthetic Employee fixture');
  perform pg_temp.p6_core_assert(exists(select 1 from public.profiles where id=e2 and status='active' and role::text in ('employee','junior_assistant')),'second synthetic Employee fixture');
  perform pg_temp.p6_core_assert(exists(select 1 from public.profiles where id=c and status='active' and role::text='client'),'synthetic Client fixture');

  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a)::text,true);
  insert into public.projects(id,client_name,project_title,service_type,due_date,assigned_to,project_manager,created_by)
  values
    (client_project,'Disposable client','Client revocation fixture','Fixture',date '2035-01-01',e,pm,a),
    (employee_project,'Disposable employee','Employee reassignment fixture','Fixture',date '2035-01-01',e,pm,a),
    (guard_project,'Disposable guard','Project manager guard fixture','Fixture',date '2035-01-01',e,pm,a);
  insert into public.client_project_access(client_id,project_id) values(c,client_project);
  insert into public.conversations(id,type,project_id,created_by) values
    (client_conversation,'project_client',client_project,a),
    (employee_conversation,'project_internal',employee_project,a);
  insert into public.conversation_members(conversation_id,user_id) values
    (client_conversation,c),(employee_conversation,e);
  insert into public.messages(id,conversation_id,sender_id,body) values
    (client_message,client_conversation,a,'Disposable client access fixture'),
    (employee_message,employee_conversation,a,'Disposable employee access fixture');

  perform set_config('request.jwt.claim.sub',c::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',c)::text,true);
  perform pg_temp.p6_core_assert(public.phase6_can_access_conversation(client_conversation),'Client initially accesses exact project conversation');
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a)::text,true);
  delete from public.client_project_access where client_id=c and project_id=client_project;
  perform set_config('request.jwt.claim.sub',c::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',c)::text,true);
  perform pg_temp.p6_core_assert(not public.phase6_can_access_conversation(client_conversation),'stale Client membership cannot preserve conversation/message/read-state access');
  execute 'set local role authenticated';
  select count(*) into visible_rows from public.messages where id=client_message;
  update public.conversation_members set last_read_at=clock_timestamp()
    where conversation_id=client_conversation and user_id=c;
  get diagnostics touched_rows=row_count;
  execute 'reset role';
  perform pg_temp.p6_core_assert(visible_rows=0,'revoked Client cannot SELECT messages despite stale membership');
  perform pg_temp.p6_core_assert(touched_rows=0,'revoked Client cannot update last_read_at despite stale membership');
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a)::text,true);
  perform pg_temp.p6_core_assert(not public.phase6_conversation_target_eligible(client_conversation,c),'revoked Client is not mention eligible');

  perform set_config('request.jwt.claim.sub',e::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',e)::text,true);
  perform pg_temp.p6_core_assert(public.phase6_can_access_conversation(employee_conversation),'assigned Employee initially accesses internal conversation');
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a)::text,true);
  update public.projects set assigned_to=e2,project_manager=e where id=employee_project;
  perform set_config('request.jwt.claim.sub',e::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',e)::text,true);
  perform pg_temp.p6_core_assert(not public.phase6_can_access_conversation(employee_conversation),'stale Employee membership cannot preserve conversation/message/read-state access');
  perform pg_temp.p6_core_assert(not public.phase6_team_can_access_project(employee_project),'projects.project_manager does not grant Employee authority');
  execute 'set local role authenticated';
  select count(*) into visible_rows from public.messages where id=employee_message;
  execute 'reset role';
  perform pg_temp.p6_core_assert(visible_rows=0,'reassigned Employee cannot SELECT messages despite stale membership');

  execute 'set local role authenticated';
  begin
    update public.projects set project_manager=e where id=guard_project;
  exception when sqlstate '42501' then denied:=sqlerrm='phase6_project_manager_change_denied'; end;
  execute 'reset role';
  perform pg_temp.p6_core_assert(denied,'Employee cannot modify projects.project_manager');
  perform pg_temp.p6_core_assert(public.phase6_team_can_access_project(guard_project),
    'assigned Employee access remains assigned_to-based');
  perform set_config('request.jwt.claim.sub',pm::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pm)::text,true);
  execute 'set local role authenticated';
  update public.projects set project_manager=a where id=guard_project;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a)::text,true);
  execute 'set local role authenticated';
  update public.projects set project_manager=pm where id=guard_project;
  execute 'reset role';
  perform pg_temp.p6_core_assert((select project_manager=pm from public.projects where id=guard_project),'Admin/PM retain project_manager management');
  raise notice 'PASS: single-session revoked-access fixture scenarios; TWO-SESSION DM CONCURRENCY TEST REQUIRED IN STAGING.';
end $$;

rollback;
