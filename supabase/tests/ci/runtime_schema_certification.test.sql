begin;

create extension if not exists pgtap with schema extensions;
select plan(34);

select has_table('public','task_attachments','task attachments table exists');
select has_table('public','task_mentions','task mentions table exists');
select has_table('public','project_templates','project templates table exists');
select has_table('public','project_template_tasks','project template tasks table exists');
select has_table('public','workspaces','workspace root exists');
select has_table('public','workspace_members','workspace memberships exist');
select has_table('public','workspace_events','workspace event outbox exists');
select has_table('public','workspace_webhook_endpoints','webhook endpoints exist');
select has_table('public','workspace_webhook_deliveries','webhook delivery outbox exists');

select has_column('public','projects','workspace_id','projects are workspace scoped');
select has_column('public','tasks','workspace_id','tasks are workspace scoped');
select has_column('public','projects','workflow_template_key','projects remember selected template');
select has_column('public','tasks','workflow_stage_key','template tasks can map to workflow stage');
select has_column('public','attendance_sessions','last_app_heartbeat_at','attendance heartbeat schema exists');
select has_table('public','invoice_versions','invoice version history exists');
select has_table('public','ai_operator_events','AI operator telemetry exists');
select has_column('public','conversation_members','last_read_at','message read state exists');

select ok((select relrowsecurity from pg_class where oid='public.task_attachments'::regclass),'task attachments RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.task_mentions'::regclass),'task mentions RLS enabled');
select ok(not has_table_privilege('authenticated','public.task_attachments','UPDATE'),'registered task file metadata cannot be updated by authenticated users');
select ok(not has_table_privilege('authenticated','public.task_attachments','DELETE'),'registered task file metadata cannot be deleted by authenticated users');

select ok(
  exists(select 1 from storage.buckets where id='task-files' and public=false and file_size_limit=104857600),
  'private task-files bucket has 100MB cap'
);

select ok(
  (select count(*)=7 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public'
     and tablename in ('tasks','task_assignees','task_comments','task_checklist_items','task_dependencies','task_attachments','task_mentions')),
  'all task collaboration tables are published to Realtime'
);

select ok(
  exists(select 1 from pg_policy where polrelid='public.projects'::regclass and polname='tenant_projects_workspace_guard' and polpermissive=false),
  'projects have restrictive workspace RLS guard'
);
select ok(
  exists(select 1 from pg_policy where polrelid='public.tasks'::regclass and polname='tenant_tasks_workspace_guard' and polpermissive=false),
  'tasks have restrictive workspace RLS guard'
);

select has_function('public','apply_project_template',array['uuid','text'],'template application RPC exists');
select has_function('public','workflow_client_approve_stage',array['uuid','bigint','uuid','text'],'client approval canonical RPC exists');
select has_function('public','attendance_record_heartbeat',array['text'],'attendance heartbeat RPC exists');
select has_function(
  'public',
  'invoice_save_version',
  array['uuid','text','text','text','integer','integer','text','date','jsonb','numeric','numeric','numeric','text','text','text'],
  'invoice versioning RPC exists'
);

select ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='tenant_is_workspace_member'
      and p.prosecdef and 'search_path=pg_catalog, pg_temp'=any(p.proconfig)
  ),
  'workspace membership helper is fixed-path SECURITY DEFINER'
);

select ok(
  exists(select 1 from pg_trigger t where t.tgrelid='public.profiles'::regclass
    and t.tgname='tenant_bootstrap_profile_membership_trigger' and not t.tgisinternal),
  'new profiles are bootstrapped into the existing workspace'
);

select results_eq(
  $$select count(*)::bigint from public.project_templates where is_system and active$$,
  array[4::bigint],
  'four active system publishing templates are seeded'
);

select ok(
  exists(select 1 from pg_trigger t where t.tgrelid='public.projects'::regclass
    and t.tgname='apply_project_template_after_project_insert_trigger' and not t.tgisinternal),
  'project template tasks seed in the project transaction'
);

select ok(
  exists(select 1 from pg_trigger t where t.tgrelid='public.task_mentions'::regclass
    and t.tgname='notify_task_mention_trigger' and not t.tgisinternal),
  '@mentions have a notification trigger'
);

select * from finish();
rollback;
