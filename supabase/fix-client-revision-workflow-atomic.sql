-- ==========================================================
-- MH TRACKER — Client Revision Atomic Workflow Fix
-- ==========================================================
-- Fixes the critical bug where client revision requests create
-- the revision record but do NOT update the project workflow state.
--
-- Root causes addressed:
-- 1. Client role cannot UPDATE projects table directly (RLS).
-- 2. Existing trigger did not set stage_status = 'REVISION_ACTIVE'.
-- 3. client_project_summaries view did not expose stage_status,
--    stage_due_at, or revision_count so clients always saw stale state.
--
-- Solution:
-- A single SECURITY DEFINER RPC function that performs all steps
-- atomically in the same transaction, bypassing client RLS restrictions.
-- ==========================================================

-- -----------------------------------------------------------
-- Step 1: Drop the old broken trigger (replaced by RPC below)
-- -----------------------------------------------------------
drop trigger if exists mark_project_revision_requested_trigger on public.revision_requests;
drop function if exists public.mark_project_revision_requested();

-- -----------------------------------------------------------
-- Step 2: New atomic RPC — submit_client_revision
--         Called by the frontend instead of individual inserts.
--         Runs as SECURITY DEFINER so it can update projects.
-- -----------------------------------------------------------
create or replace function public.submit_client_revision(
  p_project_id    uuid,
  p_client_id     uuid,
  p_title         text,
  p_description   text,
  p_instructions  text,
  p_priority      text default 'Normal'
)
returns uuid          -- returns the new revision_request.id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id      uuid := gen_random_uuid();
  v_project         public.projects%rowtype;
  v_revision_count  integer;
  v_stage_due_at    timestamptz;
  v_revision_days   integer := 2;
  v_now             timestamptz := now();
  v_status_value    text;
begin
  -- -------------------------------------------------------
  -- Verify the client actually has access to this project
  -- -------------------------------------------------------
  if not public.client_has_project_access(p_project_id, p_client_id) then
    raise exception 'Project not found or access denied.';
  end if;

  -- -------------------------------------------------------
  -- Load the project
  -- -------------------------------------------------------
  select * into v_project
  from public.projects
  where id = p_project_id
  for update;  -- lock the row for the transaction

  if not found then
    raise exception 'Project % not found.', p_project_id;
  end if;

  -- -------------------------------------------------------
  -- Determine revision days from workflow_settings
  -- -------------------------------------------------------
  v_revision_days := coalesce(
    case
      when v_project.current_stage in ('Concept Approval', 'Awaiting Concept Approval')
        then (v_project.workflow_settings->>'design_concept_revision_days')::integer
      when v_project.current_stage in ('Print Approval', 'Awaiting Print Approval')
        then (v_project.workflow_settings->>'print_version_revision_days')::integer
      when v_project.current_stage in ('Ebook Approval', 'eBook Review')
        then (v_project.workflow_settings->>'ebook_version_revision_days')::integer
      else 2
    end,
    2
  );

  -- -------------------------------------------------------
  -- Determine due date (business days — simple calendar add)
  -- -------------------------------------------------------
  v_stage_due_at := v_now + (v_revision_days * interval '1 day');

  -- -------------------------------------------------------
  -- Increment revision counter
  -- -------------------------------------------------------
  v_revision_count := coalesce(v_project.revision_count, 0) + 1;

  -- -------------------------------------------------------
  -- Map the status to the correct 'In Revision' enum value
  -- -------------------------------------------------------
  v_status_value := 'In Revision';

  -- -------------------------------------------------------
  -- 1. Insert the revision request
  -- -------------------------------------------------------
  insert into public.revision_requests (
    id,
    project_id,
    client_id,
    title,
    description,
    instructions,
    team_response,
    priority,
    status,
    submitted_at,
    created_at,
    updated_at
  ) values (
    v_request_id,
    p_project_id,
    p_client_id,
    coalesce(nullif(trim(p_title), ''), 'Revision request for ' || v_project.project_title),
    coalesce(nullif(trim(p_description), ''), p_instructions),
    p_instructions,
    null,
    p_priority,
    'Submitted',
    v_now,
    v_now,
    v_now
  );

  -- -------------------------------------------------------
  -- 2. Update project workflow state — ATOMICALLY
  --    This bypasses RLS because the function is SECURITY DEFINER
  -- -------------------------------------------------------
  update public.projects
  set
    status              = v_status_value::public.project_status,
    stage_status        = 'REVISION_ACTIVE',
    waiting_on          = 'Manuscript Heaven',
    timeline_status     = 'Active',
    client_action_required = '',
    revision_count      = v_revision_count,
    stage_started_at    = v_now,
    stage_due_at        = v_stage_due_at,
    updated_at          = v_now
  where id = p_project_id;

  -- -------------------------------------------------------
  -- 3. Log stage history
  -- -------------------------------------------------------
  insert into public.project_stage_history (
    project_id, stage, status, started_at, due_at, actor_id, action, notes
  ) values (
    p_project_id,
    coalesce(v_project.current_stage, 'Unknown Stage'),
    'REVISION_ACTIVE',
    v_now,
    v_stage_due_at,
    p_client_id,
    'Client requested revision #' || v_revision_count || ' for ' || coalesce(v_project.current_stage, 'Unknown Stage'),
    p_instructions
  );

  -- -------------------------------------------------------
  -- 4. Create notifications for assigned employee, manager, all admins
  -- -------------------------------------------------------
  insert into public.notifications (
    recipient_id,
    project_id,
    type,
    title,
    message
  )
  select
    p.id,
    p_project_id,
    'revision_requested',
    'Revision Requested: ' || v_project.project_title,
    'Client requested ' || coalesce(v_project.current_stage, 'stage') || ' revision #' ||
    v_revision_count || '. ' || v_revision_days || ' production day' ||
    case when v_revision_days = 1 then '' else 's' end || ' allocated. Due: ' ||
    to_char(v_stage_due_at, 'Mon DD, YYYY') || '.'
  from public.profiles p
  where
    p.status = 'active'
    and p.id != p_client_id
    and (
      p.role::text in ('admin', 'manager', 'project_manager')
      or p.id = v_project.assigned_to
      or p.id = v_project.project_manager
    );

  return v_request_id;
end;
$$;

-- Grant execute to authenticated users (client role will call this)
revoke all on function public.submit_client_revision(uuid, uuid, text, text, text, text) from public;
grant execute on function public.submit_client_revision(uuid, uuid, text, text, text, text) to authenticated;

-- -----------------------------------------------------------
-- Step 3: Update client_project_summaries view to include
--         stage_status, stage_due_at, and revision_count
--         so clients see the actual real-time workflow state.
-- -----------------------------------------------------------
drop view if exists public.client_project_summaries;

create or replace view public.client_project_summaries
with (security_invoker = false)
as
select
  project.id,
  project.project_number,
  project.project_title,
  project.client_name,
  project.client_email,
  project.service_type,
  project.genre,
  project.priority,
  project.due_date,
  project.status,
  project.proof_pdf_link,
  project.final_print_pdf_link,
  project.final_ebook_link,
  project.cover_file_link,
  project.source_file_link,
  project.drive_folder_link,
  project.client_brief_link,
  project.other_links,
  project.client_instructions,
  project.general_notes,
  project.delivery_notes,
  project.files_received_date,
  project.design_concept_due_date,
  project.design_concept_due_date_manual,
  project.design_concept_submitted_date,
  project.design_concept_approval_date,
  project.concept_revision_due_date,
  project.print_version_due_date,
  project.print_version_due_date_manual,
  project.print_version_submitted_date,
  project.print_version_approval_date,
  project.print_revision_due_date,
  project.ebook_due_date,
  project.ebook_due_date_manual,
  project.ebook_submitted_date,
  project.ebook_approval_date,
  project.final_delivery_date,
  project.current_stage,
  project.stage_status,           -- NEW: REVISION_ACTIVE / PAUSED_CLIENT_REVIEW / ACTIVE
  project.stage_due_at,           -- NEW: revision or stage due date
  project.stage_started_at,       -- NEW: when current stage / revision started
  project.revision_count,         -- NEW: number of revisions requested
  project.progress_percentage,
  project.waiting_on,
  project.timeline_status,
  project.client_action_required,
  project.print_timeline_days,
  project.workflow_settings,
  project.assigned_to,
  project.project_manager,
  project.updated_at,
  project.created_at
from public.projects project
where public.client_has_project_access(project.id, auth.uid());

grant select on public.client_project_summaries to authenticated;

-- -----------------------------------------------------------
-- Step 4: Make sure projects is in realtime publication
--         (idempotent — safe to re-run)
-- -----------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'revision_requests'
  ) then
    alter publication supabase_realtime add table public.revision_requests;
  end if;
end;
$$;

-- -----------------------------------------------------------
-- Step 5: uploadRevisedProof also uses a direct project update
--         as a team member. That's fine (team has UPDATE on projects).
--         But we also want it to correctly set stage_status.
--         Add a helper RPC for team-submitted revised proofs:
-- -----------------------------------------------------------
create or replace function public.submit_revised_proof(
  p_request_id    uuid,
  p_file_name     text,
  p_file_url      text,
  p_uploader_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request   public.revision_requests%rowtype;
  v_project   public.projects%rowtype;
  v_now       timestamptz := now();
begin
  -- Load the revision request
  select * into v_request
  from public.revision_requests
  where id = p_request_id;

  if not found then
    raise exception 'Revision request % not found.', p_request_id;
  end if;

  -- Load the project
  select * into v_project
  from public.projects
  where id = v_request.project_id
  for update;

  -- Insert the revised proof attachment
  insert into public.revision_attachments (
    revision_request_id, revision_item_id, file_name, file_url, file_type, uploaded_by
  ) values (
    p_request_id, null, p_file_name, p_file_url, 'revised_proof', p_uploader_id
  );

  -- Update revision request status to 'Ready for Client Review'
  update public.revision_requests
  set
    status     = 'Ready for Client Review',
    updated_at = v_now
  where id = p_request_id;

  -- Update project: back to PAUSED_CLIENT_REVIEW — awaiting client approval again
  update public.projects
  set
    stage_status           = 'PAUSED_CLIENT_REVIEW',
    waiting_on             = 'Client',
    timeline_status        = 'Paused',
    client_action_required = 'Review the updated proof and approve or request further changes.',
    updated_at             = v_now
  where id = v_request.project_id;

  -- Notify the client
  insert into public.notifications (
    recipient_id, project_id, type, title, message
  ) values (
    v_request.client_id,
    v_request.project_id,
    'revision_submitted',
    'Revision Completed: ' || coalesce(v_project.project_title, 'Your project'),
    'Your requested revision has been completed and is ready for your review.'
  );

  -- Log stage history
  insert into public.project_stage_history (
    project_id, stage, status, started_at, actor_id, action
  ) values (
    v_request.project_id,
    coalesce(v_project.current_stage, 'Unknown Stage'),
    'PAUSED_CLIENT_REVIEW',
    v_now,
    p_uploader_id,
    'Revised proof submitted for client review'
  );
end;
$$;

revoke all on function public.submit_revised_proof(uuid, text, text, uuid) from public;
grant execute on function public.submit_revised_proof(uuid, text, text, uuid) to authenticated;
