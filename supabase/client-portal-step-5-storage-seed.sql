insert into storage.buckets (id, name, public)
values ('revision-files', 'revision-files', false)
on conflict (id) do nothing;

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

insert into public.team_members (full_name, email, role, phone, status)
values ('Amelia Carter', 'amelia@example.com', 'client', '', 'active')
on conflict (email) do update set
  full_name = excluded.full_name,
  role = excluded.role,
  phone = excluded.phone,
  status = excluded.status;
