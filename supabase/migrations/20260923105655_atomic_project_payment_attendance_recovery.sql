begin;

-- One confirmed action has one stable request ID. Only INSERT privileges permit
-- setting this column; existing column-level UPDATE grants cannot rewrite it.
alter table public.finance_transactions add column if not exists payment_request_id text;
create unique index if not exists finance_payment_request_unique
  on public.finance_transactions(created_by, payment_request_id)
  where payment_request_id is not null;

create or replace function public.record_project_payment(
  p_project_id uuid, p_amount numeric, p_request_id text,
  p_payment_date date default current_date,
  p_payment_method text default 'Bank Transfer', p_notes text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_payment public.project_payments;
  v_transaction public.finance_transactions;
  v_project public.projects;
  v_duplicate boolean := false;
begin
  if v_actor is null or coalesce(public.phase6_app_actor_class(), '') <> 'admin' then
    raise exception 'payment_admin_required' using errcode='42501';
  end if;
  if p_request_id is null or length(btrim(p_request_id)) not between 8 and 200 then
    raise exception 'payment_request_id_required' using errcode='22023';
  end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity')
     or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_payment_date is null then
    raise exception 'payment_invalid_amount_or_date' using errcode='22023';
  end if;

  -- Respect project RLS (including workspace restrictions) before touching finance.
  select * into v_project from public.projects where id=p_project_id;
  if v_project.id is null then
    raise exception 'payment_project_not_accessible' using errcode='42501';
  end if;
  -- Serialize concurrent payments before checking the authoritative balance.
  select * into v_payment from public.project_payments where project_id=p_project_id for update;
  if v_payment.id is null then
    raise exception 'payment_account_missing' using errcode='22023';
  end if;

  select * into v_transaction from public.finance_transactions
  where created_by=v_actor and payment_request_id=p_request_id;
  if v_transaction.id is not null then
    if v_transaction.project_id is distinct from p_project_id
       or v_transaction.amount is distinct from p_amount
       or v_transaction.transaction_date is distinct from p_payment_date
       or v_transaction.payment_method is distinct from p_payment_method
       or v_transaction.notes is distinct from coalesce(p_notes, '')
       or v_transaction.is_soft_deleted then
      raise exception 'payment_request_conflict' using errcode='22023';
    end if;
    v_duplicate := true;
  else
    if p_amount > v_payment.total_price - v_payment.advance_paid then
      raise exception 'payment_exceeds_outstanding_balance' using errcode='22023';
    end if;
    insert into public.finance_transactions (
      type, category, description, amount, transaction_date, project_id,
      created_by, updated_by, currency, exchange_rate, amount_pkr,
      client_name, payment_method, notes, payment_status, paid_date, payment_request_id
    ) values (
      'income', 'Project Payment', 'Payment received for ' || v_project.project_title,
      p_amount, p_payment_date, p_project_id, v_actor, v_actor, 'USD', 1, p_amount,
      v_project.client_name, p_payment_method, coalesce(p_notes, ''), 'Paid', p_payment_date, p_request_id
    ) returning * into v_transaction;

    update public.project_payments
    set advance_paid=advance_paid+p_amount,
        payment_status=case when advance_paid+p_amount >= total_price then 'Fully Paid'::public.payment_status
          else 'Partially Paid'::public.payment_status end,
        payment_date=p_payment_date, notes=coalesce(p_notes, ''), updated_by=v_actor
    where id=v_payment.id
    returning * into v_payment;
    if not found then raise exception 'payment_balance_update_denied' using errcode='42501'; end if;
  end if;
  return jsonb_build_object('projectId', p_project_id, 'transactionId', v_transaction.id,
    'totalPaid', v_payment.advance_paid, 'remainingBalance', v_payment.remaining_balance,
    'paymentStatus', v_payment.payment_status, 'duplicate', v_duplicate, 'transaction', to_jsonb(v_transaction));
end;
$$;
revoke all on function public.record_project_payment(uuid,numeric,text,date,text,text) from public,anon;
grant execute on function public.record_project_payment(uuid,numeric,text,date,text,text) to authenticated;

-- Recover an abandoned shift only after 12 hours without a heartbeat. Brief
-- disconnects still pause/resume the same shift. No absent time is credited.
create or replace function public.attendance_expire_own_session()
returns public.attendance_sessions
language plpgsql security definer set search_path=pg_catalog,public,pg_temp
as $$
declare v_session public.attendance_sessions; v_end timestamptz;
begin
  if auth.uid() is null then raise exception 'attendance_not_authenticated' using errcode='42501'; end if;
  select * into v_session from public.attendance_sessions
  where user_id=auth.uid() and status='active'
    and coalesce(last_app_heartbeat_at,clock_in) < clock_timestamp()-interval '12 hours'
  for update;
  if v_session.id is null then return null; end if;
  v_end := greatest(v_session.clock_in,coalesce(v_session.last_app_heartbeat_at,v_session.clock_in));
  update public.attendance_breaks set ended_at=greatest(started_at,v_end)
  where session_id=v_session.id and ended_at is null;
  update public.attendance_sessions set status='completed',clock_out=v_end,updated_at=clock_timestamp(),
    note=concat_ws(E'\n',nullif(note,''),'Automatically ended after 12 hours without an app connection.')
  where id=v_session.id returning * into v_session;
  return v_session;
end;
$$;
revoke all on function public.attendance_expire_own_session() from public,anon,authenticated;

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

  perform public.attendance_expire_own_session();

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

  v_row := public.attendance_expire_own_session();
  if v_row.id is not null then return v_row; end if;

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


notify pgrst, 'reload schema';
commit;
