import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const migrationDir = 'supabase/phase6/migrations';
const migrationFiles = fs.readdirSync(migrationDir).filter((f) => /^00(?:100|200|300|400|450|460)_phase6_.*\.sql$/.test(f)).sort();
assert.deepEqual(migrationFiles, [
  '00100_phase6_canonical_foundation.sql',
  '00200_phase6_legacy_backfill.sql',
  '00300_phase6_workflow_rpcs.sql',
  '00400_phase6_security_and_projections.sql',
  '00450_phase6_core_application_security.sql',
  '00460_phase6_finance_payroll_security.sql',
]);

assert.equal(sha(`${migrationDir}/${migrationFiles[0]}`), '3bdae7a341b22699cb8879a3508e3f97eb76e1e09287949ebd7fe93aed1ee21a');
assert.equal(sha(`${migrationDir}/${migrationFiles[1]}`), '848c80db812dfa583c563fc9b73c44deebf6130d56578946712a78003cbb2cfc');
assert.equal(sha(`${migrationDir}/${migrationFiles[2]}`), '296b77041d7af216c499c50a7e91866cb70d2f7e4fb9e36f6410e86bf6c7e767');
assert.equal(sha(`${migrationDir}/${migrationFiles[3]}`), '22a852cf39d1e6d3292d98fcdc8ad90663770864e65592472a9b783565415628');
assert.equal(sha(`${migrationDir}/${migrationFiles[4]}`), 'fcffa593f087308a87c5d58e974cfbb81f13c2335429da82c24bfe8c11c980ee');
assert.equal(sha(`${migrationDir}/${migrationFiles[5]}`), '927032d087c2f1cd9faaa59ba10a9dbf76afb8a47b074dff029d7ced19b76add');

const phase6Readme = read('supabase/phase6/README.md');
assert.match(phase6Readme, /historical frontend snapshot of 128 files/i);
assert.match(phase6Readme, /f7299751ed2a80e9cfa82d5d46dea521637879f0394ede7514906e6add97bf99/);

const sql = read(`${migrationDir}/${migrationFiles[3]}`);
const rpcSql = read(`${migrationDir}/${migrationFiles[2]}`);
const compact = sql.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();

assert.match(compact, /create role phase6_workflow_rpc_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls/);
assert.match(compact, /alter role phase6_workflow_rpc_owner nologin noinherit nocreatedb nocreaterole noreplication/);
assert.doesNotMatch(compact, /alter role phase6_workflow_rpc_owner[^;]*(?:nosuperuser|nobypassrls)/);
assert.match(compact, /from pg_catalog\.pg_roles[\s\S]*v_role\.rolsuper[\s\S]*v_role\.rolbypassrls[\s\S]*v_role\.rolcanlogin[\s\S]*v_role\.rolinherit[\s\S]*v_role\.rolcreatedb[\s\S]*v_role\.rolcreaterole[\s\S]*v_role\.rolreplication[\s\S]*phase6_workflow_rpc_owner_unsafe_attributes/);
assert.match(compact, /revoke phase6_workflow_rpc_owner from anon, authenticated/);
assert.doesNotMatch(compact, /grant phase6_workflow_rpc_owner to (?:anon|authenticated)/);
assert.doesNotMatch(compact, /grant usage on schema auth|grant execute on function auth\.uid/);
assert.match(compact, /grant execute on function public\.phase6_auth_uid\(\) to phase6_workflow_rpc_owner/);
assert.doesNotMatch(compact, /alter function public\.phase6_auth_uid\(\) owner to/,
  'the bridge remains owned by the migration executor');
assert.match(compact, /grant phase6_workflow_rpc_owner to postgres; grant create on schema public to phase6_workflow_rpc_owner/);
assert.match(compact, /revoke create on schema public from phase6_workflow_rpc_owner; revoke phase6_workflow_rpc_owner from postgres; notify pgrst/);

const canonical = [
  'workflow_advance_stage','workflow_submit_stage_for_approval','workflow_client_approve_stage',
  'workflow_submit_client_revision','workflow_submit_revised_proof','workflow_request_stage_skip',
  'workflow_respond_stage_skip','workflow_admin_override','workflow_complete_final_delivery',
  'workflow_set_project_lifecycle','workflow_update_project_configuration',
];
for (const name of canonical) {
  assert.equal((compact.match(new RegExp(`alter function public\\.${name}\\([^;]+? owner to phase6_workflow_rpc_owner`, 'g')) ?? []).length, 1,
    `${name} ownership`);
  assert.equal((compact.match(new RegExp(`grant execute on function public\\.${name}\\([^;]+? to authenticated`, 'g')) ?? []).length, 1,
    `${name} authenticated grant`);
  assert.match(compact, new RegExp(`revoke all on function public\\.${name}\\([^;]+? from public, anon, authenticated`));
}
assert.equal((compact.match(/alter function public\.workflow_[a-z_]+\([^;]+? owner to phase6_workflow_rpc_owner/g) ?? []).length, 11);
assert.equal((compact.match(/grant execute on function public\.workflow_[a-z_]+\([^;]+? to authenticated/g) ?? []).length, 11);

assert.doesNotMatch(compact, /grant execute on function public\._workflow_[^(]*\([^;]* to (?:authenticated|anon)/);
assert.match(compact, /revoke all on function public\._workflow_format_evidence\(public\.projects,text\) from public, anon, authenticated/);
const ownerInternalGrants = compact.match(/grant execute on function public\.(?:_workflow_[^(]+|workflow_(?:add_production_days|production_seconds_between|production_days_between))\([^;]+? to phase6_workflow_rpc_owner/g) ?? [];
assert.equal(ownerInternalGrants.length, 54, 'all 54 engine helpers explicitly granted to owner');
assert.doesNotMatch(compact, /grant (?:all|execute) on all functions/);
assert.doesNotMatch(compact, /grant all on (?:table )?public\./);

const pgcryptoGrant = sql.match(/-- Request fingerprinting discovers pgcrypto[\s\S]*?\$phase6\$;/i)?.[0] ?? '';
assert.match(pgcryptoGrant, /from pg_catalog\.pg_extension e\s+join pg_catalog\.pg_namespace n on n\.oid=e\.extnamespace\s+where e\.extname='pgcrypto'/i);
assert.match(pgcryptoGrant, /raise exception 'workflow_pgcrypto_unavailable'/i);
assert.match(pgcryptoGrant, /to_regprocedure\([\s\S]*?%I\.digest\(text,text\)/i);
assert.match(pgcryptoGrant, /pg_catalog\.pg_depend[\s\S]*?refclassid='pg_catalog\.pg_extension'::regclass[\s\S]*?deptype='e'/i);
assert.match(pgcryptoGrant, /grant usage on schema %I to phase6_workflow_rpc_owner/i);
assert.match(pgcryptoGrant, /grant execute on function %I\.digest\(text,text\) to phase6_workflow_rpc_owner/i);
assert.doesNotMatch(pgcryptoGrant, /grant (?:all|create)|grant execute on all functions|to (?:authenticated|anon)/i);

const projectTouch = sql.match(/create or replace function public\.phase6_touch_project_metadata_updated_at\(\)[\s\S]*?\$fn\$;/i)?.[0] ?? '';
assert.match(projectTouch, /if current_user='phase6_workflow_rpc_owner' then\s+return new;/i);
assert.ok(projectTouch.indexOf("current_user='phase6_workflow_rpc_owner'") < projectTouch.indexOf('new.updated_at := clock_timestamp()'),
  'canonical owner returns before ordinary timestamp stamping');
assert.match(projectTouch, /new\.updated_at := clock_timestamp\(\)/i);
assert.doesNotMatch(projectTouch, /new\.updated_at is not distinct from old\.updated_at/i);
assert.match(projectTouch, /new\.client_profile_id is distinct from old\.client_profile_id[\s\S]*?phase6_current_actor_class\(\) not in \('admin','project_manager'\)[\s\S]*?workflow_project_client_access_denied/i);

const revisionTouch = sql.match(/create or replace function public\.phase6_touch_revision_metadata_updated_at\(\)[\s\S]*?\$fn\$;/i)?.[0] ?? '';
assert.match(revisionTouch, /if current_user='phase6_workflow_rpc_owner' then\s+return new;/i);
assert.ok(revisionTouch.indexOf("current_user='phase6_workflow_rpc_owner'") < revisionTouch.indexOf('new.updated_at := clock_timestamp()'),
  'canonical owner preserves explicit revision timestamp');
assert.match(revisionTouch, /new\.updated_at := clock_timestamp\(\)/i);
assert.doesNotMatch(revisionTouch, /new\.updated_at is not distinct from old\.updated_at/i);
assert.equal((rpcSql.match(/update public\.projects set workflow_version = v_after\.workflow_version where id = p_project_id;/g) ?? []).length, 11,
  'all canonical RPCs retain their version-only project update');

for (const table of ['project_stage_history','project_stage_skips','revision_requests','admin_workflow_overrides','workflow_idempotency_receipts']) {
  assert.match(compact, new RegExp(`revoke all on [^;]*public\\.${table}[^;]* from public, anon, authenticated`));
}
assert.match(compact, /revoke update on public\.projects from public, anon, authenticated/);
const projectColumnGrant = compact.match(/grant update \(([^)]+)\) on public\.projects to authenticated/)?.[1] ?? '';
for (const column of [
  'project_status','workflow_stage_key','workflow_stage_status_key','workflow_waiting_on_key','workflow_version',
  'requires_print','requires_ebook','service_capability_status','capabilities_resolved_by','capabilities_resolved_at',
  'workflow_settings','stage_started_at','stage_due_at','stage_completed_at','final_due_at','delivered_at',
  'revision_count','production_seconds_total','client_wait_seconds_total','status','current_stage','stage_status',
  'waiting_on','timeline_status','progress_percentage','production_days_used','delay_reason',
  'client_action_required','print_timeline_days','production_time_used','client_wait_time','stage_states',
  'files_received_date','design_concept_due_date','design_concept_due_date_manual','design_concept_submitted_date',
  'design_concept_approval_date','concept_revision_due_date','print_version_submitted_date',
  'print_version_due_date','print_version_due_date_manual','print_version_approval_date','print_revision_due_date',
  'ebook_due_date','ebook_due_date_manual','ebook_submitted_date','ebook_approval_date',
  'final_delivery_date','delivery_date',
]) assert.ok(!projectColumnGrant.split(',').map((x) => x.trim()).includes(column), `${column} must not be directly updateable`);
for (const column of ['project_title','client_name','assigned_to','proof_pdf_link','updated_at'])
  assert.ok(projectColumnGrant.split(',').map((x) => x.trim()).includes(column), `${column} metadata update retained`);
const revisionColumnGrant = compact.match(/grant update \(([^)]+)\) on public\.revision_requests to authenticated/)?.[1] ?? '';
assert.deepEqual(revisionColumnGrant.split(',').map((x) => x.trim()).sort(), ['assigned_to','priority','team_response'].sort());
for (const column of ['status','canonical_status','stage_key','revision_round','due_at','completed_at','updated_at'])
  assert.ok(!revisionColumnGrant.split(',').map((x) => x.trim()).includes(column), `${column} revision lifecycle update denied`);

assert.doesNotMatch(compact, /(?:using|with check)\s*\(\s*true\s*\)/);
assert.doesNotMatch(compact, /auth\.jwt\s*\(/);
assert.match(compact, /create policy phase6_projects_team_select[\s\S]*phase6_current_actor_class\(\) in \('admin','project_manager'\)[\s\S]*phase6_current_actor_class\(\)='employee' and assigned_to=auth\.uid\(\)/);
assert.doesNotMatch(compact, /create policy [^;]*projects[^;]*(?:client_has_project_access|phase6_current_actor_class\(\)='client')/);

const projectProjection = sql.match(/create or replace function public\.get_client_project_summaries\(\)([\s\S]*?)\$fn\$;/i)?.[1] ?? '';
assert.ok(projectProjection);
assert.doesNotMatch(projectProjection, /\bp\.\*|to_jsonb\s*\(|row_to_json\s*\(/i);
for (const prohibited of [
  'internal_notes','qa_notes','assigned_to','project_manager','production_seconds_total',
  'client_wait_seconds_total','workflow_settings','capabilities_resolved_by','capabilities_resolved_at',
  'other_links',
]) assert.doesNotMatch(projectProjection, new RegExp(`\\b${prohibited}\\b`, 'i'));
const clientRevisionActivity = sql.match(/create or replace function public\.get_client_revision_activity\(\)([\s\S]*?)\$fn\$;/i)?.[1] ?? '';
assert.doesNotMatch(clientRevisionActivity, /user_id|previous_value|new_value/i);
assert.match(projectProjection, /public\.client_has_project_access\(p\.id,public\.phase6_auth_uid\(\)\)/i);
const clientAccessHelper = sql.match(/create or replace function public\.client_has_project_access\([\s\S]*?\$fn\$;/i)?.[0] ?? '';
assert.match(clientAccessHelper, /client_id uuid default auth\.uid\(\)/i);
assert.match(clientAccessHelper, /client_id is not distinct from public\.phase6_auth_uid\(\)/i);
assert.match(clientAccessHelper, /p\.client_profile_id=public\.phase6_auth_uid\(\)/i);
assert.match(clientAccessHelper, /public\.client_project_access/i);
const ownerDefinerBodies = [...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\([^)]*\)[\s\S]*?security definer[\s\S]*?as \$fn\$([\s\S]*?)\$fn\$;/gi)];
assert.ok(ownerDefinerBodies.length > 0);
for (const block of ownerDefinerBodies) assert.doesNotMatch(block[2], /auth\.uid\(\)/i, `${block[1]} uses the public bridge`);
assert.match(compact, /create policy phase6_access_management_insert[\s\S]*?with check \(public\.phase6_current_actor_class\(\) in \('admin','project_manager'\)\)/);
assert.match(compact, /create policy phase6_access_management_update[\s\S]*?using \(public\.phase6_current_actor_class\(\) in \('admin','project_manager'\)\)[\s\S]*?with check \(public\.phase6_current_actor_class\(\) in \('admin','project_manager'\)\)/);
assert.match(compact, /create policy phase6_access_management_delete[\s\S]*?using \(public\.phase6_current_actor_class\(\) in \('admin','project_manager'\)\)/);
assert.doesNotMatch(compact, /create policy phase6_access_management_(?:insert|update|delete)[^;]*(?:='client'|='employee')/);
assert.match(compact, /create view public\.client_project_summaries with \(security_invoker=true\)/);
assert.doesNotMatch(compact, /client_project_summaries[\s\S]{0,2000}(?:p\.\*|to_jsonb\s*\(|row_to_json\s*\()/);

const legacy = [
  'client_approve_project_milestone','submit_client_revision','submit_revised_proof','client_respond_revision',
  'apply_revision_request_timeline','mark_project_revision_requested','apply_project_timeline',
  'create_timeline_deadline_notifications','create_project_notifications','notify_revision_watchers',
  'set_revision_completed_at','notify_revised_proof_uploaded','log_project_status_change','auto_link_client_project_access',
];
for (const name of legacy) assert.ok(compact.includes(`'${name}'`), `${name} legacy revoke inventory`);
for (const trigger of [
  'apply_project_timeline_trigger','project_notifications_trigger','log_project_status_change',
  'auto_link_client_project_access_trigger','mark_project_revision_requested_trigger',
  'revision_request_notifications_trigger','set_revision_completed_at_trigger','revised_proof_uploaded_trigger',
]) assert.match(compact, new RegExp(`drop trigger if exists ${trigger}`));

const securityTest = read('supabase/tests/database/phase6_security.test.sql');
assert.match(securityTest, /^begin;/m);
assert.match(securityTest, /rollback;\s*$/);
assert.doesNotMatch(securityTest, /insert into (?:auth\.users|public\.profiles)/i);
assert.match(securityTest, /project timestamp trigger preserves owner timestamp and stamps ordinary writers/i);
assert.match(securityTest, /owner has exact digest\(text,text\) execute/i);
assert.match(securityTest, /runtime role-matrix and client_profile_id guard tests require disposable synthetic Auth fixtures/i);

console.log(JSON.stringify({
  staticChecks: 'passed (source assertions, NOT PostgreSQL execution)',
  phase6Migrations: migrationFiles.length,
  canonicalRpcOwners: canonical.length,
  ownerInternalExecuteGrants: ownerInternalGrants.length,
  clientProjectFields: (projectProjection.match(/^\s{2}[a-z_]+(?: public\.[a-z_]+| [a-z_]+)(?:,|\n)/gm) ?? []).length,
  frontendAttestation: 'historical 128-file digest preserved; current semantics asserted separately',
}, null, 2));
