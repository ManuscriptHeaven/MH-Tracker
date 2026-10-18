-- Receiving files outside the portal completes intake in one atomic action.
-- Reuse the canonical team RPC so authorization, versioning, replay, clocks,
-- routing, history and notifications retain their existing protections.
do $migration$
declare
  v_oid oid := 'public.workflow_advance_stage(uuid,bigint,uuid,text)'::regprocedure;
  v_definition text := pg_get_functiondef(v_oid);
  v_owner oid;
  v_acl aclitem[];
  v_config text[];
  v_definer boolean;
  v_change record;
begin
  select proowner, proacl, proconfig, prosecdef into v_owner, v_acl, v_config, v_definer
  from pg_proc where oid = v_oid;

  for v_change in select * from (values
    ($old$    from public._workflow_interval_delta(p_project_id,v_before.workflow_stage_status_key,
      v_before.stage_started_at,v_mutation_at,v_before.workflow_settings) d;$old$,
     $new$    -- Intake is client waiting time even for legacy active intake rows.
    from public._workflow_interval_delta(p_project_id,'awaiting_client'::public.workflow_stage_status,
      v_before.stage_started_at,v_mutation_at,v_before.workflow_settings) d;$new$),
    ($old$  perform public._workflow_lock_mutation_rows(p_project_id);$old$,
     $new$  if coalesce(p_note, '') !~ '[^[:space:]]' then
    raise exception 'workflow_file_note_required';
  end if;
  perform public._workflow_lock_mutation_rows(p_project_id);$new$),
    ($old$  if v_before.workflow_stage_status_key = 'pending' then
    v_after := public._workflow_enter_production(v_after,'files_received',v_mutation_at);
  else
    -- Normally Files -> Design. An already client-approved future Design skip
    -- becomes effective here; it must not leave the project running a skipped pair.
    select * into v_route from public._workflow_next_stage(v_before.workflow_stage_key,
      v_before.requires_print,v_before.requires_ebook,v_before.service_capability_status,v_manual,false);
    v_events := public._workflow_route_events(v_before,v_route.skipped_stages,v_route.skip_reasons);
    v_after := public._workflow_enter_production(v_after,v_route.next_stage,v_mutation_at);
  end if;$old$,
     $new$  -- Receipt completes intake for both pending and legacy active states.
  -- Honor any existing client-approved skips through the canonical router.
  select * into v_route from public._workflow_next_stage(v_before.workflow_stage_key,
    v_before.requires_print,v_before.requires_ebook,v_before.service_capability_status,v_manual,false);
  v_events := public._workflow_route_events(v_before,v_route.skipped_stages,v_route.skip_reasons);
  v_after := public._workflow_enter_production(v_after,v_route.next_stage,v_mutation_at);
  v_after.requirements_submitted_at := coalesce(v_before.requirements_submitted_at,v_mutation_at);$new$),
    ($old$  v_events := v_events || public._workflow_event('stage_entered',v_before,v_after,'{}','{}');$old$,
     $new$  v_events := v_events || public._workflow_event('stage_entered',v_before,v_after,'{}',
    jsonb_build_object('source','team_file_receipt_confirmation','portal_upload_skipped',true));$new$)
  ) as changes(old_text, new_text) loop
    if (length(v_definition) - length(replace(v_definition, v_change.old_text, '')))
       <> length(v_change.old_text) then
      raise exception 'team_confirm_received_files_definition_drift';
    end if;
    v_definition := replace(v_definition, v_change.old_text, v_change.new_text);
  end loop;

  execute v_definition;
  if exists (select 1 from pg_proc where oid = v_oid and
    (proowner is distinct from v_owner or proacl is distinct from v_acl or
     proconfig is distinct from v_config or prosecdef is distinct from v_definer)) then
    raise exception 'team_confirm_received_files_security_drift';
  end if;
end
$migration$;
