-- Extends the live admin-only Social Studio pilot; no existing post text is changed.
alter table public.social_post_revisions
  add column image_brief text not null default '',
  add column content_origin text not null default 'manual';

alter table public.social_post_revisions
  add constraint social_revision_image_brief_length check (char_length(image_brief) <= 2400),
  add constraint social_revision_content_origin check (content_origin in ('manual','ai_suggested'));

-- This RPC creates a post, its first immutable revision, and its target atomically.
-- Gemini has no write access: the authenticated admin explicitly calls this after review.
create function public.social_create_rich_draft(
  p_brand_id uuid, p_caption text, p_channel text,
  p_image_brief text, p_content_origin text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_post_id uuid;
begin
  if (select public.phase6_app_actor_class()) <> 'admin' then
    raise exception 'Social Studio requires admin access';
  end if;

  insert into public.social_posts(owner_id, brand_id)
    values (auth.uid(), p_brand_id) returning id into v_post_id;

  insert into public.social_post_revisions
    (owner_id, post_id, revision_number, caption, image_brief, content_origin)
  values (auth.uid(), v_post_id, 1, p_caption, p_image_brief, p_content_origin);

  insert into public.social_post_targets(owner_id, post_id, channel)
    values (auth.uid(), v_post_id, p_channel);
  return v_post_id;
end $$;

create function public.social_append_rich_revision(
  p_post_id uuid, p_caption text,
  p_image_brief text, p_content_origin text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_revision_id uuid;
begin
  if (select public.phase6_app_actor_class()) <> 'admin' then
    raise exception 'Social Studio requires admin access';
  end if;

  -- Serialize edits without granting UPDATE permissions on the posts table.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_post_id::text), 5471);
  perform 1 from public.social_posts where id = p_post_id and owner_id = auth.uid();
  if not found then raise exception 'Social draft not accessible'; end if;

  if exists (
    select 1 from public.social_post_targets
    where post_id = p_post_id and owner_id = auth.uid() and status = 'cancelled'
  ) then
    raise exception 'Cancelled content cannot be edited; create a new post';
  end if;

  insert into public.social_post_revisions
    (owner_id, post_id, revision_number, caption, image_brief, content_origin)
  values (
    auth.uid(), p_post_id,
    (select coalesce(max(revision_number),0) + 1
       from public.social_post_revisions where post_id = p_post_id),
    p_caption, p_image_brief, p_content_origin
  ) returning id into v_revision_id;
  return v_revision_id;
end $$;

revoke all on function public.social_create_rich_draft(uuid,text,text,text,text) from public,anon;
revoke all on function public.social_append_rich_revision(uuid,text,text,text) from public,anon;
grant execute on function public.social_create_rich_draft(uuid,text,text,text,text) to authenticated;
grant execute on function public.social_append_rich_revision(uuid,text,text,text) to authenticated;
