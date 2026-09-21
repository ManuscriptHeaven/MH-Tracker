-- Atomic team action for reminder draft resolution.
create or replace function public.resolve_project_client_reminder(
  p_reminder_id uuid,
  p_status text
)
returns public.project_client_reminders
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_reminder public.project_client_reminders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'workflow_unauthenticated';
  end if;

  if p_status not in ('sent','dismissed') then
    raise exception 'workflow_invalid_state';
  end if;

  select *
  into v_reminder
  from public.project_client_reminders
  where id = p_reminder_id
  for update;

  if not found then
    raise exception 'workflow_project_not_found';
  end if;

  if not public.phase6_team_can_access_project(v_reminder.project_id) then
    raise exception 'workflow_forbidden';
  end if;

  if v_reminder.status <> 'pending' then
    raise exception 'workflow_invalid_state';
  end if;

  update public.project_client_reminders
  set status = 'obsolete',
      handled_at = coalesce(handled_at, clock_timestamp()),
      handled_by = coalesce(handled_by, auth.uid())
  where project_id = v_reminder.project_id
    and workflow_version = v_reminder.workflow_version
    and status = 'pending'
    and threshold_hours < v_reminder.threshold_hours;

  update public.project_client_reminders
  set status = p_status,
      handled_at = clock_timestamp(),
      handled_by = auth.uid()
  where id = p_reminder_id
  returning * into v_reminder;

  return v_reminder;
end
$function$;

revoke all on function public.resolve_project_client_reminder(uuid,text) from public;
revoke all on function public.resolve_project_client_reminder(uuid,text) from anon;
grant execute on function public.resolve_project_client_reminder(uuid,text) to authenticated;
