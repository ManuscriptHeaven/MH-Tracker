-- LOCAL/DISPOSABLE DATABASE ONLY, after migrations 1-3. Run as migration owner:
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/database/phase6_business_days.test.sql
-- Plain SQL assertions: no pgTAP dependency, no Auth fixtures, no persistent data.
begin;
set local timezone = 'UTC';
create temporary table phase6_calendar_test_marker (id integer) on commit drop;
create function pg_temp.phase6_assert(p_ok boolean, p_label text) returns void
language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'FAIL: %', p_label; end if;
end; $$;
create function pg_temp.phase6_expect_error(p_sql text, p_error text) returns void
language plpgsql as $$ begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm <> p_error then raise exception 'Expected %, got %', p_error, sqlerrm; end if;
    return;
  end;
  raise exception 'Expected error was not raised: %', p_error;
end; $$;

-- Isolate fixture dates even if the local database has a calendar already.
insert into public.workflow_calendar_exceptions(calendar_date, is_working_day, label)
select d::date, extract(isodow from d) < 6, 'Phase 6 rollback-only calendar test'
from generate_series(timestamp '2026-09-01', timestamp '2026-09-30', interval '1 day') d
on conflict (calendar_date) do update set is_working_day = excluded.is_working_day;

select pg_temp.phase6_assert(public.workflow_add_production_days('2026-09-04 10:30+05',1)
  = timestamptz '2026-09-07 10:30+05', 'Friday + 1 = Monday, same wall time');
select pg_temp.phase6_assert(public.workflow_add_production_days('2026-09-04 10:30+05',2)
  = timestamptz '2026-09-08 10:30+05', 'Friday + 2 = Tuesday');

-- Remove only this transaction's explicit Saturday exception to test weekend=false.
delete from public.workflow_calendar_exceptions where calendar_date = date '2026-09-05';
select pg_temp.phase6_assert(public.workflow_add_production_days('2026-09-04 10:30+05',1,false)
  = timestamptz '2026-09-05 10:30+05', 'Included weekend: Friday + 1 = Saturday');
select pg_temp.phase6_assert(public.workflow_add_production_days('2026-09-05 10:30:00.123456+05',0)
  = timestamptz '2026-09-05 10:30:00.123456+05', 'Zero preserves instant and subseconds');
select pg_temp.phase6_expect_error(
  $q$select public.workflow_add_production_days('2026-09-04 10:30+05',-1)$q$,
  'workflow_invalid_production_days');

insert into public.workflow_calendar_exceptions(calendar_date,is_working_day)
values ('2026-09-05',true) on conflict (calendar_date) do update set is_working_day = true;
select pg_temp.phase6_assert(public.workflow_add_production_days('2026-09-04 10:30+05',1)
  = timestamptz '2026-09-05 10:30+05', 'Working Saturday overrides weekend exclusion');
select pg_temp.phase6_assert(public.workflow_production_seconds_between(
  '2026-09-05 10:30+05','2026-09-05 11:30+05') = 3600, 'Working exception counts seconds');

update public.workflow_calendar_exceptions set is_working_day = false
where calendar_date in (date '2026-09-05', date '2026-09-07');
select pg_temp.phase6_assert(public.workflow_add_production_days('2026-09-04 10:30+05',1)
  = timestamptz '2026-09-08 10:30+05', 'Nonworking Monday overrides weekday');
select pg_temp.phase6_assert(public.workflow_production_seconds_between(
  '2026-09-07 00:00+05','2026-09-08 00:00+05',false) = 0,
  'Nonworking exception overrides even weekends-included mode');
update public.workflow_calendar_exceptions set is_working_day = true where calendar_date = date '2026-09-07';

select pg_temp.phase6_assert(public.workflow_production_seconds_between(
  '2026-09-04 10:15+05','2026-09-04 12:45+05') = 9000, 'Partial weekday: 2.5 hours');
select pg_temp.phase6_assert(public.workflow_production_seconds_between(
  '2026-09-04 23:30+05','2026-09-07 01:30+05') = 7200, 'Weekend excluded; partial first and last dates');
select pg_temp.phase6_assert(public.workflow_production_seconds_between(
  '2026-09-05 00:00+05','2026-09-07 00:00+05') = 0, 'Weekend alone contributes zero');
select pg_temp.phase6_assert(public.workflow_add_production_days('2026-09-07 00:01+05',1)
  = timestamptz '2026-09-08 00:01+05', 'Start date is never day one');
select pg_temp.phase6_assert(public.workflow_production_seconds_between(
  '2026-09-04 18:30+00','2026-09-04 19:30+00') = 1800, 'UTC Friday crosses Karachi Saturday');
select pg_temp.phase6_assert(public.workflow_add_production_days('2026-09-04 20:00+00',1)
  = timestamptz '2026-09-06 20:00+00', 'UTC Friday night is local Saturday, next eligible date Monday');
select pg_temp.phase6_assert(public.workflow_production_days_between(
  '2026-09-04 06:00+05','2026-09-04 18:00+05') = 0.5, 'Days means 24-hour-equivalent elapsed production');
select pg_temp.phase6_assert(public.workflow_production_seconds_between(
  '2026-09-04 10:00:00.1+05','2026-09-04 10:00:01.9+05') = 1, 'Floor subseconds once');
select pg_temp.phase6_expect_error(
  $q$select public.workflow_production_seconds_between('2026-09-07 10:00+05','2026-09-04 10:00+05')$q$,
  'workflow_invalid_interval');
select pg_temp.phase6_expect_error(
  $q$select public.workflow_production_days_between('2026-09-07 10:00+05','2026-09-04 10:00+05')$q$,
  'workflow_invalid_interval');
select pg_temp.phase6_expect_error(
  $q$select public.workflow_add_production_days('2026-09-04 10:00+05',1,true,'Invalid/Zone')$q$,
  'workflow_invalid_calendar_input');

select pg_temp.phase6_assert(public._workflow_add_production_seconds(
  '2026-09-04 23:30+05',7200,true,'Asia/Karachi') = timestamptz '2026-09-07 01:30+05',
  'Partial-time resume crosses excluded weekend');
select pg_temp.phase6_assert(public._workflow_add_production_seconds(
  '2026-09-05 12:00+05',0,true,'Asia/Karachi') = timestamptz '2026-09-05 12:00+05', 'Zero seconds unchanged');
select pg_temp.phase6_assert(public._workflow_add_production_seconds(
  '2026-09-04 23:30+05',1800,true,'Asia/Karachi') = timestamptz '2026-09-05 00:00+05',
  'Exact midnight completion does not advance beyond the consumed interval');
select pg_temp.phase6_expect_error(
  $q$select public._workflow_add_production_seconds('2026-09-04 10:00+05',-1,true,'Asia/Karachi')$q$,
  'workflow_invalid_production_seconds');
update public.workflow_calendar_exceptions set is_working_day = true where calendar_date = date '2026-09-05';
select pg_temp.phase6_assert(public._workflow_add_production_seconds(
  '2026-09-04 23:30+05',7200,true,'Asia/Karachi') = timestamptz '2026-09-05 01:30+05',
  'Seconds resume obeys working Saturday');

-- DST: included local Sunday has 23 hours, not an assumed 86400 seconds.
insert into public.workflow_calendar_exceptions(calendar_date,is_working_day)
values ('2026-03-08',true) on conflict (calendar_date) do update set is_working_day = true;
select pg_temp.phase6_assert(public.workflow_production_seconds_between(
  '2026-03-08 00:00-05','2026-03-09 00:00-04',false,'America/New_York') = 82800,
  'DST eligible date counts actual elapsed seconds');
select pg_temp.phase6_assert(public._workflow_add_production_seconds(
  '2026-03-08 00:00-05',82800,false,'America/New_York') = timestamptz '2026-03-09 00:00-04',
  'DST add-seconds uses the real local-date boundary');
select pg_temp.phase6_expect_error(
  $q$select public.workflow_add_production_days('2026-03-07 02:30-05',1,false,'America/New_York')$q$,
  'workflow_local_time_unrepresentable');

rollback;
