-- Social Studio Facebook delivery slice. Rollout defaults: NO live publishing, no OAuth credentials.
-- Companion to existing private artwork + exact-revision approval schema.
-- Secure token storage uses Supabase Vault; no token is exposed in any admin-readable table.
create table public.social_facebook_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid not null,
  page_id text not null check (page_id ~ '^[0-9]{3,30}$'),
  page_name text not null check (char_length(btrim(page_name)) between 1 and 180),
  status text not null default 'connected'
    check(status in ('connected','disconnected','expired')),
  publish_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,brand_id,page_id),
  unique(id,owner_id,brand_id),
  foreign key(brand_id,owner_id) references public.social_brands(id,owner_id)
);
alter table public.social_facebook_connections enable row level security;
revoke all on public.social_facebook_connections from anon,authenticated;
grant select on public.social_facebook_connections to authenticated;
create policy social_fb_connections_admin_read on public.social_facebook_connections
for select to authenticated using(
  owner_id=(select auth.uid()) and (select public.phase6_app_actor_class())='admin'
);

-- Tables readable only using service-role backend code. OAuth state is a hash, never raw state.
create table public.social_facebook_oauth_states (
  state_hash text primary key check(length(state_hash)=64),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid not null,
  expected_page_id text check(expected_page_id is null or expected_page_id ~ '^[0-9]{3,30}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+ interval '10 minutes'),
  consumed_at timestamptz,
  foreign key(brand_id,owner_id) references public.social_brands(id,owner_id)
);
create index social_fb_oauth_expiry_idx on public.social_facebook_oauth_states(expires_at);
alter table public.social_facebook_oauth_states enable row level security;
revoke all on public.social_facebook_oauth_states from anon,authenticated;
grant select,insert,update,delete on public.social_facebook_oauth_states to service_role;

create table public.social_facebook_token_refs (
  connection_id uuid primary key references public.social_facebook_connections(id) on delete cascade,
  token_secret_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.social_facebook_token_refs enable row level security;
revoke all on public.social_facebook_token_refs from anon,authenticated;
grant select,insert,update,delete on public.social_facebook_token_refs to service_role;

-- A server role can upsert only a Page already authorized via Facebook Login.
-- This is an internal service-only RPC, NEVER callable using the browser JWT.
create function public.social_server_save_facebook_page(
  p_owner uuid, p_brand uuid, p_page_id text, p_page_name text, p_page_token text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_connection uuid; v_secret uuid; v_previous uuid;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'Service identity required';
  end if;
  if p_page_id !~ '^[0-9]{3,30}$'
     or char_length(btrim(p_page_name)) not between 1 and 180
     or char_length(p_page_token) < 30
     or not exists(select 1 from public.social_brands
       where owner_id=p_owner and id=p_brand) then
    raise exception 'Invalid verified Facebook Page';
  end if;
  insert into public.social_facebook_connections
    (owner_id,brand_id,page_id,page_name,status,publish_enabled)
  values(p_owner,p_brand,p_page_id,p_page_name,'connected',false)
  on conflict(owner_id,brand_id,page_id) do update set
    page_name=excluded.page_name,status='connected',
    publish_enabled=false,updated_at=now()
  returning id into v_connection;
  select token_secret_id into v_previous
    from public.social_facebook_token_refs where connection_id=v_connection for update;
  v_secret:=vault.create_secret(p_page_token);
  insert into public.social_facebook_token_refs(connection_id,token_secret_id)
    values(v_connection,v_secret)
    on conflict(connection_id) do update set token_secret_id=excluded.token_secret_id;
  if v_previous is not null then
    delete from vault.secrets where id=v_previous;
  end if;
  return v_connection;
end $$;

create function public.social_server_facebook_token(p_connection uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_token text;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'Service identity required';
  end if;
  select secret.decrypted_secret into v_token
  from public.social_facebook_token_refs ref
  join vault.decrypted_secrets secret on secret.id=ref.token_secret_id
  join public.social_facebook_connections c on c.id=ref.connection_id
  where c.id=p_connection and c.status='connected';
  return v_token;
end $$;

create function public.social_server_disconnect_facebook(p_connection uuid,p_owner uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_secret uuid;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'Service identity required';
  end if;
  if not exists(select 1 from public.social_facebook_connections
    where id=p_connection and owner_id=p_owner) then return false; end if;
  update public.social_facebook_connections set status='disconnected',
    publish_enabled=false,updated_at=now()
  where id=p_connection and owner_id=p_owner;
  select token_secret_id into v_secret from public.social_facebook_token_refs
  where connection_id=p_connection;
  delete from public.social_facebook_token_refs where connection_id=p_connection;
  if v_secret is not null then delete from vault.secrets where id=v_secret; end if;
  return true;
end $$;

revoke all on function public.social_server_save_facebook_page(uuid,uuid,text,text,text)
  from public,anon,authenticated;
revoke all on function public.social_server_facebook_token(uuid)
  from public,anon,authenticated;
revoke all on function public.social_server_disconnect_facebook(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.social_server_save_facebook_page(uuid,uuid,text,text,text) to service_role;
grant execute on function public.social_server_facebook_token(uuid) to service_role;
grant execute on function public.social_server_disconnect_facebook(uuid,uuid) to service_role;

alter table public.social_post_targets
  add constraint social_fb_target_owner_unique unique(id,owner_id);

-- One durable job records exactly which revision and schedule were approved.
-- Fake provider is the only default; actual Facebook requires a separately gated release.
create table public.social_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null,
  revision_id uuid not null,
  scheduled_at timestamptz not null,
  status text not null default 'queued'
    check(status in ('queued','processing','simulated','published','unknown','blocked','cancelled')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 5),
  lease_id uuid,
  locked_at timestamptz,
  provider_post_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(target_id,revision_id,scheduled_at),
  foreign key(target_id,owner_id) references public.social_post_targets(id,owner_id),
  foreign key(revision_id) references public.social_post_revisions(id)
);
create index social_jobs_due_idx on public.social_delivery_jobs(scheduled_at)
  where status='queued';
create index social_jobs_owner_idx on public.social_delivery_jobs(owner_id,created_at desc);
alter table public.social_delivery_jobs enable row level security;
revoke all on public.social_delivery_jobs from anon,authenticated;
grant select on public.social_delivery_jobs to authenticated;
create policy social_jobs_admin_read on public.social_delivery_jobs for select to authenticated
  using(owner_id=(select auth.uid()) and (select public.phase6_app_actor_class())='admin');

-- Scheduling is currently initiated by the existing, protected exact-revision approval transition.
-- Cancel queued deliveries when approval is withdrawn; processing attempts are quarantined.
create function public.social_enqueue_on_schedule()
returns trigger language plpgsql security definer set search_path='' as $
begin
  if new.channel <> 'facebook' then return new; end if;
  if new.status='scheduled' and (
      old.status is distinct from 'scheduled'
      or old.approved_revision_id is distinct from new.approved_revision_id
      or old.scheduled_at is distinct from new.scheduled_at) then
    update public.social_delivery_jobs set status='cancelled',updated_at=now()
      where target_id=new.id and status='queued';
    insert into public.social_delivery_jobs(owner_id,target_id,revision_id,scheduled_at)
      values(new.owner_id,new.id,new.approved_revision_id,new.scheduled_at)
      on conflict(target_id,revision_id,scheduled_at) do update set
        status=case when public.social_delivery_jobs.status in ('queued','cancelled','blocked')
          then 'queued' else public.social_delivery_jobs.status end,
        updated_at=now();
  elsif new.status <> 'scheduled' and old.status='scheduled' then
    update public.social_delivery_jobs set status='cancelled',updated_at=now()
      where target_id=new.id and status='queued';
  end if;
  return new;
end $$;
create trigger social_enqueue_on_schedule after update of
  status,approved_revision_id,scheduled_at on public.social_post_targets
for each row execute function public.social_enqueue_on_schedule();
revoke execute on function public.social_enqueue_on_schedule()
  from public,anon,authenticated;

-- Worker RPCs are accessible only to service_role. No browser mutation policy.
create function public.social_server_claim_due(p_limit integer default 5,p_owner uuid default null)
returns setof public.social_delivery_jobs
language plpgsql security definer set search_path='' as $$
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'Service identity required';
  end if;
  if p_limit not between 1 and 10 then raise exception 'Invalid batch size'; end if;

  -- A lost acknowledgement might mean Facebook already received a post.
  -- Never automatically retry a stale attempt. An operator must reconcile it.
  update public.social_delivery_jobs set status='unknown',lease_id=null,updated_at=now(),
    error_code='STALE_UNCERTAIN_OUTCOME'
  where status='processing' and locked_at < now()-interval '10 minutes';

  return query
  with ready as (
    select j.id from public.social_delivery_jobs j
    join public.social_post_targets t on t.id=j.target_id
    join public.social_post_revisions r on r.id=j.revision_id and r.post_id=t.post_id
    where j.status='queued' and j.scheduled_at<=now()
      and (p_owner is null or j.owner_id=p_owner)
      and t.status='scheduled'
      and t.channel='facebook'
      and t.approved_revision_id=j.revision_id
      and t.scheduled_at=j.scheduled_at
      and not exists(select 1 from public.social_assets a
        where a.id=r.asset_id and a.rights_status <> 'cleared')
    order by j.scheduled_at,j.id
    for update of j skip locked
    limit p_limit
  )
  update public.social_delivery_jobs j
    set status='processing',lease_id=gen_random_uuid(),locked_at=now(),
      attempt_count=j.attempt_count+1,updated_at=now()
  from ready where j.id=ready.id
  returning j.*;
end $$;

create function public.social_server_complete_delivery(
 p_id uuid,p_lease uuid,p_status text,p_provider_id text default null,p_error text default null
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_affected integer;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'Service identity required';
  end if;
  if p_status not in ('simulated','published','unknown','blocked','cancelled') then
    raise exception 'Invalid completion outcome';
  end if;
  update public.social_delivery_jobs
    set status=p_status,provider_post_id=case when p_status='published' then left(p_provider_id,200) else null end,
      error_code=case when p_status in ('blocked','unknown') then left(coalesce(p_error,'UNSPECIFIED'),80) else null end,
      lease_id=null,updated_at=now()
  where id=p_id and lease_id=p_lease and status='processing';
  get diagnostics v_affected=row_count;
  return v_affected=1;
end $$;
revoke all on function public.social_server_claim_due(integer,uuid) from public,anon,authenticated;
revoke all on function public.social_server_complete_delivery(uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.social_server_claim_due(integer,uuid) to service_role;
grant execute on function public.social_server_complete_delivery(uuid,uuid,text,text,text)
  to service_role;
