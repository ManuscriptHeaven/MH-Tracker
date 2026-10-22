-- Admin-only Social Studio pilot. Adds new tables only; no changes to existing tracker data.
-- No social provider connection or automatic publishing exists in this release.
create table public.social_brands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  brief text not null default '',
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  brand_id uuid not null,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint social_post_brand_fk foreign key (brand_id, owner_id)
    references public.social_brands(id, owner_id) on delete restrict
);

create table public.social_post_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  post_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  caption text not null check (length(btrim(caption)) between 1 and 8000),
  created_at timestamptz not null default now(),
  unique (post_id, revision_number),
  unique (id, post_id, owner_id),
  constraint social_revision_post_fk foreign key (post_id, owner_id)
    references public.social_posts(id, owner_id) on delete restrict
);

create table public.social_post_targets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  post_id uuid not null,
  channel text not null check (channel in ('facebook', 'instagram', 'linkedin')),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'scheduled', 'cancelled')),
  approved_revision_id uuid,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (post_id, channel),
  foreign key (post_id, owner_id) references public.social_posts(id, owner_id) on delete restrict,
  foreign key (approved_revision_id, post_id, owner_id)
    references public.social_post_revisions(id, post_id, owner_id),
  constraint social_target_approval_consistency check (
    (status in ('approved', 'scheduled') and approved_revision_id is not null
      and approved_by is not null and approved_at is not null)
    or (status not in ('approved', 'scheduled') and approved_revision_id is null
      and approved_by is null and approved_at is null)
  ),
  constraint social_target_schedule_consistency check (
    (status = 'scheduled' and scheduled_at is not null)
    or (status <> 'scheduled' and scheduled_at is null)
  )
);

create index social_post_targets_owner_status_idx on public.social_post_targets(owner_id,status);
create index social_post_revisions_post_num_idx on public.social_post_revisions(post_id,revision_number desc);

-- Revised content is append-only; a new revision withdraws any approval or planned slot.
create function public.social_revision_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Social content revisions are immutable';
end $$;
create trigger social_revision_immutable before update or delete on public.social_post_revisions
  for each row execute function public.social_revision_immutable();

create function public.social_revision_invalidate()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.social_post_targets
    set status='draft', approved_revision_id=null, approved_by=null,
        approved_at=null, scheduled_at=null
  where post_id = new.post_id and owner_id = new.owner_id;
  return new;
end $$;
create trigger social_revision_invalidate after insert on public.social_post_revisions
  for each row execute function public.social_revision_invalidate();

-- Enforce review -> exact-revision approval -> future schedule at database level.
create function public.social_target_transition()
returns trigger language plpgsql set search_path = '' as $$
declare latest_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.approved_revision_id is not null
        or new.approved_by is not null or new.approved_at is not null
        or new.scheduled_at is not null then
      raise exception 'New target must start as draft';
    end if;
    return new;
  end if;
  if new.owner_id <> old.owner_id or new.post_id <> old.post_id
      or new.channel <> old.channel or new.created_at <> old.created_at then
    raise exception 'Target identity cannot change';
  end if;
  if new.status = old.status and new.approved_revision_id is not distinct from old.approved_revision_id
      and new.approved_by is not distinct from old.approved_by
      and new.approved_at is not distinct from old.approved_at
      and new.scheduled_at is not distinct from old.scheduled_at then
    return new;
  end if;
  if new.status = 'draft' then
    if new.approved_revision_id is not null or new.approved_by is not null
        or new.approved_at is not null or new.scheduled_at is not null then
      raise exception 'Draft cannot retain approval or schedule';
    end if;
    return new;
  end if;
  if new.status = 'in_review' then
    if old.status <> 'draft' or new.approved_revision_id is not null
        or new.approved_by is not null or new.approved_at is not null
        or new.scheduled_at is not null then
      raise exception 'Review requires a draft';
    end if;
    return new;
  end if;
  if new.status = 'approved' and old.status = 'in_review' then
    select id into latest_id from public.social_post_revisions
      where post_id = new.post_id and owner_id = new.owner_id
      order by revision_number desc limit 1;
    if latest_id is null or new.approved_revision_id is distinct from latest_id
        or new.approved_by is distinct from auth.uid()
        or new.approved_at is null or new.scheduled_at is not null then
      raise exception 'Approval must identify the current immutable revision and reviewer';
    end if;
    return new;
  end if;
  if new.status = 'scheduled' and old.status = 'approved' then
    select id into latest_id from public.social_post_revisions
      where post_id = new.post_id and owner_id = new.owner_id
      order by revision_number desc limit 1;
    if new.approved_revision_id is distinct from latest_id
        or new.approved_revision_id is distinct from old.approved_revision_id
        or new.approved_by is distinct from old.approved_by
        or new.approved_at is distinct from old.approved_at
        or new.scheduled_at is null or new.scheduled_at <= now() then
      raise exception 'Only a current approved revision can be scheduled in the future';
    end if;
    return new;
  end if;
  if new.status = 'cancelled' and old.status in ('draft','in_review','approved','scheduled') then
    if new.approved_revision_id is not null or new.approved_by is not null
        or new.approved_at is not null or new.scheduled_at is not null then
      raise exception 'Cancelled targets cannot retain approval';
    end if;
    return new;
  end if;
  raise exception 'Invalid social target transition';
end $$;
create trigger social_target_transition before insert or update on public.social_post_targets
  for each row execute function public.social_target_transition();

alter table public.social_brands enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_revisions enable row level security;
alter table public.social_post_targets enable row level security;

revoke all on public.social_brands, public.social_posts,
  public.social_post_revisions, public.social_post_targets from anon, authenticated;

grant select,insert,update on public.social_brands to authenticated;
grant select,insert on public.social_posts to authenticated;
grant select,insert on public.social_post_revisions to authenticated;
grant select,insert,update on public.social_post_targets to authenticated;

create policy social_brands_admin_select on public.social_brands for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.phase6_app_actor_class()) = 'admin');
create policy social_brands_admin_insert on public.social_brands for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.phase6_app_actor_class()) = 'admin');
create policy social_brands_admin_update on public.social_brands for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.phase6_app_actor_class()) = 'admin')
  with check (owner_id = (select auth.uid()) and (select public.phase6_app_actor_class()) = 'admin');

create policy social_posts_admin_select on public.social_posts for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.phase6_app_actor_class()) = 'admin');
create policy social_posts_admin_insert on public.social_posts for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.phase6_app_actor_class()) = 'admin');

create policy social_revisions_admin_select on public.social_post_revisions for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.phase6_app_actor_class()) = 'admin');
create policy social_revisions_admin_insert on public.social_post_revisions for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.phase6_app_actor_class()) = 'admin');

create policy social_targets_admin_select on public.social_post_targets for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.phase6_app_actor_class()) = 'admin');
create policy social_targets_admin_insert on public.social_post_targets for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.phase6_app_actor_class()) = 'admin');
create policy social_targets_admin_update on public.social_post_targets for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.phase6_app_actor_class()) = 'admin')
  with check (owner_id = (select auth.uid()) and (select public.phase6_app_actor_class()) = 'admin');

-- Keep privileged transition helpers inaccessible via direct API calls.
revoke execute on function public.social_revision_immutable() from public, anon, authenticated;
revoke execute on function public.social_revision_invalidate() from public, anon, authenticated;
revoke execute on function public.social_target_transition() from public, anon, authenticated;


-- A single transaction creates the post, first revision, and planning target.
create function public.social_create_draft(p_brand_id uuid, p_caption text, p_channel text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if (select public.phase6_app_actor_class()) <> 'admin' then
    raise exception 'Social Studio requires admin access';
  end if;
  insert into public.social_posts (owner_id, brand_id)
    values (auth.uid(), p_brand_id) returning id into v_id;
  insert into public.social_post_revisions (owner_id, post_id, revision_number, caption)
    values (auth.uid(), v_id, 1, p_caption);
  insert into public.social_post_targets (owner_id, post_id, channel)
    values (auth.uid(), v_id, p_channel);
  return v_id;
end $$;

-- Lock the post before numbering a new revision to avoid duplicate revision numbers.
create function public.social_append_revision(p_post_id uuid, p_caption text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_revision_id uuid;
begin
  perform 1 from public.social_posts
    where id = p_post_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Social draft not accessible'; end if;
  insert into public.social_post_revisions (owner_id, post_id, revision_number, caption)
  values (
    auth.uid(), p_post_id,
    (select coalesce(max(revision_number),0) + 1 from public.social_post_revisions
      where post_id = p_post_id), p_caption
  ) returning id into v_revision_id;
  return v_revision_id;
end $$;

revoke all on function public.social_create_draft(uuid,text,text) from public, anon;
revoke all on function public.social_append_revision(uuid,text) from public, anon;
grant execute on function public.social_create_draft(uuid,text,text) to authenticated;
grant execute on function public.social_append_revision(uuid,text) to authenticated;
