-- Fix client canonical workflow mutations that were always sending workflow_version=0.
-- get_client_project_summaries() originally omitted the optimistic-lock version,
-- while the frontend normalizes a missing client workflow_version to 0.
-- Canonical workflow RPCs therefore rejected valid client approvals as stale.

drop view if exists public.client_project_summaries;
drop function if exists public.get_client_project_summaries();

create function public.get_client_project_summaries()
returns table (
  id uuid,
  project_number text,
  project_title text,
  client_name text,
  service_type text,
  genre text,
  priority public.project_priority,
  project_status public.project_lifecycle_status,
  workflow_stage_key public.workflow_stage,
  workflow_stage_status_key public.workflow_stage_status,
  workflow_waiting_on_key public.workflow_waiting_on,
  workflow_version bigint,
  status public.project_status,
  current_stage text,
  stage_status text,
  waiting_on text,
  timeline_status text,
  progress_percentage integer,
  client_action_required text,
  start_date date,
  due_date date,
  stage_started_at timestamptz,
  stage_due_at timestamptz,
  stage_completed_at timestamptz,
  final_due_at timestamptz,
  delivered_at timestamptz,
  files_received_date date,
  design_concept_due_date date,
  design_concept_submitted_date date,
  design_concept_approval_date date,
  concept_revision_due_date date,
  print_version_due_date date,
  print_version_submitted_date date,
  print_version_approval_date date,
  print_revision_due_date date,
  ebook_due_date date,
  ebook_submitted_date date,
  ebook_approval_date date,
  final_delivery_date date,
  delivery_date date,
  revision_count integer,
  source_file_link text,
  proof_pdf_link text,
  final_print_pdf_link text,
  final_ebook_link text,
  cover_file_link text,
  client_brief_link text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select
    p.id,p.project_number,p.project_title,p.client_name,p.service_type,p.genre,p.priority,
    p.project_status,p.workflow_stage_key,p.workflow_stage_status_key,p.workflow_waiting_on_key,
    p.workflow_version,
    p.status,p.current_stage,p.stage_status,p.waiting_on,p.timeline_status,p.progress_percentage,
    p.client_action_required,p.start_date,p.due_date,p.stage_started_at,p.stage_due_at,
    p.stage_completed_at,p.final_due_at,p.delivered_at,p.files_received_date,
    p.design_concept_due_date,p.design_concept_submitted_date,p.design_concept_approval_date,
    p.concept_revision_due_date,p.print_version_due_date,p.print_version_submitted_date,
    p.print_version_approval_date,p.print_revision_due_date,p.ebook_due_date,
    p.ebook_submitted_date,p.ebook_approval_date,p.final_delivery_date,p.delivery_date,
    p.revision_count,p.source_file_link,p.proof_pdf_link,p.final_print_pdf_link,
    p.final_ebook_link,p.cover_file_link,p.client_brief_link,p.created_at,p.updated_at
  from public.projects p
  where public.client_has_project_access(p.id,public.phase6_auth_uid())
$fn$;

revoke all on function public.get_client_project_summaries() from public, anon, authenticated;
grant execute on function public.get_client_project_summaries() to authenticated;

create view public.client_project_summaries with (security_invoker=true) as
select c.id,c.project_number,c.project_title,c.client_name,c.service_type,c.genre,c.priority,
  c.project_status,c.workflow_stage_key,c.workflow_stage_status_key,c.workflow_waiting_on_key,
  c.workflow_version,
  c.status,c.current_stage,c.stage_status,c.waiting_on,c.timeline_status,c.progress_percentage,
  c.client_action_required,c.start_date,c.due_date,c.stage_started_at,c.stage_due_at,
  c.stage_completed_at,c.final_due_at,c.delivered_at,c.files_received_date,
  c.design_concept_due_date,c.design_concept_submitted_date,c.design_concept_approval_date,
  c.concept_revision_due_date,c.print_version_due_date,c.print_version_submitted_date,
  c.print_version_approval_date,c.print_revision_due_date,c.ebook_due_date,
  c.ebook_submitted_date,c.ebook_approval_date,c.final_delivery_date,c.delivery_date,
  c.revision_count,c.source_file_link,c.proof_pdf_link,c.final_print_pdf_link,
  c.final_ebook_link,c.cover_file_link,c.client_brief_link,c.created_at,c.updated_at
from public.get_client_project_summaries() c;

revoke all on public.client_project_summaries from public, anon, authenticated;
grant select on public.client_project_summaries to authenticated;

notify pgrst, 'reload schema';
