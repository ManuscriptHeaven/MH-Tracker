-- Migration 00500: Phase 6 Final Cutover and Validation (V3)
-- Converts tested compatibility state into canonical production state.
-- Fails closed on any unresolved blocking backfill errors or invariant violations.
-- Retires conflicting legacy workflow mutation surfaces using RESTRICT semantics.
-- Enforces canonical write guards (BEFORE UPDATE ONLY) and validates deferred constraints.
-- Managed-Supabase compatible: asserts no usable owner privileges for postgres (USAGE/SET=false).

begin;

-- ============================================================================
-- A. PRE-CUTOVER ASSERTIONS & CAPABILITY / BACKFILL PREFLIGHT
-- ============================================================================

do $phase6_preflight$
declare
  v_owner_oid oid;
  v_app_sec_oid oid;
  v_bridge_rec record;
  v_expected_rpc_signatures text[] := array[
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
  v_sig text;
  v_proc_oid oid;
  v_rpc_count integer;
  v_blocking_errors integer;
  v_unresolved_caps integer;
  v_proj public.projects%rowtype;
begin
  -- 1. Verify owner roles exist and have safe attributes
  select oid into v_owner_oid from pg_catalog.pg_roles where rolname = 'phase6_workflow_rpc_owner';
  select oid into v_app_sec_oid from pg_catalog.pg_roles where rolname = 'phase6_app_security_owner';
  if v_owner_oid is null or v_app_sec_oid is null then
    raise exception 'phase6_cutover_failed: dedicated owner roles missing' using errcode = '42501';
  end if;

  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname in ('phase6_workflow_rpc_owner', 'phase6_app_security_owner')
      and (
        rolsuper
        or rolinherit
        or rolcreaterole
        or rolcreatedb
        or rolcanlogin
        or rolreplication
        or rolbypassrls
      )
  ) then
    raise exception 'phase6_cutover_failed: dedicated owner roles have unsafe attributes' using errcode = '42501';
  end if;

  -- 2. Verify private auth bridge function exists and has exact properties and ACLs
  select p.oid, p.prorettype, p.provolatile, p.prosecdef, p.proconfig, p.prosrc
  into v_bridge_rec
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'phase6_auth_uid' and p.pronargs = 0;

  if v_bridge_rec.oid is null then
    raise exception 'phase6_cutover_failed: private auth uid bridge missing' using errcode = '42883';
  end if;

  if v_bridge_rec.prorettype <> 'uuid'::regtype
     or v_bridge_rec.provolatile <> 's'
     or not v_bridge_rec.prosecdef
     or not (array['search_path=pg_catalog, pg_temp']::text[] <@ coalesce(v_bridge_rec.proconfig, array[]::text[]))
     or trim(both ' \t\r\n;' from v_bridge_rec.prosrc) !~* '^\s*select\s+auth\.uid\(\)\s*$'
  then
    raise exception 'phase6_cutover_failed: private auth uid bridge configuration mismatch' using errcode = '22023';
  end if;

  if has_function_privilege('public', v_bridge_rec.oid, 'EXECUTE')
     or has_function_privilege('anon', v_bridge_rec.oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_bridge_rec.oid, 'EXECUTE')
     or not has_function_privilege('phase6_workflow_rpc_owner', v_bridge_rec.oid, 'EXECUTE')
     or not has_function_privilege('phase6_app_security_owner', v_bridge_rec.oid, 'EXECUTE')
  then
    raise exception 'phase6_cutover_failed: private auth uid bridge ACLs mismatch' using errcode = '42501';
  end if;

  -- 3. Verify canonical stage definitions match authoritative seed exactly
  if exists (
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
  ) then
    raise exception 'phase6_cutover_failed: canonical stage definitions do not match authoritative definitions' using errcode = '22023';
  end if;

  -- 4. Verify exact 11 canonical mutation RPC signatures exist, are owned by phase6_workflow_rpc_owner, and have exact ACLs
  foreach v_sig in array v_expected_rpc_signatures loop
    v_proc_oid := coalesce(to_regprocedure('public.' || v_sig), to_regprocedure(v_sig));
    if v_proc_oid is null then
      raise exception 'phase6_cutover_failed: canonical RPC signature missing: %', v_sig using errcode = '42883';
    end if;
    if (select proowner from pg_catalog.pg_proc where oid = v_proc_oid) <> v_owner_oid then
      raise exception 'phase6_cutover_failed: canonical RPC not owned by phase6_workflow_rpc_owner: %', v_sig using errcode = '42501';
    end if;
    if not has_function_privilege('authenticated', v_proc_oid, 'EXECUTE') then
      raise exception 'phase6_cutover_failed: authenticated lacks EXECUTE on %', v_sig using errcode = '42501';
    end if;
    if has_function_privilege('anon', v_proc_oid, 'EXECUTE') then
      raise exception 'phase6_cutover_failed: anon has EXECUTE on %', v_sig using errcode = '42501';
    end if;
  end loop;

  -- Assert no unexpected overloads exist for canonical RPC names
  select count(*) into v_rpc_count
  from pg_catalog.pg_proc p
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
    ]);
  if v_rpc_count <> 11 then
    raise exception 'phase6_cutover_failed: canonical RPC overload mismatch (found %, expected 11)', v_rpc_count using errcode = '42P13';
  end if;

  -- 5. Backfill preflight: fail if genuinely unresolved error-level backfill issues exist
  select count(*) into v_blocking_errors
  from public.phase6_backfill_issues
  where severity = 'error' and not resolved;
  if v_blocking_errors > 0 then
    raise exception 'phase6_cutover_blocked_backfill_error: % unresolved error-level backfill issues exist', v_blocking_errors;
  end if;

  -- 6. Capability preflight: active projects must have deterministic capability route
  select count(*) into v_unresolved_caps
  from public.projects
  where project_status not in ('completed'::public.project_lifecycle_status, 'cancelled'::public.project_lifecycle_status, 'archived'::public.project_lifecycle_status)
    and (
      service_capability_status = 'needs_review'::public.service_capability_status
      or requires_print is null
      or requires_ebook is null
      or (not requires_print and not requires_ebook)
    );
  if v_unresolved_caps > 0 then
    raise exception 'phase6_cutover_blocked_unresolved_capability: % active projects have unresolved capability ambiguity', v_unresolved_caps;
  end if;

  -- 7. Pre-cutover invariant validation for every project row (actionable error reporting)
  for v_proj in select * from public.projects loop
    begin
      perform public._workflow_validate_tuple(v_proj);
    exception when others then
      raise exception 'phase6_cutover_blocked_invalid_workflow_tuple: project % (%): %',
        v_proj.project_number, v_proj.id, sqlerrm
        using errcode = sqlstate;
    end;
    if v_proj.workflow_version < 0 or v_proj.production_seconds_total < 0 or v_proj.client_wait_seconds_total < 0 then
      raise exception 'phase6_cutover_blocked_invalid_counters: project % has negative counter values', v_proj.id;
    end if;
  end loop;
end
$phase6_preflight$;

-- ============================================================================
-- B. RETIRE LEGACY WORKFLOW MUTATION PATHS
-- ============================================================================

-- 1. Drop competing legacy triggers if still attached to projects / revisions
drop trigger if exists apply_project_timeline_trigger on public.projects;
drop trigger if exists project_notifications_trigger on public.projects;
drop trigger if exists log_project_status_change on public.projects;
drop trigger if exists auto_link_client_project_access_trigger on public.projects;
drop trigger if exists touch_projects_updated_at on public.projects;
drop trigger if exists apply_revision_request_timeline_trigger on public.revision_requests;
drop trigger if exists revision_request_timeline_trigger on public.revision_requests;
drop trigger if exists mark_project_revision_requested_trigger on public.revision_requests;
drop trigger if exists revision_request_notifications_trigger on public.revision_requests;
drop trigger if exists set_revision_completed_at_trigger on public.revision_requests;
drop trigger if exists touch_revision_requests_updated_at on public.revision_requests;
drop trigger if exists revised_proof_uploaded_trigger on public.revision_attachments;

-- 2. Drop obsolete legacy mutation functions with RESTRICT semantics (NO CASCADE)
do $phase6_retire_legacy$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array[
      'client_approve_project_milestone',
      'submit_client_revision',
      'submit_revised_proof',
      'client_respond_revision',
      'apply_revision_request_timeline',
      'mark_project_revision_requested',
      'apply_project_timeline',
      'create_timeline_deadline_notifications',
      'create_project_notifications',
      'notify_revision_watchers',
      'set_revision_completed_at',
      'notify_revised_proof_uploaded',
      'log_project_status_change',
      'auto_link_client_project_access'
    ])
  loop
    execute format('drop function if exists %s restrict', r.signature);
  end loop;
end
$phase6_retire_legacy$;

-- 3. Install canonical workflow write guard on public.projects
-- Ensures ordinary authenticated users cannot directly mutate workflow state.
-- CRITICAL: Installed as BEFORE UPDATE only. NEVER BEFORE INSERT.
create or replace function public.phase6_touch_project_metadata_updated_at()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  -- Workflow mutations originate strictly from the canonical workflow RPC owner
  if current_user = 'phase6_workflow_rpc_owner' then
    return new;
  end if;

  -- Block any direct mutation of canonical workflow authority fields
  if (new.project_status is distinct from old.project_status
      or new.workflow_stage_key is distinct from old.workflow_stage_key
      or new.workflow_stage_status_key is distinct from old.workflow_stage_status_key
      or new.workflow_waiting_on_key is distinct from old.workflow_waiting_on_key
      or new.workflow_version is distinct from old.workflow_version
      or new.requires_print is distinct from old.requires_print
      or new.requires_ebook is distinct from old.requires_ebook
      or new.service_capability_status is distinct from old.service_capability_status
      or new.production_seconds_total is distinct from old.production_seconds_total
      or new.client_wait_seconds_total is distinct from old.client_wait_seconds_total
      or new.delivered_at is distinct from old.delivered_at) then
    raise exception 'phase6_workflow_direct_mutation_denied: canonical workflow fields require workflow RPC' using errcode = '42501';
  end if;

  -- Client profile assignment is Admin/PM guarded
  if new.client_profile_id is distinct from old.client_profile_id
     and public.phase6_current_actor_class() not in ('admin', 'project_manager') then
    raise exception 'workflow_project_client_access_denied' using errcode = '42501';
  end if;

  -- Project manager reassignment is denied to Employee
  if new.project_manager is distinct from old.project_manager
     and public.phase6_current_actor_class() = 'employee' then
    raise exception 'phase6_project_manager_change_denied' using errcode = '42501';
  end if;

  -- Invoice metadata is Admin/PM guarded
  if (new.invoiced is distinct from old.invoiced
      or new.invoice_id is distinct from old.invoice_id
      or new.invoiced_at is distinct from old.invoiced_at)
     and public.phase6_current_actor_class() not in ('admin', 'project_manager') then
    raise exception 'phase6_project_invoice_metadata_denied' using errcode = '42501';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end
$fn$;
revoke all on function public.phase6_touch_project_metadata_updated_at() from public, anon, authenticated;

-- Ensure the guard trigger is installed on public.projects as BEFORE UPDATE ONLY
drop trigger if exists phase6_touch_project_metadata_updated_at on public.projects;
create trigger phase6_touch_project_metadata_updated_at
before update on public.projects
for each row execute function public.phase6_touch_project_metadata_updated_at();

-- 4. Enforce project_stage_history append-only trigger
create or replace function public.phase6_guard_history_append_only()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'phase6_project_stage_history_append_only: workflow history is append-only' using errcode = '42501';
  end if;
  return null;
end
$fn$;
revoke all on function public.phase6_guard_history_append_only() from public, anon, authenticated;

drop trigger if exists phase6_guard_history_append_only_trigger on public.project_stage_history;
create trigger phase6_guard_history_append_only_trigger
before update or delete on public.project_stage_history
for each row execute function public.phase6_guard_history_append_only();

-- ============================================================================
-- C. FINAL ACL / RLS HARDENING & DEFERRED CONSTRAINT VALIDATION
-- ============================================================================

-- 1. Validate all deferred constraints from 00100
alter table public.projects validate constraint projects_workflow_version_nonnegative;
alter table public.projects validate constraint projects_production_seconds_total_nonnegative;
alter table public.projects validate constraint projects_client_wait_seconds_total_nonnegative;
alter table public.project_stage_history validate constraint project_stage_history_production_delta_nonnegative;
alter table public.project_stage_history validate constraint project_stage_history_client_wait_delta_nonnegative;
alter table public.project_stage_history validate constraint project_stage_history_metadata_object;
do $phase6_notif_fk$
begin
  if exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.notifications'::regclass
      and conname = 'notifications_revision_request_id_fkey'
  ) then
    alter table public.notifications validate constraint notifications_revision_request_id_fkey;
  end if;
end
$phase6_notif_fk$;

-- 2. Final security assertions on RLS and policies
do $phase6_security_hardening$
declare
  t text;
  v_protected text[] := array[
    'projects', 'project_stage_history', 'project_stage_skips', 'revision_requests',
    'admin_workflow_overrides', 'workflow_idempotency_receipts', 'client_project_access',
    'project_payments', 'finance_transactions', 'finance_budgets', 'employee_compensation',
    'employee_ledger', 'profiles', 'tasks', 'notifications', 'conversations',
    'conversation_members', 'messages', 'message_attachments', 'message_mentions',
    'message_reactions', 'revision_items', 'revision_attachments', 'revision_activity'
  ];
  v_view text;
  v_client_views text[] := array[
    'client_project_summaries', 'client_revision_requests', 'client_revision_items',
    'client_revision_attachments', 'client_revision_activity'
  ];
  v_invoker boolean;
begin
  -- Assert RLS is active on all protected tables
  foreach t in array v_protected loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception 'phase6_cutover_failed: RLS is not enabled on public.%', t;
    end if;

    -- Assert no broad unconditional policies for authenticated
    if exists (
      select 1 from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid = p.polrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t
        and (
          coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~* '^\(?true\)?$'
          or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~* '^\(?true\)?$'
        )
    ) then
      raise exception 'phase6_cutover_failed: broad unconditional policy found on public.%', t;
    end if;
  end loop;

  -- Assert security_invoker = true on all five client projection views
  foreach v_view in array v_client_views loop
    select ('security_invoker=true' = any(c.reloptions)) into v_invoker
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_view;

    if v_invoker is distinct from true then
      raise exception 'phase6_cutover_failed: client view % is not security_invoker', v_view;
    end if;
  end loop;
end
$phase6_security_hardening$;

-- 3. Clean up transient schema privileges on owner roles
revoke create on schema public from phase6_workflow_rpc_owner;
revoke create on schema public from phase6_app_security_owner;

-- Ensure private auth UID bridge is not directly callable by clients
revoke all on function public.phase6_auth_uid() from public, anon, authenticated;

-- ============================================================================
-- D. FINAL CANONICAL INVARIANT ASSERTIONS
-- ============================================================================

do $phase6_final_verification$
declare
  v_proj public.projects%rowtype;
  v_owner_oid oid;
  v_expected_rpc_signatures text[] := array[
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
  v_sig text;
  v_proc_oid oid;
  v_rpc_count integer;
begin
  select oid into v_owner_oid from pg_catalog.pg_roles where rolname = 'phase6_workflow_rpc_owner';

  -- 1. All existing projects must satisfy canonical tuple invariants (actionable error reporting)
  for v_proj in select * from public.projects loop
    begin
      perform public._workflow_validate_tuple(v_proj);
    exception when others then
      raise exception 'phase6_cutover_blocked_invalid_workflow_tuple: project % (%): %',
        v_proj.project_number, v_proj.id, sqlerrm
        using errcode = sqlstate;
    end;
  end loop;

  -- 2. Confirm exactly 11 canonical mutation RPCs exist with exact signatures, owner, and permissions
  foreach v_sig in array v_expected_rpc_signatures loop
    v_proc_oid := coalesce(to_regprocedure('public.' || v_sig), to_regprocedure(v_sig));
    if v_proc_oid is null then
      raise exception 'phase6_cutover_failed: final check - canonical RPC signature missing: %', v_sig using errcode = '42883';
    end if;
    if (select proowner from pg_catalog.pg_proc where oid = v_proc_oid) <> v_owner_oid then
      raise exception 'phase6_cutover_failed: final check - canonical RPC not owned by phase6_workflow_rpc_owner: %', v_sig using errcode = '42501';
    end if;
    if not has_function_privilege('authenticated', v_proc_oid, 'EXECUTE') then
      raise exception 'phase6_cutover_failed: final check - authenticated lacks EXECUTE on %', v_sig using errcode = '42501';
    end if;
    if has_function_privilege('anon', v_proc_oid, 'EXECUTE') then
      raise exception 'phase6_cutover_failed: final check - anon has EXECUTE on %', v_sig using errcode = '42501';
    end if;
  end loop;

  -- Confirm no extra canonical mutation RPC overloads exist
  select count(*) into v_rpc_count
  from pg_catalog.pg_proc p
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
    ]);
  if v_rpc_count <> 11 then
    raise exception 'phase6_cutover_failed: final check - unexpected RPC overloads found (count: %, expected 11)', v_rpc_count using errcode = '42P13';
  end if;

  -- 3. Assert no role other than postgres is a member of either dedicated owner role
  if exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles r on r.oid = m.roleid
    join pg_catalog.pg_roles mem on mem.oid = m.member
    where r.rolname in ('phase6_workflow_rpc_owner', 'phase6_app_security_owner')
      and mem.rolname <> 'postgres'
  ) then
    raise exception 'phase6_cutover_failed: unexpected member in dedicated owner role' using errcode = '42501';
  end if;

  -- Assert that any postgres membership does not provide inheritance or SET capability
  if exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles r on r.oid = m.roleid
    join pg_catalog.pg_roles mem on mem.oid = m.member
    where r.rolname in ('phase6_workflow_rpc_owner', 'phase6_app_security_owner')
      and mem.rolname = 'postgres'
      and (
        coalesce(m.inherit_option, false)
        or coalesce(m.set_option, false)
      )
  ) or pg_has_role('postgres', 'phase6_workflow_rpc_owner', 'USAGE')
    or pg_has_role('postgres', 'phase6_workflow_rpc_owner', 'SET')
    or pg_has_role('postgres', 'phase6_app_security_owner', 'USAGE')
    or pg_has_role('postgres', 'phase6_app_security_owner', 'SET')
  then
    raise exception 'phase6_cutover_failed: postgres retains usable privilege on owner roles' using errcode = '42501';
  end if;

  -- 4. Assert neither owner role has CREATE on schema public
  if has_schema_privilege('phase6_workflow_rpc_owner', 'public', 'CREATE')
     or has_schema_privilege('phase6_app_security_owner', 'public', 'CREATE') then
    raise exception 'phase6_cutover_failed: owner roles retain CREATE privilege on schema public' using errcode = '42501';
  end if;
end
$phase6_final_verification$;

-- ============================================================================
-- E. CUTOVER COMPLETION MARKER
-- ============================================================================

notify pgrst, 'reload schema';
comment on schema public is 'Phase 6 canonical workflow cutover finalized. Migration 00500 executed successfully.';

commit;
