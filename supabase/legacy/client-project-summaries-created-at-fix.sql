-- Fixes client dashboards showing empty when the app sorts client projects.
-- The view intentionally exposes only client-safe project fields.

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
  project.due_date,
  project.status,
  project.proof_pdf_link,
  project.final_print_pdf_link,
  project.final_ebook_link,
  project.cover_file_link,
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
  project.progress_percentage,
  project.waiting_on,
  project.timeline_status,
  project.client_action_required,
  project.print_timeline_days,
  project.updated_at,
  project.created_at
from public.projects project
where public.client_has_project_access(project.id, auth.uid());

grant select on public.client_project_summaries to authenticated;

notify pgrst, 'reload schema';
