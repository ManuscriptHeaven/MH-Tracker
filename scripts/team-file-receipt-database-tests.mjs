// Disposable Postgres harness for the real advance RPC + migration.
// Canonical helper contracts are isolated stubs; this never connects to production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { PGlite } = await import(process.argv[2]);
const db = new PGlite();
const project = '22222222-2222-4222-8222-222222222222';
const employee = '11111111-1111-4111-8111-111111111111';
const outsider = '44444444-4444-4444-8444-444444444444';
await db.exec(`
create role phase6_workflow_rpc_owner nologin;
create role authenticated nologin; create role anon nologin;
create type public.workflow_stage as enum ('files_received','design_concept','print_version');
create type public.project_lifecycle_status as enum ('active','on_hold','completed','cancelled','archived');
create type public.workflow_event_type as enum ('stage_entered');
create type public.workflow_stage_status as enum ('pending','active','awaiting_client','revision_active','paused','completed','skipped');
create table public.projects(id uuid primary key,assigned_to uuid,project_status project_lifecycle_status,
 workflow_stage_key workflow_stage,workflow_stage_status_key text,workflow_waiting_on_key text,
 workflow_version bigint,stage_started_at timestamptz,workflow_settings jsonb,
 requires_print boolean,requires_ebook boolean,service_capability_status text,
 files_received_date date,requirements_submitted_at timestamptz,production_seconds_total bigint default 0,
 client_wait_seconds_total bigint default 0,updated_at timestamptz,stage_due_at timestamptz,final_due_at timestamptz);
create table public.revision_requests(id uuid); create table public.project_stage_skips(id uuid);
create table public.admin_workflow_overrides(id uuid);
create table public.project_stage_history(id uuid primary key,project_id uuid,reason text,events jsonb,production_delta bigint,client_delta bigint);
create table public.notifications(id uuid primary key,project_id uuid);
create type public.workflow_mutation_result as (project_id uuid,workflow_version bigint,affected jsonb);
create table public.receipts(id uuid primary key,fingerprint text,result public.workflow_mutation_result);
grant usage,create on schema public to phase6_workflow_rpc_owner;
grant all on all tables in schema public to phase6_workflow_rpc_owner;
create function public._workflow_current_actor() returns table(actor_id uuid,normalized_role text)
 language sql as $$ select current_setting('test.actor')::uuid,current_setting('test.role') $$;
create function public._workflow_lock_project(p uuid) returns public.projects language sql as $$ select * from public.projects where id=p $$;
create function public._workflow_request_fingerprint(n text,p uuid,input jsonb) returns text language sql as $$ select input::text $$;
create function public._workflow_receipt_lookup(n text,p uuid,k uuid,f text) returns public.workflow_mutation_result language plpgsql as $$
 declare r public.receipts; begin select * into r from public.receipts where id=k;
 if found and r.fingerprint<>f then raise exception 'idempotency_key_reused'; end if; return r.result; end $$;
create function public._workflow_check_version(actual bigint,expected bigint) returns void language plpgsql as $$ begin if actual is distinct from expected then raise exception 'workflow_stale_version'; end if; end $$;
create function public._workflow_validate_tuple(p public.projects) returns void language plpgsql as $$ begin end $$;
create function public._workflow_stage_required(s public.workflow_stage,p boolean,e boolean,c text) returns boolean language sql as $$ select true $$;
create function public._workflow_lock_mutation_rows(p uuid) returns void language plpgsql as $$ begin end $$;
create function public._workflow_checked_manual_skips(p uuid) returns public.workflow_stage[] language sql as $$
 select case when current_setting('test.skip',true)='yes' then array['design_concept']::public.workflow_stage[] else '{}'::public.workflow_stage[] end $$;
create function public._workflow_effective_clock_start(p uuid,t timestamptz) returns timestamptz language sql as $$ select t $$;
create function public._workflow_exclude_weekends(settings jsonb) returns boolean language sql as $$ select true $$;
create function public.workflow_production_seconds_between(s timestamptz,e timestamptz,w boolean,z text) returns bigint language plpgsql as $$ begin raise exception 'intake_must_not_count_as_production'; end $$;
create function public._workflow_next_stage(s public.workflow_stage,p boolean,e boolean,c text,m public.workflow_stage[],x boolean) returns table(next_stage public.workflow_stage,skipped_stages public.workflow_stage[],skip_reasons jsonb) language sql as $$
 select case when 'design_concept'=any(m) then 'print_version'::public.workflow_stage else 'design_concept'::public.workflow_stage end,m,'{}'::jsonb $$;
create function public._workflow_enter_production(p public.projects,s public.workflow_stage,t timestamptz) returns public.projects language plpgsql as $$ begin p.workflow_stage_key:=s; p.workflow_stage_status_key:='active'; p.workflow_waiting_on_key:='team'; p.stage_started_at:=t; p.stage_due_at:=t+interval '3 days'; return p; end $$;
create function public._workflow_route_events(p public.projects,s public.workflow_stage[],r jsonb) returns jsonb language sql as $$ select '[]'::jsonb $$;
create function public._workflow_event(n text,b public.projects,a public.projects,l jsonb,m jsonb) returns jsonb language sql as $$ select jsonb_build_array(jsonb_build_object('event',n,'metadata',m,'links',l)) $$;
create function public._workflow_compatibility_projection(p public.project_lifecycle_status,s public.workflow_stage,t text,w text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public._workflow_estimate_remaining_production(p public.projects,t timestamptz,s public.workflow_stage[],d timestamptz) returns timestamptz language sql as $$ select t+interval '7 days' $$;
create function public._workflow_write_project(p public.projects) returns void language sql as $$ update public.projects set
 workflow_stage_key=p.workflow_stage_key,workflow_stage_status_key=p.workflow_stage_status_key,workflow_waiting_on_key=p.workflow_waiting_on_key,
 files_received_date=p.files_received_date,requirements_submitted_at=p.requirements_submitted_at,production_seconds_total=p.production_seconds_total,
 client_wait_seconds_total=p.client_wait_seconds_total,stage_started_at=p.stage_started_at,stage_due_at=p.stage_due_at,final_due_at=p.final_due_at where id=p.id $$;
create function public._workflow_assert_project_projection(p public.projects) returns void language plpgsql as $$ begin end $$;
create function public._workflow_assert_milestones(p public.projects) returns void language plpgsql as $$ begin end $$;
create function public._workflow_emit_events(p uuid,e jsonb,prod bigint,client bigint,n text,t timestamptz,k uuid,c integer) returns uuid[] language plpgsql as $$ declare id uuid:=gen_random_uuid(); begin insert into public.project_stage_history values(id,p,n,e,prod,client); return array[id]; end $$;
create function public._workflow_notify(p public.projects,a text,n text,r uuid,t timestamptz) returns uuid[] language plpgsql as $$ declare id uuid:=gen_random_uuid(); begin insert into public.notifications values(id,p.id); return array[id]; end $$;
create function public._workflow_make_result(p uuid,a jsonb,h uuid[]) returns public.workflow_mutation_result language sql as $$ select row(p,(select workflow_version from public.projects where id=p),a)::public.workflow_mutation_result $$;
create function public._workflow_receipt_store(n text,p uuid,k uuid,f text,r public.workflow_mutation_result,t timestamptz) returns void language sql as $$ insert into public.receipts values(k,f,r) $$;
insert into public.projects(id,assigned_to,project_status,workflow_stage_key,workflow_stage_status_key,workflow_waiting_on_key,workflow_version)
 values ('${project}','${employee}','active','files_received','pending','client',1);
set test.actor='${employee}'; set test.role='Employee';
`);
const original = fs.readFileSync('supabase/phase6/migrations/00300_phase6_workflow_rpcs.sql','utf8');
const extract = (start,end) => original.slice(original.indexOf(start),original.indexOf(end,original.indexOf(start)));
// Use actual canonical authorization, interval accounting and RPC signatures.
await db.exec(extract('create function public._workflow_can_team_work(', 'create function public._workflow_can_client_access('));
await db.exec(extract('create function public._workflow_interval_delta(', 'create function public._workflow_reconcile('));
await db.exec(extract('create function public.workflow_advance_stage(', 'create function public.workflow_submit_stage_for_approval('));
await db.exec(`alter function public.workflow_advance_stage(uuid,bigint,uuid,text) owner to phase6_workflow_rpc_owner;
revoke all on function public.workflow_advance_stage(uuid,bigint,uuid,text) from public,anon;
grant execute on function public.workflow_advance_stage(uuid,bigint,uuid,text) to authenticated;`);
const catalog = async () => (await db.query(`select proowner,proacl::text,proconfig,prosecdef from pg_proc where oid='public.workflow_advance_stage(uuid,bigint,uuid,text)'::regprocedure`)).rows;
const before = await catalog();
const migration = fs.readFileSync('supabase/migrations/20261018162003_team_confirm_received_files.sql','utf8');
await db.exec(migration);
assert.deepEqual(await catalog(),before,'owner, access grants and definer configuration are preserved');
const submit = (note='Files already received via Email.',version=1,key=crypto.randomUUID()) => db.query('select * from public.workflow_advance_stage($1,$2,$3,$4)',[project,version,key,note]);
for (const note of [null,'',' ','\t\n']) await assert.rejects(()=>submit(note),/workflow_file_note_required/);
await assert.rejects(()=>submit('Already received',0),/workflow_stale_version/);
await db.exec(`set test.role='Client'`);
await assert.rejects(()=>submit(),/workflow_forbidden/);
await db.exec(`set test.role='Employee'; set test.actor='${outsider}'`);
await assert.rejects(()=>submit(),/workflow_forbidden/);
await db.exec(`set test.actor='${employee}'`);
for (const status of ['on_hold','completed','cancelled','archived']) {
 await db.query('update public.projects set project_status=$1',[status]);
 await assert.rejects(()=>submit(),/workflow_invalid_state/);
}
await db.exec(`update public.projects set project_status='active',stage_started_at=clock_timestamp()-interval '60 seconds'`);
const key=crypto.randomUUID();
const result=await submit('Files already received via WhatsApp.',1,key);
assert.equal(result.rows[0].workflow_version,2);
const saved=(await db.query('select * from public.projects')).rows[0];
assert.equal(saved.workflow_stage_key,'design_concept');
assert.equal(saved.workflow_stage_status_key,'active');
assert.equal(saved.workflow_waiting_on_key,'team');
assert.ok(saved.requirements_submitted_at && saved.files_received_date && saved.stage_due_at && saved.final_due_at);
assert.equal(saved.production_seconds_total,0);
assert.ok(saved.client_wait_seconds_total >= 60 && saved.client_wait_seconds_total < 70);
const history=(await db.query('select * from public.project_stage_history')).rows[0];
assert.equal(history.production_delta,0);
assert.equal(history.client_delta,saved.client_wait_seconds_total);
assert.equal(history.reason,'Files already received via WhatsApp.');
assert.equal(history.events[0].metadata.source,'team_file_receipt_confirmation');
assert.equal(history.events[0].metadata.portal_upload_skipped,true);
assert.deepEqual((await submit('Files already received via WhatsApp.',1,key)).rows,result.rows,'replay preserves the committed result');
await assert.rejects(()=>submit('Changed note',1,key),/idempotency_key_reused/);
await assert.rejects(()=>submit('Already received',2),/workflow_invalid_state/);
for (const table of ['project_stage_history','notifications','receipts']) assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,1,`${table} emitted exactly once`);
// Legacy active intake + manager, then admin + an approved future concept skip.
for (const [role,skip,target] of [['Project Manager','no','design_concept'],['Admin','yes','print_version']]) {
 await db.exec(`update public.projects set workflow_stage_key='files_received',workflow_stage_status_key='active',workflow_version=3;
 set test.actor='${outsider}'; set test.role='${role}'; set test.skip='${skip}'`);
 await submit('Files received via Email.',3);
 assert.equal((await db.query('select workflow_stage_key from public.projects')).rows[0].workflow_stage_key,target);
}
await assert.rejects(()=>db.exec(migration),/definition_drift/,'unexpected definitions cannot be silently patched');
await db.close();
console.log('Team file receipt database harness passed: permission checks, lifecycle, atomic routing, timers, audit, stale versions, replay, approved skips and ACL preservation. Helpers are isolated stubs.');
