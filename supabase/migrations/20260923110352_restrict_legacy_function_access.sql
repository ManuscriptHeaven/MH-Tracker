begin;
-- These legacy role predicates only serve signed-in application users. Keep
-- those calls working while removing inherited PUBLIC/anonymous execution.
do $$
declare signature text; routine regprocedure;
begin
  foreach signature in array array['public.can_manage_all_projects()',
    'public.current_user_is_client()', 'public.current_user_role()',
    'public.project_is_visible(public.projects)'] loop
    routine := to_regprocedure(signature);
    if routine is not null then
      execute format('revoke execute on function %s from public, anon', routine);
      execute format('grant execute on function %s to authenticated, service_role', routine);
    end if;
  end loop;
  foreach signature in array array['public.set_updated_at()', 'public.touch_updated_at()',
    'public.add_business_days(date,integer)', 'public.timeline_progress(text)',
    'public.project_production_days(public.projects)', 'public.is_client_user(uuid)'] loop
    routine := to_regprocedure(signature);
    if routine is not null then
      execute format('alter function %s set search_path = pg_catalog, public, pg_temp', routine);
    end if;
  end loop;
end;
$$;
commit;
