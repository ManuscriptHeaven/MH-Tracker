-- Attendance historical reconciliation; admin-only, append-only auditing.
-- Do not backfill/redistribute historical time across dates.
create table if not exists public.attendance_reconciliation_audit (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete restrict,
  employee_id uuid not null references public.profiles(id) on delete restrict,
  performed_by uuid not null references public.profiles(id) on delete restrict,
  action_type text not null check (action_type in ('verified_seconds_reconciliation', 'session_window_correction')),
  reason text not null check (length(btrim(reason)) >= 15),
  evidence_note text not null check (length(btrim(evidence_note)) >= 10),
  previous_record jsonb not null,
  updated_record jsonb not null,
  dated_accepted_seconds bigint not null check (dated_accepted_seconds >= 0),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists attendance_reconciliation_audit_session_idx on public.attendance_reconciliation_audit(session_id, created_at desc);
create index if not exists attendance_reconciliation_audit_employee_idx on public.attendance_reconciliation_audit(employee_id, created_at desc);
alter table public.attendance_reconciliation_audit enable row level security;
drop policy if exists attendance_reconciliation_admin_read on public.attendance_reconciliation_audit;
create policy attendance_reconciliation_admin_read on public.attendance_reconciliation_audit
 for select to authenticated using (public.phase6_app_actor_class() = 'admin');
revoke all on public.attendance_reconciliation_audit from public, anon, authenticated;
grant select on public.attendance_reconciliation_audit to authenticated;

-- Ordinary table clients have no writes; this trigger also protects against
-- UPDATE / DELETE from other RPCs accidentally modifying audit history.
create or replace function public.attendance_reconciliation_audit_immutable()
returns trigger language plpgsql set search_path = '' as $immutable$
begin
  raise exception 'attendance_audit_is_append_only' using errcode = '42501';
end;
$immutable$;
drop trigger if exists attendance_reconciliation_no_mutation on public.attendance_reconciliation_audit;
create trigger attendance_reconciliation_no_mutation
before update or delete on public.attendance_reconciliation_audit
for each row execute function public.attendance_reconciliation_audit_immutable();
revoke all on function public.attendance_reconciliation_audit_immutable() from public, anon, authenticated;

-- Correct the recorded session total only; accepted dated ledger slices stay intact.
-- Expected previous value provides optimistic concurrency protection.
create or replace function public.attendance_admin_reconcile_session(
  p_session_id uuid,
  p_corrected_seconds bigint,
  p_expected_seconds bigint,
  p_reason text,
  p_evidence_note text
) returns public.attendance_sessions
language plpgsql security definer set search_path = '' as $reconcile$
declare
  v_actor uuid := auth.uid();
  v_before public.attendance_sessions;
  v_after public.attendance_sessions;
  v_dated bigint := 0;
  v_break_seconds bigint := 0;
  v_max bigint := 0;
begin
  if v_actor is null or coalesce(public.phase6_app_actor_class(), '') <> 'admin' then
    raise exception 'attendance_admin_required' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 15 or length(btrim(coalesce(p_evidence_note,''))) < 10 then
    raise exception 'attendance_reason_and_evidence_required' using errcode = '22023';
  end if;
  select * into v_before from public.attendance_sessions
  where id = p_session_id and status = 'completed' for update;
  if v_before.id is null then
    raise exception 'attendance_completed_session_required' using errcode = '22023';
  end if;
  if v_before.clock_out is null or v_before.clock_out < v_before.clock_in then
    raise exception 'attendance_missing_completed_window' using errcode = '22023';
  end if;
  if p_expected_seconds is distinct from v_before.verified_seconds then
    raise exception 'attendance_record_changed_reload' using errcode = '40001';
  end if;
  select coalesce(sum(credited_seconds),0) into v_dated
    from public.attendance_daily_credits where session_id = p_session_id;
  select coalesce(sum(greatest(0, floor(extract(epoch from (
    coalesce(b.ended_at,v_before.clock_out) - b.started_at
  )))::bigint)),0) into v_break_seconds
  from public.attendance_breaks b where b.session_id=p_session_id;
  v_max := greatest(0, floor(extract(epoch from (v_before.clock_out - v_before.clock_in)))::bigint - v_break_seconds);
  if p_corrected_seconds is null or p_corrected_seconds < v_dated
     or p_corrected_seconds > v_max then
    raise exception 'attendance_correction_outside_evidence_bound' using errcode = '22023';
  end if;
  if p_corrected_seconds = v_before.verified_seconds then
    raise exception 'attendance_correction_no_change' using errcode = '22023';
  end if;
  update public.attendance_sessions
     set verified_seconds=p_corrected_seconds,
         adjusted_by=v_actor, adjustment_reason=left(btrim(p_reason),1000),
         updated_at=clock_timestamp()
   where id=p_session_id returning * into v_after;
  insert into public.attendance_reconciliation_audit (
    session_id, employee_id, performed_by, action_type, reason, evidence_note,
    previous_record, updated_record, dated_accepted_seconds
  ) values (
    p_session_id, v_before.user_id, v_actor, 'verified_seconds_reconciliation',
    left(btrim(p_reason),1000), left(btrim(p_evidence_note),2000),
    to_jsonb(v_before),to_jsonb(v_after),v_dated
  );
  return v_after;
end;
$reconcile$;
revoke all on function public.attendance_admin_reconcile_session(uuid,bigint,bigint,text,text) from public, anon;
grant execute on function public.attendance_admin_reconcile_session(uuid,bigint,bigint,text,text) to authenticated;

-- Existing clock-window correction must be audited too. Keep the legacy RPC
-- signature so existing UI stays compatible; reject windows that would erase
-- accepted dated credits, breaks, or more recorded hours than can fit.
create or replace function public.attendance_admin_adjust_session(
  p_session_id uuid, p_clock_in timestamptz, p_clock_out timestamptz, p_reason text
) returns public.attendance_sessions
language plpgsql security definer set search_path = '' as $window$
declare
  v_actor uuid := auth.uid();
  v_before public.attendance_sessions;
  v_after public.attendance_sessions;
  v_dated bigint := 0;
  v_break_seconds bigint := 0;
begin
  if v_actor is null or coalesce(public.phase6_app_actor_class(), '') <> 'admin' then
    raise exception 'attendance_admin_required' using errcode = '42501';
  end if;
  if p_clock_in is null or p_clock_out is null or p_clock_out < p_clock_in
     or p_clock_out > clock_timestamp() then
    raise exception 'attendance_invalid_time_range' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 15 then
    raise exception 'attendance_adjustment_reason_required' using errcode = '22023';
  end if;
  select * into v_before from public.attendance_sessions
  where id=p_session_id and status='completed' for update;
  if v_before.id is null then
    raise exception 'attendance_session_not_adjustable' using errcode = '22023';
  end if;
  if p_clock_in = v_before.clock_in and p_clock_out = v_before.clock_out then
    raise exception 'attendance_correction_no_change' using errcode = '22023';
  end if;
  if exists (select 1 from public.attendance_daily_credits c
      where c.session_id=p_session_id and (c.started_at < p_clock_in or c.ended_at > p_clock_out))
    or exists (select 1 from public.attendance_breaks b
      where b.session_id=p_session_id and (b.started_at < p_clock_in or coalesce(b.ended_at,clock_timestamp()) > p_clock_out)) then
    raise exception 'attendance_window_would_erase_evidence' using errcode = '22023';
  end if;
  select coalesce(sum(credited_seconds),0) into v_dated
    from public.attendance_daily_credits where session_id=p_session_id;
  select coalesce(sum(greatest(0,floor(extract(epoch from (
    coalesce(b.ended_at,v_before.clock_out)-b.started_at
  )))::bigint)),0) into v_break_seconds
    from public.attendance_breaks b where b.session_id=p_session_id;
  if v_before.verified_seconds < v_dated or
     greatest(0,coalesce(v_before.verified_seconds,0)) >
     greatest(0,floor(extract(epoch from (p_clock_out-p_clock_in)))::bigint-v_break_seconds) then
    raise exception 'attendance_window_shorter_than_recorded_time' using errcode = '22023';
  end if;
  update public.attendance_sessions
     set clock_in=p_clock_in, clock_out=p_clock_out, adjusted_by=v_actor,
         adjustment_reason=left(btrim(p_reason),1000), updated_at=clock_timestamp()
   where id=p_session_id returning * into v_after;
  insert into public.attendance_reconciliation_audit (
    session_id, employee_id, performed_by, action_type, reason, evidence_note,
    previous_record, updated_record, dated_accepted_seconds
  ) values (p_session_id, v_before.user_id, v_actor, 'session_window_correction',
    left(btrim(p_reason),1000), left(btrim(p_reason),1000),
    to_jsonb(v_before), to_jsonb(v_after), v_dated);
  return v_after;
end;
$window$;
revoke all on function public.attendance_admin_adjust_session(uuid,timestamptz,timestamptz,text) from public, anon;
grant execute on function public.attendance_admin_adjust_session(uuid,timestamptz,timestamptz,text) to authenticated;
