-- MH Social Studio: private image assets, admin rights controls, media-linked immutable revisions.
-- Applies after social_studio_ai_revision_briefs_20261023. No automatic publishing.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('social-artwork-private','social-artwork-private',false,8388608,
  array['image/png','image/jpeg','image/webp']::text[])
on conflict (id) do nothing;

create table public.social_assets (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id),
 brand_id uuid not null,
 storage_path text not null unique,
 mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
 file_bytes integer not null check(file_bytes between 1 and 8388608),
 source text not null check(source in ('uploaded','ai_generated')),
 rights_status text not null default 'pending' check(rights_status in ('pending','cleared','withdrawn')),
 permission_basis text not null default 'unverified' check(permission_basis in ('unverified','original','licensed','ai_generated')),
 permission_note text not null default '' check(char_length(permission_note) <= 1200),
 creative_brief text not null default '' check(char_length(creative_brief) <= 2000),
 created_at timestamptz not null default now(),
 unique(id,owner_id,brand_id),
 foreign key (brand_id, owner_id) references public.social_brands(id,owner_id) on delete restrict,
 constraint social_asset_path_matches_owner check (
   storage_path like (owner_id::text || '/' || brand_id::text || '/' || id::text || '.%')
   and storage_path ~* '\.(png|jpg|jpeg|webp)$'
 ),
 constraint social_asset_clearance_guard check (
   rights_status <> 'cleared' or
   (permission_basis in ('original','licensed','ai_generated')
     and (permission_basis <> 'licensed' or char_length(btrim(permission_note)) >= 12))
 ),
 constraint social_asset_ai_origin check (
   (source='ai_generated' and permission_basis in ('unverified','ai_generated'))
   or (source='uploaded' and permission_basis <> 'ai_generated')
 )
);

create index social_assets_owner_brand_idx on public.social_assets(owner_id,brand_id,created_at desc);

alter table public.social_assets enable row level security;
revoke all on public.social_assets from anon,authenticated;
grant select,insert,update on public.social_assets to authenticated;

create policy social_asset_admin_read on public.social_assets for select to authenticated
using (owner_id=(select auth.uid()) and (select public.phase6_app_actor_class())='admin');
create policy social_asset_admin_insert on public.social_assets for insert to authenticated
with check(owner_id=(select auth.uid()) and (select public.phase6_app_actor_class())='admin');
create policy social_asset_admin_update on public.social_assets for update to authenticated
using (owner_id=(select auth.uid()) and (select public.phase6_app_actor_class())='admin')
with check(owner_id=(select auth.uid()) and (select public.phase6_app_actor_class())='admin');

-- Storage is private. No public read, no overwrite and no delete of registered objects.
create policy social_artwork_private_read on storage.objects
for select to authenticated using (
 bucket_id='social-artwork-private'
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and (select public.phase6_app_actor_class())='admin'
);
create policy social_artwork_private_insert on storage.objects
for insert to authenticated with check (
 bucket_id='social-artwork-private'
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and (select public.phase6_app_actor_class())='admin'
 and name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'
 and exists (
   select 1 from public.social_brands b
   where b.id = case when (storage.foldername(name))[2]
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     then ((storage.foldername(name))[2])::uuid else null end
   and b.owner_id = (select auth.uid())
 )
);
create policy social_artwork_private_orphan_cleanup on storage.objects
for delete to authenticated using (
 bucket_id='social-artwork-private'
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and (select public.phase6_app_actor_class())='admin'
 and not exists (
   select 1 from public.social_assets a where a.storage_path=name
 )
);

-- Metadata registration must refer to a real, private object.
create function public.social_asset_storage_check()
returns trigger language plpgsql set search_path='' as $$
begin
 if not exists (
   select 1 from storage.objects o
   where o.bucket_id='social-artwork-private' and o.name=new.storage_path
 ) then raise exception 'Artwork object must be uploaded before registration'; end if;
 return new;
end $$;
create trigger social_asset_storage_check before insert on public.social_assets
for each row execute function public.social_asset_storage_check();
revoke execute on function public.social_asset_storage_check() from public,anon,authenticated;

create function public.social_asset_metadata_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if row(old.id,old.owner_id,old.brand_id,old.storage_path,old.mime_type,old.file_bytes,
        old.source,old.creative_brief,old.created_at)
    is distinct from
    row(new.id,new.owner_id,new.brand_id,new.storage_path,new.mime_type,new.file_bytes,
        new.source,new.creative_brief,new.created_at) then
   raise exception 'Stored artwork identity and contents are immutable';
 end if;
 if old.rights_status='withdrawn' and new.rights_status <> 'withdrawn' then
   raise exception 'Withdrawn artwork cannot be re-authorized; upload a new copy';
 end if;
 return new;
end $$;
create trigger social_asset_metadata_guard before update on public.social_assets
for each row execute function public.social_asset_metadata_guard();
revoke execute on function public.social_asset_metadata_guard() from public,anon,authenticated;

-- Refuse linking an asset from a different workspace or brand.
alter table public.social_post_revisions add column asset_id uuid;
alter table public.social_post_revisions
add constraint social_revision_asset_owner_fk foreign key (asset_id)
references public.social_assets(id) on delete restrict;

create function public.social_revision_asset_check()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.asset_id is not null and not exists (
   select 1 from public.social_assets a
   join public.social_posts p on p.owner_id=a.owner_id and p.brand_id=a.brand_id
   where p.id=new.post_id and p.owner_id=new.owner_id
     and a.id=new.asset_id and a.rights_status <> 'withdrawn'
 ) then
   raise exception 'Artwork belongs to another brand or was withdrawn';
 end if;
 return new;
end $$;
create trigger social_revision_asset_check before insert on public.social_post_revisions
for each row execute function public.social_revision_asset_check();
revoke execute on function public.social_revision_asset_check() from public,anon,authenticated;

-- Revoking artwork permission revokes existing post approvals and schedules.
create function public.social_asset_permission_revoked()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.rights_status='cleared' and new.rights_status <> 'cleared' then
   update public.social_post_targets t
     set status='draft',approved_revision_id=null,approved_by=null,
         approved_at=null,scheduled_at=null
   from public.social_post_revisions r
   where r.asset_id=new.id and r.post_id=t.post_id and t.approved_revision_id=r.id
     and t.owner_id=new.owner_id and t.status in ('approved','scheduled');
 end if;
 return new;
end $$;
create trigger social_asset_permission_revoked after update of rights_status on public.social_assets
for each row execute function public.social_asset_permission_revoked();
revoke execute on function public.social_asset_permission_revoked() from public,anon,authenticated;

-- An immutable cancelled post must never be revived by older revision RPCs.
create or replace function public.social_revision_invalidate()
returns trigger language plpgsql set search_path='' as $$
begin
 if exists (select 1 from public.social_post_targets
   where post_id=new.post_id and owner_id=new.owner_id and status='cancelled') then
   raise exception 'Cancelled social posts are immutable';
 end if;
 update public.social_post_targets
 set status='draft',approved_revision_id=null,approved_by=null,
     approved_at=null,scheduled_at=null
 where post_id=new.post_id and owner_id=new.owner_id;
 return new;
end $$;

-- Enforce current image permission at approval and again at schedule.
create or replace function public.social_target_transition()
returns trigger language plpgsql set search_path = '' as $$
declare latest_id uuid;
begin
 if tg_op='INSERT' then
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
 if new.status='draft' then
   if new.approved_revision_id is not null or new.approved_by is not null
     or new.approved_at is not null or new.scheduled_at is not null then
     raise exception 'Draft cannot retain approval or schedule';
   end if;
   return new;
 end if;
 if new.status='in_review' then
   if old.status <> 'draft' or new.approved_revision_id is not null
     or new.approved_by is not null or new.approved_at is not null
     or new.scheduled_at is not null then
     raise exception 'Review requires draft';
   end if;
   return new;
 end if;
 if new.status in ('approved','scheduled') then
   select id into latest_id from public.social_post_revisions
     where post_id=new.post_id and owner_id=new.owner_id
     order by revision_number desc limit 1;
   if latest_id is null or new.approved_revision_id is distinct from latest_id then
     raise exception 'Only the current immutable revision can be approved or scheduled';
   end if;
   if exists (
     select 1 from public.social_post_revisions r
     join public.social_assets a on a.id=r.asset_id
     where r.id=latest_id and a.rights_status <> 'cleared'
   ) then
     raise exception 'Artwork permission must be cleared before approval or planning';
   end if;
 end if;
 if new.status='approved' and old.status='in_review' then
   if new.approved_by is distinct from auth.uid()
     or new.approved_at is null or new.scheduled_at is not null then
     raise exception 'Approval must identify the reviewer';
   end if;
   return new;
 end if;
 if new.status='scheduled' and old.status='approved' then
   if new.approved_revision_id is distinct from old.approved_revision_id
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
     or new.scheduled_at is null or new.scheduled_at <= now() then
     raise exception 'Only approved content can be scheduled in the future';
   end if;
   return new;
 end if;
 if new.status='cancelled' and old.status in ('draft','in_review','approved','scheduled') then
   if new.approved_revision_id is not null or new.approved_by is not null
     or new.approved_at is not null or new.scheduled_at is not null then
     raise exception 'Cancelled targets cannot retain approval';
   end if;
   return new;
 end if;
 raise exception 'Invalid social target transition';
end $$;

-- Atomic media-linked drafts and revisions; storage object must already exist.
create function public.social_create_media_draft(
 p_brand_id uuid,p_caption text,p_channel text,p_image_brief text,p_content_origin text,p_asset_id uuid
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_post_id uuid;
begin
 if (select public.phase6_app_actor_class()) <> 'admin' then
   raise exception 'Social Studio requires admin access';
 end if;
 insert into public.social_posts(owner_id,brand_id)
   values(auth.uid(),p_brand_id) returning id into v_post_id;
 insert into public.social_post_revisions
   (owner_id,post_id,revision_number,caption,image_brief,content_origin,asset_id)
 values(auth.uid(),v_post_id,1,p_caption,p_image_brief,p_content_origin,p_asset_id);
 insert into public.social_post_targets(owner_id,post_id,channel)
 values(auth.uid(),v_post_id,p_channel);
 return v_post_id;
end $$;

create function public.social_append_media_revision(
 p_post_id uuid,p_caption text,p_image_brief text,p_content_origin text,p_asset_id uuid
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_revision_id uuid;
begin
 if (select public.phase6_app_actor_class()) <> 'admin' then
   raise exception 'Social Studio requires admin access';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_post_id::text),5471);
 perform 1 from public.social_posts where id=p_post_id and owner_id=auth.uid();
 if not found then raise exception 'Social post not accessible'; end if;
 if exists(select 1 from public.social_post_targets where post_id=p_post_id
    and owner_id=auth.uid() and status='cancelled') then
   raise exception 'Cancelled post cannot be edited';
 end if;
 insert into public.social_post_revisions
   (owner_id,post_id,revision_number,caption,image_brief,content_origin,asset_id)
 values(auth.uid(),p_post_id,
   (select coalesce(max(revision_number),0)+1 from public.social_post_revisions where post_id=p_post_id),
   p_caption,p_image_brief,p_content_origin,p_asset_id)
 returning id into v_revision_id;
 return v_revision_id;
end $$;
revoke all on function public.social_create_media_draft(uuid,text,text,text,text,uuid) from public,anon;
revoke all on function public.social_append_media_revision(uuid,text,text,text,uuid) from public,anon;
grant execute on function public.social_create_media_draft(uuid,text,text,text,text,uuid) to authenticated;
grant execute on function public.social_append_media_revision(uuid,text,text,text,uuid) to authenticated;

-- Durable, owner-scoped paid image generation quota; one invocation record per request.
create table public.social_image_requests(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id),
 brand_id uuid not null,
 created_at timestamptz not null default now(),
 foreign key(brand_id,owner_id) references public.social_brands(id,owner_id)
);
create index social_image_requests_quota_idx on public.social_image_requests(owner_id,created_at desc);
alter table public.social_image_requests enable row level security;
revoke all on public.social_image_requests from anon,authenticated;
grant select,insert on public.social_image_requests to authenticated;
create policy social_image_requests_read on public.social_image_requests for select to authenticated
using(owner_id=(select auth.uid()) and (select public.phase6_app_actor_class())='admin');
create policy social_image_requests_insert on public.social_image_requests for insert to authenticated
with check(owner_id=(select auth.uid()) and (select public.phase6_app_actor_class())='admin');

create function public.social_claim_image_generation(p_brand_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 if (select public.phase6_app_actor_class()) <> 'admin' or not exists(
    select 1 from public.social_brands where id=p_brand_id and owner_id=auth.uid()
 ) then raise exception 'Artwork generation not authorized'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(auth.uid()::text), 5472);
 if (select count(*) from public.social_image_requests
       where owner_id=auth.uid() and created_at > now()-interval '24 hours') >= 10
    or (select count(*) from public.social_image_requests
       where owner_id=auth.uid() and created_at > now()-interval '5 minutes') >= 2
 then raise exception 'Artwork generation limit reached: 2 per 5 minutes, 10 per day'; end if;
 insert into public.social_image_requests(owner_id,brand_id)
   values(auth.uid(),p_brand_id) returning id into v_id;
 return v_id;
end $$;
revoke execute on function public.social_claim_image_generation(uuid) from public,anon;
grant execute on function public.social_claim_image_generation(uuid) to authenticated;
