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
begin
  update public.projects
  set
    status = 'Revision Requested',
    updated_at = now()
  where id = new.project_id
    and status is distinct from 'Revision Requested';

  return new;
end;
$$;

drop trigger if exists mark_project_revision_requested_trigger on public.revision_requests;
create trigger mark_project_revision_requested_trigger
after insert on public.revision_requests
for each row execute function public.mark_project_revision_requested();

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
