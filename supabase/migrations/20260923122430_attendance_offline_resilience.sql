-- Attendance offline/minimized resilience.
-- The desktop client measures elapsed time inside the same running MH Tracker page
-- and can queue that time locally while offline. The server credits only the queued
-- elapsed seconds, capped by the physically possible non-break time in the session.

drop function if exists public.attendance_record_heartbeat(text);

create or replace function public.attendance_record_heartbeat(
  p_client_kind text default 'desktop_web',
  p_client_elapsed_seconds bigint default null
)
returns public.attendance_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_row public.attendance_sessions;
  v_server_elapsed bigint := 0;
  v_client_elapsed bigint := greatest(0, coalesce(p_client_elapsed_seconds, 0));
  v_break_seconds bigint := 0;
  v_max_verified bigint := 0;
  v_credit bigint := 0;
  v_has_active_break boolean := false;
begin
  if v_actor is null then
    raise exception 'attendance_not_authenticated' using errcode = '42501';
  end if;

  if coalesce(public.phase6_app_actor_class(), '') not in ('admin','project_manager','employee') then
    raise exception 'attendance_role_denied' using errcode = '42501';
  end if;

  if p_client_kind <> 'desktop_web' then
    raise exception 'attendance_desktop_presence_required' using errcode = '42501';
  end if;

  select *
  into v_row
  from public.attendance_sessions
  where user_id = v_actor
    and status = 'active'
  order by clock_in desc
  limit 1
  for update;

  if v_row.id is null then
    raise exception 'attendance_not_clocked_in' using errcode = '22023';
  end if;

  select
    coalesce(
      sum(
        greatest(
          0,
          floor(extract(epoch from (coalesce(b.ended_at, v_now) - b.started_at)))::bigint
        )
      ),
      0
    ),
    bool_or(b.ended_at is null)
  into v_break_seconds, v_has_active_break
  from public.attendance_breaks b
  where b.session_id = v_row.id;

  v_has_active_break := coalesce(v_has_active_break, false);

  -- Never allow credited time to exceed the wall-clock session duration minus breaks.
  v_max_verified := greatest(
    0,
    floor(extract(epoch from (v_now - v_row.clock_in)))::bigint - v_break_seconds
  );

  if not v_has_active_break then
    if p_client_elapsed_seconds is not null then
      -- Updated clients send time accumulated by the same still-running browser runtime.
      -- This keeps minimized tabs and temporary internet outages from losing valid time.
      v_credit := least(
        v_client_elapsed,
        greatest(0, v_max_verified - greatest(0, coalesce(v_row.verified_seconds, 0)))
      );
    elsif v_row.last_app_heartbeat_at is not null then
      -- Backward-compatible fallback for older clients that do not send local elapsed time.
      v_server_elapsed := greatest(
        0,
        floor(extract(epoch from (v_now - v_row.last_app_heartbeat_at)))::bigint
      );
      if v_server_elapsed > 0 and v_server_elapsed <= 90 then
        v_credit := least(
          v_server_elapsed,
          greatest(0, v_max_verified - greatest(0, coalesce(v_row.verified_seconds, 0)))
        );
      end if;
    end if;
  end if;

  update public.attendance_sessions
  set
    verified_seconds = greatest(0, coalesce(v_row.verified_seconds, 0)) + v_credit,
    last_app_heartbeat_at = v_now,
    presence_client_kind = p_client_kind,
    updated_at = v_now
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.attendance_record_heartbeat(text, bigint) from public, anon;
grant execute on function public.attendance_record_heartbeat(text, bigint) to authenticated;
