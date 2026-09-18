// Dependency-free source assertions only; this does not execute PostgreSQL.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const migrationDir = 'supabase/phase6/migrations';
const expected = [
  '00100_phase6_canonical_foundation.sql',
  '00200_phase6_legacy_backfill.sql',
  '00300_phase6_workflow_rpcs.sql',
  '00400_phase6_security_and_projections.sql',
  '00450_phase6_core_application_security.sql',
  '00460_phase6_finance_payroll_security.sql',
];
const cutoverPresent = fs.existsSync(`${migrationDir}/00500_phase6_cutover_and_validation.sql`);
const migrations = fs.readdirSync(migrationDir).filter((f) => /^00(?:100|200|300|400|450|460)_phase6_.*\.sql$/.test(f)).sort();
assert.deepEqual(migrations, expected);

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const accepted = [
   '3bdae7a341b22699cb8879a3508e3f97eb76e1e09287949ebd7fe93aed1ee21a',
  '848c80db812dfa583c563fc9b73c44deebf6130d56578946712a78003cbb2cfc',
  '296b77041d7af216c499c50a7e91866cb70d2f7e4fb9e36f6410e86bf6c7e767',
  '22a852cf39d1e6d3292d98fcdc8ad90663770864e65592472a9b783565415628',
  'fcffa593f087308a87c5d58e974cfbb81f13c2335429da82c24bfe8c11c980ee',
  '927032d087c2f1cd9faaa59ba10a9dbf76afb8a47b074dff029d7ced19b76add',
];
for (let i=0;i<accepted.length;i++) assert.equal(sha(`${migrationDir}/${expected[i]}`),accepted[i],`${expected[i]} unchanged`);

const phase6Readme=fs.readFileSync('supabase/phase6/README.md','utf8');
assert.match(phase6Readme,/historical frontend snapshot of 128 files/i);
assert.match(phase6Readme,/f7299751ed2a80e9cfa82d5d46dea521637879f0394ede7514906e6add97bf99/);

const sql=fs.readFileSync(`${migrationDir}/${expected[4]}`,'utf8').replace(/\r\n/g,'\n');
const compact=sql.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
assert.match(compact,/\bbegin;[\s\S]*\bcommit;\s*$/);
assert.match(compact,/create role phase6_app_security_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls/);
assert.match(compact,/alter role phase6_app_security_owner nologin noinherit nocreatedb nocreaterole noreplication/);
assert.doesNotMatch(compact,/alter role phase6_app_security_owner[^;]*(?:nosuperuser|nobypassrls)/);
assert.match(compact,/from pg_catalog\.pg_roles[\s\S]*v_role\.rolsuper[\s\S]*v_role\.rolbypassrls[\s\S]*v_role\.rolcanlogin[\s\S]*v_role\.rolinherit[\s\S]*v_role\.rolcreatedb[\s\S]*v_role\.rolcreaterole[\s\S]*v_role\.rolreplication[\s\S]*phase6_app_security_owner_unsafe_attributes/);
assert.match(compact,/revoke phase6_app_security_owner from anon, authenticated/);
assert.doesNotMatch(compact,/grant phase6_app_security_owner to (?:anon|authenticated)/);
assert.doesNotMatch(compact,/grant usage on schema auth|grant execute on function auth\.uid/);
assert.match(compact,/grant execute on function public\.phase6_auth_uid\(\) to phase6_app_security_owner/);
assert.doesNotMatch(compact,/alter function public\.phase6_auth_uid\(\) owner to/,
  'the bridge remains owned by the migration executor');
assert.match(compact,/grant phase6_app_security_owner to postgres; grant create on schema public to phase6_app_security_owner/);
assert.match(compact,/revoke create on schema public from phase6_app_security_owner; revoke phase6_app_security_owner from postgres; notify pgrst/);
assert.doesNotMatch(compact,/auth\.jwt\s*\(/);
assert.doesNotMatch(compact,/grant all|grant execute on all functions|grant .* on all tables/);
assert.match(compact,/p\.proname in \('is_client_user','find_login_email'\)[\s\S]*revoke all on function %s from public, anon, authenticated/);

const inScope=['profiles','notifications','conversations','conversation_members','messages','message_attachments',
  'message_mentions','message_reactions','tasks','revision_notes','project_notes','activity_logs'];
inScope.push('team_members');
for(const table of inScope){
  assert.match(compact,new RegExp(`alter table public\\.${table} enable row level security`));
  const policies=[...compact.matchAll(new RegExp(`create policy [^;]+ on public\\.${table} [^;]+;`,'g'))].map(m=>m[0]);
  assert.ok(policies.length>0,`${table} policies present`);
  for(const p of policies){
    assert.doesNotMatch(p,/(?:using|with check)\s*\(\s*true\s*\)/,`${table} has no unconditional policy`);
    assert.doesNotMatch(p,/auth\.jwt\s*\(/,`${table} has no JWT role authorization`);
  }
}

assert.match(compact,/revoke all on public\.profiles,[^;]+ from public,anon,authenticated/);
assert.match(compact,/create policy phase6_profiles_self_select[^;]+using \(id=auth\.uid\(\)\)/);
assert.match(compact,/create policy phase6_profiles_admin_select[^;]+phase6_app_actor_class\(\)='admin'/);
assert.doesNotMatch(compact,/create policy [^;]+profiles[^;]+using \(true\)/);
const directory=sql.match(/create or replace function public\.get_collaboration_directory\(\)[\s\S]*?\$fn\$;/i)?.[0]??'';
assert.match(directory,/returns table \(id uuid, full_name text, role public\.app_role, avatar_url text\)/i);
assert.doesNotMatch(directory,/\bp\.\*|\bemail\b|\bphone\b|created_at|status text/i);
assert.match(directory,/p\.status='active'[\s\S]*?p\.role::text in \('admin','project_manager','manager','employee','junior_assistant'\)/i);
const profileGuard=sql.match(/create or replace function public\.phase6_guard_profile_update\(\)[\s\S]*?\$fn\$;/i)?.[0]??'';
assert.match(profileGuard,/phase6_app_actor_class\(\)='admin'/i);
for(const field of ['email','role','status','created_at']) assert.match(profileGuard,new RegExp(`new\\.${field} is distinct from old\\.${field}`,'i'));
assert.match(compact,/grant update \(full_name,avatar_url,phone,role,status\) on public\.profiles to authenticated/);

assert.match(compact,/grant update \(is_read\) on public\.notifications to authenticated/);
assert.doesNotMatch(compact,/grant (?:[^;]*,)?insert(?:,[^;]*)? on public\.notifications to authenticated/);
assert.match(compact,/create policy phase6_notifications_recipient_select[^;]+recipient_id=auth\.uid\(\)/);
assert.match(compact,/create policy phase6_notifications_recipient_update[^;]+recipient_id=auth\.uid\(\)[^;]+recipient_id=auth\.uid\(\)/);
assert.match(compact,/create policy phase6_notifications_recipient_delete[^;]+recipient_id=auth\.uid\(\)/);
assert.match(compact,/phase6_notifications_workflow_owner_select[\s\S]*phase6_notifications_workflow_owner_insert/);
assert.match(compact,/phase6_notifications_app_security_insert/);

const conversationAccess=sql.match(/create or replace function public\.phase6_can_access_conversation\([^)]*\)[\s\S]*?\$fn\$;/i)?.[0]??'';
assert.match(conversationAccess,/case\s+when c\.type='project_internal' then c\.project_id is not null\s+and public\.phase6_team_can_access_project\(c\.project_id\)/i);
assert.match(conversationAccess,/when c\.type='project_client' then c\.project_id is not null and \(\s*public\.phase6_team_can_access_project\(c\.project_id\)\s+or public\.phase6_client_can_access_project\(c\.project_id\)\)/i);
assert.match(conversationAccess,/when c\.type='task' then c\.task_id is not null\s+and public\.phase6_can_access_task\(c\.task_id\)/i);
assert.match(conversationAccess,/when c\.type in \('dm','team_channel'\) then exists \([\s\S]*conversation_members[\s\S]*cm\.user_id=public\.phase6_auth_uid\(\)/i);
assert.match(conversationAccess,/else false\s+end/i);
assert.doesNotMatch(conversationAccess,/conversation_members[\s\S]*?\bor\s*\(c\.type='project_/i);
assert.doesNotMatch(conversationAccess,/email|client_name/i);
assert.match(compact,/create policy phase6_conversations_member_select[^;]+phase6_can_access_conversation\(id\)/);
assert.doesNotMatch(compact,/type='dm'[^;]+phase6_conversations_eligible_insert/);
const dm=sql.match(/create or replace function public\.phase6_create_direct_conversation\(p_other_user_id uuid\)[\s\S]*?\$fn\$;/i)?.[0]??'';
assert.match(dm,/phase6_collaboration_target_is_team\(p_other_user_id\)/i);
assert.match(dm,/least\(v_actor_id,p_other_user_id\)::text[\s\S]*greatest\(v_actor_id,p_other_user_id\)::text/i);
assert.match(dm,/pg_catalog\.pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\(v_pair_key,0\)\s*\)/i);
assert.ok(dm.indexOf('pg_advisory_xact_lock')<dm.indexOf('select c.id into v_id'),'DM pair lock precedes existing-DM lookup');
assert.match(dm,/select c\.id into v_id[\s\S]*if v_id is not null then return v_id; end if;[\s\S]*insert into public\.conversations/i);
assert.match(dm,/insert into public\.conversation_members[\s\S]*?v_actor_id[\s\S]*?p_other_user_id/i);
assert.match(compact,/grant update \(last_read_at\) on public\.conversation_members to authenticated/);
assert.match(compact,/phase6_members_self_read_update[^;]+user_id=auth\.uid\(\)[^;]+phase6_can_access_conversation/);
assert.doesNotMatch(compact,/grant delete on public\.conversation_members to authenticated/);

assert.match(compact,/phase6_messages_member_select[^;]+phase6_can_access_conversation\(conversation_id\)/);
assert.match(compact,/phase6_messages_member_insert[^;]+sender_id=auth\.uid\(\)[^;]+phase6_can_access_conversation\(conversation_id\)/);
assert.doesNotMatch(compact,/grant (?:update|delete) on public\.messages to authenticated/);
assert.match(compact,/phase6_attachments_sender_insert[^;]+phase6_can_attach_to_message\(message_id\)/);
assert.match(compact,/phase6_mentions_sender_insert[^;]+phase6_conversation_target_eligible/);
for(const operation of ['insert','delete'])
  assert.match(compact,new RegExp(`phase6_reactions_self_${operation}[^;]+user_id=auth\\.uid\\(\\)`));

const targetEligibility=sql.match(/create or replace function public\.phase6_conversation_target_eligible\([^)]*\)[\s\S]*?\$fn\$;/i)?.[0]??'';
assert.match(targetEligibility,/case\s+when c\.type='project_internal'[\s\S]*when c\.type='project_client'[\s\S]*when c\.type='task'/i);
assert.match(targetEligibility,/when c\.type in \('dm','team_channel'\) then exists \([\s\S]*conversation_members/i);
assert.match(targetEligibility,/else false\s+end/i);
assert.doesNotMatch(targetEligibility,/where c\.id=p_conversation_id and \(\s*exists[\s\S]*conversation_members/i);
assert.doesNotMatch(targetEligibility,/p\.project_manager\s*=\s*target\.id/i);
const mentionTrigger=sql.match(/create or replace function public\.phase6_notify_message_mention\(\)[\s\S]*?\$fn\$;/i)?.[0]??'';
assert.match(mentionTrigger,/phase6_conversation_target_eligible\(v_conversation_id,new\.user_id\)[\s\S]*insert into public\.notifications/i);
const teamProfileSync=sql.match(/create or replace function public\.phase6_sync_profile_from_team_member\(\)[\s\S]*?\$fn\$;/i)?.[0]??'';
assert.match(teamProfileSync,/returns trigger language plpgsql security invoker\s+set search_path = pg_catalog, pg_temp/i);
assert.match(teamProfileSync,/update public\.profiles p\s+set full_name=new\.full_name,\s*role=new\.role,\s*phone=new\.phone,\s*status=new\.status\s+where pg_catalog\.lower\(p\.email\)=pg_catalog\.lower\(new\.email\)/i);
const teamProfileAssignments=teamProfileSync.match(/\bset\b([\s\S]*?)\bwhere\b/i)?.[1]??'';
assert.doesNotMatch(teamProfileAssignments,/\b(?:id|email|created_at)\s*=/i);
assert.match(compact,/revoke all on function public\.phase6_sync_profile_from_team_member\(\) from public,anon,authenticated/);
assert.match(compact,/create trigger phase6_sync_profile_from_team_member after insert or update of full_name,email,role,phone,status on public\.team_members for each row execute function public\.phase6_sync_profile_from_team_member\(\)/);

const projectAccess=sql.match(/create or replace function public\.phase6_team_can_access_project\([^)]*\)[\s\S]*?\$fn\$;/i)?.[0]??'';
assert.match(projectAccess,/phase6_app_actor_class\(\)='employee' and p\.assigned_to=public\.phase6_auth_uid\(\)/i);
assert.doesNotMatch(projectAccess,/p\.project_manager/i);
const projectGuard=sql.match(/create or replace function public\.phase6_touch_project_metadata_updated_at\(\)[\s\S]*?\$fn\$;/i)?.[0]??'';
assert.match(projectGuard,/current_user='phase6_workflow_rpc_owner'[\s\S]*return new/i);
assert.match(projectGuard,/new\.client_profile_id is distinct from old\.client_profile_id[\s\S]*phase6_current_actor_class\(\) not in \('admin','project_manager'\)/i);
assert.match(projectGuard,/new\.project_manager is distinct from old\.project_manager[\s\S]*phase6_current_actor_class\(\)='employee'[\s\S]*phase6_project_manager_change_denied/i);
assert.match(projectGuard,/new\.updated_at := clock_timestamp\(\)/i);
const conversationInsertPolicy=compact.match(/create policy phase6_conversations_eligible_insert[^;]+;/)?.[0]??'';
assert.doesNotMatch(conversationInsertPolicy,/type='dm'/);

assert.match(compact,/phase6_tasks_team_select[^;]+phase6_can_access_task\(id\)/);
assert.match(compact,/phase6_tasks_team_insert[^;]+created_by=auth\.uid\(\)[^;]+assigned_to=auth\.uid\(\)/);
const taskGuard=sql.match(/create or replace function public\.phase6_guard_task_update\(\)[\s\S]*?\$fn\$;/i)?.[0]??'';
assert.match(taskGuard,/phase6_app_actor_class\(\)='employee'[\s\S]*?new\.assigned_to is distinct from old\.assigned_to[\s\S]*?new\.project_id is distinct from old\.project_id/i);
assert.doesNotMatch(compact,/grant delete on public\.tasks to authenticated/);

for(const table of ['revision_notes','project_notes']){
  assert.match(compact,new RegExp(`create policy phase6_${table}_team_select[^;]+phase6_team_can_access_project\\(project_id\\)`));
  assert.match(compact,new RegExp(`create policy phase6_${table}_team_insert[^;]+(?:added_by|user_id)=auth\\.uid\\(\\)[^;]+phase6_team_can_access_project\\(project_id\\)`));
}
assert.match(compact,/phase6_activity_logs_team_insert[^;]+user_id=auth\.uid\(\)/);
assert.doesNotMatch(compact,/create policy [^;]+(?:revision_notes|project_notes|activity_logs)[^;]+(?:client|phase6_client_can_access_project)/);
for(const operation of ['select','insert','update','delete'])
  assert.match(compact,new RegExp(`create policy phase6_team_members_admin_${operation}[^;]+phase6_app_actor_class\\(\\)='admin'`));

const functionBlocks=[...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\([^)]*\)[\s\S]*?\$fn\$;/gi)];
const definerNames=functionBlocks.filter((m)=>/security definer/i.test(m[0])).map((m)=>m[1]);
assert.equal(definerNames.length,14);
for(const name of definerNames){
  assert.match(sql,new RegExp(`alter function public\\.${name}\\([^;]* owner to phase6_app_security_owner`,'i'),`${name} app owner`);
}
const definerBodies=[...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\([^)]*\)[\s\S]*?security definer[\s\S]*?as \$fn\$([\s\S]*?)\$fn\$;/gi)];
assert.equal(definerBodies.length,definerNames.length);
for(const block of definerBodies) assert.doesNotMatch(block[2],/auth\.uid\(\)/i,`${block[1]} uses the public bridge`);
assert.doesNotMatch(compact,/owner to phase6_workflow_rpc_owner/);

const securityTest=fs.readFileSync('supabase/tests/database/phase6_core_security.test.sql','utf8');
assert.match(securityTest,/^begin;/m);
assert.match(securityTest,/rollback;\s*$/);
assert.doesNotMatch(securityTest,/insert into (?:auth\.users|public\.profiles)/i);
assert.match(securityTest,/Client-revocation, Employee-reassignment and project_manager runtime scenarios/i);
assert.match(securityTest,/stale Client membership cannot preserve conversation\/message\/read-state access/i);
assert.match(securityTest,/stale Employee membership cannot preserve conversation\/message\/read-state access/i);
assert.match(securityTest,/TWO-SESSION DM CONCURRENCY TEST REQUIRED IN STAGING/i);

console.log(JSON.stringify({
  staticChecks:'passed (source assertions, NOT PostgreSQL execution)',
  phase6Migrations:migrations.length,
  reservedCutover00500:cutoverPresent ? 'authored' : 'absent',
  appSecurityDefiners:definerNames.length,
  inScopeTables:inScope.length,
  frontendAttestation:'historical 128-file digest preserved; current semantics asserted separately',
},null,2));
