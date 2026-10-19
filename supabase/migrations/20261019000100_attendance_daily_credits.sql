-- Attendance V2 daily-credit ledger (new credits only; no historical backfill).
-- Apply in a staging database and certify RLS/RPC before production release.
-- Source slices are supplied by the desktop client and are bounded by server time,
-- session ownership, break windows, idempotency and mutual-exclusion checks.
-- Existing aggregate verified_seconds are intentionally unchanged on migration.

create table if not exists public.attendance_daily_credits (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_key uuid not null,
  local_work_date date not null,
  time_zone text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  credited_seconds bigint not null,
  created_at timestamptz not null default now(),
  constraint attendance_daily_credit_positive check (credited_seconds between 1 and 57600),
  constraint attendance_daily_credit_interval_valid check (ended_at > started_at),
  constraint attendance_daily_credit_source_unique unique (user_id, source_key)
);

create index if not exists attendance_daily_credits_user_date_idx
  on public.attendance_daily_credits (user_id, local_work_date desc);
create index if not exists attendance_daily_credits_session_idx
  on public.attendance_daily_credits (session_id, started_at);

alter table public.attendance_daily_credits enable row level security;

drop policy if exists attendance_daily_credits_self_read on public.attendance_daily_credits;
create policy attendance_daily_credits_self_read
on public.attendance_daily_credits
for select to authenticated
using (user_id = (select auth.uid()));

-- No direct client INSERT/UPDATE/DELETE: write via validated RPC only.
revoke all on public.attendance_daily_credits from public, anon, authenticated;
grant select on public.attendance_daily_credits to authenticated;

-- Client arguments:
-- [{ "source_key": UUID, "started_at": ISO UTC, "ended_at": ISO UTC,
--    "time_zone": "Asia/Karachi", "local_work_date": "YYYY-MM-DD" }, ...]
-- One slice must fit a single local work date; split at local midnight before sync.
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

    -- Do not partially attribute a date: either the whole slice is valid or
    -- the transaction aborts and the unsynced client queue stays available.
    if v_credit > greatest(0, v_max_verified - greatest(0, coalesce(v_session.verified_seconds, 0))) then
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
      set verified_seconds = verified_seconds + v_credit,
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

-- With dated credit RPCs, time must be credited only by an accepted slice,
-- never speculatively at a break or clock-out boundary. The previous functions
-- credited up to 90 heartbeat seconds there, causing unattributed double credit.
create or replace function public.attendance_start_break()
returns public.attendance_breaks
language plpgsql
security definer
set search_path = ''
as $
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_session public.attendance_sessions;
  v_row public.attendance_breaks;
begin
  if v_actor is null then
    raise exception 'attendance_not_authenticated' using errcode = '42501';
  end if;

  select * into v_session
  from public.attendance_sessions
  where user_id = v_actor and status = 'active'
  order by clock_in desc limit 1 for update;

  if v_session.id is null then
    raise exception 'attendance_not_clocked_in' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.attendance_breaks
    where session_id = v_session.id and ended_at is null
  ) then
    raise exception 'attendance_break_already_active' using errcode = '23505';
  end if;

  update public.attendance_sessions
  set last_app_heartbeat_at = v_now, updated_at = v_now
  where id = v_session.id;

  insert into public.attendance_breaks(session_id, user_id, started_at)
  values (v_session.id, v_actor, v_now)
  returning * into v_row;

  return v_row;
end;
$;

create or replace function public.attendance_clock_out(p_note text default null)
returns public.attendance_sessions
language plpgsql
security definer
set search_path = ''
as $
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_session public.attendance_sessions;
  v_row public.attendance_sessions;
begin
  if v_actor is null then
    raise exception 'attendance_not_authenticated' using errcode = '42501';
  end if;

  select * into v_session
  from public.attendance_sessions
  where user_id = v_actor and status = 'active'
  order by clock_in desc limit 1 for update;

  if v_session.id is null then
    raise exception 'attendance_not_clocked_in' using errcode = '22023';
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
    last_app_heartbeat_at = v_now,
    updated_at = v_now
  where id = v_session.id
  returning * into v_row;

  return v_row;
end;
$;

-- Preserve only signed-in attendance access, not public/anon RPC execution.
revoke all on function public.attendance_start_break() from public, anon;
grant execute on function public.attendance_start_break() to authenticated;
revoke all on function public.attendance_clock_out(text) from public, anon;
grant execute on function public.attendance_clock_out(text) to authenticated;

-- Read-only per-day rollup. SECURITY INVOKER preserves the underlying
-- attendance_daily_credits RLS filter for employee self-service reports.
create or replace view public.attendance_daily_totals
with (security_invoker = true)
as
select
  c.user_id,
  c.local_work_date,
  sum(c.credited_seconds)::bigint as actual_seconds,
  (sum(c.credited_seconds) >= 60) as counts_as_day_worked,
  count(*)::bigint as accepted_slices
from public.attendance_daily_credits c
group by c.user_id, c.local_work_date;

revoke all on public.attendance_daily_totals from public, anon;
grant select on public.attendance_daily_totals to authenticated;

comment on table public.attendance_daily_credits is
  'Verified daily attendance slices added after the V2 cutover. Historical session aggregates are intentionally not backfilled.';
