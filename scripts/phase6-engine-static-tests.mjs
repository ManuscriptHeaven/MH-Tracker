// Dependency-free source checks ONLY. This does not parse/execute PostgreSQL.
// Run: node scripts/phase6-engine-static-tests.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const base = 'supabase/phase6/migrations/';
const names = readdirSync(path.join(root, base)).filter((n) => /^00(?:100|200|300|400|450|460)_phase6_.*\.sql$/.test(n)).sort();
assert.deepEqual(names, [
  '00100_phase6_canonical_foundation.sql',
  '00200_phase6_legacy_backfill.sql',
  '00300_phase6_workflow_rpcs.sql',
  '00400_phase6_security_and_projections.sql',
  '00450_phase6_core_application_security.sql',
  '00460_phase6_finance_payroll_security.sql',
]);
const foundation = read(base + names[0]);
const backfill = read(base + names[1]);
const engine = read(base + names[2]);
assert.match(foundation, /alter table public\.project_stage_history\s+alter column stage drop not null;/);
assert.match(foundation, /create table if not exists public\.projects[\s\S]*?\bdue_date date,/,
  'clean projects definition keeps legacy due_date nullable');
assert.match(foundation, /alter table public\.projects alter column due_date drop not null;/,
  'existing projects explicitly drop the legacy due_date NOT NULL constraint');
assert.match(backfill, /\)\nselect\n  p\.id,\n  p\.current_stage,\n  p\.stage_status,/);
const seed = foundation.match(/insert into public\.workflow_stage_definitions[\s\S]*?\nvalues\n([\s\S]*?)\non conflict/)[1];
assert.equal((seed.match(/^\s*\('/gm) ?? []).length, 8);

const functions = [...engine.matchAll(/create function (public\.\w+)\(([\s\S]*?)\)\s*returns([\s\S]*?)as \$fn\$([\s\S]*?)\$fn\$;/g)];
assert.equal(functions.length, 66);
assert.equal(new Set(functions.map((m) => m[1])).size, functions.length);
assert.equal((engine.match(/^create table /gm) ?? []).length, 1);
assert.equal((engine.match(/^create type /gm) ?? []).length, 1);
const publicMutations = [
  'workflow_advance_stage', 'workflow_submit_stage_for_approval', 'workflow_client_approve_stage',
  'workflow_submit_client_revision', 'workflow_submit_revised_proof', 'workflow_request_stage_skip',
  'workflow_respond_stage_skip', 'workflow_admin_override', 'workflow_complete_final_delivery',
  'workflow_set_project_lifecycle', 'workflow_update_project_configuration',
];
assert.deepEqual(functions.filter(m => m[3].includes('security definer')).map(m => m[1].slice(7)).sort(),
  [...publicMutations, 'phase6_auth_uid'].sort());
assert.deepEqual(functions.filter(m => !m[1].startsWith('public._')).map(m => m[1].slice(7)).sort(),
  [...publicMutations, 'phase6_auth_uid', 'workflow_add_production_days', 'workflow_production_seconds_between', 'workflow_production_days_between'].sort());

const bodyFor = (name) => {
  const match = functions.find((m) => m[1] === `public.${name}`);
  assert.ok(match, `Missing ${name}`);
  return match[4];
};
const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');
const code = stripComments(engine);
let outsideFunctions = engine;
for (const fn of functions) outsideFunctions = outsideFunctions.replace(fn[0], '');
assert.doesNotMatch(stripComments(outsideFunctions), /\b(?:insert\s+into|update\s+public\.|delete\s+from)\b/i,
  'Workflow writes must remain inside reviewed mutation functions/helpers');
// Lexical balance catches edit damage, but is not a substitute for a SQL parser.
const tokens = code.replace(/'(?:''|[^'])*'/g, "''");
let nesting = 0;
for (const ch of tokens) {
  if (ch === '(') nesting++;
  if (ch === ')') nesting--;
  assert.ok(nesting >= 0, 'Unexpected closing parenthesis');
}
assert.equal(nesting, 0, 'Unclosed SQL parenthesis');
assert.equal((code.match(/\$fn\$/g) ?? []).length, functions.length * 2);
assert.doesNotMatch(code, /\b(?:create|drop|alter)\s+(?:or\s+replace\s+)?(?:trigger|policy|role)\b/i);
assert.doesNotMatch(code, /\bbypassrls\b|auth\.jwt\s*\(/i);
assert.doesNotMatch(code, /\bdelete\s+from\b/i);
assert.doesNotMatch(code, /\b(?:drop|alter)\s+(?:table|type)\s+public\.(?!workflow_idempotency_receipts\b)/i);
assert.match(code, /\bbegin;[\s\S]*\bcommit;\s*$/);
assert.match(code, /alter table public\.workflow_idempotency_receipts enable row level security;/);
assert.match(code, /revoke all on table public\.workflow_idempotency_receipts from public, anon, authenticated;/);
assert.match(code, /unique \(rpc_name, project_id, actor_id, idempotency_key\)/);
assert.equal((code.match(/references public\.(?:projects|profiles)\(id\) on delete restrict/g) ?? []).length, 2);

for (const fn of functions) {
  const isRPC = publicMutations.includes(fn[1].slice(7));
  const isDefiner = isRPC || fn[1] === 'public.phase6_auth_uid';
  assert.match(fn[3], new RegExp(`security ${isDefiner ? 'definer' : 'invoker'}\\s+set search_path = pg_catalog, pg_temp`));
  const types = fn[2].trim() ? fn[2].trim().split(',').map((arg) =>
    arg.trim().replace(/^p_\w+\s+/, '').replace(/\s+default[\s\S]*/i, '')).join(',') : '';
  assert.ok(code.includes(`revoke all on function ${fn[1]}(${types}) from public, anon, authenticated;`), `Missing revoke ${fn[1]}`);
  if (/language plpgsql/.test(fn[3])) assert.match(fn[4], /end;\s*$/);
  const allowedWrites = {
    _workflow_append_history: ['project_stage_history'], _workflow_receipt_store: ['workflow_idempotency_receipts'],
    _workflow_write_project: ['projects'], _workflow_notify: ['notifications'],
    workflow_client_approve_stage: ['projects', 'revision_requests'], workflow_submit_client_revision: ['projects','revision_requests'],
    workflow_submit_revised_proof: ['projects','revision_requests'], workflow_request_stage_skip: ['projects','project_stage_skips'],
    workflow_respond_stage_skip: ['projects','project_stage_skips'], workflow_admin_override: ['projects','admin_workflow_overrides'],
  };
  const writes = [...stripComments(fn[4]).matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+public\.(\w+)/gi)].map(m => m[1]);
  const allowed = allowedWrites[fn[1].slice(7)] ?? (isRPC ? ['projects'] : []);
  for (const table of writes) assert.ok(allowed.includes(table), `Unexpected write to ${table} in ${fn[1]}`);
  assert.doesNotMatch(stripComments(fn[4]), /\b(?:insert\s+into|update|delete\s+from)\s+(?!public\.)[a-z_]\w*\s+(?:set|values|select|\()/i);
  if (isRPC) {
    assert.match(fn[3], /^\s*public\.workflow_mutation_result\b/);
    assert.match(fn[2], /p_project_id uuid/); assert.match(fn[2], /p_expected_workflow_version bigint/);
    assert.match(fn[2], /p_idempotency_key uuid/);
    assert.doesNotMatch(fn[2], /p_(?:actor|user|client|role|requester|uploader)(?:_id|\s)/i);
    assert.ok(code.includes(`grant execute on function ${fn[1]}(${types}) to authenticated;`));
    const body = stripComments(fn[4]);
    const order = ['_workflow_current_actor(', '_workflow_lock_project(', '_workflow_request_fingerprint(',
      '_workflow_receipt_lookup(', '_workflow_check_version(', '_workflow_lock_mutation_rows(', 'clock_timestamp()',
      '_workflow_write_project(', '_workflow_assert_project_projection(', '_workflow_emit_events(', '_workflow_notify(',
      'v_after.workflow_version := v_before.workflow_version + 1', '_workflow_make_result(', '_workflow_receipt_store('];
    let prior = -1;
    for (const token of order) { const pos = body.indexOf(token); assert.ok(pos > prior, `${fn[1]} order: ${token}`); prior = pos; }
    assert.match(body, /if v_result\.project_id is not null then return v_result; end if;/);
    assert.equal((body.match(/clock_timestamp\(\)/g) ?? []).length,1);
    assert.doesNotMatch(body, /\bnow\(\)|current_timestamp/i);
    assert.equal((body.match(/workflow_version\s*:=.*\+\s*1/g) ?? []).length,1);
    assert.equal((body.match(/set workflow_version\s*=/g) ?? []).length,1);
    assert.match(body, /_workflow_assert_milestones\(v_after\)/);
    assert.match(body, /to_jsonb\(p\)[\s\S]*is distinct from to_jsonb\(v_before\)/);
    assert.match(body, /v_history_before \+ cardinality\(v_history\)/);
    assert.doesNotMatch(body, /v_notifications_before|count\(\*\)[\s\S]*public\.notifications[\s\S]*cardinality\(v_notifications\)/);
    const fingerprintArgs = body.slice(body.indexOf('_workflow_request_fingerprint('), body.indexOf('_workflow_receipt_lookup('));
    for (const arg of fn[2].split(',').map(x=>x.trim().split(/\s+/)[0]).filter(x=>x!=='p_idempotency_key'))
      assert.ok(fingerprintArgs.includes(arg), `Fingerprint omits ${arg} in ${fn[1]}`);
  }
}
assert.doesNotMatch(bodyFor('_workflow_receipt_lookup'), /_workflow_check_version|p_expected/);
assert.match(bodyFor('phase6_auth_uid'), /select auth\.uid\(\)/);
assert.match(engine, /create function public\.phase6_auth_uid\(\)\s*returns uuid language sql stable security definer\s*set search_path = pg_catalog, pg_temp/i);
assert.match(engine, /revoke all on function public\.phase6_auth_uid\(\) from public, anon, authenticated;/);
assert.match(bodyFor('_workflow_current_actor'), /v_actor_id uuid := public\.phase6_auth_uid\(\)/);
assert.match(bodyFor('_workflow_current_actor'), /p\.id = v_actor_id and p\.status = 'active'/);
assert.doesNotMatch(bodyFor('_workflow_current_actor'), /auth\.uid\(\)/);
assert.match(bodyFor('_workflow_can_team_work'), /p\.assigned_to = a\.actor_id/);
assert.doesNotMatch(bodyFor('_workflow_can_client_access'), /email|full_name|client_name/i);
assert.match(bodyFor('_workflow_can_client_access'), /p\.client_profile_id = a\.actor_id/);
assert.match(bodyFor('_workflow_can_client_access'), /c\.project_id = p\.id and c\.client_id = a\.actor_id/);
assert.doesNotMatch(bodyFor('_workflow_project_snapshot'), /p_project\.\*|to_jsonb\(p_project\)|internal_notes|qa_notes|client_email|capabilities_resolved_by|production_seconds_total|client_wait_seconds_total|workflow_settings/);
const safeSnapshotFields = [...bodyFor('_workflow_project_snapshot').matchAll(/'([a-z_]+)',\s*p_project\.[a-z_]+/g)].map((m) => m[1]);
assert.deepEqual(safeSnapshotFields.sort(), [
  'id', 'project_status', 'workflow_stage_key', 'workflow_stage_status_key', 'workflow_waiting_on_key',
  'workflow_version', 'requires_print', 'requires_ebook', 'service_capability_status', 'stage_started_at',
  'stage_due_at', 'stage_completed_at', 'final_due_at', 'revision_count', 'delivered_at',
  'status', 'current_stage', 'stage_status', 'waiting_on', 'timeline_status',
].sort());
const fingerprint = bodyFor('_workflow_request_fingerprint');
assert.match(foundation, /create extension if not exists pgcrypto;/i);
assert.match(fingerprint, /from pg_catalog\.pg_extension e/);
assert.match(fingerprint, /join pg_catalog\.pg_namespace n on n\.oid = e\.extnamespace where e\.extname = 'pgcrypto'/);
assert.match(fingerprint, /v_canonical_text := jsonb_build_object\('contract', 'phase6-v1', 'rpc', p_rpc_name,\s*'project_id', p_project_id, 'parameters', p_parameters\)::text/);
assert.match(fingerprint, /pg_catalog\.encode\(%I\.digest\(\$1::text, ''sha256''::text\), ''hex''::text\)/);
assert.match(fingerprint, /into v_fingerprint using v_canonical_text/);
assert.match(fingerprint, /return v_fingerprint;/);
assert.doesNotMatch(fingerprint, /return\s+(?:v_canonical_text|jsonb_build_object)/);
assert.match(bodyFor('_workflow_receipt_store'), /p_result\.project_snapshot is distinct from public\._workflow_project_snapshot\(v_project\)/);
assert.doesNotMatch(bodyFor('_workflow_receipt_store'), /p_parameters|v_canonical_text|production_seconds_total|client_wait_seconds_total|workflow_settings/);
assert.match(bodyFor('_workflow_assert_project_projection'), /v_actual\.production_seconds_total is distinct from p_expected\.production_seconds_total/);
assert.match(bodyFor('_workflow_assert_project_projection'), /v_actual\.client_wait_seconds_total is distinct from p_expected\.client_wait_seconds_total/);
assert.match(bodyFor('_workflow_append_history'), /p_actor_id is distinct from v_actor\.actor_id/);
assert.match(bodyFor('_workflow_append_history'), /coalesce\(max\(h\.sequence_no\), 0\) \+ 1/);
assert.match(bodyFor('_workflow_accounting_totals'), /h\.sequence_no > v_baseline\.snapshot_sequence/);
assert.match(bodyFor('_workflow_accounting_baseline'), /metadata -> 'canonical_snapshot'/);
assert.match(bodyFor('_workflow_effective_clock_start'), /greatest\(p_stage_started_at, v_baseline\.snapshot_at\)/);
assert.match(bodyFor('_workflow_assert_project_projection'), /legacy_workflow_trigger_conflict/);
assert.match(bodyFor('workflow_production_seconds_between'), /floor\(v_total\)::bigint/);
assert.match(bodyFor('workflow_production_days_between'), /86400::numeric/);
assert.match(bodyFor('_workflow_lock_mutation_rows'), /revision_requests[\s\S]*order by r\.id for update;[\s\S]*project_stage_skips[\s\S]*order by s\.id for update;/);
assert.match(bodyFor('_workflow_operational_leaf'), /not exists \(select 1 from public\.revision_requests c where c\.parent_revision_request_id = r\.id\)/);
assert.match(bodyFor('_workflow_checked_manual_skips'), /having count\(\*\) > 1/);
assert.match(bodyFor('_workflow_route_events'), /h\.stage_skip_id = v_skip_id[\s\S]*h\.to_stage = p_stages\[v_i\]/);
assert.match(bodyFor('_workflow_emit_events'), /case when cardinality\(v_ids\)\+1=p_primary_event_index then p_production_delta else 0 end/);
assert.match(bodyFor('_workflow_emit_events'), /case when cardinality\(v_ids\)\+1=p_primary_event_index then p_client_delta else 0 end/);
assert.match(bodyFor('_workflow_emit_events'), /p_primary_event_index > jsonb_array_length\(p_events\)/);
assert.match(bodyFor('workflow_advance_stage'), /_workflow_next_stage/);
assert.doesNotMatch(stripComments(bodyFor('_workflow_write_project')), /returning/i);
assert.doesNotMatch(bodyFor('_workflow_notify'), /email|p_reason|p_explanation/);
assert.match(bodyFor('_workflow_notify'), /select distinct a\.id/);
assert.match(bodyFor('_workflow_notify'), /v_id is null or v_id = any\(v_ids\)/);
assert.match(bodyFor('_workflow_notify'), /n\.id = v_id and n\.project_id = p_project\.id[\s\S]*n\.recipient_id = v_recipient[\s\S]*n\.type = p_type/);
assert.match(bodyFor('_workflow_notify'), /n\.revision_request_id is not distinct from p_revision_id/);
assert.match(bodyFor('_workflow_notify'), /n\.created_at = p_mutation_at and n\.title = v_title[\s\S]*n\.message = v_message/);
assert.match(bodyFor('_workflow_notify'), /array_position\(v_ids,null\) is not null/);
assert.match(bodyFor('_workflow_notify'), /count\(distinct x\) from unnest\(v_ids\)/);
assert.doesNotMatch(code, /v_notifications_before/);
assert.match(bodyFor('workflow_respond_stage_skip'), /when_routing_reaches_target/);
assert.match(bodyFor('workflow_respond_stage_skip'), /v_target_order=v_order then[\s\S]*_workflow_interval_delta/);
const futureSkipBranch = bodyFor('workflow_respond_stage_skip').match(/elsif v_target_order>v_order then([\s\S]*?)end if;/)?.[1] ?? '';
assert.match(futureSkipBranch, /v_after\.final_due_at := public\._workflow_estimate_remaining_production/);
assert.match(futureSkipBranch, /workflow_stage_status_key = 'revision_active'[\s\S]*v_after\.stage_due_at/);
assert.doesNotMatch(futureSkipBranch, /_workflow_interval_delta|stage_started_at\s*:=|stage_due_at\s*:=|workflow_stage_key\s*:=|workflow_stage_status_key\s*:=|workflow_waiting_on_key\s*:=/);
assert.equal((bodyFor('workflow_respond_stage_skip').match(/v_after\.final_due_at :=/g) ?? []).length,2,
  'skip response changes final due only for current/future approval branches');
assert.doesNotMatch(bodyFor('workflow_request_stage_skip'), /_workflow_interval_delta|stage_started_at\s*:=/);
const finalDueEstimator = bodyFor('_workflow_estimate_final_due');
assert.match(finalDueEstimator, /v_count <> 1 or v_project\.stage_due_at is null then return null/);
assert.match(finalDueEstimator, /then v_project\.stage_due_at else null end/);
assert.doesNotMatch(finalDueEstimator, /max\(r\.due_at\)|v_revision_due|coalesce\([^)]*r\.due_at/);
assert.match(bodyFor('workflow_update_project_configuration'), /_workflow_capability_resume_route/);
assert.match(bodyFor('workflow_update_project_configuration'), /v_before\.workflow_settings\) d;[\s\S]*v_after\.workflow_settings := v_settings/);
assert.match(bodyFor('workflow_set_project_lifecycle'), /remaining_production_seconds[\s\S]*_workflow_add_production_seconds/);
assert.match(bodyFor('workflow_set_project_lifecycle'), /workflow_stage_status_key='revision_active'[\s\S]*workflow_stage_key='concept_approval'[\s\S]*concept_revision_due_date := \(v_after\.stage_due_at at time zone 'Asia\/Karachi'\)::date/);
assert.match(bodyFor('workflow_set_project_lifecycle'), /workflow_stage_key='print_approval'[\s\S]*print_revision_due_date := \(v_after\.stage_due_at at time zone 'Asia\/Karachi'\)::date/);
assert.doesNotMatch(bodyFor('workflow_set_project_lifecycle'), /update public\.revision_requests[\s\S]*due_at\s*=/);
for (const test of ['phase6_business_days.test.sql', 'phase6_engine.test.sql', 'phase6_workflow_rpcs.test.sql',
  'phase6_finance_security.test.sql']) {
  const sql = read('supabase/tests/database/' + test);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /rollback;\s*$/);
  assert.doesNotMatch(sql, /insert into (?:auth\.users|public\.profiles)|session_replication_role/i);
}
console.log(JSON.stringify({
  staticChecks: 'passed (source assertions, NOT PostgreSQL execution)',
  migrations: names.length, stageSeeds: 8, newTables: 1, newTypes: 1,
  helperFunctions: functions.length - publicMutations.length, newInternalHelpers: 12, publicMutationRPCs: 11, sqlTestFiles: 4,
  genericSnapshotFields: safeSnapshotFields.length, fingerprint: 'SHA-256 hex via catalog-resolved pgcrypto',
}, null, 2));
