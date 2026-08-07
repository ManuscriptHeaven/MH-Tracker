-- Run this once in the Supabase SQL Editor for existing deployments.
-- A client can create revision requests but does not have permission to update
-- projects directly, so the database performs the project transition safely.

create or replace function public.mark_project_revision_requested()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  revision_stage text;
begin
  select case
    when current_stage in ('Awaiting Concept Approval', 'Design Concept in Progress', 'Concept Revisions')
      then 'Concept Revisions'
    else 'Print Revisions'
  end
  into revision_stage
  from public.projects
  where id = new.project_id;

  update public.projects
  set
    status = revision_stage::public.project_status,
    current_stage = revision_stage,
    waiting_on = 'Manuscript Heaven',
    timeline_status = 'Active',
    client_action_required = '',
    updated_at = now()
  where id = new.project_id;

  return new;
end;
$$;

drop trigger if exists mark_project_revision_requested_trigger on public.revision_requests;
create trigger mark_project_revision_requested_trigger
after insert on public.revision_requests
for each row execute function public.mark_project_revision_requested();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'revision_requests'
  ) then
    alter publication supabase_realtime add table public.revision_requests;
  end if;
end;
$$;
