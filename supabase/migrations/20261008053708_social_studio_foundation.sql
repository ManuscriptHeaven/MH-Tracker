-- Social Media Studio, internal MH pilot. Publishing and OAuth are deliberately
-- separate releases. No client or employee has access to unpublished content.
begin;

create table public.social_brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  brief jsonb not null default '{}'::jsonb check (jsonb_typeof(brief) = 'object'),
  created_at timestamptz not null default now()
);

insert into public.social_brands (slug, name)
values ('manuscript-heaven', 'Manuscript Heaven');

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.social_brands(id),
  title text not null check (length(btrim(title)) between 1 and 160),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved')),
  current_revision_id uuid,
  approved_revision_id uuid,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_approval_consistency check (
    (status = 'approved' and approved_revision_id = current_revision_id
      and approved_revision_id is not null and approved_by is not null and approved_at is not null)
    or (status <> 'approved' and approved_revision_id is null
      and approved_by is null and approved_at is null)
  )
);

create table public.social_post_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id),
  revision_no integer not null check (revision_no > 0),
  platform text not null check (platform in ('facebook', 'instagram', 'linkedin')),
  caption text not null check (length(btrim(caption)) between 1 and 5000),
  image_brief text not null default '' check (length(image_brief) <= 2000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (post_id, revision_no),
  unique (post_id, id)
);

alter table public.social_posts
  add constraint social_current_revision_same_post
    foreign key (id, current_revision_id)
    references public.social_post_revisions(post_id, id),
  add constraint social_approved_revision_same_post
    foreign key (id, approved_revision_id)
    references public.social_post_revisions(post_id, id);

create table public.social_approval_events (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id),
  revision_id uuid not null,
  event_type text not null check (event_type in
    ('submitted', 'approved', 'changes_requested', 'approval_invalidated')),
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (post_id, revision_id)
    references public.social_post_revisions(post_id, id)
);

create table public.social_assets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.social_brands(id),
  storage_path text not null unique
    check (storage_path <> '' and storage_path !~ '(^/|\.\.)'),
  original_name text not null,
  permission_source text not null check (permission_source in ('owned', 'client_consent')),
  permission_evidence text not null check (length(btrim(permission_evidence)) > 0),
  permission_revoked_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index social_posts_brand_updated on public.social_posts (brand_id, updated_at desc);
create index social_revisions_post_order on public.social_post_revisions (post_id, revision_no desc);
create index social_assets_brand on public.social_assets (brand_id);
create index social_approval_events_post on public.social_approval_events (post_id, created_at desc);

-- Explicit grants remain required as Supabase changes default Data API grants.
-- All writable post state goes through RPCs below, not direct table updates.
alter table public.social_brands enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_revisions enable row level security;
alter table public.social_approval_events enable row level security;
alter table public.social_assets enable row level security;

revoke all on public.social_brands, public.social_posts,
  public.social_post_revisions, public.social_approval_events,
  public.social_assets from public, anon, authenticated;
grant select on public.social_brands, public.social_posts,
  public.social_post_revisions, public.social_approval_events,
  public.social_assets to authenticated;
grant insert on public.social_assets to authenticated;
grant update (permission_revoked_at) on public.social_assets to authenticated;

create policy social_brands_admin_read on public.social_brands
  for select to authenticated using ((select public.phase6_app_actor_class()) = 'admin');
create policy social_posts_admin_read on public.social_posts
  for select to authenticated using ((select public.phase6_app_actor_class()) = 'admin');
create policy social_revisions_admin_read on public.social_post_revisions
  for select to authenticated using ((select public.phase6_app_actor_class()) = 'admin');
create policy social_events_admin_read on public.social_approval_events
  for select to authenticated using ((select public.phase6_app_actor_class()) = 'admin');
create policy social_assets_admin_read on public.social_assets
  for select to authenticated using ((select public.phase6_app_actor_class()) = 'admin');
create policy social_assets_admin_insert on public.social_assets
  for insert to authenticated with check (
    (select public.phase6_app_actor_class()) = 'admin'
    and created_by = (select auth.uid())
    and split_part(storage_path, '/', 1) = brand_id::text
  );
create policy social_assets_admin_revoke on public.social_assets
  for update to authenticated
  using ((select public.phase6_app_actor_class()) = 'admin')
  with check ((select public.phase6_app_actor_class()) = 'admin');

insert into storage.buckets (id, name, public, file_size_limit)
values ('social-drafts', 'social-drafts', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy social_drafts_admin_read on storage.objects
  for select to authenticated using (
    bucket_id = 'social-drafts'
    and (select public.phase6_app_actor_class()) = 'admin'
  );
create policy social_drafts_admin_upload on storage.objects
  for insert to authenticated with check (
    bucket_id = 'social-drafts'
    and (select public.phase6_app_actor_class()) = 'admin'
    and exists (select 1 from public.social_brands b
      where b.id::text = (storage.foldername(name))[1])
  );

-- The functions are a narrow security boundary: the caller's active profile
-- is checked again inside each mutation, independently from the UI.
create function public.social_create_post(
  p_brand_id uuid, p_title text, p_caption text,
  p_platform text default 'facebook', p_image_brief text default ''
) returns uuid language plpgsql security definer
set search_path = pg_catalog, pg_temp as $fn$
declare v_actor uuid := (select auth.uid()); v_post uuid; v_revision uuid;
begin
  if v_actor is null or public.phase6_app_actor_class() is distinct from 'admin' then
    raise exception 'social_permission_denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.social_brands where id = p_brand_id) then
    raise exception 'social_brand_not_found' using errcode = '22023';
  end if;
  insert into public.social_posts(brand_id, title, created_by)
  values (p_brand_id, p_title, v_actor) returning id into v_post;
  insert into public.social_post_revisions(post_id, revision_no, platform,
    caption, image_brief, created_by)
  values (v_post, 1, p_platform, p_caption, coalesce(p_image_brief, ''), v_actor)
  returning id into v_revision;
  update public.social_posts set current_revision_id = v_revision where id = v_post;
  return v_post;
end $fn$;

create function public.social_revise_post(
  p_post_id uuid, p_expected_revision_id uuid, p_caption text,
  p_platform text, p_image_brief text default ''
) returns uuid language plpgsql security definer
set search_path = pg_catalog, pg_temp as $fn$
declare v_actor uuid := (select auth.uid()); v_post public.social_posts%rowtype;
  v_revision uuid; v_number integer;
begin
  if v_actor is null or public.phase6_app_actor_class() is distinct from 'admin' then
    raise exception 'social_permission_denied' using errcode = '42501';
  end if;
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or v_post.current_revision_id is distinct from p_expected_revision_id then
    raise exception 'social_stale_revision' using errcode = '40001';
  end if;
  select revision_no + 1 into v_number from public.social_post_revisions
    where id = v_post.current_revision_id;
  insert into public.social_post_revisions(post_id, revision_no, platform,
    caption, image_brief, created_by)
  values (p_post_id, v_number, p_platform, p_caption, coalesce(p_image_brief, ''), v_actor)
  returning id into v_revision;
  update public.social_posts set current_revision_id = v_revision, status = 'draft',
    approved_revision_id = null, approved_by = null, approved_at = null,
    updated_at = now() where id = p_post_id;
  if v_post.status = 'approved' then
    insert into public.social_approval_events(post_id, revision_id, event_type, actor_id)
    values (p_post_id, v_post.current_revision_id, 'approval_invalidated', v_actor);
  end if;
  return v_revision;
end $fn$;

create function public.social_submit_post(p_post_id uuid, p_revision_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, pg_temp as $fn$
declare v_actor uuid := (select auth.uid()); v_post public.social_posts%rowtype;
begin
  if v_actor is null or public.phase6_app_actor_class() is distinct from 'admin' then
    raise exception 'social_permission_denied' using errcode = '42501';
  end if;
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or v_post.status <> 'draft'
    or v_post.current_revision_id is distinct from p_revision_id then
    raise exception 'social_invalid_submission' using errcode = '22023';
  end if;
  update public.social_posts set status = 'in_review', updated_at = now()
    where id = p_post_id;
  insert into public.social_approval_events(post_id, revision_id, event_type, actor_id)
  values (p_post_id, p_revision_id, 'submitted', v_actor);
end $fn$;

create function public.social_approve_post(p_post_id uuid, p_revision_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, pg_temp as $fn$
declare v_actor uuid := (select auth.uid()); v_post public.social_posts%rowtype;
begin
  if v_actor is null or public.phase6_app_actor_class() is distinct from 'admin' then
    raise exception 'social_permission_denied' using errcode = '42501';
  end if;
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or v_post.status <> 'in_review'
    or v_post.current_revision_id is distinct from p_revision_id then
    raise exception 'social_invalid_approval' using errcode = '22023';
  end if;
  update public.social_posts set status = 'approved',
    approved_revision_id = p_revision_id, approved_by = v_actor,
    approved_at = now(), updated_at = now() where id = p_post_id;
  insert into public.social_approval_events(post_id, revision_id, event_type, actor_id)
  values (p_post_id, p_revision_id, 'approved', v_actor);
end $fn$;

create function public.social_request_changes(p_post_id uuid, p_revision_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, pg_temp as $fn$
declare v_actor uuid := (select auth.uid()); v_post public.social_posts%rowtype;
begin
  if v_actor is null or public.phase6_app_actor_class() is distinct from 'admin' then
    raise exception 'social_permission_denied' using errcode = '42501';
  end if;
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or v_post.status <> 'in_review'
    or v_post.current_revision_id is distinct from p_revision_id then
    raise exception 'social_invalid_review' using errcode = '22023';
  end if;
  update public.social_posts set status = 'draft', updated_at = now()
    where id = p_post_id;
  insert into public.social_approval_events(post_id, revision_id, event_type, actor_id)
  values (p_post_id, p_revision_id, 'changes_requested', v_actor);
end $fn$;

revoke all on function public.social_create_post(uuid, text, text, text, text),
  public.social_revise_post(uuid, uuid, text, text, text),
  public.social_submit_post(uuid, uuid),
  public.social_approve_post(uuid, uuid),
  public.social_request_changes(uuid, uuid) from public, anon, authenticated;
grant execute on function public.social_create_post(uuid, text, text, text, text),
  public.social_revise_post(uuid, uuid, text, text, text),
  public.social_submit_post(uuid, uuid),
  public.social_approve_post(uuid, uuid),
  public.social_request_changes(uuid, uuid) to authenticated;

commit;
