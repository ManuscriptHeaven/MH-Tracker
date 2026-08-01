create or replace function public.notify_revision_watchers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_name text;
  client_name text;
begin
  select project_title into project_name
  from public.projects
  where id = new.project_id;

  select full_name into client_name
  from public.profiles
  where id = new.client_id;

  if tg_op = 'INSERT' then
    insert into public.revision_activity (revision_request_id, user_id, action, previous_value, new_value)
    values (new.id, auth.uid(), 'Revision submitted', null, new.title);

    insert into public.notifications (
      recipient_id,
      project_id,
      revision_request_id,
      type,
      title,
      message
    )
    select
      profile.id,
      new.project_id,
      new.id,
      'revision_submitted',
      'Client Revision Submitted',
      coalesce(client_name, 'A client') || ' submitted a revision request for ' ||
        coalesce(project_name, 'a project') || ': ' || new.title || '.'
    from public.profiles profile
    where profile.status = 'active'
      and profile.role::text in ('admin', 'manager', 'project_manager');

    return new;
  end if;

  if old.assigned_to is distinct from new.assigned_to and new.assigned_to is not null then
    insert into public.revision_activity (revision_request_id, user_id, action, previous_value, new_value)
    values (new.id, auth.uid(), 'Assigned employee changed', old.assigned_to::text, new.assigned_to::text);

    insert into public.notifications (
      recipient_id,
      project_id,
      revision_request_id,
      type,
      title,
      message
    )
    values (
      new.assigned_to,
      new.project_id,
      new.id,
      'revision_assigned',
      'Revision Assigned',
      'You have been assigned a revision request for ' || coalesce(project_name, 'a project') || '.'
    );
  end if;

  if old.status is distinct from new.status then
    insert into public.revision_activity (revision_request_id, user_id, action, previous_value, new_value)
    values (new.id, auth.uid(), 'Revision status changed', old.status, new.status);

    insert into public.notifications (
      recipient_id,
      project_id,
      revision_request_id,
      type,
      title,
      message
    )
    values (
      new.client_id,
      new.project_id,
      new.id,
      'revision_status_changed',
      'Revision Status Updated',
      'Your revision request for ' || coalesce(project_name, 'a project') ||
        ' changed from ' || old.status || ' to ' || new.status || '.'
    );
  end if;

  return new;
end;
$$;

create or replace function public.set_revision_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('Approved', 'Completed') and old.status is distinct from new.status and new.completed_at is null then
    new.completed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists set_revision_completed_at_trigger on public.revision_requests;
create trigger set_revision_completed_at_trigger
before update on public.revision_requests
for each row execute function public.set_revision_completed_at();

drop trigger if exists revision_request_notifications_trigger on public.revision_requests;
create trigger revision_request_notifications_trigger
after insert or update on public.revision_requests
for each row execute function public.notify_revision_watchers();

create or replace function public.notify_revised_proof_uploaded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.revision_requests%rowtype;
  project_name text;
begin
  if new.file_type <> 'revised_proof' then
    return new;
  end if;

  select * into request_row
  from public.revision_requests
  where id = new.revision_request_id;

  select project_title into project_name
  from public.projects
  where id = request_row.project_id;

  insert into public.revision_activity (revision_request_id, user_id, action, previous_value, new_value)
  values (new.revision_request_id, new.uploaded_by, 'Revised proof uploaded', null, new.file_name);

  insert into public.notifications (
    recipient_id,
    project_id,
    revision_request_id,
    type,
    title,
    message
  )
  values (
    request_row.client_id,
    request_row.project_id,
    request_row.id,
    'revised_proof_uploaded',
    'Revised Proof Uploaded',
    'A revised proof was uploaded for ' || coalesce(project_name, 'your project') || '.'
  );

  return new;
end;
$$;

drop trigger if exists revised_proof_uploaded_trigger on public.revision_attachments;
create trigger revised_proof_uploaded_trigger
after insert on public.revision_attachments
for each row execute function public.notify_revised_proof_uploaded();

create or replace function public.client_respond_revision(request_id uuid, decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.revision_requests%rowtype;
begin
  if decision not in ('Approved', 'Additional Revision Required') then
    raise exception 'Invalid revision decision.';
  end if;

  select * into request_row
  from public.revision_requests
  where id = request_id
    and client_id = auth.uid()
  for update;

  if not found then
    raise exception 'Revision request not found.';
  end if;

  if request_row.status <> 'Ready for Client Review' then
    raise exception 'This revision is not ready for client review yet.';
  end if;

  update public.revision_requests
  set
    status = decision,
    completed_at = case when decision = 'Approved' then now() else completed_at end
  where id = request_id;
end;
$$;

revoke all on function public.notify_revision_watchers() from public;
revoke all on function public.set_revision_completed_at() from public;
revoke all on function public.notify_revised_proof_uploaded() from public;
revoke all on function public.client_respond_revision(uuid, text) from public;
grant execute on function public.client_respond_revision(uuid, text) to authenticated;
