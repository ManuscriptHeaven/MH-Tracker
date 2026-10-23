-- Follow-up for the pilot: serialize append operations without requiring UPDATE on posts.
create or replace function public.social_append_revision(p_post_id uuid, p_caption text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_revision_id uuid;
begin
  -- Advisory lock scopes to this transaction; no write permission on posts is needed.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_post_id::text), 5471);
  perform 1 from public.social_posts where id = p_post_id and owner_id = auth.uid();
  if not found then raise exception 'Social draft not accessible'; end if;
  insert into public.social_post_revisions (owner_id, post_id, revision_number, caption)
  values (
    auth.uid(), p_post_id,
    (select coalesce(max(revision_number),0) + 1 from public.social_post_revisions
      where post_id = p_post_id), p_caption
  ) returning id into v_revision_id;
  return v_revision_id;
end $$;
revoke all on function public.social_append_revision(uuid,text) from public, anon;
grant execute on function public.social_append_revision(uuid,text) to authenticated;
