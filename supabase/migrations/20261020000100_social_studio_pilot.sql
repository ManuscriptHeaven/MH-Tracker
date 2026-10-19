-- Social Studio internal pilot: owner-scoped drafts with revision-safe approvals.
-- No external publishing or tokens are enabled by this migration.
create table if not exists public.social_brands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  brief jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid not null,
  status text not null default 'draft' check (status in ('draft','in_review','approved','scheduled','publishing','published','failed','cancelled')),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (brand_id, owner_id) references public.social_brands(id, owner_id) on delete cascade
);
create table if not exists public.social_post_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  caption text not null check (length(caption) between 1 and 10000),
  created_at timestamptz not null default now(),
  unique (post_id, revision_number),
  unique (id, post_id, owner_id),
  foreign key (post_id, owner_id) references public.social_posts(id, owner_id) on delete cascade
);
create table if not exists public.social_post_targets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null,
  approved_revision_id uuid,
  status text not null default 'draft' check (status in ('draft','in_review','approved','scheduled','publishing','published','failed','cancelled')),
  scheduled_at timestamptz,
  published_external_id text,
  created_at timestamptz not null default now(),
  foreign key (post_id, owner_id) references public.social_posts(id, owner_id) on delete cascade,
  foreign key (approved_revision_id, post_id, owner_id)
    references public.social_post_revisions(id, post_id, owner_id),
  constraint social_target_schedule_guard check (
    status not in ('approved','scheduled','publishing','published') or approved_revision_id is not null
  ),
  constraint social_target_schedule_time_guard check (
    status <> 'scheduled' or scheduled_at is not null
  )
);
create index if not exists social_post_targets_due_idx
  on public.social_post_targets (scheduled_at) where status = 'scheduled';

-- For the pilot, the only exposed principal is the authenticated owner.
-- Publishing transitions are intentionally blocked from the browser.
create or replace function public.social_target_transition_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('publishing','published') then
    raise exception 'social_target_locked';
  end if;
  if new.status in ('publishing','published') then
    raise exception 'social_publish_server_only';
  end if;
  if (new.status in ('approved','scheduled')) and
     not exists (
       select 1 from public.social_post_revisions r
       where r.id = new.approved_revision_id and r.post_id = new.post_id
       and r.owner_id = new.owner_id
       and r.revision_number = (
         select max(r2.revision_number) from public.social_post_revisions r2
         where r2.post_id = new.post_id and r2.owner_id = new.owner_id
       )
     ) then
    raise exception 'social_approval_stale';
  end if;
  return new;
end $$;
drop trigger if exists social_target_transition_guard on public.social_post_targets;
create trigger social_target_transition_guard before update on public.social_post_targets
for each row execute function public.social_target_transition_guard();

-- Any new revision clears approvals and schedules in the same transaction.
create or replace function public.social_revision_invalidate_approval()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.social_post_targets t where t.post_id = new.post_id
    and t.status in ('publishing','published')) then
    raise exception 'social_post_locked';
  end if;
  update public.social_post_targets
  set approved_revision_id = null, scheduled_at = null, status = 'draft'
  where post_id = new.post_id and owner_id = new.owner_id;
  update public.social_posts set status = 'draft'
  where id = new.post_id and owner_id = new.owner_id;
  return new;
end $$;
drop trigger if exists social_revision_invalidate_approval on public.social_post_revisions;
create trigger social_revision_invalidate_approval after insert on public.social_post_revisions
for each row execute function public.social_revision_invalidate_approval();

-- Immutable revision history. New revision required for edits.
create or replace function public.social_revision_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'social_revision_immutable';
end $$;
drop trigger if exists social_revision_immutable on public.social_post_revisions;
create trigger social_revision_immutable before update or delete on public.social_post_revisions
for each row execute function public.social_revision_immutable();

alter table public.social_brands enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_revisions enable row level security;
alter table public.social_post_targets enable row level security;
revoke all on public.social_brands, public.social_posts, public.social_post_revisions, public.social_post_targets from anon;
grant select, insert, update, delete on public.social_brands, public.social_posts to authenticated;
grant select, insert on public.social_post_revisions to authenticated;
grant select, insert, update on public.social_post_targets to authenticated;
create policy social_brands_owner on public.social_brands for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy social_posts_owner on public.social_posts for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy social_revisions_read on public.social_post_revisions for select to authenticated
using (owner_id = (select auth.uid()));
create policy social_revisions_insert on public.social_post_revisions for insert to authenticated
with check (owner_id = (select auth.uid()));
create policy social_targets_read on public.social_post_targets for select to authenticated
using (owner_id = (select auth.uid()));
create policy social_targets_insert on public.social_post_targets for insert to authenticated
with check (owner_id = (select auth.uid()) and status in ('draft','in_review'));
create policy social_targets_update on public.social_post_targets for update to authenticated
using (owner_id = (select auth.uid()) and status not in ('publishing','published'))
with check (owner_id = (select auth.uid()) and status not in ('publishing','published'));
