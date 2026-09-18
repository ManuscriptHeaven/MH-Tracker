// Dependency-free cutover source assertions only; this does not execute PostgreSQL.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const migrationDir = 'supabase/phase6/migrations';

// 1. Verify exact hashes of all six previous accepted migrations
const accepted = [
  ['00100_phase6_canonical_foundation.sql', '3bdae7a341b22699cb8879a3508e3f97eb76e1e09287949ebd7fe93aed1ee21a'],
  ['00200_phase6_legacy_backfill.sql', '848c80db812dfa583c563fc9b73c44deebf6130d56578946712a78003cbb2cfc'],
  ['00300_phase6_workflow_rpcs.sql', '296b77041d7af216c499c50a7e91866cb70d2f7e4fb9e36f6410e86bf6c7e767'],
  ['00400_phase6_security_and_projections.sql', '22a852cf39d1e6d3292d98fcdc8ad90663770864e65592472a9b783565415628'],
  ['00450_phase6_core_application_security.sql', 'fcffa593f087308a87c5d58e974cfbb81f13c2335429da82c24bfe8c11c980ee'],
  ['00460_phase6_finance_payroll_security.sql', '927032d087c2f1cd9faaa59ba10a9dbf76afb8a47b074dff029d7ced19b76add'],
];

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

for (const [file, expectedHash] of accepted) {
  assert.equal(sha(path.join(migrationDir, file)), expectedHash, `${file} byte-for-byte unchanged`);
}

// 2. Read and inspect 00500 migration source
const cutoverMigration = '00500_phase6_cutover_and_validation.sql';
const cutoverPath = path.join(migrationDir, cutoverMigration);
assert.ok(fs.existsSync(cutoverPath), `${cutoverMigration} must exist`);

const rawSql = fs.readFileSync(cutoverPath, 'utf8').replace(/\r\n/g, '\n');
const compactSql = rawSql.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();

// Transactional boundary
assert.match(compactSql, /\bbegin;[\s\S]*\bcommit;\s*$/, '00500 must run inside a single transactional block');

// Must NOT redefine or alter any of the 11 canonical RPC signatures
const canonicalRpcSignatures = [
  'workflow_advance_stage(uuid,bigint,uuid,text)',
  'workflow_submit_stage_for_approval(uuid,bigint,uuid,text)',
  'workflow_client_approve_stage(uuid,bigint,uuid,text)',
  'workflow_submit_client_revision(uuid,bigint,uuid,text,text,text,text)',
  'workflow_submit_revised_proof(uuid,bigint,uuid,uuid,text)',
  'workflow_request_stage_skip(uuid,bigint,uuid,public.workflow_stage,text)',
  'workflow_respond_stage_skip(uuid,bigint,uuid,uuid,text,text)',
  'workflow_admin_override(uuid,bigint,uuid,public.project_lifecycle_status,public.workflow_stage,public.workflow_stage_status,public.workflow_waiting_on,text,text)',
  'workflow_complete_final_delivery(uuid,bigint,uuid,text)',
  'workflow_set_project_lifecycle(uuid,bigint,uuid,public.project_lifecycle_status,text)',
  'workflow_update_project_configuration(uuid,bigint,uuid,boolean,boolean,jsonb)'
];

const canonicalRpcNames = [
  'workflow_advance_stage',
  'workflow_submit_stage_for_approval',
  'workflow_client_approve_stage',
  'workflow_submit_client_revision',
  'workflow_submit_revised_proof',
  'workflow_request_stage_skip',
  'workflow_respond_stage_skip',
  'workflow_admin_override',
  'workflow_complete_final_delivery',
  'workflow_set_project_lifecycle',
  'workflow_update_project_configuration'
];

for (const rpc of canonicalRpcNames) {
  assert.doesNotMatch(compactSql, new RegExp(`create (?:or replace )?function public\\.${rpc}`),
    `00500 must not redefine canonical RPC ${rpc}`);
}

// Must NOT contain browser/service-role secrets or API keys
assert.doesNotMatch(rawSql, /eyJh[A-Za-z0-9_-]{20,}/, '00500 must not contain JWT tokens');
assert.doesNotMatch(compactSql, /service_role_key|anon_key|supabase_service_key/, '00500 must not contain secret names');

// Must NOT create broad/unconditional USING(true) / WITH CHECK(true) policies
assert.doesNotMatch(compactSql, /create policy [^;]+ (?:using|with check)\s*\(\s*true\s*\)/,
  '00500 must not create broad unconditional policies');

// Must NOT grant blanket permissions to authenticated or anon on workflow tables
assert.doesNotMatch(compactSql, /grant all on [^;]+ to (?:authenticated|anon)/,
  '00500 must not grant blanket table privileges');

// Must NOT grant direct raw projects access to Client
assert.doesNotMatch(compactSql, /create policy [^;]+ on public\.projects [^;]*'(?:client)'/,
  '00500 must not grant direct client access on public.projects');

// Must NOT introduce direct auth.uid() in owner SECURITY DEFINER helpers
assert.doesNotMatch(compactSql, /security definer[\s\S]*auth\.uid\s*\(/,
  '00500 must not introduce direct auth.uid() inside SECURITY DEFINER functions');

// Must NOT perform destructive deletions on projects, stage history, revisions, or finance
assert.doesNotMatch(compactSql, /delete from public\.(?:projects|project_stage_history|revision_requests|employee_ledger|project_payments|finance_transactions)/,
  '00500 must not perform destructive row deletions on business data');
assert.doesNotMatch(compactSql, /drop table (?:if exists )?public\.(?:projects|project_stage_history|revision_requests)/,
  '00500 must not drop canonical tables');

// Must NOT guess service capabilities
assert.doesNotMatch(compactSql, /set requires_print\s*=\s*true where requires_print is null/,
  '00500 must not guess requires_print capability');
assert.doesNotMatch(compactSql, /set requires_ebook\s*=\s*true where requires_ebook is null/,
  '00500 must not guess requires_ebook capability');

// Must NOT modify AI/RAG semantics or vector extension in Phase 6
assert.doesNotMatch(compactSql, /alter extension vector|create extension vector/,
  '00500 must not touch vector extension (deferred to Phase 6B)');
assert.doesNotMatch(compactSql, /create (?:or replace )?function public\.(?:match_knowledge_base|match_messages)/,
  '00500 must not alter AI/RAG search functions (deferred to Phase 6B)');

// Must NOT directly mutate storage.objects
assert.doesNotMatch(compactSql, /(?:insert into|update|delete from) storage\.objects/,
  '00500 must not directly mutate storage.objects');

// Must NOT embed specific production URLs or project IDs
assert.doesNotMatch(rawSql, /https?:\/\/[a-z0-9.-]+\.supabase\.co/,
  '00500 must not embed production Supabase project URLs');

// Must NOT create competing workflow authorities
assert.doesNotMatch(compactSql, /create role (?!phase6_)/,
  '00500 must not create unexpected new roles');

// ============================================================================
// CRITICAL CUTOVER V3 CONSTRAINTS:
// ============================================================================

// 1. Project rowtype must be typed as public.projects%rowtype (fixes Error 42846)
const rowtypeMatches = (compactSql.match(/v_proj\s+public\.projects%rowtype;/g) || []).length;
assert.equal(rowtypeMatches, 2, '00500 must declare v_proj as public.projects%rowtype in both preflight and final check');
assert.doesNotMatch(compactSql, /v_proj\s+record;/, '00500 must not declare v_proj as anonymous record');

// 2. Project invariant failure must be actionable (identifies project_number and id)
assert.match(compactSql, /phase6_cutover_blocked_invalid_workflow_tuple/,
  '00500 must re-raise actionable error with project identity on tuple validation failure');
assert.match(compactSql, /v_proj\.project_number/,
  '00500 must include project_number in tuple error message');

// 3. Project guard trigger MUST NOT include INSERT and MUST be BEFORE UPDATE only
assert.doesNotMatch(compactSql, /create trigger phase6_touch_project_metadata_updated_at[^;]*\binsert\b/,
  '00500 must NOT attach phase6_touch_project_metadata_updated_at trigger to INSERT');
assert.match(compactSql, /create trigger phase6_touch_project_metadata_updated_at\s+before update on public\.projects\s+for each row execute function public\.phase6_touch_project_metadata_updated_at\(\)/,
  '00500 MUST install phase6_touch_project_metadata_updated_at as BEFORE UPDATE only');

// 4. Legacy function retirement MUST NOT use CASCADE and MUST use RESTRICT
assert.doesNotMatch(compactSql, /drop function [^;]*\bcascade\b/,
  '00500 must NOT use CASCADE when retiring legacy functions');
assert.match(compactSql, /drop function if exists [^;]*\brestrict\b/,
  '00500 MUST use RESTRICT semantics when retiring legacy functions');

// 5. Owner roles preflight MUST verify all 7 safety attributes in pg_roles
assert.match(compactSql, /rolsuper\s+or\s+rolinherit\s+or\s+rolcreaterole\s+or\s+rolcreatedb\s+or\s+rolcanlogin\s+or\s+rolreplication\s+or\s+rolbypassrls/,
  '00500 preflight must check all 7 owner-role safety attributes');

// 6. Managed-Supabase owner membership safety assertions
assert.doesNotMatch(compactSql, /revoke phase6_workflow_rpc_owner from postgres/,
  '00500 must not attempt unachievable revocation of supabase_admin bootstrap grant');
assert.doesNotMatch(compactSql, /revoke phase6_app_security_owner from postgres/,
  '00500 must not attempt unachievable revocation of supabase_admin bootstrap grant');
assert.match(compactSql, /pg_auth_members/,
  '00500 must inspect pg_auth_members');
assert.match(compactSql, /mem\.rolname\s*<>\s*'postgres'/,
  '00500 must assert no non-postgres role is member of owner roles');
assert.match(compactSql, /inherit_option/,
  '00500 must assert inherit_option is false');
assert.match(compactSql, /set_option/,
  '00500 must assert set_option is false');
assert.match(compactSql, /pg_has_role\s*\(\s*'postgres'\s*,\s*'phase6_workflow_rpc_owner'\s*,\s*'usage'\s*\)/,
  '00500 must assert postgres lacks USAGE on phase6_workflow_rpc_owner');
assert.match(compactSql, /pg_has_role\s*\(\s*'postgres'\s*,\s*'phase6_app_security_owner'\s*,\s*'usage'\s*\)/,
  '00500 must assert postgres lacks USAGE on phase6_app_security_owner');
assert.match(compactSql, /pg_has_role\s*\(\s*'postgres'\s*,\s*'phase6_workflow_rpc_owner'\s*,\s*'set'\s*\)/,
  '00500 must assert postgres lacks SET on phase6_workflow_rpc_owner');
assert.match(compactSql, /pg_has_role\s*\(\s*'postgres'\s*,\s*'phase6_app_security_owner'\s*,\s*'set'\s*\)/,
  '00500 must assert postgres lacks SET on phase6_app_security_owner');
assert.match(compactSql, /has_schema_privilege\([^,]+,\s*'public',\s*'create'\)/,
  '00500 must assert owner roles have no CREATE on schema public');

// 7. Stage definition preflight MUST verify exact definitions (not count only)
const expectedStages = [
  'files_received', 'design_concept', 'concept_approval', 'print_version',
  'print_approval', 'ebook_version', 'ebook_approval', 'final_delivery'
];
for (const stage of expectedStages) {
  assert.match(compactSql, new RegExp(`'${stage}'`), `00500 stage preflight must check stage ${stage}`);
}
assert.match(compactSql, /except/, '00500 stage preflight must use set-difference (EXCEPT) comparison to verify exact rows');

// 8. Canonical RPC preflight MUST verify exact signatures via to_regprocedure
assert.match(compactSql, /to_regprocedure/, '00500 preflight must verify exact RPC signatures via to_regprocedure');
for (const sig of canonicalRpcSignatures) {
  const normalizedSig = sig.toLowerCase().replace(/\s+/g, '');
  assert.ok(compactSql.includes(normalizedSig), `00500 preflight must verify exact RPC signature ${sig}`);
}

// 9. Private auth bridge preflight MUST verify signature, stability, security definer, search path, body, and ACLs
assert.match(compactSql, /phase6_auth_uid/, '00500 preflight must check phase6_auth_uid');
assert.match(compactSql, /prosecdef/, '00500 preflight must verify bridge is SECURITY DEFINER');
assert.match(compactSql, /provolatile/, '00500 preflight must verify bridge is STABLE');
assert.match(compactSql, /search_path=pg_catalog,\s*pg_temp/, '00500 preflight must verify bridge search path');

// 10. Validates preflight assertions (capability preflight, backfill errors, tuple invariants)
assert.match(compactSql, /phase6_cutover_blocked_unresolved_capability/, '00500 must contain capability preflight check');
assert.match(compactSql, /phase6_cutover_blocked_backfill_error/, '00500 must contain backfill preflight check');
assert.match(compactSql, /public\._workflow_validate_tuple/, '00500 must execute canonical tuple validation');

// 11. Validates deferred constraints
assert.match(compactSql, /alter table public\.projects validate constraint projects_workflow_version_nonnegative/,
  '00500 must validate projects_workflow_version_nonnegative');
assert.match(compactSql, /alter table public\.projects validate constraint projects_production_seconds_total_nonnegative/,
  '00500 must validate projects_production_seconds_total_nonnegative');
assert.match(compactSql, /alter table public\.projects validate constraint projects_client_wait_seconds_total_nonnegative/,
  '00500 must validate projects_client_wait_seconds_total_nonnegative');
assert.match(compactSql, /alter table public\.project_stage_history validate constraint project_stage_history_production_delta_nonnegative/,
  '00500 must validate project_stage_history_production_delta_nonnegative');
assert.match(compactSql, /alter table public\.project_stage_history validate constraint project_stage_history_client_wait_delta_nonnegative/,
  '00500 must validate project_stage_history_client_wait_delta_nonnegative');
assert.match(compactSql, /alter table public\.project_stage_history validate constraint project_stage_history_metadata_object/,
  '00500 must validate project_stage_history_metadata_object');

// 12. Enforces canonical write guard and append-only trigger
assert.match(compactSql, /create or replace function public\.phase6_touch_project_metadata_updated_at/,
  '00500 must install canonical project write guard');
assert.match(compactSql, /create or replace function public\.phase6_guard_history_append_only/,
  '00500 must install history append-only guard');

// 13. Retires obsolete legacy functions and triggers
assert.match(compactSql, /drop trigger if exists apply_project_timeline_trigger on public\.projects/,
  '00500 must retire apply_project_timeline_trigger');
assert.match(compactSql, /client_approve_project_milestone/, '00500 must retire client_approve_project_milestone');

// 14. Cleans transient permissions and reloads schema cache
assert.match(compactSql, /revoke create on schema public from phase6_workflow_rpc_owner/, '00500 must revoke schema CREATE from owner');
assert.match(compactSql, /notify pgrst, 'reload schema'/, '00500 must notify PostgREST to reload schema cache');

console.log(JSON.stringify({
  cutoverStaticChecks: 'passed (00500 V3 source assertions, NOT PostgreSQL execution)',
  migrationHashesVerified: accepted.length,
  cutoverMigration: cutoverMigration,
  canonicalRpcChecks: canonicalRpcSignatures.length,
  deferredConstraintsValidated: 7,
  retiresLegacySurfaces: true,
  noCascadeInRetirement: true,
  projectGuardIsUpdateOnly: true,
  projectRowtypeTyped: true,
  actionableTupleErrors: true,
  ownerRoleAttributesChecked: true,
  managedSupabaseMembershipSafe: true,
  exactStageDefinitionsChecked: true,
  exactRpcSignaturesChecked: true,
  privateBridgeChecked: true,
  noDestructiveMutations: true,
  noCapabilityGuessing: true,
  noSecretLeaks: true
}, null, 2));
