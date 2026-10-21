-- Attendance V2 hotfix: reconcile newly dated credits with existing legacy
-- verified_seconds. Some old sessions already have unattributed heartbeat
-- credits, so reject only if total DATED credit would exceed wall clock
-- duration minus breaks. Never credit overlapping intervals, modify original
-- records, or allow a decrease in session aggregate verified_seconds.
-- This function still rejects another actor, invalid dates, break overlap,
-- out-of-session/future ranges, forged keys and duplicate intervals.

create or replace function public.attendance_sync_daily_slices(p_slices jsonb)
returns public.attendance_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_session public.attendance_sessions;
  v_slice jsonb;
  v_existing public.attendance_daily_credits;
  v_source_key uuid;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_time_zone text;
  v_local_work_date date;
  v_credit bigint;
  v_break_seconds bigint;
  v_max_verified bigint;
  v_dated_total bigint;
  v_index integer := 0;
begin
  if v_actor is null then
    raise exception 'attendance_not_authenticated' using errcode = '42501';
  end if;

  if coalesce(public.phase6_app_actor_class(), '') not in ('admin', 'project_manager', 'employee') then
    raise exception 'attendance_role_denied' using errcode = '42501';
  end if;

  if jsonb_typeof(p_slices) is distinct from 'array' then
    raise exception 'attendance_invalid_slice_batch' using errcode = '22023';
  end if;
  if jsonb_array_length(p_slices) > 120 then
    raise exception 'attendance_slice_batch_too_large' using errcode = '22023';
  end if;

  select * into v_session
  from public.attendance_sessions
  where user_id = v_actor and status = 'active'
  order by clock_in desc limit 1 for update;

  if v_session.id is null then
    raise exception 'attendance_not_clocked_in' using errcode = '22023';
  end if;

  for v_slice in select value from jsonb_array_elements(p_slices) loop
    v_index := v_index + 1;

    if jsonb_typeof(v_slice) <> 'object'
       or coalesce(v_slice ? 'source_key', false) = false
       or coalesce(v_slice ? 'started_at', false) = false
       or coalesce(v_slice ? 'ended_at', false) = false
       or coalesce(v_slice ? 'time_zone', false) = false
       or coalesce(v_slice ? 'local_work_date', false) = false then
      raise exception 'attendance_invalid_slice_fields at %', v_index using errcode = '22023';
    end if;

    begin
      v_source_key := (v_slice->>'source_key')::uuid;
      v_started_at := (v_slice->>'started_at')::timestamptz;
      v_ended_at := (v_slice->>'ended_at')::timestamptz;
      v_time_zone := v_slice->>'time_zone';
      v_local_work_date := (v_slice->>'local_work_date')::date;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'attendance_invalid_slice_value at %', v_index using errcode = '22023';
    end;

    -- A retransmitted source key is a successful no-op ONLY for identical
    -- payloads. Reject accidental UUID reuse with conflicting intervals.
    select * into v_existing
    from public.attendance_daily_credits c
    where c.user_id = v_actor and c.source_key = v_source_key;

    if v_existing.id is not null then
      if v_existing.session_id = v_session.id
        and v_existing.started_at = v_started_at
        and v_existing.ended_at = v_ended_at
        and v_existing.time_zone = v_time_zone
        and v_existing.local_work_date = v_local_work_date then
        continue;
      end if;
      raise exception 'attendance_source_key_reused' using errcode = '23505';
    end if;

    if not exists (
      select 1 from pg_catalog.pg_timezone_names where name = v_time_zone
    ) then
      raise exception 'attendance_invalid_timezone' using errcode = '22023';
    end if;

    v_credit := floor(extract(epoch from (v_ended_at - v_started_at)))::bigint;
    if v_started_at < (v_session.clock_in - interval '1 second')
       or v_ended_at > v_now
       or v_ended_at <= v_started_at
       or v_credit not between 1 and 57600
       or (v_started_at at time zone v_time_zone)::date <> v_local_work_date
       or ((v_ended_at - interval '1 microsecond') at time zone v_time_zone)::date <> v_local_work_date then
      raise exception 'attendance_slice_outside_session_or_day' using errcode = '22023';
    end if;

    -- Never double-credit overlapping slices sent from different tabs/devices.
    if exists (
      select 1 from public.attendance_daily_credits c
      where c.session_id = v_session.id
        and c.started_at < v_ended_at
        and c.ended_at > v_started_at
    ) then
      raise exception 'attendance_slice_overlap' using errcode = '23P01';
    end if;

    -- Reject any interval touching a break; the client must split it into valid
    -- before/after segments instead of crediting break time.
    if exists (
      select 1 from public.attendance_breaks b
      where b.session_id = v_session.id
        and b.started_at < v_ended_at
        and coalesce(b.ended_at, v_now) > v_started_at
    ) then
      raise exception 'attendance_slice_overlaps_break' using errcode = '22023';
    end if;

    select coalesce(sum(greatest(0, floor(extract(epoch from (
      coalesce(b.ended_at, v_now) - b.started_at
    )))::bigint)), 0)
      into v_break_seconds
    from public.attendance_breaks b where b.session_id = v_session.id;

    v_max_verified := greatest(
      0, floor(extract(epoch from (v_now - v_session.clock_in)))::bigint - v_break_seconds
    );

    -- Some live sessions already contain legacy heartbeat seconds that were
    -- not assigned to a date. Requiring aggregate + new dated credit to fit
    -- wall time permanently blocks these sessions, even when the dated slice
    -- is valid. Bound the sum of accepted DATED credits by wall time instead.
    -- The legacy aggregate remains intact and must not be counted twice.
    select coalesce(sum(credited_seconds),0)::bigint into v_dated_total
      from public.attendance_daily_credits
      where session_id = v_session.id;
    if v_dated_total + v_credit > v_max_verified then
      raise exception 'attendance_slice_exceeds_verified_cap' using errcode = '22023';
    end if;

    insert into public.attendance_daily_credits (
      session_id, user_id, source_key, local_work_date, time_zone,
      started_at, ended_at, credited_seconds
    ) values (
      v_session.id, v_actor, v_source_key, v_local_work_date, v_time_zone,
      v_started_at, v_ended_at, v_credit
    );

    update public.attendance_sessions
      set verified_seconds = greatest(
            verified_seconds,
            least(v_max_verified, verified_seconds + v_credit)
          ),
          last_app_heartbeat_at = v_now,
          presence_client_kind = 'desktop_web',
          updated_at = v_now
      where id = v_session.id returning * into v_session;
  end loop;

  return v_session;
end;
$$;

revoke all on function public.attendance_sync_daily_slices(jsonb) from public, anon;
grant execute on function public.attendance_sync_daily_slices(jsonb) to authenticated;
