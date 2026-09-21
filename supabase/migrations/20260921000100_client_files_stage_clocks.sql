-- Client-owned Files Received stage + dynamic project deadlines.

alter table public.projects
  add column if not exists requirements_submitted_at timestamptz;

create table if not exists public.project_initial_files (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  file_name text not null,
  file_type text not null,
  file_size bigint not null check (file_size >= 0),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists project_initial_files_project_id_idx
  on public.project_initial_files(project_id, created_at);

alter table public.project_initial_files enable row level security;

grant select on public.project_initial_files to authenticated;
grant select, insert on public.project_initial_files to phase6_workflow_rpc_owner;

drop policy if exists "Project file viewers can read initial files" on public.project_initial_files;
create policy "Project file viewers can read initial files"
on public.project_initial_files
for select
to authenticated
using (
  public.phase6_team_can_access_project(project_id)
  or public.phase6_client_can_access_project(project_id)
);

drop policy if exists "Workflow owner can manage initial files" on public.project_initial_files;
create policy "Workflow owner can manage initial files"
on public.project_initial_files
for all
to phase6_workflow_rpc_owner
using (current_user = 'phase6_workflow_rpc_owner'::name)
with check (current_user = 'phase6_workflow_rpc_owner'::name);

insert into storage.buckets(id, name, public, file_size_limit)
values ('project-source-files', 'project-source-files', false, 104857600)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "Project members can read source files" on storage.objects;
create policy "Project members can read source files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-source-files'
  and (
    public.phase6_team_can_access_project(
      case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then ((storage.foldername(name))[1])::uuid
        else null
      end
    )
    or public.phase6_client_can_access_project(
      case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then ((storage.foldername(name))[1])::uuid
        else null
      end
    )
  )
);

drop policy if exists "Project members can upload source files" on storage.objects;
create policy "Project members can upload source files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'project-source-files'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (
    public.phase6_team_can_access_project(
      case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then ((storage.foldername(name))[1])::uuid
        else null
      end
    )
    or public.phase6_client_can_access_project(
      case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then ((storage.foldername(name))[1])::uuid
        else null
      end
    )
  )
);

drop policy if exists "Uploaders can delete unsent source files" on storage.objects;
create policy "Uploaders can delete unsent source files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'project-source-files'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (
    public.phase6_team_can_access_project(
      case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then ((storage.foldername(name))[1])::uuid
        else null
      end
    )
    or public.phase6_client_can_access_project(
      case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then ((storage.foldername(name))[1])::uuid
        else null
      end
    )
  )
);

-- Keep compatibility fields honest: pending Files Received means the client
-- still owes files, not that the production team is already working.
create or replace function public._workflow_compatibility_projection(
  p_lifecycle public.project_lifecycle_status,
  p_stage public.workflow_stage,
  p_status public.workflow_stage_status,
  p_waiting public.workflow_waiting_on
)
returns jsonb
language sql
stable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select jsonb_build_object(
    'status', case
      when p_lifecycle = 'completed' then 'Completed'
      when p_lifecycle = 'on_hold' then 'On Hold'
      when p_lifecycle = 'cancelled' then 'Cancelled'
      when p_lifecycle = 'archived' then 'Archived'
      when p_lifecycle is null then null
      when p_stage = 'files_received' and p_status = 'pending' then 'Waiting for Files'
      when p_status = 'awaiting_client' then 'Awaiting Client Approval'
      when p_status = 'revision_active' then 'In Revision'
      when p_stage = 'final_delivery' and p_status = 'active' then 'Final Delivery'
      else 'Active' end,
    'current_stage', (
      select d.display_name
      from public.workflow_stage_definitions d
      where d.stage_key = p_stage
    ),
    'stage_status', case p_status
      when 'active' then 'ACTIVE'
      when 'revision_active' then 'REVISION_ACTIVE'
      when 'awaiting_client' then 'PAUSED_CLIENT_REVIEW'
      when 'pending' then 'PENDING'
      when 'skipped' then 'SKIPPED'
      when 'completed' then 'COMPLETED'
      when 'paused' then 'COMPLETED' end,
    'waiting_on', case
      when p_stage = 'files_received' and p_status = 'pending' then 'Client'
      when p_waiting = 'team' then 'Manuscript Heaven'
      when p_waiting = 'client' then 'Client'
      when p_waiting = 'none' then 'None' end,
    'timeline_status', case
      when p_lifecycle = 'completed' then 'Completed'
      when p_lifecycle = 'on_hold' then 'On Hold'
      when p_lifecycle = 'cancelled' then 'Cancelled'
      when p_lifecycle = 'archived' then 'Paused'
      when p_stage = 'files_received' and p_status = 'pending' then 'Paused'
      when p_status in ('active','revision_active') then 'Active'
      when p_status is not null then 'Paused' end
  )
$function$;

-- Canonical workflow writes now keep the legacy/familiar project due date in
-- sync with final_due_at. Client wait therefore moves the visible project due
-- date automatically when the next workflow mutation is confirmed.
create or replace function public._workflow_write_project(p_expected public.projects)
returns void
language plpgsql
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  update public.projects set
    project_status = p_expected.project_status,
    workflow_stage_key = p_expected.workflow_stage_key,
    workflow_stage_status_key = p_expected.workflow_stage_status_key,
    workflow_waiting_on_key = p_expected.workflow_waiting_on_key,
    requires_print = p_expected.requires_print,
    requires_ebook = p_expected.requires_ebook,
    service_capability_status = p_expected.service_capability_status,
    capabilities_resolved_by = p_expected.capabilities_resolved_by,
    capabilities_resolved_at = p_expected.capabilities_resolved_at,
    workflow_settings = p_expected.workflow_settings,
    stage_started_at = p_expected.stage_started_at,
    stage_due_at = p_expected.stage_due_at,
    stage_completed_at = p_expected.stage_completed_at,
    delivered_at = p_expected.delivered_at,
    final_due_at = p_expected.final_due_at,
    due_date = case
      when p_expected.final_due_at is not null
        then (p_expected.final_due_at at time zone 'Asia/Karachi')::date
      else p_expected.due_date
    end,
    internal_deadline = case
      when p_expected.final_due_at is not null
        then (p_expected.final_due_at at time zone 'Asia/Karachi')::date
      else p_expected.internal_deadline
    end,
    revision_count = p_expected.revision_count,
    production_seconds_total = p_expected.production_seconds_total,
    client_wait_seconds_total = p_expected.client_wait_seconds_total,
    status = p_expected.status,
    current_stage = p_expected.current_stage,
    stage_status = p_expected.stage_status,
    waiting_on = p_expected.waiting_on,
    timeline_status = p_expected.timeline_status,
    files_received_date = p_expected.files_received_date,
    requirements_submitted_at = p_expected.requirements_submitted_at,
    design_concept_submitted_date = p_expected.design_concept_submitted_date,
    design_concept_approval_date = p_expected.design_concept_approval_date,
    print_version_submitted_date = p_expected.print_version_submitted_date,
    print_version_approval_date = p_expected.print_version_approval_date,
    ebook_submitted_date = p_expected.ebook_submitted_date,
    ebook_approval_date = p_expected.ebook_approval_date,
    concept_revision_due_date = p_expected.concept_revision_due_date,
    print_revision_due_date = p_expected.print_revision_due_date,
    final_delivery_date = p_expected.final_delivery_date,
    delivery_date = p_expected.delivery_date,
    updated_at = p_expected.updated_at
  where id = p_expected.id;

  perform public._workflow_assert_project_projection(p_expected);
  perform public._workflow_assert_milestones(p_expected);
end
$function$;

grant create on schema public to phase6_workflow_rpc_owner;
grant phase6_workflow_rpc_owner to postgres with set true;
set role phase6_workflow_rpc_owner;

create or replace function public.workflow_client_submit_files(
  p_project_id uuid,
  p_expected_workflow_version bigint,
  p_idempotency_key uuid,
  p_files jsonb,
  p_note text default null
)
returns public.workflow_mutation_result
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_actor record;
  v_before public.projects%rowtype;
  v_after public.projects%rowtype;
  v_fingerprint text;
  v_result public.workflow_mutation_result;
  v_mutation_at timestamptz;
  v_local_date date;
  v_production bigint := 0;
  v_client bigint := 0;
  v_events jsonb := '[]';
  v_affected jsonb := '{}';
  v_history uuid[];
  v_notifications uuid[];
  v_manual public.workflow_stage[];
  v_route record;
  v_file jsonb;
  v_file_ids uuid[] := '{}';
  v_file_id uuid;
  v_storage_path text;
  v_history_before bigint;
begin
  select * into v_actor from public._workflow_current_actor();

  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'workflow_project_not_found';
  end if;
  if not public._workflow_can_client_access(p_project_id) then
    raise exception 'workflow_forbidden';
  end if;

  v_before := public._workflow_lock_project(p_project_id);
  if not public._workflow_can_client_access(p_project_id) then
    raise exception 'workflow_forbidden';
  end if;

  v_fingerprint := public._workflow_request_fingerprint(
    'workflow_client_submit_files',
    p_project_id,
    jsonb_build_object(
      'expected_workflow_version', p_expected_workflow_version,
      'files', p_files,
      'note', p_note
    )
  );
  v_result := public._workflow_receipt_lookup(
    'workflow_client_submit_files',
    p_project_id,
    p_idempotency_key,
    v_fingerprint
  );
  if v_result.project_id is not null then
    return v_result;
  end if;

  perform public._workflow_check_version(v_before.workflow_version, p_expected_workflow_version);
  perform public._workflow_validate_tuple(v_before);

  if v_before.project_status is distinct from 'active'::public.project_lifecycle_status
     or v_before.workflow_stage_key <> 'files_received'
     or v_before.workflow_stage_status_key not in ('pending','active') then
    raise exception 'workflow_invalid_state';
  end if;

  if p_files is null or jsonb_typeof(p_files) <> 'array'
     or jsonb_array_length(p_files) = 0
     or jsonb_array_length(p_files) > 10 then
    raise exception 'workflow_invalid_file_submission';
  end if;

  perform public._workflow_lock_mutation_rows(p_project_id);
  v_after := v_before;
  v_manual := public._workflow_checked_manual_skips(p_project_id);
  select count(*) into v_history_before
  from public.project_stage_history h
  where h.project_id = p_project_id;

  v_mutation_at := clock_timestamp();
  v_local_date := (v_mutation_at at time zone 'Asia/Karachi')::date;

  select d.production_seconds_delta, d.client_wait_seconds_delta
    into v_production, v_client
  from public._workflow_interval_delta(
    p_project_id,
    v_before.workflow_stage_status_key,
    v_before.stage_started_at,
    v_mutation_at,
    v_before.workflow_settings
  ) d;

  for v_file in
    select value from jsonb_array_elements(p_files)
  loop
    v_file_id := nullif(v_file->>'id','')::uuid;
    v_storage_path := nullif(v_file->>'storage_path','');

    if v_file_id is null
       or nullif(v_file->>'file_name','') is null
       or nullif(v_file->>'file_type','') is null
       or v_storage_path is null
       or greatest(coalesce((v_file->>'file_size')::bigint,0),0) > 104857600 then
      raise exception 'workflow_invalid_file_submission';
    end if;

    if v_storage_path not like p_project_id::text || '/' || v_actor.actor_id::text || '/%' then
      raise exception 'workflow_invalid_file_submission';
    end if;

    insert into public.project_initial_files(
      id, project_id, uploaded_by, file_name, file_type, file_size, storage_path, created_at
    )
    values(
      v_file_id,
      p_project_id,
      v_actor.actor_id,
      v_file->>'file_name',
      v_file->>'file_type',
      greatest(coalesce((v_file->>'file_size')::bigint,0),0),
      v_storage_path,
      v_mutation_at
    )
    on conflict (id) do nothing;

    v_file_ids := array_append(v_file_ids, v_file_id);
  end loop;

  v_after.files_received_date := coalesce(v_before.files_received_date, v_local_date);
  v_after.requirements_submitted_at := coalesce(v_before.requirements_submitted_at, v_mutation_at);

  select * into v_route
  from public._workflow_next_stage(
    'files_received',
    v_after.requires_print,
    v_after.requires_ebook,
    v_after.service_capability_status,
    v_manual,
    false
  );

  v_after := public._workflow_enter_production(v_after, v_route.next_stage, v_mutation_at);
  v_events := public._workflow_route_events(v_before, v_route.skipped_stages, v_route.skip_reasons)
    || public._workflow_event(
      'stage_entered',
      v_before,
      v_after,
      jsonb_build_object('initial_file_ids', to_jsonb(v_file_ids)),
      jsonb_build_object('source', 'client_file_submission')
    );

  if (select to_jsonb(p) from public.projects p where p.id = p_project_id)
     is distinct from to_jsonb(v_before) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;

  v_after.production_seconds_total := v_before.production_seconds_total + v_production;
  v_after.client_wait_seconds_total := v_before.client_wait_seconds_total + v_client;
  v_after.updated_at := v_mutation_at;
  v_after := jsonb_populate_record(
    v_after,
    public._workflow_compatibility_projection(
      v_after.project_status,
      v_after.workflow_stage_key,
      v_after.workflow_stage_status_key,
      v_after.workflow_waiting_on_key
    )
  );
  v_after.final_due_at := public._workflow_estimate_remaining_production(
    v_after,
    v_mutation_at,
    v_manual,
    case
      when v_after.workflow_stage_status_key = 'revision_active' then v_after.stage_due_at
      else null
    end
  );

  perform public._workflow_validate_tuple(v_after);
  perform public._workflow_write_project(v_after);
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);

  v_history := public._workflow_emit_events(
    p_project_id,
    v_events,
    v_production,
    v_client,
    p_note,
    v_mutation_at,
    p_idempotency_key,
    jsonb_array_length(v_events)
  );

  v_notifications := public._workflow_notify(
    v_after,
    'team',
    'advance_stage',
    null,
    v_mutation_at
  );
  v_affected := jsonb_build_object(
    'initial_file_ids', to_jsonb(v_file_ids),
    'notification_ids', v_notifications
  );

  v_after.workflow_version := v_before.workflow_version + 1;
  update public.projects
  set workflow_version = v_after.workflow_version
  where id = p_project_id;

  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);

  if (select count(*) from public.project_stage_history h where h.project_id=p_project_id)
     <> v_history_before + cardinality(v_history) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;

  v_result := public._workflow_make_result(p_project_id, v_affected, v_history);
  perform public._workflow_receipt_store(
    'workflow_client_submit_files',
    p_project_id,
    p_idempotency_key,
    v_fingerprint,
    v_result,
    v_mutation_at
  );

  return v_result;
end
$function$;

reset role;

revoke all on function public.workflow_client_submit_files(uuid,bigint,uuid,jsonb,text) from public;
revoke all on function public.workflow_client_submit_files(uuid,bigint,uuid,jsonb,text) from anon;
grant execute on function public.workflow_client_submit_files(uuid,bigint,uuid,jsonb,text) to authenticated;

grant phase6_workflow_rpc_owner to postgres with set false;
revoke create on schema public from phase6_workflow_rpc_owner;

-- Sync the visible final due date for existing canonical active projects.
update public.projects
set due_date = (final_due_at at time zone 'Asia/Karachi')::date,
    internal_deadline = (final_due_at at time zone 'Asia/Karachi')::date
where project_status = 'active'
  and final_due_at is not null;
