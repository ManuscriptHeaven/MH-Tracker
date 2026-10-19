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

    -- A retransmitted source key is a successful no-op. The row lock serializes
    -- retries and competing tab/device requests for the same active session.
    if exists (
      select 1 from public.attendance_daily_credits c
      where c.user_id = v_actor and c.source_key = v_source_key
        and c.session_id = v_session.id
    ) then
      continue;
    end if;

    if exists (
      select 1 from public.attendance_daily_credits c
      where c.user_id = v_actor and c.source_key = v_source_key
    ) then
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

comment on table public.attendance_daily_credits is
  'Verified daily attendance slices added after the V2 cutover. Historical session aggregates are intentionally not backfilled.';
