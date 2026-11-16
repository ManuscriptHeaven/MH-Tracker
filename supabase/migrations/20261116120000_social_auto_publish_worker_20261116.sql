-- Social Studio: scheduled auto-publishing for Facebook Pages.
-- 1. Service-role checks work with both legacy and current PostgREST JWT settings.
-- 2. Admin-controlled per-Page publishing switch (server RPC, never a direct browser write).
-- 3. A trusted worker secret generated inside the database (Vault), never shown to any user.
-- 4. pg_cron + pg_net call the delivery worker every 5 minutes, only when a post is due.

-- 1. Current PostgREST exposes the role in request.jwt.claims (JSON); the legacy
--    request.jwt.claim.role setting may be absent, which made every server RPC refuse
--    the service role. auth.role() reads both.
do $patch$
declare
  v_fn record;
  v_def text;
begin
  for v_fn in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'social\_server\_%'
  loop
    v_def := pg_get_functiondef(v_fn.oid);
    if position('current_setting(''request.jwt.claim.role'',true) is distinct from ''service_role''' in v_def) > 0 then
      execute replace(v_def,
        'current_setting(''request.jwt.claim.role'',true) is distinct from ''service_role''',
        '(select auth.role()) is distinct from ''service_role''');
    end if;
  end loop;
end
$patch$;

-- 2. Publishing switch. Exactly one connected Page per brand can be enabled.
create or replace function public.social_server_set_publishing(
  p_connection uuid, p_owner uuid, p_enabled boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_brand uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service identity required';
  end if;
  select brand_id into v_brand from public.social_facebook_connections
    where id = p_connection and owner_id = p_owner and status = 'connected';
  if v_brand is null then return false; end if;
  if p_enabled then
    update public.social_facebook_connections set publish_enabled = false, updated_at = now()
      where owner_id = p_owner and brand_id = v_brand and id <> p_connection and publish_enabled;
  end if;
  update public.social_facebook_connections set publish_enabled = p_enabled, updated_at = now()
    where id = p_connection and owner_id = p_owner;
  return true;
end $$;

-- Facebook rejected the stored Page token (expired or revoked): stop publishing until reconnected.
create or replace function public.social_server_mark_facebook_expired(p_connection uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service identity required';
  end if;
  update public.social_facebook_connections
    set status = 'expired', publish_enabled = false, updated_at = now()
    where id = p_connection and status = 'connected';
  return found;
end $$;

-- 3. Worker secret lives only in Vault. The Edge Function verifies a presented secret through this RPC.
do $secret$
begin
  if not exists (select 1 from vault.secrets where name = 'social_worker_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'social_worker_secret', 'MH Tracker social delivery worker shared secret');
  end if;
end
$secret$;

create or replace function public.social_server_verify_worker(p_secret text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_expected text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service identity required';
  end if;
  select decrypted_secret into v_expected from vault.decrypted_secrets
    where name = 'social_worker_secret' limit 1;
  return v_expected is not null and char_length(v_expected) >= 32
    and p_secret is not null and p_secret = v_expected;
end $$;

revoke all on function public.social_server_set_publishing(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.social_server_mark_facebook_expired(uuid) from public, anon, authenticated;
revoke all on function public.social_server_verify_worker(text) from public, anon, authenticated;
grant execute on function public.social_server_set_publishing(uuid, uuid, boolean) to service_role;
grant execute on function public.social_server_mark_facebook_expired(uuid) to service_role;
grant execute on function public.social_server_verify_worker(text) to service_role;

-- 4. Scheduler. Calls the worker only when at least one queued post is due.
create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.social_run_delivery_worker()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if not exists (select 1 from public.social_delivery_jobs
      where status = 'queued' and scheduled_at <= now()) then
    return false;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'social_worker_secret' limit 1;
  if v_secret is null then return false; end if;
  perform net.http_post(
    url := 'https://emhvwdhdmajpakoscuyn.supabase.co/functions/v1/social-delivery-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    body := jsonb_build_object('mode', 'scheduled-worker'),
    timeout_milliseconds := 55000
  );
  return true;
end $$;
revoke all on function public.social_run_delivery_worker() from public, anon, authenticated;

do $cron$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'mh-social-delivery-worker' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('mh-social-delivery-worker', '*/5 * * * *',
    'select public.social_run_delivery_worker();');
end
$cron$;
