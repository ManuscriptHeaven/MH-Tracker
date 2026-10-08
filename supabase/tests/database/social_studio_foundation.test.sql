-- Run only after the social_studio_foundation migration on the approved staging
-- database. All synthetic posts roll back. Never run this against production.
begin;

create function pg_temp.social_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'social test: %', p_message; end if;
end $$;

do $test$
declare
  -- Identity pinned in the existing Task V2 staging integration suite.
  v_staging_system_id constant text := '7482910384729103847';
  v_system_id text;
  v_admin uuid;
  v_employee uuid;
  v_client uuid;
  v_brand uuid;
  v_post uuid;
  v_first uuid;
  v_second uuid;
  v_denied boolean;
begin
  if current_setting('app.environment', true) = 'production'
    or current_database() ilike '%prod%' then
    raise exception 'SAFETY ABORT: production database';
  end if;
  select system_identifier::text into v_system_id from pg_control_system();
  if v_system_id is distinct from v_staging_system_id
    or current_setting('social_studio.test_target', true) is distinct from 'staging' then
    raise exception 'SAFETY ABORT: approved staging identity and explicit intent required';
  end if;

  select id into v_admin from public.profiles where role::text = 'admin' and status = 'active' limit 1;
  select id into v_employee from public.profiles where role::text = 'employee' and status = 'active' limit 1;
  select id into v_client from public.profiles where role::text = 'client' and status = 'active' limit 1;
  perform pg_temp.social_assert(v_admin is not null and v_employee is not null and v_client is not null,
    'active admin, employee and client staging fixtures required');
  perform pg_temp.social_assert(not has_table_privilege('authenticated', 'public.social_posts', 'UPDATE'),
    'direct post update must not be granted');
  perform pg_temp.social_assert(not has_table_privilege('authenticated', 'public.social_post_revisions', 'INSERT'),
    'revisions must be created only by validated RPC');
  perform pg_temp.social_assert((select not public from storage.buckets where id = 'social-drafts'),
    'draft media bucket must be private');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select id into v_brand from public.social_brands where slug = 'manuscript-heaven';
  v_post := public.social_create_post(v_brand, 'Studio test', 'Initial caption', 'facebook', '');
  select current_revision_id into v_first from public.social_posts where id = v_post;
  perform pg_temp.social_assert(v_first is not null, 'create saves an initial revision');
  perform public.social_submit_post(v_post, v_first);

  v_denied := false;
  begin
    perform public.social_approve_post(v_post, gen_random_uuid());
  exception when sqlstate '22023' then v_denied := true;
  end;
  perform pg_temp.social_assert(v_denied, 'stale revision approval denied');
  perform public.social_approve_post(v_post, v_first);
  perform pg_temp.social_assert((select status = 'approved' and approved_revision_id = v_first
    from public.social_posts where id = v_post), 'approval binds exact revision');

  v_second := public.social_revise_post(v_post, v_first, 'Updated caption', 'linkedin', 'New visual');
  perform pg_temp.social_assert((select status = 'draft' and approved_revision_id is null
    and current_revision_id = v_second from public.social_posts where id = v_post),
    'editing an approved post invalidates its approval');
  perform pg_temp.social_assert((select count(*) = 1 from public.social_approval_events
    where post_id = v_post and event_type = 'approval_invalidated'),
    'approval invalidation is audited');

  perform set_config('request.jwt.claim.sub', v_employee::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_employee, 'role', 'authenticated')::text, true);
  perform pg_temp.social_assert((select count(*) = 0 from public.social_posts where id = v_post),
    'employee cannot read unpublished content');
  v_denied := false;
  begin
    perform public.social_create_post(v_brand, 'Denied', 'Denied', 'facebook', '');
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.social_assert(v_denied, 'employee cannot create a post');

  perform set_config('request.jwt.claim.sub', v_client::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  perform pg_temp.social_assert((select count(*) = 0 from public.social_posts where id = v_post),
    'client cannot read unpublished content');
  v_denied := false;
  begin
    perform public.social_approve_post(v_post, v_second);
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.social_assert(v_denied, 'client cannot approve a post');
end $test$;

rollback;
