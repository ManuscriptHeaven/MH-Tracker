create or replace function public.create_project_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_name text := coalesce(new.project_title, 'Untitled Project');
begin
  if tg_op = 'INSERT' then
    if new.assigned_to is not null then
      insert into public.notifications (
        recipient_id,
        project_id,
        type,
        title,
        message
      )
      values (
        new.assigned_to,
        new.id,
        'project_assigned',
        'New Project Assigned',
        'You have been assigned a new project: ' || project_name || '.'
      );
    end if;

    return new;
  end if;

  if new.assigned_to is not null
     and old.assigned_to is distinct from new.assigned_to then
    insert into public.notifications (
      recipient_id,
      project_id,
      type,
      title,
      message
    )
    values (
      new.assigned_to,
      new.id,
      'project_assigned',
      'New Project Assigned',
      'You have been assigned a new project: ' || project_name || '.'
    );
  end if;

  if old.assigned_to is not null
     and old.assigned_to is distinct from new.assigned_to then
    insert into public.notifications (
      recipient_id,
      project_id,
      type,
      title,
      message
    )
    values (
      old.assigned_to,
      new.id,
      'project_reassigned',
      'Project Reassigned',
      'Project ' || project_name || ' was reassigned to another employee.'
    );
  end if;

  if old.status is distinct from new.status then
    insert into public.notifications (
      recipient_id,
      project_id,
      type,
      title,
      message
    )
    select
      p.id,
      new.id,
      'status_changed',
      'Project Status Updated',
      'Project ' || project_name ||
      ' status changed from ' || coalesce(old.status::text, 'No Status') ||
      ' to ' || coalesce(new.status::text, 'No Status') || '.'
    from public.profiles p
    where p.status = 'active'
      and p.role::text in ('admin', 'manager', 'project_manager');
  end if;

  return new;
end;
$$;
