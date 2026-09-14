-- DATABASE EXECUTION TESTS: authored, not executed on the development machine.
-- Run only on an UNLINKED DISPOSABLE local Supabase DB, after migrations 1-3.
-- No users/emails are inserted here. A local Auth harness must provision active
-- synthetic Admin and Client profiles, then set these connection-local settings:
-- phase6.local_disposable = on; phase6.test_admin = <synthetic admin UUID>;
-- phase6.test_client = <synthetic client UUID>.
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/database/phase6_workflow_rpcs.test.sql
-- Missing fixture settings produce an explicit SKIP, never an integration PASS.
begin;

create function pg_temp.p6_assert(p_ok boolean, p_label text) returns void
language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'Assertion failed: %',p_label; end if;
end $$;

-- Catalog tests do not require Auth fixtures.
do $$
declare n text; f record; d text; names text[] := array[
  'workflow_advance_stage','workflow_submit_stage_for_approval','workflow_client_approve_stage',
  'workflow_submit_client_revision','workflow_submit_revised_proof','workflow_request_stage_skip',
  'workflow_respond_stage_skip','workflow_admin_override','workflow_complete_final_delivery',
  'workflow_set_project_lifecycle','workflow_update_project_configuration'];
begin
  foreach n in array names loop
    perform pg_temp.p6_assert((select count(*)=1 from pg_proc p join pg_namespace s on s.oid=p.pronamespace
      where s.nspname='public' and p.proname=n),n || ' exactly once');
    select p.* into strict f from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname=n;
    perform pg_temp.p6_assert(f.prosecdef and f.prorettype='public.workflow_mutation_result'::regtype,n || ' definer/result');
    perform pg_temp.p6_assert('search_path=pg_catalog, pg_temp'=any(f.proconfig),n || ' search path');
    perform pg_temp.p6_assert(has_function_privilege('authenticated',f.oid,'EXECUTE'),n || ' authenticated execute');
    perform pg_temp.p6_assert(not has_function_privilege('anon',f.oid,'EXECUTE'),n || ' anon denied');
    perform pg_temp.p6_assert(not exists(select 1 from aclexplode(f.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE'),n || ' PUBLIC denied');
    d := pg_get_functiondef(f.oid);
    perform pg_temp.p6_assert(position('v_notifications_before' in d)=0,n || ' has no project notification baseline');
    perform pg_temp.p6_assert(position('_workflow_receipt_lookup' in d)>0
      and position('if v_result.project_id is not null then return v_result' in d)>0
      and position('if v_result.project_id is not null then return v_result' in d)<position('_workflow_notify' in d),
      n || ' receipt replay precedes notify');
  end loop;
  select p.* into strict f from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname='phase6_auth_uid' and p.pronargs=0;
  perform pg_temp.p6_assert(not has_function_privilege('authenticated',f.oid,'EXECUTE')
    and not has_function_privilege('anon',f.oid,'EXECUTE')
    and not exists(select 1 from aclexplode(f.proacl) a
      where a.grantee=0 and a.privilege_type='EXECUTE'),
    'ordinary callers cannot execute private auth UID bridge');
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname='_workflow_current_actor' and p.pronargs=0;
  perform pg_temp.p6_assert(d ~ 'v_actor_id uuid := public\.phase6_auth_uid\(\)'
    and d !~ 'auth\.uid\(\)',
    'workflow actor resolution uses the private auth UID bridge');
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname='_workflow_notify';
  perform pg_temp.p6_assert(d ~ 'n\.id = v_id and n\.project_id = p_project\.id'
    and d ~ 'n\.recipient_id = v_recipient and n\.type = p_type'
    and d ~ 'n\.revision_request_id is not distinct from p_revision_id'
    and d ~ 'n\.created_at = p_mutation_at' and d ~ 'count\(distinct x\) from unnest\(v_ids\)',
    'notification validation is scoped to mutation IDs');
  for f in select p.* from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and left(p.proname,10)='_workflow_' loop
    perform pg_temp.p6_assert(not has_function_privilege('authenticated',f.oid,'EXECUTE'),f.proname || ' internal revoked');
  end loop;
end $$;

create function pg_temp.p6_project(p_stage public.workflow_stage default 'files_received',
  p_status public.workflow_stage_status default 'pending', p_print boolean default true, p_ebook boolean default true)
returns uuid language plpgsql as $$
declare p public.projects; v_id uuid := gen_random_uuid(); t timestamptz := clock_timestamp();
begin
  insert into public.projects(id,client_name,project_title,service_type,due_date,client_profile_id,project_manager,
    assigned_to,project_status,workflow_stage_key,workflow_stage_status_key,workflow_waiting_on_key,
    requires_print,requires_ebook,service_capability_status,workflow_settings,stage_started_at,stage_due_at,
    workflow_version,production_seconds_total,client_wait_seconds_total)
  values(v_id,'Synthetic workflow fixture','Phase6 local workflow fixture','Fixture',date '2030-01-01',
    current_setting('phase6.test_client')::uuid,current_setting('phase6.test_admin')::uuid,
    current_setting('phase6.test_admin')::uuid,'active',p_stage,p_status,
    case when p_status='pending' then 'none'::public.workflow_waiting_on
      when p_status='awaiting_client' then 'client'::public.workflow_waiting_on else 'team'::public.workflow_waiting_on end,
    p_print,p_ebook,'confirmed','{"exclude_weekends":false}',
    case when p_status='pending' then null else t-interval '1 hour' end,
    case when p_status in ('active','revision_active') then t+interval '2 days' else null end,0,0,0);
  select x.* into p from public.projects x where x.id=v_id;
  p := jsonb_populate_record(p,public._workflow_compatibility_projection(p.project_status,p.workflow_stage_key,p.workflow_stage_status_key,p.workflow_waiting_on_key));
  perform public._workflow_write_project(p);
  return v_id;
end $$;

-- Statements below are test-authored SQL, never application input.
create function pg_temp.p6_call(p_actor uuid,p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor)::text,true);
  execute 'select to_jsonb(r) from (' || p_sql || ') r' into r;
  return r;
end $$;
create function pg_temp.p6_error(p_actor uuid,p_sql text,p_message text) returns void language plpgsql as $$
begin
  begin
    perform pg_temp.p6_call(p_actor,p_sql);
  exception when others then
    if sqlerrm=p_message then return; end if;
    raise;
  end;
  raise exception 'Expected error % was not raised',p_message;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.workflow_advance_stage(gen_random_uuid(),0,gen_random_uuid());
    raise exception 'Expected unauthenticated rejection';
  exception when others then
    if sqlerrm<>'workflow_unauthenticated' then raise; end if;
  end;
end $$;

do $$
declare a uuid; c uuid; p uuid; q uuid; k uuid; r jsonb; replay jsonb; rev uuid; child uuid; skip_id uuid; response_key uuid;
  before_row jsonb; h bigint; n bigint; due timestamptz; paused_due timestamptz; production bigint; wait_seconds bigint;
  started timestamptz; final_before timestamptz; final_after timestamptz; audit_due timestamptz; estimated timestamptz;
  ver bigint; st public.workflow_stage; target public.workflow_stage; stmt text;
begin
  if current_setting('phase6.local_disposable',true) is distinct from 'on'
    or nullif(current_setting('phase6.test_admin',true),'') is null
    or nullif(current_setting('phase6.test_client',true),'') is null then
    raise notice 'SKIP: authenticated mutation scenarios require explicit disposable local Auth fixture. No integration pass claimed.';
    return;
  end if;
  a := current_setting('phase6.test_admin')::uuid; c := current_setting('phase6.test_client')::uuid;
  perform pg_temp.p6_assert(exists(select 1 from public.profiles where id=a and status='active' and role::text='admin'),'synthetic Admin fixture');
  perform pg_temp.p6_assert(exists(select 1 from public.profiles where id=c and status='active' and role::text='client'),'synthetic Client fixture');
  perform set_config('request.jwt.claim.sub',a::text,true);
  p := pg_temp.p6_project(); k := gen_random_uuid();
  insert into public.client_project_access(client_id,project_id) values(c,p);
  stmt := format('select * from public.workflow_advance_stage(%L,0,%L,null)',p,k);
  r := pg_temp.p6_call(a,stmt);
  perform pg_temp.p6_assert(r->'project_snapshot'->>'workflow_stage_key'='files_received'
    and r->'project_snapshot'->>'workflow_stage_status_key'='active','Files pending -> active');
  perform pg_temp.p6_assert((select production_seconds_total=0 from public.projects where id=p),'pending no clock');
  select count(*) into h from public.project_stage_history where project_id=p;
  select count(*) into n from public.notifications where project_id=p;
  select to_jsonb(x) into before_row from public.projects x where id=p;
  replay := pg_temp.p6_call(a,stmt);
  perform pg_temp.p6_assert(replay->>'already_applied'='true' and replay-'already_applied'=r-'already_applied','identical retry preserves old result/version');
  perform pg_temp.p6_assert((select to_jsonb(x)=before_row from public.projects x where id=p),'retry no timestamps/state');
  perform pg_temp.p6_assert((select count(*)=h from public.project_stage_history where project_id=p)
    and (select count(*)=n from public.notifications where project_id=p),'retry no history/notifications');
  perform pg_temp.p6_error(a,format('select * from public.workflow_advance_stage(%L,0,%L,%L)',p,k,'changed'),'idempotency_key_reused');
  perform pg_temp.p6_error(a,format('select * from public.workflow_advance_stage(%L,0,%L)',p,gen_random_uuid()),'workflow_stale_version');
  perform pg_temp.p6_error(c,format('select * from public.workflow_advance_stage(%L,1,%L)',p,gen_random_uuid()),'workflow_forbidden');
  r := pg_temp.p6_call(a,format('select * from public.workflow_advance_stage(%L,1,%L)',p,gen_random_uuid()));
  perform pg_temp.p6_assert(r->'project_snapshot'->>'workflow_stage_key'='design_concept','Files active -> Design');
  r := pg_temp.p6_call(a,format('select * from public.workflow_submit_stage_for_approval(%L,2,%L)',p,gen_random_uuid()));
  perform pg_temp.p6_assert(r->'project_snapshot'->>'workflow_stage_key'='concept_approval'
    and r->'project_snapshot'->>'stage_due_at' is null,'Design -> Concept Approval');
  r := pg_temp.p6_call(c,format('select * from public.workflow_client_approve_stage(%L,3,%L)',p,gen_random_uuid()));
  perform pg_temp.p6_assert(r->'project_snapshot'->>'workflow_stage_key'='print_version','combined client approval');
  r := pg_temp.p6_call(a,format('select * from public.workflow_submit_stage_for_approval(%L,4,%L)',p,gen_random_uuid()));
  perform pg_temp.p6_assert(r->'project_snapshot'->>'workflow_stage_key'='print_approval','Print -> Print Approval');
  r := pg_temp.p6_call(c,format('select * from public.workflow_client_approve_stage(%L,5,%L)',p,gen_random_uuid()));
  r := pg_temp.p6_call(a,format('select * from public.workflow_submit_stage_for_approval(%L,6,%L)',p,gen_random_uuid()));
  perform pg_temp.p6_assert(r->'project_snapshot'->>'workflow_stage_key'='ebook_approval','Ebook -> Ebook Approval');
  r := pg_temp.p6_call(c,format('select * from public.workflow_client_approve_stage(%L,7,%L)',p,gen_random_uuid()));
  r := pg_temp.p6_call(a,format('select * from public.workflow_complete_final_delivery(%L,8,%L)',p,gen_random_uuid()));
  perform pg_temp.p6_assert((select project_status='completed' and delivered_at=stage_completed_at and delivered_at=final_due_at
    and final_delivery_date=(delivered_at at time zone 'Asia/Karachi')::date and delivery_date=final_delivery_date
    and stage_started_at is null from public.projects where id=p),'final delivery timestamp and milestones');
  replay := pg_temp.p6_call(a,stmt);
  perform pg_temp.p6_assert(replay->>'workflow_version'='1' and replay->>'already_applied'='true'
    and replay->'project_snapshot'->>'workflow_stage_key'='files_received','old receipt survives later transitions');

  -- Print-only and ebook-only approval routes and ordered skipped events.
  foreach st in array array['concept_approval','print_approval']::public.workflow_stage[] loop
    q := pg_temp.p6_project(st,'awaiting_client',st='print_approval',st='concept_approval');
    r := pg_temp.p6_call(c,format('select * from public.workflow_client_approve_stage(%L,0,%L)',q,gen_random_uuid()));
    target := case when st='concept_approval' then 'ebook_version'::public.workflow_stage else 'final_delivery'::public.workflow_stage end;
    perform pg_temp.p6_assert(r->'project_snapshot'->>'workflow_stage_key'=target::text,'format routing');
    perform pg_temp.p6_assert((select array_agg(event_type::text order by sequence_no)=array['stage_approved','stage_skipped','stage_skipped','stage_entered']
      from public.project_stage_history where project_id=q),'approval/skip/entry order');
  end loop;

  q := pg_temp.p6_project('concept_approval','awaiting_client');
  update public.projects set client_profile_id=null where id=q;
  perform pg_temp.p6_error(c,format('select * from public.workflow_client_approve_stage(%L,0,%L)',q,gen_random_uuid()),'workflow_forbidden');
  insert into public.client_project_access(client_id,project_id) values(c,q);
  r := pg_temp.p6_call(c,format('select * from public.workflow_client_approve_stage(%L,0,%L)',q,gen_random_uuid()));
  perform pg_temp.p6_assert(r->'project_snapshot'->>'workflow_stage_key'='print_version','exact access membership authorizes client');

  -- Initial revision, explicit revised proof, child round, revision approval.
  q := pg_temp.p6_project('concept_approval','awaiting_client'); k := gen_random_uuid();
  stmt := format('select * from public.workflow_submit_client_revision(%L,0,%L,%L,%L)',q,k,'Round one','Please change layout');
  r := pg_temp.p6_call(c,stmt); rev := (r->'affected_entity_ids'->>'revision_request_id')::uuid;
  perform pg_temp.p6_assert((select canonical_status='submitted' and status='Submitted' and revision_round=1 and parent_revision_request_id is null
    and client_id=c from public.revision_requests where id=rev),'initial revision');
  replay := pg_temp.p6_call(c,stmt);
  perform pg_temp.p6_assert((select count(*)=1 from public.revision_requests where project_id=q),'revision retry no extra row');
  r := pg_temp.p6_call(a,format('select * from public.workflow_submit_revised_proof(%L,1,%L,%L,%L)',q,gen_random_uuid(),rev,'Updated proof ready'));
  perform pg_temp.p6_assert((select canonical_status='ready_for_client_review' and status='Ready for Client Review' from public.revision_requests where id=rev),'revised proof');
  r := pg_temp.p6_call(c,format('select * from public.workflow_submit_client_revision(%L,2,%L,%L,%L)',q,gen_random_uuid(),'Round two','Please adjust spacing'));
  child := (r->'affected_entity_ids'->>'revision_request_id')::uuid;
  perform pg_temp.p6_assert((select parent_revision_request_id=rev and revision_round=2 from public.revision_requests where id=child)
    and (select canonical_status='changes_requested' and status='Additional Revision Required' from public.revision_requests where id=rev),'child revision leaf');
  perform pg_temp.p6_error(a,format('select * from public.workflow_submit_revised_proof(%L,3,%L,%L)',q,gen_random_uuid(),rev),'workflow_revision_not_found');
  r := pg_temp.p6_call(a,format('select * from public.workflow_submit_revised_proof(%L,3,%L,%L)',q,gen_random_uuid(),child));
  r := pg_temp.p6_call(c,format('select * from public.workflow_client_approve_stage(%L,4,%L)',q,gen_random_uuid()));
  perform pg_temp.p6_assert((select canonical_status='approved' and status='Approved' and completed_at is not null from public.revision_requests where id=child),'revision approved atomically');
  perform pg_temp.p6_assert((select count(*)=1 from public.project_stage_history where project_id=q and event_type='revision_approved'),'revision approval history');

  -- Future skip approval must not jump/reset current production. Routing deduplicates.
  q := pg_temp.p6_project('files_received','active');
  insert into public.project_stage_skips(project_id,stage,stage_key,requested_by,requester_id,reason,status,canonical_status)
    values(q,'Design Concept','design_concept',a,a,'Synthetic legacy approved skip','APPROVED','approved');
  r := pg_temp.p6_call(a,format('select * from public.workflow_advance_stage(%L,0,%L)',q,gen_random_uuid()));
  perform pg_temp.p6_assert(r->'project_snapshot'->>'workflow_stage_key'='print_version','Files routing honors approved Design pair');
  perform pg_temp.p6_assert((select array_agg(event_type::text order by sequence_no)=array['stage_skipped','stage_skipped','stage_entered']
    from public.project_stage_history where project_id=q),'backfilled skip gains ordered missing history');
  perform pg_temp.p6_assert((select production_seconds_delta>0 from public.project_stage_history where project_id=q and event_type='stage_entered')
    and not exists(select 1 from public.project_stage_history where project_id=q and event_type='stage_skipped' and production_seconds_delta<>0),
    'Files interval belongs only to stage entry after skips');

  q := pg_temp.p6_project('design_concept','active');
  update public.projects x set final_due_at=public._workflow_estimate_final_due(x.id,clock_timestamp()) where x.id=q;
  select stage_started_at,stage_due_at,final_due_at into started,due,final_before from public.projects where id=q;
  r := pg_temp.p6_call(a,format('select * from public.workflow_request_stage_skip(%L,0,%L,%L,%L)',q,gen_random_uuid(),'print_version','Format already supplied'));
  skip_id := (r->'affected_entity_ids'->>'stage_skip_id')::uuid;
  perform pg_temp.p6_error(a,format('select * from public.workflow_request_stage_skip(%L,1,%L,%L,%L)',q,gen_random_uuid(),'print_version','Duplicate'),'workflow_skip_already_requested');
  response_key := gen_random_uuid();
  r := pg_temp.p6_call(c,format('select * from public.workflow_respond_stage_skip(%L,1,%L,%L,%L)',q,response_key,skip_id,'approved'));
  select final_due_at into final_after from public.projects where id=q;
  perform pg_temp.p6_assert((select workflow_stage_key='design_concept' and workflow_stage_status_key='active'
    and workflow_waiting_on_key='team' and stage_started_at=started and stage_due_at=due
    and production_seconds_total=0 and client_wait_seconds_total=0 from public.projects where id=q),
    'future skip preserves current stage/owner/clock/due and books no interval');
  perform pg_temp.p6_assert(final_before is not null and final_after is not null and final_after<final_before,
    'future approved production pair shortens final estimate');
  perform pg_temp.p6_assert(not exists(select 1 from public.project_stage_history where project_id=q
    and idempotency_key=response_key and (production_seconds_delta<>0 or client_wait_seconds_delta<>0)),
    'future skip response history has zero interval delta');
  perform pg_temp.p6_assert((select count(*)=2 from public.project_stage_history where project_id=q and stage_skip_id=skip_id and event_type='stage_skipped'
    and metadata->>'effective'='when_routing_reaches_target'),'future pair effectiveness metadata');
  r := pg_temp.p6_call(a,format('select * from public.workflow_submit_stage_for_approval(%L,2,%L)',q,gen_random_uuid()));
  r := pg_temp.p6_call(c,format('select * from public.workflow_client_approve_stage(%L,3,%L)',q,gen_random_uuid()));
  perform pg_temp.p6_assert((select workflow_stage_key='ebook_version' from public.projects where id=q)
    and (select count(*)=2 from public.project_stage_history where project_id=q and stage_skip_id=skip_id and event_type='stage_skipped'),'manual skip no duplicate routing history');

  q := pg_temp.p6_project('design_concept','active');
  r := pg_temp.p6_call(a,format('select * from public.workflow_request_stage_skip(%L,0,%L,%L,%L)',q,gen_random_uuid(),'design_concept','Client supplied concept'));
  skip_id := (r->'affected_entity_ids'->>'stage_skip_id')::uuid;
  r := pg_temp.p6_call(c,format('select * from public.workflow_respond_stage_skip(%L,1,%L,%L,%L)',q,gen_random_uuid(),skip_id,'approved'));
  perform pg_temp.p6_assert((select workflow_stage_key='print_version' and production_seconds_total>0 from public.projects where id=q),'current skip closes interval/routes');
  r := pg_temp.p6_call(a,format('select * from public.workflow_request_stage_skip(%L,2,%L,%L,%L)',q,gen_random_uuid(),'ebook_version','Optional format'));
  skip_id := (r->'affected_entity_ids'->>'stage_skip_id')::uuid;
  select final_due_at into final_before from public.projects where id=q;
  r := pg_temp.p6_call(c,format('select * from public.workflow_respond_stage_skip(%L,3,%L,%L,%L)',q,gen_random_uuid(),skip_id,'rejected'));
  perform pg_temp.p6_assert((select canonical_status='rejected' and status='REJECTED' from public.project_stage_skips where id=skip_id),'skip rejected');
  perform pg_temp.p6_assert((select final_due_at is not distinct from final_before from public.projects where id=q),
    'future skip rejection preserves final estimate');

  -- Pause/resume retains remaining eligible production effort.
  q := pg_temp.p6_project('design_concept','active');
  r := pg_temp.p6_call(a,format('select * from public.workflow_set_project_lifecycle(%L,0,%L,%L)',q,gen_random_uuid(),'on_hold'));
  perform pg_temp.p6_assert((select stage_started_at is null and final_due_at is null and workflow_stage_status_key='paused' from public.projects where id=q),'pause stops');
  r := pg_temp.p6_call(a,format('select * from public.workflow_set_project_lifecycle(%L,1,%L,%L)',q,gen_random_uuid(),'active'));
  perform pg_temp.p6_assert((select x.stage_due_at=public._workflow_add_production_seconds(x.stage_started_at,
      (h.metadata->>'remaining_production_seconds')::bigint,false,'Asia/Karachi') from public.projects x
      join public.project_stage_history h on h.project_id=x.id and h.event_type='project_paused' where x.id=q),'resume remaining seconds');
  r := pg_temp.p6_call(a,format('select * from public.workflow_set_project_lifecycle(%L,2,%L,%L,%L)',q,gen_random_uuid(),'cancelled','Cancelled by team'));
  perform pg_temp.p6_error(a,format('select * from public.workflow_set_project_lifecycle(%L,3,%L,%L)',q,gen_random_uuid(),'active'),'workflow_invalid_lifecycle_transition');
  r := pg_temp.p6_call(a,format('select * from public.workflow_set_project_lifecycle(%L,3,%L,%L,%L)',q,gen_random_uuid(),'archived','Archive cancelled fixture'));
  r := pg_temp.p6_call(a,format('select * from public.workflow_set_project_lifecycle(%L,4,%L,%L)',q,gen_random_uuid(),'cancelled'));
  perform pg_temp.p6_assert((select project_status='cancelled' and final_due_at is null from public.projects where id=q),'unarchive exact prior lifecycle');

  -- Overdue pause/resume never grants a new duration.
  q := pg_temp.p6_project('design_concept','active');
  update public.projects set stage_due_at=clock_timestamp()-interval '1 day' where id=q;
  select stage_due_at into due from public.projects where id=q;
  r := pg_temp.p6_call(a,format('select * from public.workflow_set_project_lifecycle(%L,0,%L,%L)',q,gen_random_uuid(),'on_hold'));
  r := pg_temp.p6_call(a,format('select * from public.workflow_set_project_lifecycle(%L,1,%L,%L)',q,gen_random_uuid(),'active'));
  perform pg_temp.p6_assert((select stage_due_at=due and final_due_at is null from public.projects where id=q),'overdue preserved');

  -- Revision-row due is audit evidence; resumed project due is operational.
  q := pg_temp.p6_project('concept_approval','awaiting_client');
  r := pg_temp.p6_call(c,format('select * from public.workflow_submit_client_revision(%L,0,%L,%L,%L)',
    q,gen_random_uuid(),'Pause resume revision','Synthetic revision instructions'));
  rev := (r->'affected_entity_ids'->>'revision_request_id')::uuid;
  -- Keep the due initially in the future, while making the test practical.
  due := clock_timestamp()+interval '1 second';
  update public.projects set stage_due_at=due,
    concept_revision_due_date=(due at time zone 'Asia/Karachi')::date where id=q;
  update public.revision_requests set due_at=due where id=rev;
  perform pg_temp.p6_assert((select x.stage_due_at=rr.due_at from public.projects x
    join public.revision_requests rr on rr.project_id=x.id where x.id=q and rr.id=rev),
    'revision project and row deadlines initially match');
  r := pg_temp.p6_call(a,format('select * from public.workflow_set_project_lifecycle(%L,1,%L,%L)',q,gen_random_uuid(),'on_hold'));
  perform pg_sleep(1.1);
  select due_at into audit_due from public.revision_requests where id=rev;
  perform pg_temp.p6_assert(audit_due<clock_timestamp(),'revision-row audit due passed during hold');
  r := pg_temp.p6_call(a,format('select * from public.workflow_set_project_lifecycle(%L,2,%L,%L)',q,gen_random_uuid(),'active'));
  select public._workflow_estimate_final_due(q,clock_timestamp()) into estimated;
  perform pg_temp.p6_assert((select workflow_stage_status_key='revision_active' and stage_due_at>audit_due
    and concept_revision_due_date=(stage_due_at at time zone 'Asia/Karachi')::date
    from public.projects where id=q),'revision resume shifts operational due and Concept compatibility date');
  perform pg_temp.p6_assert((select due_at=audit_due from public.revision_requests where id=rev),
    'resume preserves revision-row audit due');
  perform pg_temp.p6_assert(estimated is not null and estimated=(select public._workflow_estimate_remaining_production(
    x,clock_timestamp(),public._workflow_approved_manual_skips(x.id),x.stage_due_at) from public.projects x where x.id=q),
    'estimator uses resumed project operational due despite passed row due');

  -- Print has the same legacy project-level compatibility date contract.
  q := pg_temp.p6_project('print_approval','awaiting_client');
  r := pg_temp.p6_call(c,format('select * from public.workflow_submit_client_revision(%L,0,%L,%L,%L)',
    q,gen_random_uuid(),'Print pause resume revision','Synthetic print revision instructions'));
  rev := (r->'affected_entity_ids'->>'revision_request_id')::uuid;
  select due_at into audit_due from public.revision_requests where id=rev;
  r := pg_temp.p6_call(a,format('select * from public.workflow_set_project_lifecycle(%L,1,%L,%L)',q,gen_random_uuid(),'on_hold'));
  r := pg_temp.p6_call(a,format('select * from public.workflow_set_project_lifecycle(%L,2,%L,%L)',q,gen_random_uuid(),'active'));
  perform pg_temp.p6_assert((select print_revision_due_date=(stage_due_at at time zone 'Asia/Karachi')::date
    from public.projects where id=q),'revision resume refreshes Print compatibility date');
  perform pg_temp.p6_assert((select due_at=audit_due from public.revision_requests where id=rev),
    'Print resume preserves revision-row audit due');

  -- Configuration closes old calendar interval without changing current due.
  q := pg_temp.p6_project('design_concept','active');
  select stage_due_at into due from public.projects where id=q;
  r := pg_temp.p6_call(a,format('select * from public.workflow_update_project_configuration(%L,0,%L,true,true,%L)',q,gen_random_uuid(),'{"exclude_weekends":true,"design_concept_revision_days":99}'));
  perform pg_temp.p6_assert((select stage_due_at=due and production_seconds_total>0 and workflow_settings='{"exclude_weekends":true}'::jsonb
    from public.projects where id=q),'old calendar booked/current due preserved/obsolete keys dropped');

  -- Gated migrated approval resumes without a fake approval.
  q := pg_temp.p6_project('concept_approval','awaiting_client');
  update public.projects set workflow_stage_status_key='completed',workflow_waiting_on_key='none',stage_started_at=null,
    requires_print=null,requires_ebook=null,service_capability_status='needs_review' where id=q;
  r := pg_temp.p6_call(a,format('select * from public.workflow_update_project_configuration(%L,0,%L,false,true,%L)',q,gen_random_uuid(),'{}'));
  perform pg_temp.p6_assert((select workflow_stage_key='ebook_version' and capabilities_resolved_by=a from public.projects where id=q),'capability resume');
  perform pg_temp.p6_assert((select array_agg(event_type::text order by sequence_no)=array['workflow_configuration_updated','stage_skipped','stage_skipped','stage_entered']
    from public.project_stage_history where project_id=q),'configuration resume no fake approval');

  -- Admin correction records complete state and does not fabricate delivery.
  q := pg_temp.p6_project('design_concept','active');
  r := pg_temp.p6_call(a,format('select * from public.workflow_admin_override(%L,0,%L,%L,%L,%L,%L,%L,%L)',q,gen_random_uuid(),
    'active','print_version','active','team','Emergency correction','Synthetic test correction'));
  perform pg_temp.p6_assert((select count(*)=1 from public.admin_workflow_overrides where project_id=q and actor_id=a
    and previous_stage_key='design_concept' and resulting_stage_key='print_version'),'admin override audit');

  -- All fixtures: contiguous sequence, ordered returned IDs, one nonzero interval
  -- event per mutation, cache reconciliation, notification recipients deduplicated.
  perform pg_temp.p6_assert(not exists(select 1 from public.project_stage_history h join public.projects x on x.id=h.project_id
    where x.project_title='Phase6 local workflow fixture' group by h.project_id,h.idempotency_key
    having count(*) filter(where h.production_seconds_delta>0 or h.client_wait_seconds_delta>0)>1),'one interval event');
  perform pg_temp.p6_assert(not exists(select 1 from public.projects x cross join lateral public._workflow_reconcile(x.id) z
    where x.project_title='Phase6 local workflow fixture' and (z.production_difference<>0 or z.client_difference<>0)),'accounting reconciles');
  perform pg_temp.p6_assert(not exists(select 1 from public.project_stage_history h join public.projects x on x.id=h.project_id
    where x.project_title='Phase6 local workflow fixture' group by h.project_id having max(h.sequence_no)<>count(*)),'contiguous sequences');
  perform pg_temp.p6_assert(not exists(select 1 from public.workflow_idempotency_receipts w join public.projects x on x.id=w.project_id
    where x.project_title='Phase6 local workflow fixture' and w.result_payload->'history_event_ids' is distinct from
      (select to_jsonb(array_agg(h.id order by h.sequence_no)) from public.project_stage_history h
       where h.project_id=w.project_id and h.idempotency_key=w.idempotency_key)),'receipt history ID order');
  perform pg_temp.p6_assert(not exists(select 1 from public.workflow_idempotency_receipts w
    cross join lateral jsonb_array_elements_text(w.result_payload->'affected_entity_ids'->'notification_ids') z(id)
    join public.notifications n on n.id=z.id::uuid join public.projects x on x.id=w.project_id
    where x.project_title='Phase6 local workflow fixture' group by w.id,n.recipient_id having count(*)>1),'distinct notification recipients');
  perform pg_temp.p6_assert(not exists(select 1 from public.workflow_idempotency_receipts w
    join public.project_stage_history h on h.project_id=w.project_id and h.idempotency_key=w.idempotency_key
    join public.projects x on x.id=w.project_id where x.project_title='Phase6 local workflow fixture'
    and (h.occurred_at<>w.created_at or h.created_at<>w.created_at or w.updated_at<>w.created_at)),'one mutation timestamp');
  raise notice 'PASS: authenticated mutation scenarios executed in disposable fixture (transaction will roll back).';
end $$;

-- Transaction-local conflict trigger exercises actual BEFORE trigger divergence.
create function pg_temp.p6_conflict() returns trigger language plpgsql as $$ begin
  if current_setting('phase6.inject_conflict',true)='on' then new.files_received_date:=date '1990-01-01'; end if;
  return new;
end $$;
create trigger phase6_test_projection_conflict before update on public.projects
  for each row execute function pg_temp.p6_conflict();
do $$
declare p uuid; a uuid; original jsonb;
begin
  if current_setting('phase6.local_disposable',true) is distinct from 'on'
    or nullif(current_setting('phase6.test_admin',true),'') is null
    or nullif(current_setting('phase6.test_client',true),'') is null then
    raise notice 'SKIP: trigger rollback scenario requires local Auth fixture'; return;
  end if;
  a:=current_setting('phase6.test_admin')::uuid;
  p:=pg_temp.p6_project(); select to_jsonb(x) into original from public.projects x where id=p;
  perform set_config('phase6.inject_conflict','on',true);
  perform pg_temp.p6_error(a,format('select * from public.workflow_advance_stage(%L,0,%L)',p,gen_random_uuid()),'legacy_workflow_trigger_conflict');
  perform pg_temp.p6_assert((select to_jsonb(x)=original from public.projects x where id=p),'trigger conflict rolled back project');
  perform pg_temp.p6_assert(not exists(select 1 from public.project_stage_history where project_id=p)
    and not exists(select 1 from public.notifications where project_id=p)
    and not exists(select 1 from public.workflow_idempotency_receipts where project_id=p),'trigger conflict rolled back related writes');
end $$;
rollback;
