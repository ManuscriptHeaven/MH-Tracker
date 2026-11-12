drop policy if exists "Managers can read client project access" on public.client_project_access;
create policy "Managers can read client project access"
on public.client_project_access
for select
to authenticated
using (public.can_manage_all_projects() or client_id = auth.uid());

drop policy if exists "Managers can create client project access" on public.client_project_access;
create policy "Managers can create client project access"
on public.client_project_access
for insert
to authenticated
with check (public.can_manage_all_projects());

drop policy if exists "Managers can update client project access" on public.client_project_access;
create policy "Managers can update client project access"
on public.client_project_access
for update
to authenticated
using (public.can_manage_all_projects())
with check (public.can_manage_all_projects());

drop policy if exists "Managers can delete client project access" on public.client_project_access;
create policy "Managers can delete client project access"
on public.client_project_access
for delete
to authenticated
using (public.can_manage_all_projects());

drop policy if exists "Team can read assigned revision requests" on public.revision_requests;
create policy "Team can read assigned revision requests"
on public.revision_requests
for select
to authenticated
using (public.can_manage_all_projects() or assigned_to = auth.uid());

drop policy if exists "Clients can read own revision requests" on public.revision_requests;
create policy "Clients can read own revision requests"
on public.revision_requests
for select
to authenticated
using (client_id = auth.uid());

drop policy if exists "Clients can submit assigned project revisions" on public.revision_requests;
create policy "Clients can submit assigned project revisions"
on public.revision_requests
for insert
to authenticated
with check (
  client_id = auth.uid()
  and assigned_to is null
  and status = 'Submitted'
  and public.client_has_project_access(project_id, auth.uid())
);

drop policy if exists "Managers can create revision requests" on public.revision_requests;
create policy "Managers can create revision requests"
on public.revision_requests
for insert
to authenticated
with check (public.can_manage_all_projects());

drop policy if exists "Team can update revision requests" on public.revision_requests;
create policy "Team can update revision requests"
on public.revision_requests
for update
to authenticated
using (public.can_manage_all_projects() or assigned_to = auth.uid())
with check (public.can_manage_all_projects() or assigned_to = auth.uid());

drop policy if exists "Admins can delete revision requests" on public.revision_requests;
create policy "Admins can delete revision requests"
on public.revision_requests
for delete
to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "Team can read revision items" on public.revision_items;
create policy "Team can read revision items"
on public.revision_items
for select
to authenticated
using (
  exists (
    select 1
    from public.revision_requests request
    where request.id = revision_items.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

drop policy if exists "Clients can create revision items" on public.revision_items;
create policy "Clients can create revision items"
on public.revision_items
for insert
to authenticated
with check (
  status = 'Open'
  and coalesce(team_response, '') = ''
  and coalesce(internal_note, '') = ''
  and exists (
    select 1
    from public.revision_requests request
    where request.id = revision_items.revision_request_id
      and request.client_id = auth.uid()
      and request.status = 'Submitted'
  )
);

drop policy if exists "Team can create revision items" on public.revision_items;
create policy "Team can create revision items"
on public.revision_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.revision_requests request
    where request.id = revision_items.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

drop policy if exists "Team can update revision items" on public.revision_items;
create policy "Team can update revision items"
on public.revision_items
for update
to authenticated
using (
  exists (
    select 1
    from public.revision_requests request
    where request.id = revision_items.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.revision_requests request
    where request.id = revision_items.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

drop policy if exists "Admins can delete revision items" on public.revision_items;
create policy "Admins can delete revision items"
on public.revision_items
for delete
to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "Team can read revision attachments" on public.revision_attachments;
create policy "Team can read revision attachments"
on public.revision_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.revision_requests request
    where request.id = revision_attachments.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

drop policy if exists "Clients can create revision attachments" on public.revision_attachments;
create policy "Clients can create revision attachments"
on public.revision_attachments
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1
    from public.revision_requests request
    where request.id = revision_attachments.revision_request_id
      and request.client_id = auth.uid()
      and request.status = 'Submitted'
  )
);

drop policy if exists "Team can create revision attachments" on public.revision_attachments;
create policy "Team can create revision attachments"
on public.revision_attachments
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1
    from public.revision_requests request
    where request.id = revision_attachments.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

drop policy if exists "Team can read revision activity" on public.revision_activity;
create policy "Team can read revision activity"
on public.revision_activity
for select
to authenticated
using (
  exists (
    select 1
    from public.revision_requests request
    where request.id = revision_activity.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

drop policy if exists "Clients can create own revision activity" on public.revision_activity;
create policy "Clients can create own revision activity"
on public.revision_activity
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.revision_requests request
    where request.id = revision_activity.revision_request_id
      and request.client_id = auth.uid()
  )
);

drop policy if exists "Team can create revision activity" on public.revision_activity;
create policy "Team can create revision activity"
on public.revision_activity
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.revision_requests request
    where request.id = revision_activity.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);
