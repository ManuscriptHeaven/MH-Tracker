-- LOCAL/DISPOSABLE DATABASE ONLY after migrations 1-3, as migration owner.
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/database/phase6_engine.test.sql
-- All fixtures roll back. No Auth users, emails, application RPCs, or trigger changes.
begin;
set local timezone = 'UTC';
create temporary table phase6_engine_test_marker (id integer) on commit drop;
create function pg_temp.phase6_assert(p_ok boolean, p_label text) returns void
language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'FAIL: %', p_label; end if;
end; $$;
create function pg_temp.phase6_expect_error(p_sql text, p_error text) returns void
language plpgsql as $$ begin
  begin execute p_sql;
  exception when others then
    if sqlerrm <> p_error then raise exception 'Expected %, got %', p_error, sqlerrm; end if;
    return;
  end;
  raise exception 'Expected error was not raised: %', p_error;
end; $$;

-- Repeatable fixture calendar, restored by ROLLBACK.
insert into public.workflow_calendar_exceptions(calendar_date,is_working_day)
select d::date, extract(isodow from d) < 6
from generate_series(timestamp '2026-09-01', timestamp '2026-09-30', interval '1 day') d
on conflict (calendar_date) do update set is_working_day = excluded.is_working_day;

select pg_temp.phase6_assert(public._workflow_stage_duration_days('files_received','{}') = 2, 'Files default');
select pg_temp.phase6_assert(public._workflow_stage_duration_days('design_concept','{}') = 3, 'Design default');
select pg_temp.phase6_assert(public._workflow_stage_duration_days('print_version','{}') = 5, 'Print default');
select pg_temp.phase6_assert(public._workflow_stage_duration_days('ebook_version','{"ebook_version_days":4}') = 4, 'Canonical ebook key');
select pg_temp.phase6_assert(public._workflow_stage_duration_days('concept_approval','{"design_concept_days":8}') = 0, 'Approval duration zero');
select pg_temp.phase6_assert(public._workflow_revision_duration_days('{"design_concept_revision_days":7}') = 2, 'Legacy extras tolerated, not canonical defaults');
select pg_temp.phase6_assert(not public._workflow_exclude_weekends('{"exclude_weekends":false}'), 'Weekend setting');
select pg_temp.phase6_assert(public._workflow_stage_duration_days('print_version','{"print_version_days":365}') = 365, 'Upper bound');
select pg_temp.phase6_assert(public._workflow_stage_duration_days('print_version','{"print_version_days":0}') = 0, 'Zero duration');
select pg_temp.phase6_expect_error($q$select public._workflow_validate_settings('{"revision_days":1.5}')$q$, 'workflow_invalid_settings');
select pg_temp.phase6_expect_error($q$select public._workflow_validate_settings('{"revision_days":366}')$q$, 'workflow_invalid_settings');
select pg_temp.phase6_expect_error($q$select public._workflow_validate_settings('{"exclude_weekends":"false"}')$q$, 'workflow_invalid_settings');
select pg_temp.phase6_expect_error($q$select public._workflow_validate_settings('{"revision_days":null}')$q$, 'workflow_invalid_settings');
select pg_temp.phase6_expect_error($q$select public._workflow_validate_settings('[]')$q$, 'workflow_invalid_settings');

do $test$
declare v_path public.workflow_stage[]; v_next record; v_stage public.workflow_stage;
  v_print boolean; v_ebook boolean; v_case integer;
begin
  for v_case in 1..3 loop
    v_print := v_case <> 2; v_ebook := v_case <> 1;
    v_stage := 'files_received'; v_path := array[v_stage];
    loop
      select * into v_next from public._workflow_next_stage(v_stage,v_print,v_ebook,'confirmed');
      exit when v_next.next_stage is null;
      v_stage := v_next.next_stage;
      v_path := array_append(v_path,v_stage);
    end loop;
    perform pg_temp.phase6_assert(v_path = case v_case
      when 1 then array['files_received','design_concept','concept_approval','print_version','print_approval','final_delivery']::public.workflow_stage[]
      when 2 then array['files_received','design_concept','concept_approval','ebook_version','ebook_approval','final_delivery']::public.workflow_stage[]
      else array['files_received','design_concept','concept_approval','print_version','print_approval','ebook_version','ebook_approval','final_delivery']::public.workflow_stage[] end,
      'Complete capability path ' || v_case);
  end loop;
  select * into v_next from public._workflow_next_stage('files_received',true,true,'confirmed',array['design_concept']::public.workflow_stage[]);
  perform pg_temp.phase6_assert(v_next.next_stage = 'print_version'
    and v_next.skipped_stages = array['design_concept','concept_approval']::public.workflow_stage[]
    and v_next.skip_reasons = array['approved_manual_skip','approved_manual_skip'], 'Manual paired skip');
  select * into v_next from public._workflow_next_stage('print_version',true,true,'confirmed',array['print_version']::public.workflow_stage[],true);
  perform pg_temp.phase6_assert(v_next.next_stage = 'ebook_version'
    and v_next.skipped_stages = array['print_version','print_approval']::public.workflow_stage[], 'Include current pair for newly approved skip');
  select * into v_next from public._workflow_next_stage('files_received',true,true,'confirmed',array['ebook_version']::public.workflow_stage[]);
  perform pg_temp.phase6_assert(v_next.next_stage = 'design_concept' and cardinality(v_next.skipped_stages) = 0,
    'Future skip does not jump over earlier executable stages');
  select * into v_next from public._workflow_capability_resume_route('active','concept_approval','completed','none',true,false,'confirmed');
  perform pg_temp.phase6_assert(v_next.next_stage = 'print_version', 'Concept resume to print');
  select * into v_next from public._workflow_capability_resume_route('active','concept_approval','completed','none',false,true,'confirmed');
  perform pg_temp.phase6_assert(v_next.next_stage = 'ebook_version'
    and v_next.skipped_stages = array['print_version','print_approval']::public.workflow_stage[]
    and v_next.skip_reasons = array['capability_disabled','capability_disabled'], 'Concept resume to ebook with automatic print pair skip');
  select * into v_next from public._workflow_capability_resume_route('active','print_approval','completed','none',true,true,'confirmed');
  perform pg_temp.phase6_assert(v_next.next_stage = 'ebook_version', 'Print resume with ebook');
  select * into v_next from public._workflow_capability_resume_route('active','print_approval','completed','none',true,false,'confirmed');
  perform pg_temp.phase6_assert(v_next.next_stage = 'final_delivery'
    and v_next.skipped_stages = array['ebook_version','ebook_approval']::public.workflow_stage[], 'Print resume without ebook');
end;
$test$;
select pg_temp.phase6_expect_error($q$select public._workflow_next_stage('files_received',null,true,'needs_review')$q$, 'service_capabilities_unresolved');
select pg_temp.phase6_expect_error($q$select public._workflow_next_stage('files_received',false,false,'confirmed')$q$, 'workflow_invalid_capabilities');
select pg_temp.phase6_expect_error($q$select public._workflow_next_stage('files_received',true,true,'confirmed',array['concept_approval']::public.workflow_stage[])$q$, 'workflow_invalid_manual_skips');
select pg_temp.phase6_expect_error($q$select public._workflow_next_stage('files_received',true,true,'confirmed',array['final_delivery']::public.workflow_stage[])$q$, 'workflow_invalid_manual_skips');
select pg_temp.phase6_expect_error($q$select public._workflow_next_stage('files_received',true,true,'confirmed',array['files_received']::public.workflow_stage[])$q$, 'workflow_invalid_manual_skips');
select pg_temp.phase6_expect_error($q$select public._workflow_capability_resume_route('active','concept_approval','awaiting_client','client',true,true,'confirmed')$q$, 'workflow_invalid_capability_resume');

do $test$
declare v_id uuid := gen_random_uuid(); v_clean_id uuid := gen_random_uuid(); v_totals record;
  v_delta record; v_reconcile record; v_project public.projects%rowtype; v_expected public.projects%rowtype;
  v_before_count bigint; v_after_count bigint; v_route record;
begin
  insert into public.projects(id,client_name,project_title,service_type,due_date,
    project_status,workflow_stage_key,workflow_stage_status_key,workflow_waiting_on_key,
    requires_print,requires_ebook,service_capability_status,production_seconds_total,client_wait_seconds_total)
  values (v_id,'Local rollback fixture','Phase 6 engine fixture','Print + eBook','2026-09-30',
    'active','files_received','active','team',true,true,'confirmed',150,245),
    (v_clean_id,'Local rollback fixture','Phase 6 clean fixture','Print + eBook','2026-09-30',
    'active','files_received','active','team',true,true,'confirmed',0,0);
  insert into public.project_stage_history(project_id,stage,status,action,sequence_no,event_type,
    occurred_at,production_seconds_delta,client_wait_seconds_delta,metadata)
  values
    (v_id,null,'ACTIVE','fixture',1,'stage_entered','2026-09-03 10:00+05',999,888,'{}'),
    (v_id,null,'ACTIVE','legacy_snapshot_imported',10,'legacy_snapshot_imported','2026-09-04 10:00+05',0,0,
      '{"canonical_snapshot":{"production_seconds_total":100,"client_wait_seconds_total":200}}'),
    (v_id,'Files Received','ACTIVE','fixture',11,'stage_entered','2026-09-04 10:01+05',30,40,'{}'),
    (v_clean_id,'Files Received','ACTIVE','fixture',1,'stage_entered','2026-09-04 10:00+05',7,9,'{}');
  select count(*) into v_before_count from public.project_stage_history where project_id = v_id;
  select * into v_totals from public._workflow_accounting_totals(v_id);
  perform pg_temp.phase6_assert(v_totals.production_seconds_total = 130 and v_totals.client_wait_seconds_total = 240,
    'Baseline + post-snapshot deltas only; older canonical deltas excluded');
  select * into v_totals from public._workflow_accounting_totals(v_clean_id);
  perform pg_temp.phase6_assert(v_totals.production_seconds_total = 7 and v_totals.client_wait_seconds_total = 9, 'No snapshot uses zero baseline');
  perform pg_temp.phase6_assert(public._workflow_effective_clock_start(v_id,'2026-09-03 10:00+05')
    = timestamptz '2026-09-04 10:00+05', 'Old stage start clamps to import');
  perform pg_temp.phase6_assert(public._workflow_effective_clock_start(v_id,null)
    = timestamptz '2026-09-04 10:00+05', 'Snapshot supplies boundary when old start absent');
  perform pg_temp.phase6_assert(public._workflow_effective_clock_start(v_id,'2026-09-07 10:00+05')
    = timestamptz '2026-09-07 10:00+05', 'Later stage start wins');
  select * into v_delta from public._workflow_interval_delta(v_id,'active','2026-09-03 10:00+05','2026-09-07 10:00+05','{}');
  perform pg_temp.phase6_assert(v_delta.production_seconds_delta = 86400 and v_delta.client_wait_seconds_delta = 0,
    'Production starts at snapshot and excludes weekend');
  select * into v_delta from public._workflow_interval_delta(v_id,'awaiting_client','2026-09-03 10:00+05','2026-09-07 10:00+05','{}');
  perform pg_temp.phase6_assert(v_delta.production_seconds_delta = 0 and v_delta.client_wait_seconds_delta = 259200,
    'Client wait includes weekend, excludes pre-snapshot time');
  select * into v_delta from public._workflow_interval_delta(v_id,'paused','2026-09-03 10:00+05','2026-09-07 10:00+05','{}');
  perform pg_temp.phase6_assert(v_delta.production_seconds_delta = 0 and v_delta.client_wait_seconds_delta = 0, 'Stopped clock zero');
  select * into v_delta from public._workflow_interval_delta(v_clean_id,'active',null,'2026-09-07 10:00+05','{}');
  perform pg_temp.phase6_assert(v_delta.production_seconds_delta = 0, 'No usable clean clock start: zero');
  perform pg_temp.phase6_expect_error(format(
    'select public._workflow_interval_delta(%L,''active'',null,''2026-09-03 10:00+05'',''{}'')',v_id), 'workflow_invalid_interval');
  select * into v_reconcile from public._workflow_reconcile(v_id);
  perform pg_temp.phase6_assert(v_reconcile.production_difference = 20 and v_reconcile.client_difference = 5,
    'Reconciliation differences are stored minus calculated');
  select count(*) into v_after_count from public.project_stage_history where project_id = v_id;
  perform pg_temp.phase6_assert(v_before_count = v_after_count, 'Accounting appends no history');
  perform pg_temp.phase6_assert((select production_seconds_delta = 0 and client_wait_seconds_delta = 0
    from public.project_stage_history where project_id = v_id and event_type = 'legacy_snapshot_imported'), 'Snapshot deltas stay zero');

  insert into public.project_stage_skips(project_id,stage,reason,status,stage_key,canonical_status)
  values (v_id,'Ebook Version','Rollback fixture','APPROVED','ebook_version','approved'),
    (v_id,'Print Version','Rollback fixture','PENDING','print_version','pending'),
    (v_id,'Design Concept','Rollback fixture','SERVICE_TYPE_PRESET','design_concept',null),
    (v_id,'Print Approval','Rollback fixture','APPROVED','print_approval','approved');
  perform pg_temp.phase6_assert(public._workflow_approved_manual_skips(v_id)
    = array['ebook_version']::public.workflow_stage[], 'Only approved production targets recognized');
  perform pg_temp.phase6_assert(public._workflow_has_approved_manual_skip(v_id,'ebook_version'), 'Future manual approval recognized');
  select * into v_route from public._workflow_next_stage('print_approval',true,true,'confirmed',public._workflow_approved_manual_skips(v_id));
  perform pg_temp.phase6_assert(v_route.next_stage = 'final_delivery'
    and v_route.skipped_stages = array['ebook_version','ebook_approval']::public.workflow_stage[], 'Stored future decision drives pair routing');

  select p.* into v_project from public.projects p where p.id = v_id;
  v_project.workflow_stage_key := 'print_version'; v_project.stage_due_at := '2026-09-07 10:00+05';
  perform pg_temp.phase6_assert(public._workflow_estimate_remaining_production(v_project,'2026-09-04 10:00+05','{}')
    = timestamptz '2026-09-16 10:00+05', 'Remaining print due + ebook 5 + final 2; no client time');
  perform pg_temp.phase6_assert(public._workflow_estimate_remaining_production(v_project,'2026-09-04 10:00+05',array['ebook_version']::public.workflow_stage[])
    = timestamptz '2026-09-09 10:00+05', 'Due estimate omits manual ebook pair');
  v_project.workflow_stage_key := 'concept_approval'; v_project.workflow_stage_status_key := 'awaiting_client';
  v_project.workflow_waiting_on_key := 'client'; v_project.stage_due_at := null;
  v_project.requires_print := false;
  perform pg_temp.phase6_assert(public._workflow_estimate_remaining_production(v_project,'2026-09-04 10:00+05','{}')
    = timestamptz '2026-09-15 10:00+05', 'Waiting approval estimates production starting as-of only');
  v_project.workflow_stage_status_key := 'revision_active'; v_project.workflow_waiting_on_key := 'team';
  perform pg_temp.phase6_assert(public._workflow_estimate_remaining_production(v_project,'2026-09-04 10:00+05','{}','2026-09-07 10:00+05')
    = timestamptz '2026-09-16 10:00+05', 'Current revision due precedes remaining production');
  v_project.service_capability_status := 'needs_review'; v_project.requires_print := null;
  perform pg_temp.phase6_assert(public._workflow_estimate_remaining_production(v_project,'2026-09-04 10:00+05','{}') is null,
    'Unresolved capability returns NULL estimate');
  v_project.service_capability_status := 'confirmed'; v_project.requires_print := false;
  v_project.stage_due_at := '2026-09-03 10:00+05';
  perform pg_temp.phase6_assert(public._workflow_estimate_remaining_production(v_project,'2026-09-04 10:00+05','{}') is null,
    'Overdue current effort is unknown, not assumed completed');

  select p.* into v_expected from public.projects p where p.id = v_id;
  update public.projects set status = 'Active',current_stage = 'Files Received',stage_status = 'ACTIVE',
    waiting_on = 'Manuscript Heaven',timeline_status = 'Active' where id = v_id;
  perform public._workflow_assert_project_projection(v_expected);
  -- Internal totals remain guarded even though they are no longer public fields.
  update public.projects set production_seconds_total = 151 where id = v_id;
  begin
    perform public._workflow_assert_project_projection(v_expected);
    raise exception 'Expected production total conflict';
  exception when raise_exception then
    if sqlerrm <> 'legacy_workflow_trigger_conflict' then raise; end if;
  end;
  update public.projects set production_seconds_total = 150, client_wait_seconds_total = 246 where id = v_id;
  begin
    perform public._workflow_assert_project_projection(v_expected);
    raise exception 'Expected client wait total conflict';
  exception when raise_exception then
    if sqlerrm <> 'legacy_workflow_trigger_conflict' then raise; end if;
  end;
  update public.projects set client_wait_seconds_total = 245 where id = v_id;
  update public.projects set current_stage = 'Design Concept' where id = v_id;
  begin
    perform public._workflow_assert_project_projection(v_expected);
    raise exception 'Expected legacy_workflow_trigger_conflict';
  exception when raise_exception then
    if sqlerrm <> 'legacy_workflow_trigger_conflict' then raise; end if;
  end;
end;
$test$;

select pg_temp.phase6_assert(public._workflow_compatibility_projection('active','ebook_approval','revision_active','team')
  = '{"status":"In Revision","current_stage":"Ebook Approval","stage_status":"REVISION_ACTIVE","waiting_on":"Manuscript Heaven","timeline_status":"Active"}'::jsonb,
  'Exact revision compatibility and Ebook capitalization');
select pg_temp.phase6_assert(public._workflow_compatibility_projection('archived','print_version','paused','none') ->> 'timeline_status'
  = 'Paused', 'Archive uses SQL-compatible stopped timeline');
select pg_temp.phase6_assert(public._workflow_compatibility_projection('active',null,null,null) -> 'current_stage'
  = 'null'::jsonb, 'Unknown stage stays NULL');

do $test$
declare v_id uuid := gen_random_uuid(); v_a text; v_b text; v_result public.workflow_mutation_result;
  v_project public.projects%rowtype; v_snapshot jsonb; v_committed jsonb;
  v_request jsonb := '{"version":0,"settings":{"b":2,"a":1},"note":null}';
begin
  -- Row composite only: no user/profile/actor fixture is inserted.
  v_project.id := v_id; v_project.workflow_version := 1;
  v_project.project_status := 'active'; v_project.workflow_stage_key := 'concept_approval';
  v_project.workflow_stage_status_key := 'awaiting_client'; v_project.workflow_waiting_on_key := 'client';
  v_project.production_seconds_total := 123; v_project.client_wait_seconds_total := 456;
  v_project.capabilities_resolved_by := gen_random_uuid();
  v_project.workflow_settings := '{"revision_days":7,"private_compatibility_note":"not for clients"}';
  v_snapshot := public._workflow_project_snapshot(v_project);
  perform pg_temp.phase6_assert(not (v_snapshot ?| array['production_seconds_total','client_wait_seconds_total',
    'capabilities_resolved_by','workflow_settings']), 'Generic snapshot excludes internal caches, resolver identity and settings');
  perform pg_temp.phase6_assert(v_snapshot ?& array['workflow_version','project_status','workflow_stage_key',
    'workflow_stage_status_key','workflow_waiting_on_key'], 'Generic snapshot retains canonical state and version');
  perform pg_temp.phase6_assert((select count(*) from jsonb_object_keys(v_snapshot)) = 20, 'Exactly twenty public-safe snapshot fields');
  v_project.production_seconds_total := 999; v_project.client_wait_seconds_total := 888;
  v_project.workflow_settings := '{"revision_days":9}';
  perform pg_temp.phase6_assert(v_snapshot = public._workflow_project_snapshot(v_project),
    'Receipt snapshot comparison is independent of excluded internal fields');
  v_a := public._workflow_request_fingerprint('fixture',v_id,'{"version":0,"settings":{"b":2,"a":1},"note":null}');
  v_b := public._workflow_request_fingerprint('fixture',v_id,'{"note":null,"settings":{"a":1,"b":2},"version":0}');
  perform pg_temp.phase6_assert(v_a = v_b, 'Fingerprint independent of object key order');
  perform pg_temp.phase6_assert(v_a <> public._workflow_request_fingerprint('fixture',v_id,
    '{"note":null,"settings":{"a":1,"b":3},"version":0}'), 'Changed nested value changes fingerprint');
  perform pg_temp.phase6_assert(length(v_a) = 64 and v_a ~ '^[0-9a-f]{64}$', 'Fingerprint is SHA-256 lowercase hex');
  perform pg_temp.phase6_assert(v_a <> v_request::text and position(v_request::text in v_a) = 0
    and position('settings' in v_a) = 0, 'Fingerprint does not retain raw request JSON');
  perform pg_temp.phase6_assert(v_a <> public._workflow_request_fingerprint('fixture',v_id,
    '{"note":"changed","settings":{"a":1,"b":2},"version":0}'), 'Changed behavior changes fingerprint');
  v_result := row(v_id,1,v_snapshot,'{}'::jsonb,'{}'::uuid[],false)::public.workflow_mutation_result;
  v_committed := to_jsonb(v_result);
  v_result := public._workflow_retry_result(to_jsonb(v_result),v_a,v_b);
  perform pg_temp.phase6_assert(to_jsonb(v_result) = v_committed || '{"already_applied":true}'::jsonb,
    'Retry returns exactly the originally committed safe result apart from retry flag');
  perform pg_temp.phase6_assert(v_result.already_applied and v_result.workflow_version = 1,
    'Retry returns original version-1 result for original version-0 request');
  perform pg_temp.phase6_expect_error(format('select public._workflow_retry_result(%L::jsonb,%L,%L)',
    to_jsonb(v_result),v_a,'different'),'idempotency_key_reused');
  perform pg_temp.phase6_expect_error('select public._workflow_check_version(1,0)','workflow_stale_version');
end;
$test$;

-- Grants are part of this migration, not deferred assertions of security success.
select pg_temp.phase6_assert(not has_table_privilege('authenticated','public.workflow_idempotency_receipts','SELECT'), 'Receipts not directly readable');
select pg_temp.phase6_assert(not has_table_privilege('authenticated','public.workflow_idempotency_receipts','INSERT'), 'Receipts not directly writable');
select pg_temp.phase6_assert(not exists (
  select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like '\_workflow\_%' escape '\'
    or p.proname in ('workflow_add_production_days','workflow_production_seconds_between','workflow_production_days_between'))
    and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))
), 'No ordinary EXECUTE grants on the foundation');
rollback;
