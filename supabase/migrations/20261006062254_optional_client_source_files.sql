-- Extend the existing canonical RPC; do not replace its access, version, receipt,
-- timing, routing, history or notification logic. Fail closed on definition drift.
do $migration$
declare
  v_oid oid := 'public.workflow_client_submit_files(uuid,bigint,uuid,jsonb,text)'::regprocedure;
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
    ($old$  v_history_before bigint;$old$, $new$  v_history_before bigint;
  v_submission_note_id uuid;$new$),
    ($old$  if p_files is null or jsonb_typeof(p_files) <> 'array'
     or jsonb_array_length(p_files) = 0
     or jsonb_array_length(p_files) > 10 then
    raise exception 'workflow_invalid_file_submission';
  end if;$old$, $new$  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception 'workflow_invalid_file_submission';
  end if;
  if jsonb_array_length(p_files) > 10 then
    raise exception 'workflow_invalid_file_submission';
  end if;
  if jsonb_array_length(p_files) = 0 and coalesce(p_note, '') !~ '[^[:space:]]' then
    raise exception 'workflow_file_note_required';
  end if;$new$),
    ($old$      jsonb_build_object('source', 'client_file_submission')$old$, $new$      jsonb_build_object('source', case when jsonb_array_length(p_files) = 0
        then 'off_platform_file_confirmation' else 'client_file_submission' end)$new$),
    ($old$  v_notifications := public._workflow_notify($old$, $new$  -- Make the client's message visible in the team's existing project notes.
  -- This is in the same transaction; receipt replay above prevents duplicates.
  if coalesce(p_note, '') ~ '[^[:space:]]' then
    v_submission_note_id := gen_random_uuid();
    insert into public.project_notes(id, project_id, note_type, note, added_by, created_at)
    values (v_submission_note_id, p_project_id, 'client_instruction',
      case when jsonb_array_length(p_files) = 0
        then 'Files provided outside the portal: ' else 'Client file submission: ' end || btrim(p_note),
      v_actor.actor_id, v_mutation_at);
  end if;

  v_notifications := public._workflow_notify($new$),
    ($old$    'notification_ids', v_notifications$old$, $new$    'notification_ids', v_notifications,
    'source_submission_note_id', v_submission_note_id$new$)
  ) as changes(old_text, new_text) loop
    if (length(v_definition) - length(replace(v_definition, v_change.old_text, '')))
       <> length(v_change.old_text) then
      raise exception 'optional_client_source_files_definition_drift';
    end if;
    v_definition := replace(v_definition, v_change.old_text, v_change.new_text);
  end loop;

  execute v_definition;
  if exists (select 1 from pg_proc where oid = v_oid and
    (proowner is distinct from v_owner or proacl is distinct from v_acl or
     proconfig is distinct from v_config or prosecdef is distinct from v_definer)) then
    raise exception 'optional_client_source_files_security_drift';
  end if;
end
$migration$;

-- Only the existing non-login RPC owner needs INSERT; caller permissions/RLS
-- remain unchanged. The RPC checks client access before writing any note.
grant insert on public.project_notes to phase6_workflow_rpc_owner;
create policy phase6_project_notes_client_submission_insert
on public.project_notes for insert to phase6_workflow_rpc_owner
with check (
  current_user = 'phase6_workflow_rpc_owner'
  and note_type = 'client_instruction'
  and added_by = public.phase6_auth_uid()
  and public._workflow_can_client_access(project_id)
);
