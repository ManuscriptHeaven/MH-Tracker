-- Run this in Supabase SQL Editor after the client portal tables are installed.
-- It keeps project status in sync with client revision requests and makes sure
-- client revision file uploads use the expected private storage bucket.

insert into storage.buckets (id, name, public)
values ('revision-files', 'revision-files', false)
on conflict (id) do nothing;

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
  where id = new.project_id
    and (
      status is distinct from revision_stage::public.project_status
      or current_stage is distinct from revision_stage
      or waiting_on is distinct from 'Manuscript Heaven'
      or timeline_status is distinct from 'Active'
      or client_action_required is distinct from ''
    );

  return new;
end;
$$;

drop trigger if exists mark_project_revision_requested_trigger on public.revision_requests;
create trigger mark_project_revision_requested_trigger
after insert on public.revision_requests
for each row execute function public.mark_project_revision_requested();

-- Keep dashboard cards current for every signed-in team member. The checks
-- make this safe to run again when the tables are already in the publication.
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

drop policy if exists "Clients can read own revision files" on storage.objects;
create policy "Clients can read own revision files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'revision-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Team can read assigned revision files" on storage.objects;
create policy "Team can read assigned revision files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'revision-files'
  and (
    public.can_manage_all_projects()
    or exists (
      select 1
      from public.revision_requests request
      where request.id::text = (storage.foldername(name))[3]
        and request.assigned_to = auth.uid()
    )
  )
);

drop policy if exists "Clients can upload own revision files" on storage.objects;
create policy "Clients can upload own revision files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'revision-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Team can upload assigned revision files" on storage.objects;
create policy "Team can upload assigned revision files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'revision-files'
  and (
    public.can_manage_all_projects()
    or exists (
      select 1
      from public.revision_requests request
      where request.id::text = (storage.foldername(name))[3]
        and request.assigned_to = auth.uid()
    )
  )
);

drop policy if exists "Admins can delete revision files" on storage.objects;
create policy "Admins can delete revision files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'revision-files'
  and public.current_user_role() = 'admin'
);
