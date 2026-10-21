-- Run after daily ledger tests and legacy compatibility migration on disposable PG17.
\set ON_ERROR_STOP on
-- Test-only fixture seed: emulate a legacy browser that already credited
-- its entire session by heartbeat, before the new dated ledger is applied.
update public.attendance_sessions
  set verified_seconds = greatest(0,floor(extract(epoch from (
    clock_timestamp() - clock_in)))::bigint)
  where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);

do $$
declare
  v_prior bigint;
  v_response public.attendance_sessions;
  v_start timestamptz := clock_timestamp() - interval '180 seconds';
  v_end timestamptz := clock_timestamp() - interval '160 seconds';
  v_payload jsonb;
  v_dated bigint;
begin
  select verified_seconds into v_prior from public.attendance_sessions
    where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  v_payload := jsonb_build_array(jsonb_build_object(
    'source_key','d9999999-9999-4999-8999-999999999999',
    'started_at',v_start::text,'ended_at',v_end::text,
    'time_zone','UTC','local_work_date',(v_start at time zone 'UTC')::date::text
  ));
  select * into v_response from public.attendance_sync_daily_slices(v_payload);
  select sum(credited_seconds) into v_dated from public.attendance_daily_credits
    where session_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_dated <> 20 then raise exception 'legacy-saturated session failed to accept valid dated slice'; end if;
  if v_response.verified_seconds < v_prior then
    raise exception 'new dated slice decreased existing legacy verified aggregate';
  end if;
  if v_response.verified_seconds < v_dated then
    raise exception 'dated credit exceeded recorded verified aggregate';
  end if;
  if v_response.verified_seconds >
     floor(extract(epoch from (clock_timestamp() - v_response.clock_in)))::bigint then
    raise exception 'legacy credit incorrectly exceeded session wall-clock cap';
  end if;

  -- Replaying the same key remains a no-op, with no duplicate credits.
  perform public.attendance_sync_daily_slices(v_payload);
  if (select sum(credited_seconds) from public.attendance_daily_credits
     where session_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 20 then
    raise exception 'idempotency broken for legacy-saturated session';
  end if;
  -- Different keys still cannot overlap existing accepted intervals.
  begin
    perform public.attendance_sync_daily_slices(jsonb_build_array(jsonb_build_object(
      'source_key','d8888888-8888-4888-8888-888888888888',
      'started_at',(v_start + interval '5 seconds')::text,
      'ended_at',(v_end + interval '5 seconds')::text,
      'time_zone','UTC','local_work_date',(v_start at time zone 'UTC')::date::text
    )));
    raise exception 'overlapping legacy interval was improperly credited';
  exception when sqlstate '23P01' then null;
  end;
end $$;
reset role;
select 'ATTENDANCE LEGACY CREDIT COMPATIBILITY: PASSED' as result;
