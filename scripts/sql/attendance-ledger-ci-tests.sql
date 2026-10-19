-- Run with psql -v ON_ERROR_STOP=1 after fixture and migration, on disposable PG17.
-- Tests real Postgres execution, SQL assertions and authenticated RLS.
\set ON_ERROR_STOP on

do $$ begin
  if has_function_privilege('anon','public.attendance_sync_daily_slices(jsonb)','EXECUTE') then
    raise exception 'SECURITY FAILURE: anon can execute daily sync';
  end if;
  if not has_function_privilege('authenticated','public.attendance_sync_daily_slices(jsonb)','EXECUTE') then
    raise exception 'authenticated must be able to execute daily sync';
  end if;
  if has_table_privilege('authenticated','public.attendance_daily_credits','INSERT') then
    raise exception 'SECURITY FAILURE: authenticated can insert ledger directly';
  end if;
  if has_table_privilege('anon','public.attendance_daily_credits','SELECT') then
    raise exception 'SECURITY FAILURE: anon can select ledger directly';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.attendance_daily_credits'::regclass) then
    raise exception 'SECURITY FAILURE: ledger RLS disabled';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);

do $$
declare
  v_source uuid := 'd1111111-1111-4111-8111-111111111111';
  v_start timestamptz := clock_timestamp() - interval '180 seconds';
  v_end timestamptz := clock_timestamp() - interval '150 seconds';
  v_payload jsonb;
  v_row public.attendance_sessions;
begin
  v_payload := jsonb_build_array(jsonb_build_object(
    'source_key',v_source::text,'started_at',v_start::text,'ended_at',v_end::text,
    'time_zone','UTC','local_work_date',(v_start at time zone 'UTC')::date::text
  ));
  select * into v_row from public.attendance_sync_daily_slices(v_payload);
  if v_row.verified_seconds <> 60 then raise exception 'expected initial 30 + 30 credit, got %', v_row.verified_seconds; end if;

  -- A replay of exactly the same payload must be harmless.
  select * into v_row from public.attendance_sync_daily_slices(v_payload);
  if v_row.verified_seconds <> 60 then raise exception 'duplicate replay double-credited'; end if;

  -- Duplicate id with modified interval must fail, not acknowledge false data.
  begin
    perform public.attendance_sync_daily_slices(jsonb_build_array(jsonb_build_object(
      'source_key',v_source::text,'started_at',(v_start + interval '1 second')::text,
      'ended_at',v_end::text,'time_zone','UTC',
      'local_work_date',(v_start at time zone 'UTC')::date::text
    )));
    raise exception 'duplicate source with mutated payload was improperly accepted';
  exception when sqlstate '23505' then null;
  end;

  -- A different key cannot earn an overlapping interval.
  begin
    perform public.attendance_sync_daily_slices(jsonb_build_array(jsonb_build_object(
      'source_key','d2222222-2222-4222-8222-222222222222',
      'started_at',(v_start + interval '10 seconds')::text,
      'ended_at',(v_end + interval '10 seconds')::text,
      'time_zone','UTC',
      'local_work_date',(v_start at time zone 'UTC')::date::text
    )));
    raise exception 'overlapping interval was accepted';
  exception when sqlstate '23P01' then null;
  end;

  -- A row cannot lie about its calendar work date.
  begin
    perform public.attendance_sync_daily_slices(jsonb_build_array(jsonb_build_object(
      'source_key','d3333333-3333-4333-8333-333333333333',
      'started_at',(v_start - interval '60 seconds')::text,
      'ended_at',(v_start - interval '30 seconds')::text,
      'time_zone','UTC','local_work_date','1999-01-01'
    )));
    raise exception 'forged local date was accepted';
  exception when sqlstate '22023' then null;
  end;

  -- A very long duration cannot exceed credit caps.
  begin
    perform public.attendance_sync_daily_slices(jsonb_build_array(jsonb_build_object(
      'source_key','d4444444-4444-4444-8444-444444444444',
      'started_at',(clock_timestamp() - interval '2 days')::text,
      'ended_at',(clock_timestamp() + interval '2 days')::text,
      'time_zone','UTC','local_work_date','1999-01-01'
    )));
    raise exception 'impossible/future interval was accepted';
  exception when sqlstate '22023' then null;
  end;

  if (select count(*) from public.attendance_daily_credits) <> 1 then
    raise exception 'RLS must show exactly one own credit';
  end if;
end $$;

-- Confirm one actor cannot inspect another actor's ledger records.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$ begin
  if (select count(*) from public.attendance_daily_credits) <> 0 then
    raise exception 'RLS leaked other user credit';
  end if;
end $$;

-- Client accounts are not authorized to credit working time.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
do $$
begin
  begin
    perform public.attendance_sync_daily_slices('[]'::jsonb);
    raise exception 'client was allowed to use attendance sync';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- SECURITY INVOKER view must not leak other users' dated totals.
do $ begin
  if (select count(*) from public.attendance_daily_totals) <> 0 then
    raise exception 'daily totals view leaked another user';
  end if;
end $;

reset role;

-- Add a break as trusted test setup, then verify any slice touching it fails.
insert into public.attendance_breaks(session_id,user_id,started_at,ended_at) values(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  clock_timestamp() - interval '100 seconds',
  clock_timestamp() - interval '90 seconds'
);

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);

do $$
declare
  v_start timestamptz := clock_timestamp() - interval '105 seconds';
begin
  begin
    perform public.attendance_sync_daily_slices(jsonb_build_array(jsonb_build_object(
      'source_key','d5555555-5555-4555-8555-555555555555',
      'started_at',v_start::text,
      'ended_at',(v_start + interval '30 seconds')::text,
      'time_zone','UTC','local_work_date',(v_start at time zone 'UTC')::date::text
    )));
    raise exception 'break-overlapping time was credited';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Successful positive slice outside break; check non-attributed baseline invariant.
do $$
declare
  v_start timestamptz := clock_timestamp() - interval '80 seconds';
  v_row public.attendance_sessions;
begin
  select * into v_row from public.attendance_sync_daily_slices(jsonb_build_array(jsonb_build_object(
    'source_key','d6666666-6666-4666-8666-666666666666',
    'started_at',v_start::text,'ended_at',(v_start + interval '10 seconds')::text,
    'time_zone','UTC','local_work_date',(v_start at time zone 'UTC')::date::text
  )));
  if v_row.verified_seconds <> 70 then
    raise exception 'expected 30 historical + 40 ledger = 70, got %', v_row.verified_seconds;
  end if;
  if (select sum(credited_seconds) from public.attendance_daily_credits
      where session_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 40 then
    raise exception 'daily ledger total expected 40';
  end if;
  if (select sum(actual_seconds) from public.attendance_daily_totals) <> 40 then
    raise exception 'read-only daily totals should equal credited ledger seconds';
  end if;
end $$;

reset role;

select 'ATTENDANCE LEDGER: ALL POSTGRESQL/RLS INTEGRATION TESTS PASSED' as result;
