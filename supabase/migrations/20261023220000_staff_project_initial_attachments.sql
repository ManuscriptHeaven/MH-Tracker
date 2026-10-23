-- Optional staff-uploaded source attachments at project creation.
-- Reuses the existing PRIVATE project-source-files bucket and project_initial_files
-- table. Client submission RPC and Files Received stage transitions are unchanged.
-- RELEASE GATE: test with disposable admin, manager, employee, client sessions
-- on certified staging before applying to production.
begin;

grant insert on table public.project_initial_files to authenticated;

drop policy if exists project_initial_files_staff_insert on public.project_initial_files;
create policy project_initial_files_staff_insert on public.project_initial_files
for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and public.phase6_app_actor_class() in ('admin', 'project_manager')
  and public.phase6_team_can_access_project(project_id)
  and split_part(storage_path, '/', 1) = project_id::text
  and split_part(storage_path, '/', 2) = (select auth.uid())::text
  and file_size > 0
  and file_size <= 104857600
);

-- Existing select policy grants only members of the linked project access.
-- Existing storage.objects RLS restricts source-file upload to project members
-- and requires the uploader's auth.uid() in the second path segment.
-- Do not broaden storage policies, switch to public storage, or trigger
-- submitInitialFiles / startDesignConcept on staff attachment upload.

commit;
