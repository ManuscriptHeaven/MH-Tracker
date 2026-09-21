-- Attendance app-presence verification.
-- Worked time is credited only while MH Tracker is sending desktop-app heartbeats.

alter table public.attendance_sessions
  add column if not exists verified_seconds bigint not null default 0,
  add column if not exists last_app_heartbeat_at timestamptz,
  add column if not exists presence_client_kind text;

alter table public.attendance_sessions
  drop constraint if exists attendance_verified_seconds_nonnegative;

alter table public.attendance_sessions
  add constraint attendance_verified_seconds_nonnegative
  check (verified_seconds >= 0);

-- Preserve historical totals when introducing presence-based accounting.
update public.attendance_sessions s
set verified_seconds = greatest(
  0,
  floor(extract(epoch from (coalesce(s.clock_out, now()) - s.clock_in)))::bigint
  - coalesce((
      select sum(
        greatest(
          0,
          floor(extract(epoch from (coalesce(b.ended_at, coalesce(s.clock_out, now())) - b.started_at)))::bigint
        )
      )
      from public.attendance_breaks b
      where b.session_id = s.id
    ), 0)
)
where s.verified_seconds = 0
  and s.clock_in is not null;

create or replace function public.attendance_record_heartbeat(
  p_client_kind text default 'desktop_web'
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
  v_elapsed bigint := 0;
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

  select exists(
    select 1
    from public.attendance_breaks b
    where b.session_id = v_row.id
      and b.ended_at is null
  ) into v_has_active_break;

  if v_row.last_app_heartbeat_at is not null then
    v_elapsed := greatest(
      0,
      floor(extract(epoch from (v_now - v_row.last_app_heartbeat_at)))::bigint
    );
  end if;

  -- Heartbeats are expected every 30s. Up to 90s tolerates browser timer throttling.
  -- A larger gap is treated as app-closed/offline time and earns zero seconds.
  if not v_has_active_break
     and v_elapsed > 0
     and v_elapsed <= 90 then
    v_row.verified_seconds := v_row.verified_seconds + v_elapsed;
  end if;

  update public.attendance_sessions
  set
    verified_seconds = v_row.verified_seconds,
    last_app_heartbeat_at = v_now,
    presence_client_kind = p_client_kind,
    updated_at = v_now
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.attendance_start_break()
returns public.attendance_breaks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_session public.attendance_sessions;
  v_elapsed bigint := 0;
  v_row public.attendance_breaks;
begin
  if v_actor is null then
    raise exception 'attendance_not_authenticated' using errcode = '42501';
  end if;

  select *
  into v_session
  from public.attendance_sessions
  where user_id = v_actor and status = 'active'
  order by clock_in desc
  limit 1
  for update;

  if v_session.id is null then
    raise exception 'attendance_not_clocked_in' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.attendance_breaks
    where session_id = v_session.id and ended_at is null
  ) then
    raise exception 'attendance_break_already_active' using errcode = '23505';
  end if;

  if v_session.last_app_heartbeat_at is not null then
    v_elapsed := greatest(
      0,
      floor(extract(epoch from (v_now - v_session.last_app_heartbeat_at)))::bigint
    );
    if v_elapsed > 0 and v_elapsed <= 90 then
      update public.attendance_sessions
      set
        verified_seconds = verified_seconds + v_elapsed,
        last_app_heartbeat_at = v_now,
        updated_at = v_now
      where id = v_session.id;
    else
      update public.attendance_sessions
      set last_app_heartbeat_at = v_now, updated_at = v_now
      where id = v_session.id;
    end if;
  end if;

  insert into public.attendance_breaks(session_id, user_id, started_at)
  values (v_session.id, v_actor, v_now)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.attendance_end_break()
returns public.attendance_breaks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_row public.attendance_breaks;
begin
  update public.attendance_breaks
  set ended_at = v_now
  where id = (
    select id
    from public.attendance_breaks
    where user_id = v_actor and ended_at is null
    order by started_at desc
    limit 1
    for update
  )
  returning * into v_row;

  if v_row.id is null then
    raise exception 'attendance_no_active_break' using errcode = '22023';
  end if;

  update public.attendance_sessions
  set last_app_heartbeat_at = v_now, updated_at = v_now
  where id = v_row.session_id
    and status = 'active';

  return v_row;
end;
$$;

create or replace function public.attendance_clock_out(p_note text default null)
returns public.attendance_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_session public.attendance_sessions;
  v_elapsed bigint := 0;
  v_has_active_break boolean := false;
  v_row public.attendance_sessions;
begin
  if v_actor is null then
    raise exception 'attendance_not_authenticated' using errcode = '42501';
  end if;

  select *
  into v_session
  from public.attendance_sessions
  where user_id = v_actor and status = 'active'
  order by clock_in desc
  limit 1
  for update;

  if v_session.id is null then
    raise exception 'attendance_not_clocked_in' using errcode = '22023';
  end if;

  select exists(
    select 1
    from public.attendance_breaks
    where session_id = v_session.id
      and ended_at is null
  ) into v_has_active_break;

  if not v_has_active_break and v_session.last_app_heartbeat_at is not null then
    v_elapsed := greatest(
      0,
      floor(extract(epoch from (v_now - v_session.last_app_heartbeat_at)))::bigint
    );
    if v_elapsed > 0 and v_elapsed <= 90 then
      v_session.verified_seconds := v_session.verified_seconds + v_elapsed;
    end if;
  end if;

  update public.attendance_breaks
  set ended_at = v_now
  where session_id = v_session.id and ended_at is null;

  update public.attendance_sessions
  set
    clock_out = v_now,
    status = 'completed',
    note = case
      when nullif(btrim(coalesce(p_note,'')), '') is null then note
      else left(btrim(p_note), 1000)
    end,
    verified_seconds = v_session.verified_seconds,
    last_app_heartbeat_at = v_now,
    updated_at = v_now
  where id = v_session.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.attendance_record_heartbeat(text) from public, anon;
grant execute on function public.attendance_record_heartbeat(text) to authenticated;
