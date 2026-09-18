-- Phase 6 Step 3D.1 security tests. Authored for an unlinked disposable DB.
-- Apply migrations 1-4 first. No Auth users/emails are created by this file.
-- Catalog assertions run as the migration test owner; authenticated runtime
-- role-matrix scenarios require separately provisioned synthetic Auth fixtures.
begin;

create function pg_temp.p6_assert(p_ok boolean,p_label text) returns void
language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'Assertion failed: %',p_label; end if;
end $$;

do $$
declare
  n text; f record; d text; owner_oid oid; app_owner_oid oid;
  pgcrypto_oid oid; pgcrypto_namespace_oid oid; pgcrypto_schema text; digest_oid oid;
  canonical text[] := array[
    'workflow_advance_stage','workflow_submit_stage_for_approval','workflow_client_approve_stage',
    'workflow_submit_client_revision','workflow_submit_revised_proof','workflow_request_stage_skip',
    'workflow_respond_stage_skip','workflow_admin_override','workflow_complete_final_delivery',
    'workflow_set_project_lifecycle','workflow_update_project_configuration'
  ];
  legacy text[] := array[
    'client_approve_project_milestone','submit_client_revision','submit_revised_proof',
    'client_respond_revision','apply_revision_request_timeline','mark_project_revision_requested',
    'apply_project_timeline','create_timeline_deadline_notifications','create_project_notifications',
    'notify_revision_watchers','set_revision_completed_at','notify_revised_proof_uploaded',
    'log_project_status_change','auto_link_client_project_access'
  ];
begin
  select oid into owner_oid from pg_catalog.pg_roles where rolname='phase6_workflow_rpc_owner';
  perform pg_temp.p6_assert(owner_oid is not null,'dedicated owner exists');
  perform pg_temp.p6_assert((select not rolcanlogin and not rolsuper and not rolcreatedb
    and not rolcreaterole and not rolreplication and not rolbypassrls
    from pg_catalog.pg_roles where oid=owner_oid),'owner is NOLOGIN/nonprivileged/no BYPASSRLS');
  perform pg_temp.p6_assert(not exists(
    select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid=m.member
    where m.roleid=owner_oid and r.rolname in ('anon','authenticated')),
    'application roles are not owner members');

  select p.* into strict f from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname='phase6_auth_uid' and p.pronargs=0;
  perform pg_temp.p6_assert(f.prorettype='uuid'::regtype,'auth UID bridge returns uuid');
  perform pg_temp.p6_assert(f.provolatile='s','auth UID bridge is STABLE');
  perform pg_temp.p6_assert(f.prosecdef,'auth UID bridge is SECURITY DEFINER');
  perform pg_temp.p6_assert('search_path=pg_catalog, pg_temp'=any(f.proconfig),'auth UID bridge has fixed path');
  perform pg_temp.p6_assert(
    f.prosrc ~* '^[[:space:]]*select[[:space:]]+auth\.uid\(\)[[:space:]]*;?[[:space:]]*$',
    'auth UID bridge delegates only to auth.uid()');
  perform pg_temp.p6_assert(not has_function_privilege('authenticated',f.oid,'EXECUTE'),
    'authenticated cannot execute auth UID bridge');
  perform pg_temp.p6_assert(not has_function_privilege('anon',f.oid,'EXECUTE'),
    'anon cannot execute auth UID bridge');
  perform pg_temp.p6_assert(not exists(select 1 from pg_catalog.aclexplode(f.proacl) a
    where a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC cannot execute auth UID bridge');
  perform pg_temp.p6_assert(has_function_privilege('phase6_workflow_rpc_owner',f.oid,'EXECUTE'),
    'workflow owner can execute auth UID bridge');
  select oid into app_owner_oid from pg_catalog.pg_roles where rolname='phase6_app_security_owner';
  if app_owner_oid is not null then
    perform pg_temp.p6_assert(has_function_privilege('phase6_app_security_owner',f.oid,'EXECUTE'),
      'app-security owner can execute auth UID bridge after 00450');
  end if;
  perform pg_temp.p6_assert(f.proowner<>owner_oid and (app_owner_oid is null or f.proowner<>app_owner_oid),
    'auth UID bridge remains owned by the migration executor');

  foreach n in array canonical loop
    select p.* into strict f from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace s on s.oid=p.pronamespace
      where s.nspname='public' and p.proname=n;
    perform pg_temp.p6_assert(f.proowner=owner_oid,n || ' dedicated owner');
    perform pg_temp.p6_assert(f.prosecdef,n || ' SECURITY DEFINER');
    perform pg_temp.p6_assert('search_path=pg_catalog, pg_temp'=any(f.proconfig),n || ' fixed path');
    perform pg_temp.p6_assert(has_function_privilege('authenticated',f.oid,'EXECUTE'),n || ' authenticated execute');
    perform pg_temp.p6_assert(not has_function_privilege('anon',f.oid,'EXECUTE'),n || ' anon denied');
    perform pg_temp.p6_assert(not exists(select 1 from aclexplode(f.proacl) a
      where a.grantee=0 and a.privilege_type='EXECUTE'),n || ' PUBLIC denied');
  end loop;
  perform pg_temp.p6_assert((select count(*)=11 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname=any(canonical) and p.proowner=owner_oid),
    'exactly eleven canonical RPCs owned');

  for f in select p.* from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and left(p.proname,10)='_workflow_' loop
    perform pg_temp.p6_assert(not has_function_privilege('authenticated',f.oid,'EXECUTE'),f.proname || ' authenticated denied');
    perform pg_temp.p6_assert(not has_function_privilege('anon',f.oid,'EXECUTE'),f.proname || ' anon denied');
    perform pg_temp.p6_assert(not exists(select 1 from aclexplode(f.proacl) a
      where a.grantee=0 and a.privilege_type='EXECUTE'),f.proname || ' PUBLIC denied');
    perform pg_temp.p6_assert(has_function_privilege('phase6_workflow_rpc_owner',f.oid,'EXECUTE'),f.proname || ' owner execute');
  end loop;

  for f in select p.* from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname=any(legacy) loop
    perform pg_temp.p6_assert(not has_function_privilege('authenticated',f.oid,'EXECUTE'),f.proname || ' legacy authenticated denied');
    perform pg_temp.p6_assert(not has_function_privilege('anon',f.oid,'EXECUTE'),f.proname || ' legacy anon denied');
    perform pg_temp.p6_assert(not exists(select 1 from aclexplode(f.proacl) a
      where a.grantee=0 and a.privilege_type='EXECUTE'),f.proname || ' legacy PUBLIC denied');
  end loop;

  select pg_get_functiondef(p.oid) into d from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname='get_client_project_summaries';
  perform pg_temp.p6_assert(d is not null and d !~* 'p\.\*|to_jsonb\s*\(|row_to_json\s*\(',
    'client project projection has explicit output');
  perform pg_temp.p6_assert(d !~* 'internal_notes|qa_notes|assigned_to|project_manager|production_seconds_total|client_wait_seconds_total|workflow_settings|capabilities_resolved_by|capabilities_resolved_at',
    'client project projection excludes prohibited fields');
  perform pg_temp.p6_assert(d ~* 'client_has_project_access\(p\.id,\s*public\.phase6_auth_uid\(\)\)'
    and d !~* 'auth\.uid\(\)',
    'client projection delegates exact access');
  select p.prosrc into d from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname='client_has_project_access';
  perform pg_temp.p6_assert((select pg_get_function_arguments(p.oid) ~*
      'client_id uuid default auth\.uid\(\)'
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname='client_has_project_access')
    and d ~* 'client_id\s+is\s+not\s+distinct\s+from\s+public\.phase6_auth_uid\(\)'
    and d ~* 'p\.client_profile_id\s*=\s*public\.phase6_auth_uid\(\)'
    and d ~* 'a\.client_id\s*=\s*public\.phase6_auth_uid\(\)'
    and d !~* 'auth\.uid\(\)',
    'client access helper binds exact caller/FK/membership');

  for f in select p.* from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.prosecdef
      and p.proowner in (select oid from pg_catalog.pg_roles
        where rolname in ('phase6_workflow_rpc_owner','phase6_app_security_owner')) loop
    perform pg_temp.p6_assert(f.prosrc !~* 'auth\.uid\s*\(',
      f.proname || ' owner SECURITY DEFINER body uses private identity bridge');
  end loop;

  select pg_get_functiondef(p.oid) into d from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname='phase6_touch_project_metadata_updated_at';
  perform pg_temp.p6_assert(d ~* 'current_user\s*=\s*''phase6_workflow_rpc_owner''[[:space:]]+then[[:space:]]+return new'
    and d ~* 'new\.updated_at\s*:=\s*clock_timestamp\(\)'
    and d !~* 'new\.updated_at\s+is\s+not\s+distinct\s+from\s+old\.updated_at',
    'project timestamp trigger preserves owner timestamp and stamps ordinary writers');
  perform pg_temp.p6_assert(d ~* 'new\.client_profile_id\s+is\s+distinct\s+from\s+old\.client_profile_id'
    and d ~* 'phase6_current_actor_class\(\)\s+not\s+in\s*\(''admin'',\s*''project_manager''\)'
    and d ~* 'workflow_project_client_access_denied',
    'project trigger limits client_profile_id changes to Admin/PM direct flow');

  select pg_get_functiondef(p.oid) into d from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname='phase6_touch_revision_metadata_updated_at';
  perform pg_temp.p6_assert(d ~* 'current_user\s*=\s*''phase6_workflow_rpc_owner''[[:space:]]+then[[:space:]]+return new'
    and d ~* 'new\.updated_at\s*:=\s*clock_timestamp\(\)'
    and d !~* 'new\.updated_at\s+is\s+not\s+distinct\s+from\s+old\.updated_at',
    'revision timestamp trigger preserves owner timestamp and stamps ordinary writers');

  perform pg_temp.p6_assert(exists(
    select 1 from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace s on s.oid=c.relnamespace
    join pg_catalog.pg_proc p on p.oid=t.tgfoid
    where s.nspname='public' and c.relname='projects'
      and t.tgname='phase6_touch_project_metadata_updated_at'
      and p.proname='phase6_touch_project_metadata_updated_at' and not t.tgisinternal),
    'project owner-bypass timestamp trigger is installed');

  select e.oid,n.oid,n.nspname
    into pgcrypto_oid,pgcrypto_namespace_oid,pgcrypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid=e.extnamespace
  where e.extname='pgcrypto';
  perform pg_temp.p6_assert(pgcrypto_schema is not null,'pgcrypto schema discovered from extension catalog');
  digest_oid := pg_catalog.to_regprocedure(pg_catalog.format('%I.digest(text,text)',pgcrypto_schema));
  perform pg_temp.p6_assert(digest_oid is not null and exists(
    select 1 from pg_catalog.pg_depend x
    where x.classid='pg_catalog.pg_proc'::regclass and x.objid=digest_oid
      and x.refclassid='pg_catalog.pg_extension'::regclass
      and x.refobjid=pgcrypto_oid and x.deptype='e'),
    'exact digest(text,text) is owned by pgcrypto');
  perform pg_temp.p6_assert(has_schema_privilege('phase6_workflow_rpc_owner',pgcrypto_namespace_oid,'USAGE'),
    'owner has pgcrypto schema USAGE');
  perform pg_temp.p6_assert(has_function_privilege('phase6_workflow_rpc_owner',digest_oid,'EXECUTE'),
    'owner has exact digest(text,text) EXECUTE');
  perform pg_temp.p6_assert(not exists(
    select 1 from pg_catalog.pg_namespace n
    cross join lateral pg_catalog.aclexplode(n.nspacl) a
    where n.oid=pgcrypto_namespace_oid and a.grantee=owner_oid
      and (a.privilege_type<>'USAGE' or a.is_grantable)),
    'owner has no CREATE or grant option on pgcrypto schema');
  perform pg_temp.p6_assert((select count(*)=1 and bool_and(p.oid=digest_oid)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_depend x on x.classid='pg_catalog.pg_proc'::regclass
      and x.objid=p.oid and x.refclassid='pg_catalog.pg_extension'::regclass
      and x.refobjid=pgcrypto_oid and x.deptype='e'
    cross join lateral pg_catalog.aclexplode(p.proacl) a
    where a.grantee=owner_oid and a.privilege_type='EXECUTE'),
    'owner direct extension function grant is exact digest(text,text) only');
  perform pg_temp.p6_assert(not exists(
    select 1
    from pg_catalog.pg_roles r
    join pg_catalog.pg_namespace n on n.oid=pgcrypto_namespace_oid
    cross join lateral pg_catalog.aclexplode(n.nspacl) a
    where r.rolname in ('anon','authenticated')
      and a.grantee=r.oid
      and (a.privilege_type<>'USAGE' or a.is_grantable)),
    'application roles have no pgcrypto schema privilege beyond non-grantable USAGE');
  perform pg_temp.p6_assert(not exists(
    select 1 from pg_catalog.pg_roles r
    join pg_catalog.pg_proc p on true
    join pg_catalog.pg_depend x on x.classid='pg_catalog.pg_proc'::regclass
      and x.objid=p.oid and x.refclassid='pg_catalog.pg_extension'::regclass
      and x.refobjid=pgcrypto_oid and x.deptype='e'
    cross join lateral pg_catalog.aclexplode(p.proacl) a
    where r.rolname in ('anon','authenticated') and a.grantee=r.oid),
    'migration adds no direct pgcrypto function grant to application roles');
end
$$;

-- Direct workflow-table mutation and receipt access are denied at the ACL layer.
select pg_temp.p6_assert(not has_table_privilege('authenticated','public.project_stage_history','INSERT,UPDATE,DELETE'),'history immutable to authenticated');
select pg_temp.p6_assert(not has_table_privilege('authenticated','public.project_stage_skips','INSERT,UPDATE,DELETE'),'skips mutation denied');
select pg_temp.p6_assert(not has_table_privilege('authenticated','public.revision_requests','INSERT,DELETE'),'revision insert/delete denied');
select pg_temp.p6_assert(not has_column_privilege('authenticated','public.revision_requests','status','UPDATE')
  and not has_column_privilege('authenticated','public.revision_requests','canonical_status','UPDATE')
  and not has_column_privilege('authenticated','public.revision_requests','due_at','UPDATE')
  and has_column_privilege('authenticated','public.revision_requests','priority','UPDATE'),
  'revision lifecycle denied while metadata update retained');
select pg_temp.p6_assert(not has_table_privilege('authenticated','public.admin_workflow_overrides','INSERT,UPDATE,DELETE'),'override mutation denied');
select pg_temp.p6_assert(not has_table_privilege('authenticated','public.workflow_idempotency_receipts','SELECT,INSERT,UPDATE,DELETE'),'receipt access denied');

select pg_temp.p6_assert(has_table_privilege('phase6_workflow_rpc_owner','public.projects','SELECT,UPDATE'),'owner project access');
select pg_temp.p6_assert(has_table_privilege('phase6_workflow_rpc_owner','public.project_stage_history','SELECT,INSERT'),'owner history access');
select pg_temp.p6_assert(has_table_privilege('phase6_workflow_rpc_owner','public.project_stage_skips','SELECT,INSERT,UPDATE'),'owner skip access');
select pg_temp.p6_assert(has_table_privilege('phase6_workflow_rpc_owner','public.revision_requests','SELECT,INSERT,UPDATE'),'owner revision access');
select pg_temp.p6_assert(has_table_privilege('phase6_workflow_rpc_owner','public.admin_workflow_overrides','SELECT,INSERT'),'owner override access');
select pg_temp.p6_assert(has_table_privilege('phase6_workflow_rpc_owner','public.workflow_idempotency_receipts','SELECT,INSERT'),'owner receipt access');
select pg_temp.p6_assert(has_table_privilege('phase6_workflow_rpc_owner','public.notifications','SELECT,INSERT')
  and not has_table_privilege('phase6_workflow_rpc_owner','public.notifications','UPDATE,DELETE'),'owner notification least privilege');

-- Column ACLs preserve CRM/file edits but reject protected workflow assignments,
-- including a SQL no-op assignment of the existing protected value.
select pg_temp.p6_assert(has_column_privilege('authenticated','public.projects','project_title','UPDATE'),'metadata update retained');
select pg_temp.p6_assert(not has_column_privilege('authenticated','public.projects','workflow_stage_key','UPDATE'),'canonical stage update denied');
select pg_temp.p6_assert(not has_column_privilege('authenticated','public.projects','status','UPDATE'),'compatibility status update denied');
select pg_temp.p6_assert(not has_column_privilege('authenticated','public.projects','stage_due_at','UPDATE'),'operational due update denied');
select pg_temp.p6_assert(not has_column_privilege('authenticated','public.projects','design_concept_approval_date','UPDATE'),'milestone update denied');

-- client_profile_id remains an exact authorization input, but its column grant
-- is constrained by the project trigger to Admin/PM. client_project_access is
-- independently Admin/PM-only for every mutation operation.
select pg_temp.p6_assert(has_column_privilege('authenticated','public.projects','client_profile_id','UPDATE'),
  'client_profile_id stays in the guarded direct metadata path');
select pg_temp.p6_assert((select count(*)=3 from pg_catalog.pg_policy p
  join pg_catalog.pg_class c on c.oid=p.polrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='client_project_access'
    and p.polname in ('phase6_access_management_insert','phase6_access_management_update','phase6_access_management_delete')
    and coalesce(pg_get_expr(p.polqual,p.polrelid),'') || coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
      ~* '''admin''.*''project_manager'''
    and coalesce(pg_get_expr(p.polqual,p.polrelid),'') !~* '''client''|''employee'''
    and coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') !~* '''client''|''employee'''),
  'client_project_access mutation policies have no Employee/Client path');

-- No client/raw-project policy and no permissive protected-table policy remains.
select pg_temp.p6_assert(not exists(
  select 1 from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='projects'
    and pg_get_expr(p.polqual,p.polrelid) ~* 'client'),
  'client raw-project SELECT policy absent');
select pg_temp.p6_assert(not exists(
  select 1 from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in (
    'projects','project_stage_history','project_stage_skips','revision_requests',
    'admin_workflow_overrides','workflow_idempotency_receipts')
    and (coalesce(pg_get_expr(p.polqual,p.polrelid),'') ~* '^true$'
      or coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') ~* '^true$')),
  'no unconditional workflow policy');

-- Runtime role/cross-user projection tests require disposable active Auth fixtures.
-- Their absence is not a pass and no production connection may be used.
do $$ begin
  if nullif(current_setting('phase6.test_admin',true),'') is null
    or nullif(current_setting('phase6.test_employee',true),'') is null
    or nullif(current_setting('phase6.test_client',true),'') is null then
    raise notice 'SKIP: runtime role-matrix and client_profile_id guard tests require disposable synthetic Auth fixtures.';
  end if;
end $$;

rollback;
