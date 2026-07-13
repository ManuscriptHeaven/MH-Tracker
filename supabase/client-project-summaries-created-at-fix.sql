-- Fixes client dashboards showing empty when the app sorts client projects.

create or replace view public.client_project_summaries as
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
  project.updated_at,
  project.created_at
from public.projects project
where public.client_has_project_access(project.id, auth.uid());

grant select on public.client_project_summaries to authenticated;
