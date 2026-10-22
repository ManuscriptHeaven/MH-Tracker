-- The brand brief is edited through a checked RPC, never by direct table update.
begin;

create function public.social_update_brand_brief(p_brand_id uuid, p_brief jsonb)
returns void language plpgsql security definer
set search_path = pg_catalog, pg_temp as $fn$
declare v_key text;
begin
  if auth.uid() is null or public.phase6_app_actor_class() is distinct from 'admin' then
    raise exception 'social_permission_denied' using errcode = '42501';
  end if;
  if p_brief is null or jsonb_typeof(p_brief) <> 'object'
    or (select count(*) from jsonb_object_keys(p_brief)) <> 4 then
    raise exception 'social_invalid_brief' using errcode = '22023';
  end if;
  foreach v_key in array array['audience', 'voice', 'goals', 'avoid'] loop
    if jsonb_typeof(p_brief -> v_key) is distinct from 'string'
      or length(p_brief ->> v_key) > 1000 then
      raise exception 'social_invalid_brief' using errcode = '22023';
    end if;
  end loop;
  update public.social_brands set brief = p_brief where id = p_brand_id;
  if not found then
    raise exception 'social_brand_not_found' using errcode = '22023';
  end if;
end $fn$;

revoke all on function public.social_update_brand_brief(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.social_update_brand_brief(uuid, jsonb) to authenticated;

commit;
