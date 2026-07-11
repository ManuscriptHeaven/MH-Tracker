create or replace function public.current_user_is_client()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role()::text = 'client';
$$;

create or replace function public.client_has_project_access(project_id uuid, client_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.client_project_access access
    join public.profiles client on client.id = access.client_id
    where access.project_id = client_has_project_access.project_id
      and access.client_id = client_has_project_access.client_id
      and client.role::text = 'client'
      and client.status = 'active'
  );
$$;

create or replace function public.user_can_access_revision_request(request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.revision_requests request
    where request.id = user_can_access_revision_request.request_id
      and (
        public.can_manage_all_projects()
        or request.assigned_to = auth.uid()
        or request.client_id = auth.uid()
      )
  );
$$;

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
  project.updated_at
from public.projects project
where public.client_has_project_access(project.id, auth.uid());

create or replace view public.client_revision_requests as
select
  request.id,
  request.project_id,
  request.client_id,
  request.title,
  request.description,
  request.instructions,
  request.team_response,
  request.priority,
  request.status,
  request.submitted_at,
  request.completed_at,
  request.created_at,
  request.updated_at
from public.revision_requests request
where request.client_id = auth.uid();

create or replace view public.client_revision_items as
select
  item.id,
  item.revision_request_id,
  item.sort_order,
  item.page_reference,
  item.instruction,
  item.status,
  item.client_attachment_url,
  item.team_response,
  item.created_at,
  item.updated_at
from public.revision_items item
join public.revision_requests request on request.id = item.revision_request_id
where request.client_id = auth.uid();

create or replace view public.client_revision_attachments as
select
  attachment.id,
  attachment.revision_request_id,
  attachment.revision_item_id,
  attachment.file_name,
  attachment.file_url,
  attachment.file_type,
  attachment.uploaded_by,
  attachment.created_at
from public.revision_attachments attachment
join public.revision_requests request on request.id = attachment.revision_request_id
where request.client_id = auth.uid();

create or replace view public.client_revision_activity as
select
  activity.id,
  activity.revision_request_id,
  activity.user_id,
  activity.action,
  activity.previous_value,
  activity.new_value,
  activity.created_at
from public.revision_activity activity
join public.revision_requests request on request.id = activity.revision_request_id
where request.client_id = auth.uid();

grant select on public.client_project_summaries to authenticated;
grant select on public.client_revision_requests to authenticated;
grant select on public.client_revision_items to authenticated;
grant select on public.client_revision_attachments to authenticated;
grant select on public.client_revision_activity to authenticated;

revoke all on function public.current_user_is_client() from public;
revoke all on function public.client_has_project_access(uuid, uuid) from public;
revoke all on function public.user_can_access_revision_request(uuid) from public;
grant execute on function public.current_user_is_client() to authenticated;
grant execute on function public.client_has_project_access(uuid, uuid) to authenticated;
grant execute on function public.user_can_access_revision_request(uuid) to authenticated;
