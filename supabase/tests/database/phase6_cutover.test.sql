-- Phase 6 Cutover and Validation test for an unlinked disposable database (V3).
-- Apply migrations 00100-00500 first. Runs in a transaction and rolls back cleanly.
begin;

create function pg_temp.p6_cutover_assert(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'Assertion failed: %', p_label;
  end if;
end
$$;

-- ============================================================================
-- 1. Exactly 11 canonical workflow mutation RPCs with exact signatures
-- ============================================================================
do $$
declare
  v_owner_oid oid;
  v_rpcs text[] := array[
    'workflow_advance_stage(uuid,bigint,uuid,text)',
    'workflow_submit_stage_for_approval(uuid,bigint,uuid,text)',
    'workflow_client_approve_stage(uuid,bigint,uuid,text)',
    'workflow_submit_client_revision(uuid,bigint,uuid,text,text,text,text)',
    'workflow_submit_revised_proof(uuid,bigint,uuid,uuid,text)',
    'workflow_request_stage_skip(uuid,bigint,uuid,public.workflow_stage,text)',
    'workflow_respond_stage_skip(uuid,bigint,uuid,uuid,text,text)',
    'workflow_admin_override(uuid,bigint,uuid,public.project_lifecycle_status,public.workflow_stage,public.workflow_stage_status,public.workflow_waiting_on,text,text)',
    'workflow_complete_final_delivery(uuid,bigint,uuid,text)',
    'workflow_set_project_lifecycle(uuid,bigint,uuid,public.project_lifecycle_status,text)',
    'workflow_update_project_configuration(uuid,bigint,uuid,boolean,boolean,jsonb)'
  ];
  sig text;
  v_proc_oid oid;
begin
  select oid into v_owner_oid from pg_catalog.pg_roles where rolname = 'phase6_workflow_rpc_owner';
  perform pg_temp.p6_cutover_assert(v_owner_oid is not null, 'phase6_workflow_rpc_owner role exists');

  foreach sig in array v_rpcs loop
    v_proc_oid := coalesce(to_regprocedure('public.' || sig), to_regprocedure(sig));
    perform pg_temp.p6_cutover_assert(v_proc_oid is not null, 'RPC signature ' || sig || ' exists');
    perform pg_temp.p6_cutover_assert(
      (select proowner from pg_catalog.pg_proc where oid = v_proc_oid) = v_owner_oid,
      'RPC ' || sig || ' is owned by phase6_workflow_rpc_owner'
    );
    perform pg_temp.p6_cutover_assert(
      has_function_privilege('authenticated', v_proc_oid, 'EXECUTE'),
      'RPC ' || sig || ' executable by authenticated'
    );
    perform pg_temp.p6_cutover_assert(
      not has_function_privilege('anon', v_proc_oid, 'EXECUTE'),
      'RPC ' || sig || ' denied to anon'
    );
  end loop;

  perform pg_temp.p6_cutover_assert(
    (select count(*) from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any(array[
         'workflow_advance_stage',
         'workflow_submit_stage_for_approval',
         'workflow_client_approve_stage',
         'workflow_submit_client_revision',
         'workflow_submit_revised_proof',
         'workflow_request_stage_skip',
         'workflow_respond_stage_skip',
         'workflow_admin_override',
         'workflow_complete_final_delivery',
         'workflow_set_project_lifecycle',
         'workflow_update_project_configuration'
       ])) = 11,
    'exactly 11 canonical workflow mutation RPCs without unexpected overloads'
  );
end $$;

-- ============================================================================
-- 2. Workflow owner and app security owner role safety attributes
-- ============================================================================
do $$
declare
  r record;
  v_role_count integer := 0;
begin
  for r in select * from pg_catalog.pg_roles where rolname in ('phase6_workflow_rpc_owner', 'phase6_app_security_owner') loop
    v_role_count := v_role_count + 1;
    perform pg_temp.p6_cutover_assert(
      not r.rolcanlogin and not r.rolsuper and not r.rolcreatedb and not r.rolcreaterole
      and not r.rolreplication and not r.rolbypassrls and not r.rolinherit,
      r.rolname || ' is unprivileged NOLOGIN/NOINHERIT/NOSUPERUSER/NOBYPASSRLS role'
    );
    -- No member other than postgres may exist
    perform pg_temp.p6_cutover_assert(
      not exists (
        select 1 from pg_catalog.pg_auth_members m
        join pg_catalog.pg_roles mem on mem.oid = m.member
        where m.roleid = r.oid and mem.rolname <> 'postgres'
      ),
      'no role other than postgres is a member of ' || r.rolname
    );
    -- If postgres membership exists, inherit_option and set_option must be false
    perform pg_temp.p6_cutover_assert(
      not exists (
        select 1 from pg_catalog.pg_auth_members m
        join pg_catalog.pg_roles mem on mem.oid = m.member
        where m.roleid = r.oid and mem.rolname = 'postgres'
          and (coalesce(m.inherit_option, false) or coalesce(m.set_option, false))
      ),
      'postgres membership in ' || r.rolname || ' does not grant inherit or set'
    );
    -- postgres cannot inherit or SET into owner role
    perform pg_temp.p6_cutover_assert(
      not pg_has_role('postgres', r.rolname, 'USAGE'),
      'postgres does not have USAGE on ' || r.rolname
    );
    perform pg_temp.p6_cutover_assert(
      not pg_has_role('postgres', r.rolname, 'SET'),
      'postgres does not have SET on ' || r.rolname
    );
    perform pg_temp.p6_cutover_assert(
      not has_schema_privilege(r.rolname, 'public', 'CREATE'),
      r.rolname || ' has no CREATE privilege on public schema'
    );
  end loop;

  perform pg_temp.p6_cutover_assert(v_role_count = 2, 'both dedicated owner roles exist and were validated');
end $$;

-- ============================================================================
-- 3. Private auth UID bridge properties and ACLs
-- ============================================================================
do $$
declare
  v_bridge record;
begin
  select p.oid, p.prorettype, p.provolatile, p.prosecdef, p.proconfig, p.prosrc
  into v_bridge
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'phase6_auth_uid' and p.pronargs = 0;

  perform pg_temp.p6_cutover_assert(v_bridge.oid is not null, 'phase6_auth_uid exists');
  perform pg_temp.p6_cutover_assert(v_bridge.prorettype = 'uuid'::regtype, 'phase6_auth_uid returns uuid');
  perform pg_temp.p6_cutover_assert(v_bridge.provolatile = 's', 'phase6_auth_uid is STABLE');
  perform pg_temp.p6_cutover_assert(v_bridge.prosecdef, 'phase6_auth_uid is SECURITY DEFINER');
  perform pg_temp.p6_cutover_assert(
    array['search_path=pg_catalog, pg_temp']::text[] <@ coalesce(v_bridge.proconfig, array[]::text[]),
    'phase6_auth_uid has fixed search_path = pg_catalog, pg_temp'
  );
  perform pg_temp.p6_cutover_assert(
    trim(both ' \t\r\n;' from v_bridge.prosrc) ~* '^\s*select\s+auth\.uid\(\)\s*$',
    'phase6_auth_uid body delegates only to auth.uid()'
  );
  perform pg_temp.p6_cutover_assert(not has_function_privilege('public', v_bridge.oid, 'EXECUTE'), 'phase6_auth_uid denied to PUBLIC');
  perform pg_temp.p6_cutover_assert(not has_function_privilege('anon', v_bridge.oid, 'EXECUTE'), 'phase6_auth_uid denied to anon');
  perform pg_temp.p6_cutover_assert(not has_function_privilege('authenticated', v_bridge.oid, 'EXECUTE'), 'phase6_auth_uid denied to authenticated');
  perform pg_temp.p6_cutover_assert(has_function_privilege('phase6_workflow_rpc_owner', v_bridge.oid, 'EXECUTE'), 'phase6_auth_uid executable by phase6_workflow_rpc_owner');
  perform pg_temp.p6_cutover_assert(has_function_privilege('phase6_app_security_owner', v_bridge.oid, 'EXECUTE'), 'phase6_auth_uid executable by phase6_app_security_owner');
end $$;

-- ============================================================================
-- 4. Canonical stage definitions exact seed verification
-- ============================================================================
do $$
begin
  perform pg_temp.p6_cutover_assert(
    not exists (
      (
        select
          stage_key::text as stage_key,
          stage_order::integer as stage_order,
          display_name::text as display_name,
          default_production_days::integer as default_production_days,
          client_controlled::boolean as client_controlled,
          clock_paused::boolean as clock_paused,
          is_delivery_stage::boolean as is_delivery_stage
        from public.workflow_stage_definitions
        except
        select * from (values
          ('files_received'::text, 1::integer, 'Files Received'::text, 2::integer, false, false, false),
          ('design_concept'::text, 2::integer, 'Design Concept'::text, 3::integer, false, false, false),
          ('concept_approval'::text, 3::integer, 'Concept Approval'::text, 0::integer, true, true, false),
          ('print_version'::text, 4::integer, 'Print Version'::text, 5::integer, false, false, false),
          ('print_approval'::text, 5::integer, 'Print Approval'::text, 0::integer, true, true, false),
          ('ebook_version'::text, 6::integer, 'Ebook Version'::text, 5::integer, false, false, false),
          ('ebook_approval'::text, 7::integer, 'Ebook Approval'::text, 0::integer, true, true, false),
          ('final_delivery'::text, 8::integer, 'Final Delivery'::text, 2::integer, false, false, true)
        ) as v(stage_key, stage_order, display_name, default_production_days, client_controlled, clock_paused, is_delivery_stage)
      )
      union all
      (
        select * from (values
          ('files_received'::text, 1::integer, 'Files Received'::text, 2::integer, false, false, false),
          ('design_concept'::text, 2::integer, 'Design Concept'::text, 3::integer, false, false, false),
          ('concept_approval'::text, 3::integer, 'Concept Approval'::text, 0::integer, true, true, false),
          ('print_version'::text, 4::integer, 'Print Version'::text, 5::integer, false, false, false),
          ('print_approval'::text, 5::integer, 'Print Approval'::text, 0::integer, true, true, false),
          ('ebook_version'::text, 6::integer, 'Ebook Version'::text, 5::integer, false, false, false),
          ('ebook_approval'::text, 7::integer, 'Ebook Approval'::text, 0::integer, true, true, false),
          ('final_delivery'::text, 8::integer, 'Final Delivery'::text, 2::integer, false, false, true)
        ) as v(stage_key, stage_order, display_name, default_production_days, client_controlled, clock_paused, is_delivery_stage)
        except
        select
          stage_key::text as stage_key,
          stage_order::integer as stage_order,
          display_name::text as display_name,
          default_production_days::integer as default_production_days,
          client_controlled::boolean as client_controlled,
          clock_paused::boolean as clock_paused,
          is_delivery_stage::boolean as is_delivery_stage
        from public.workflow_stage_definitions
      )
    ),
    'workflow_stage_definitions matches exact authoritative 8-stage seed'
  );
end $$;

-- ============================================================================
-- 5. Project metadata write guard trigger: BEFORE UPDATE ONLY, NOT INSERT
-- ============================================================================
do $$
declare
  v_tgtype smallint;
  v_tgrelid oid;
begin
  select t.tgtype, t.tgrelid into v_tgtype, v_tgrelid
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'projects'
    and t.tgname = 'phase6_touch_project_metadata_updated_at';

  perform pg_temp.p6_cutover_assert(v_tgtype is not null, 'phase6_touch_project_metadata_updated_at trigger exists on public.projects');
  -- Bitmask checks: bit 0 (1) = ROW, bit 1 (2) = BEFORE, bit 2 (4) = INSERT, bit 3 (8) = DELETE, bit 4 (16) = UPDATE
  perform pg_temp.p6_cutover_assert((v_tgtype & 1) <> 0, 'phase6_touch_project_metadata_updated_at is a FOR EACH ROW trigger');
  perform pg_temp.p6_cutover_assert((v_tgtype & 2) <> 0, 'phase6_touch_project_metadata_updated_at is a BEFORE trigger');
  perform pg_temp.p6_cutover_assert((v_tgtype & 16) <> 0, 'phase6_touch_project_metadata_updated_at fires on UPDATE');
  perform pg_temp.p6_cutover_assert((v_tgtype & 4) = 0, 'phase6_touch_project_metadata_updated_at does NOT fire on INSERT');
  perform pg_temp.p6_cutover_assert((v_tgtype & 8) = 0, 'phase6_touch_project_metadata_updated_at does NOT fire on DELETE');
end $$;

-- ============================================================================
-- 6. Direct workflow-table mutation remains denied & history append-only protection
-- ============================================================================
select pg_temp.p6_cutover_assert(
  not has_table_privilege('authenticated', 'public.project_stage_history', 'INSERT')
  and not has_table_privilege('authenticated', 'public.project_stage_history', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.project_stage_history', 'DELETE'),
  'authenticated has no direct mutation privileges on project_stage_history'
);
select pg_temp.p6_cutover_assert(
  not has_table_privilege('authenticated', 'public.project_stage_skips', 'INSERT')
  and not has_table_privilege('authenticated', 'public.project_stage_skips', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.project_stage_skips', 'DELETE'),
  'authenticated has no direct mutation privileges on project_stage_skips'
);
select pg_temp.p6_cutover_assert(
  not has_table_privilege('authenticated', 'public.admin_workflow_overrides', 'INSERT')
  and not has_table_privilege('authenticated', 'public.admin_workflow_overrides', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.admin_workflow_overrides', 'DELETE'),
  'authenticated has no direct mutation privileges on admin_workflow_overrides'
);
select pg_temp.p6_cutover_assert(
  not has_table_privilege('authenticated', 'public.workflow_idempotency_receipts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.workflow_idempotency_receipts', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.workflow_idempotency_receipts', 'DELETE'),
  'authenticated has no direct mutation privileges on workflow_idempotency_receipts'
);
select pg_temp.p6_cutover_assert(
  exists (
    select 1 from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    where c.relname = 'project_stage_history'
      and t.tgname = 'phase6_guard_history_append_only_trigger'
  ),
  'history append-only trigger is active'
);

-- ============================================================================
-- 7. No legacy workflow mutation path survives cutover
-- ============================================================================
select pg_temp.p6_cutover_assert(
  not exists (
    select 1 from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and t.tgname in (
      'apply_project_timeline_trigger', 'apply_revision_request_timeline_trigger',
      'revision_request_timeline_trigger', 'mark_project_revision_requested_trigger',
      'project_notifications_trigger', 'log_project_status_change',
      'auto_link_client_project_access_trigger', 'touch_projects_updated_at',
      'revision_request_notifications_trigger', 'set_revision_completed_at_trigger',
      'touch_revision_requests_updated_at', 'revised_proof_uploaded_trigger'
    )
  ),
  'no legacy timeline/revision mutation triggers survive cutover'
);
select pg_temp.p6_cutover_assert(
  not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'client_approve_project_milestone', 'client_respond_revision',
      'apply_revision_request_timeline', 'mark_project_revision_requested',
      'apply_project_timeline', 'submit_client_revision', 'submit_revised_proof',
      'create_timeline_deadline_notifications', 'create_project_notifications',
      'notify_revision_watchers', 'set_revision_completed_at',
      'notify_revised_proof_uploaded', 'log_project_status_change',
      'auto_link_client_project_access'
    )
  ),
  'no legacy workflow mutation functions survive cutover'
);

-- ============================================================================
-- 8. Canonical project workflow fields cannot be mutated directly by ordinary authenticated users
-- ============================================================================
select pg_temp.p6_cutover_assert(
  not has_column_privilege('authenticated', 'public.projects', 'project_status', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.projects', 'workflow_stage_key', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.projects', 'workflow_stage_status_key', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.projects', 'workflow_waiting_on_key', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.projects', 'workflow_version', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.projects', 'requires_print', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.projects', 'requires_ebook', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.projects', 'service_capability_status', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.projects', 'production_seconds_total', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.projects', 'client_wait_seconds_total', 'UPDATE'),
  'authenticated column ACL denies direct update of canonical workflow fields'
);

-- ============================================================================
-- 9. Client raw projects access remains zero; projections remain available and security_invoker
-- ============================================================================
select pg_temp.p6_cutover_assert(
  not exists (
    select 1 from pg_catalog.pg_policy p
    where p.polrelid = 'public.projects'::regclass
      and (
        coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~* '''client'''
        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~* '''client'''
      )
  ),
  'raw public.projects RLS has zero Client policies'
);

do $$
declare
  v_view text;
  v_client_views text[] := array[
    'client_project_summaries', 'client_revision_requests', 'client_revision_items',
    'client_revision_attachments', 'client_revision_activity'
  ];
  v_invoker boolean;
begin
  foreach v_view in array v_client_views loop
    select ('security_invoker=true' = any(c.reloptions)) into v_invoker
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_view;

    perform pg_temp.p6_cutover_assert(v_invoker is true, v_view || ' is security_invoker');
    perform pg_temp.p6_cutover_assert(has_table_privilege('authenticated', 'public.' || v_view, 'SELECT'),
      v_view || ' is SELECT-accessible to authenticated');
    perform pg_temp.p6_cutover_assert(not has_table_privilege('anon', 'public.' || v_view, 'SELECT'),
      v_view || ' is denied to anon');
  end loop;
end $$;

-- ============================================================================
-- 10. No broad protected authenticated RLS policies
-- ============================================================================
do $$
declare
  t text;
  v_protected text[] := array[
    'projects', 'project_stage_history', 'project_stage_skips', 'revision_requests',
    'admin_workflow_overrides', 'workflow_idempotency_receipts', 'client_project_access',
    'project_payments', 'finance_transactions', 'finance_budgets', 'employee_compensation',
    'employee_ledger', 'profiles', 'tasks', 'notifications', 'conversations',
    'conversation_members', 'messages'
  ];
begin
  foreach t in array v_protected loop
    perform pg_temp.p6_cutover_assert(
      not exists (
        select 1 from pg_catalog.pg_policy p
        join pg_catalog.pg_class c on c.oid = p.polrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = t
          and (
            coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~* '^\(?true\)?$'
            or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~* '^\(?true\)?$'
          )
      ),
      t || ' has no broad unconditional policy'
    );
  end loop;
end $$;

-- ============================================================================
-- 11. Finance/payroll security remains intact
-- ============================================================================
select pg_temp.p6_cutover_assert(
  has_table_privilege('authenticated', 'public.project_payments', 'SELECT')
  and has_table_privilege('authenticated', 'public.finance_transactions', 'SELECT')
  and has_table_privilege('authenticated', 'public.finance_budgets', 'SELECT')
  and not has_table_privilege('anon', 'public.project_payments', 'SELECT'),
  'business finance tables accessible under RLS'
);
select pg_temp.p6_cutover_assert(
  not exists (
    select 1 from pg_catalog.pg_policy p
    where p.polrelid in ('public.project_payments'::regclass, 'public.finance_transactions'::regclass, 'public.finance_budgets'::regclass)
      and (
        coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~* '''employee'''
        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~* '''employee'''
      )
  ),
  'Employee has no business finance policy branch'
);

-- ============================================================================
-- 12. Team/task/collaboration security remains intact
-- ============================================================================
select pg_temp.p6_cutover_assert(
  not has_table_privilege('authenticated', 'public.conversations', 'UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.messages', 'UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.tasks', 'DELETE'),
  'collaboration and tasks remain protected against arbitrary mutation'
);

-- ============================================================================
-- 13. No temporary cutover/helper privilege remains
-- ============================================================================
select pg_temp.p6_cutover_assert(
  not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'phase6_temp%'
  ),
  'no temporary cutover helper procedures remain'
);

rollback;
