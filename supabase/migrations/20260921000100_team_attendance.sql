-- Team attendance: secure clock-in/out, breaks, manager visibility and admin corrections.

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  status text not null default 'active' check (status in ('active','completed')),
  note text not null default '',
  adjusted_by uuid references public.profiles(id) on delete set null,
  adjustment_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_session_clock_order check (clock_out is null or clock_out >= clock_in)
);

create unique index if not exists attendance_one_active_session_per_user
  on public.attendance_sessions(user_id)
  where status = 'active';

create index if not exists attendance_sessions_user_clock_idx
  on public.attendance_sessions(user_id, clock_in desc);

create table if not exists public.attendance_breaks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attendance_break_clock_order check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists attendance_one_active_break_per_session
  on public.attendance_breaks(session_id)
  where ended_at is null;

create index if not exists attendance_breaks_user_started_idx
  on public.attendance_breaks(user_id, started_at desc);

alter table public.attendance_sessions enable row level security;
alter table public.attendance_breaks enable row level security;

drop policy if exists attendance_sessions_select on public.attendance_sessions;
create policy attendance_sessions_select
on public.attendance_sessions
for select
to authenticated
using (
  user_id = auth.uid()
  or public.phase6_app_actor_class() in ('admin','project_manager')
);

drop policy if exists attendance_breaks_select on public.attendance_breaks;
create policy attendance_breaks_select
on public.attendance_breaks
for select
to authenticated
using (
  user_id = auth.uid()
  or public.phase6_app_actor_class() in ('admin','project_manager')
);

revoke insert, update, delete on public.attendance_sessions from authenticated;
revoke insert, update, delete on public.attendance_breaks from authenticated;
grant select on public.attendance_sessions to authenticated;
grant select on public.attendance_breaks to authenticated;

create or replace function public.attendance_clock_in(p_note text default '')
returns public.attendance_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_row public.attendance_sessions;
begin
  if v_actor is null then
    raise exception 'attendance_not_authenticated' using errcode = '42501';
  end if;

  v_role := public.phase6_app_actor_class();
  if coalesce(v_role, '') not in ('admin','project_manager','employee') then
    raise exception 'attendance_role_denied' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.profiles
    where id = v_actor
      and coalesce(status,'active') <> 'active'
  ) then
    raise exception 'attendance_profile_inactive' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.attendance_sessions
    where user_id = v_actor and status = 'active'
  ) then
    raise exception 'attendance_already_clocked_in' using errcode = '23505';
  end if;

  insert into public.attendance_sessions(user_id, note)
  values (v_actor, left(coalesce(p_note,''), 1000))
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
  v_session_id uuid;
  v_row public.attendance_breaks;
begin
  if v_actor is null then
    raise exception 'attendance_not_authenticated' using errcode = '42501';
  end if;

  select id into v_session_id
  from public.attendance_sessions
  where user_id = v_actor and status = 'active'
  order by clock_in desc
  limit 1;

  if v_session_id is null then
    raise exception 'attendance_not_clocked_in' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.attendance_breaks
    where session_id = v_session_id and ended_at is null
  ) then
    raise exception 'attendance_break_already_active' using errcode = '23505';
  end if;

  insert into public.attendance_breaks(session_id, user_id)
  values (v_session_id, v_actor)
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
  v_row public.attendance_breaks;
begin
  update public.attendance_breaks
  set ended_at = now()
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
  v_session_id uuid;
  v_row public.attendance_sessions;
begin
  if v_actor is null then
    raise exception 'attendance_not_authenticated' using errcode = '42501';
  end if;

  select id into v_session_id
  from public.attendance_sessions
  where user_id = v_actor and status = 'active'
  order by clock_in desc
  limit 1
  for update;

  if v_session_id is null then
    raise exception 'attendance_not_clocked_in' using errcode = '22023';
  end if;

  update public.attendance_breaks
  set ended_at = now()
  where session_id = v_session_id and ended_at is null;

  update public.attendance_sessions
  set
    clock_out = now(),
    status = 'completed',
    note = case
      when nullif(btrim(coalesce(p_note,'')), '') is null then note
      else left(btrim(p_note), 1000)
    end,
    updated_at = now()
  where id = v_session_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.attendance_admin_adjust_session(
  p_session_id uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_reason text
)
returns public.attendance_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.attendance_sessions;
begin
  if v_actor is null or coalesce(public.phase6_app_actor_class(), '') <> 'admin' then
    raise exception 'attendance_admin_required' using errcode = '42501';
  end if;

  if p_clock_in is null or p_clock_out is null or p_clock_out < p_clock_in then
    raise exception 'attendance_invalid_time_range' using errcode = '22023';
  end if;

  if length(btrim(coalesce(p_reason,''))) < 5 then
    raise exception 'attendance_adjustment_reason_required' using errcode = '22023';
  end if;

  update public.attendance_sessions
  set
    clock_in = p_clock_in,
    clock_out = p_clock_out,
    status = 'completed',
    adjusted_by = v_actor,
    adjustment_reason = left(btrim(p_reason), 1000),
    updated_at = now()
  where id = p_session_id
    and status = 'completed'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'attendance_session_not_adjustable' using errcode = '22023';
  end if;

  return v_row;
end;
$$;

revoke all on function public.attendance_clock_in(text) from public, anon;
revoke all on function public.attendance_start_break() from public, anon;
revoke all on function public.attendance_end_break() from public, anon;
revoke all on function public.attendance_clock_out(text) from public, anon;
revoke all on function public.attendance_admin_adjust_session(uuid,timestamptz,timestamptz,text) from public, anon;

grant execute on function public.attendance_clock_in(text) to authenticated;
grant execute on function public.attendance_start_break() to authenticated;
grant execute on function public.attendance_end_break() to authenticated;
grant execute on function public.attendance_clock_out(text) to authenticated;
grant execute on function public.attendance_admin_adjust_session(uuid,timestamptz,timestamptz,text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='attendance_sessions'
  ) then
    alter publication supabase_realtime add table public.attendance_sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='attendance_breaks'
  ) then
    alter publication supabase_realtime add table public.attendance_breaks;
  end if;
end
$$;
