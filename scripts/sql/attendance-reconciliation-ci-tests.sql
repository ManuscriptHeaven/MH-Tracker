-- Run after attendance-ledger-ci-tests.sql. No production data is used.
\set ON_ERROR_STOP on

-- Database permissions do not allow normal API clients to mutate audit history.
do $$ begin
  if has_table_privilege('authenticated','public.attendance_reconciliation_audit','INSERT')
     or has_table_privilege('authenticated','public.attendance_reconciliation_audit','UPDATE')
     or has_table_privilege('authenticated','public.attendance_reconciliation_audit','DELETE')
     or has_function_privilege('anon','public.attendance_admin_reconcile_session(uuid,bigint,bigint,text,text)','EXECUTE') then
    raise exception 'attendance_audit_privilege_leak' using errcode='42501';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.attendance_reconciliation_audit'::regclass) then
    raise exception 'attendance_audit_rls_not_enabled';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$ begin
  if (select count(*) from public.attendance_reconciliation_audit) <> 0 then
    raise exception 'employee_can_read_admin_audit';
  end if;
  begin
    perform public.attendance_admin_reconcile_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',80,70,
      'Employee cannot override attendance','Attendance evidence form');
    raise exception 'employee_was_allowed_to_reconcile';
  exception when sqlstate '42501' then null;
  end;
end $$;

select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
do $$ begin
  if (select count(*) from public.attendance_reconciliation_audit) <> 0 then
    raise exception 'manager_can_read_admin_audit';
  end if;
  begin
    perform public.attendance_admin_reconcile_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',80,70,
      'Manager cannot override attendance','Attendance evidence form');
    raise exception 'manager_was_allowed_to_reconcile';
  exception when sqlstate '42501' then null;
  end;
end $$;

select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
do $$
declare
  v_after public.attendance_sessions;
begin
  -- The preceding ledger suite finished this session with 70 seconds,
  -- including 40 seconds of dated/immutable accepted slices.
  begin
    perform public.attendance_admin_reconcile_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',25,70,
      'Reject reduction below dated hours','Accepted dated ledger is 40 seconds');
    raise exception 'below_dated_credits_allowed';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.attendance_admin_reconcile_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',360000,70,
      'Reject inflated historical attendance','No evidence of hundred hour work');
    raise exception 'above_session_bounds_allowed';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.attendance_admin_reconcile_session('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',20,0,
      'Reject ongoing work edits','Session has not been clocked out');
    raise exception 'active_session_reconciled';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.attendance_admin_reconcile_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',80,70,
      'short','short');
    raise exception 'missing_reason_evidence_allowed';
  exception when sqlstate '22023' then null;
  end;
  select * into v_after from public.attendance_admin_reconcile_session(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',90,70,
    'Original overtime overstated after supervisor review',
    'Reviewed office log and author correspondence for this date'
  );
  if v_after.verified_seconds <> 90 then raise exception 'reconciliation_failed'; end if;
  if (select count(*) from public.attendance_reconciliation_audit) <> 1 then
    raise exception 'missing_audit_event';
  end if;
  if not exists (select 1 from public.attendance_reconciliation_audit a
    where a.performed_by='55555555-5555-4555-8555-555555555555'
      and a.employee_id='11111111-1111-4111-8111-111111111111'
      and a.action_type='verified_seconds_reconciliation'
      and (a.previous_record->>'verified_seconds')::bigint = 70
      and (a.updated_record->>'verified_seconds')::bigint = 90
      and a.dated_accepted_seconds=40) then
    raise exception 'incomplete_audit_snapshot';
  end if;
  if (select sum(credited_seconds) from public.attendance_daily_credits
      where session_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 40 then
    raise exception 'reconciliation_modified_dated_credits';
  end if;
  begin
    perform public.attendance_admin_reconcile_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',95,70,
      'Reject stale review after a different admin updated it',
      'Original expected total was 70 seconds');
    raise exception 'stale_expected_value_allowed';
  exception when sqlstate '40001' then null;
  end;
end $$;

-- Clock-window edits also require audit records and must not invalidate the
-- accepted dated ledger. The existing RPC signature remains compatible.
do $$
declare
  v_before public.attendance_sessions;
  v_after public.attendance_sessions;
begin
  select * into v_before from public.attendance_sessions
    where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  begin
    perform public.attendance_admin_adjust_session(v_before.id,
      v_before.clock_in, v_before.clock_out, 'short');
    raise exception 'short_reason_allowed';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.attendance_admin_adjust_session(v_before.id,
      v_before.clock_in + interval '59 minutes', v_before.clock_out,
      'Reject reducing window below recorded verified evidence');
    raise exception 'impossible_clock_window_allowed';
  exception when sqlstate '22023' then null;
  end;
  select * into v_after from public.attendance_admin_adjust_session(
    v_before.id, v_before.clock_in - interval '2 minutes',
    v_before.clock_out,
    'Shift start corrected against signed manager timesheet');
  if v_after.clock_in <> v_before.clock_in - interval '2 minutes' then
    raise exception 'corrected_window_not_saved';
  end if;
  if (select count(*) from public.attendance_reconciliation_audit) <> 2 then
    raise exception 'window_adjustment_not_audited';
  end if;
  if not exists (select 1 from public.attendance_reconciliation_audit
    where action_type='session_window_correction') then
    raise exception 'window_adjustment_audit_type_missing';
  end if;
end $$;

reset role;
-- A SQL owner cannot silently mutate an existing audit event because of the trigger.
do $$ begin
  begin
    update public.attendance_reconciliation_audit set reason='rewritten';
    raise exception 'audit_update_was_allowed';
  exception when sqlstate '42501' then null;
  end;
  begin
    delete from public.attendance_reconciliation_audit;
    raise exception 'audit_delete_was_allowed';
  exception when sqlstate '42501' then null;
  end;
end $$;
select 'ADMIN HISTORICAL RECONCILIATION: PostgreSQL and RLS tests passed' as result;
