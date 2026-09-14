// Dependency-free frontend source assertions only; this does not execute PostgreSQL.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const migrationDir = 'supabase/phase6/migrations';
const migrations = [
  ['00100_phase6_canonical_foundation.sql','3bdae7a341b22699cb8879a3508e3f97eb76e1e09287949ebd7fe93aed1ee21a'],
  ['00200_phase6_legacy_backfill.sql','848c80db812dfa583c563fc9b73c44deebf6130d56578946712a78003cbb2cfc'],
  ['00300_phase6_workflow_rpcs.sql','296b77041d7af216c499c50a7e91866cb70d2f7e4fb9e36f6410e86bf6c7e767'],
  ['00400_phase6_security_and_projections.sql','22a852cf39d1e6d3292d98fcdc8ad90663770864e65592472a9b783565415628'],
  ['00450_phase6_core_application_security.sql','fcffa593f087308a87c5d58e974cfbb81f13c2335429da82c24bfe8c11c980ee'],
  ['00460_phase6_finance_payroll_security.sql','927032d087c2f1cd9faaa59ba10a9dbf76afb8a47b074dff029d7ced19b76add'],
];
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const cutoverPresent = fs.existsSync(`${migrationDir}/00500_phase6_cutover_and_validation.sql`);
assert.deepEqual(fs.readdirSync(migrationDir).filter((f)=>f.includes('phase6')&&f.endsWith('.sql')&&!f.startsWith('00500_')).sort(),migrations.map(([f])=>f));
for (const [file, expected] of migrations) assert.equal(sha(`${migrationDir}/${file}`), expected, `${file} unchanged`);

const sourceFiles=[];
const walk=(dir)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name); if(entry.isDirectory()) walk(file); else if(/\.(?:ts|tsx)$/.test(file)) sourceFiles.push(file);
}};
walk('src');
const source=sourceFiles.map((file)=>fs.readFileSync(file,'utf8')).join('\n');
const tracker=fs.readFileSync('src/lib/useTracker.ts','utf8').replace(/\r\n/g,'\n');
const workflow=fs.readFileSync('src/lib/workflowClient.ts','utf8');
const notifications=fs.readFileSync('src/lib/notifications.ts','utf8');
const app=fs.readFileSync('src/App.tsx','utf8');
const projectDetail=fs.readFileSync('src/components/ProjectDetail.tsx','utf8');
const projectsPage=fs.readFileSync('src/pages/ProjectsPage.tsx','utf8');
const revisionsPage=fs.readFileSync('src/pages/RevisionRequestsPage.tsx','utf8');
const projectForm=fs.readFileSync('src/components/ProjectFormModal.tsx','utf8');
const teamPage=fs.readFileSync('src/pages/TeamPage.tsx','utf8').replace(/\r\n/g,'\n');
const types=fs.readFileSync('src/lib/types.ts','utf8');
const rpcSql=fs.readFileSync(`${migrationDir}/00300_phase6_workflow_rpcs.sql`,'utf8');

const canonical=[
  'workflow_advance_stage','workflow_submit_stage_for_approval','workflow_client_approve_stage',
  'workflow_submit_client_revision','workflow_submit_revised_proof','workflow_request_stage_skip',
  'workflow_respond_stage_skip','workflow_admin_override','workflow_complete_final_delivery',
  'workflow_set_project_lifecycle','workflow_update_project_configuration',
];
const declared=[...workflow.matchAll(/^\s*'((?:workflow_)[a-z_]+)',?$/gm)].map((m)=>m[1]);
assert.deepEqual(declared,canonical,'canonical client declares exactly eleven RPCs in accepted order');
for(const rpc of canonical){
  assert.match(workflow,new RegExp(`this\\.mutate\\('${rpc}'`),`${rpc} uses central mutation path`);
}
assert.match(workflow,/p_expected_workflow_version:\s*version/g);
assert.match(workflow,/p_idempotency_key:\s*idempotencyKey/);
assert.match(workflow,/crypto\.randomUUID\(\)/);
assert.match(workflow,/pendingRequests\.get\(retryKey\)/);
assert.match(workflow,/pending\.argsFingerprint !== argsFingerprint/,'pending retry detects argument drift');
assert.match(workflow,/workflow_stale_version[\s\S]*refreshProjectData\(\)/);
assert.match(workflow,/typeof result\.project_id === 'string'[\s\S]*Number\.isInteger\(result\.workflow_version\)[\s\S]*typeof result\.already_applied === 'boolean'/,'canonical result validates project, version, and replay flag');
const resultValidationIndex=workflow.indexOf('if (!isWorkflowMutationResult(result))');
const successClearIndex=workflow.indexOf('this.pendingRequests.delete(retryKey)',resultValidationIndex);
assert.ok(resultValidationIndex>=0&&successClearIndex>resultValidationIndex,'pending retry state clears only after result validation');
assert.doesNotMatch(workflow.slice(resultValidationIndex,successClearIndex),/pendingRequests\.delete/,'malformed success preserves pending retry state');

const sqlParameterNames=(rpc)=>{
  const match=rpcSql.match(new RegExp(`create function public\\.${rpc}\\(([\\s\\S]*?)\\) returns public\\.workflow_mutation_result`,'i'));
  assert.ok(match,`${rpc} SQL signature exists`);
  return match[1].split(',').map((part)=>part.trim().match(/^(p_[a-z_]+)/i)?.[1]).filter(Boolean);
};
const declaredParameterNames=(rpc)=>{
  const match=workflow.match(new RegExp(`${rpc}: \\[([^\\]]+)\\]`));
  assert.ok(match,`${rpc} frontend parameter declaration exists`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item)=>item[1]);
};
const wrapperParameterNames=(rpc)=>{
  const match=workflow.match(new RegExp(`this\\.mutate\\('${rpc}',[\\s\\S]*?,\\s*\\{([\\s\\S]*?)\\}\\);`));
  assert.ok(match,`${rpc} wrapper call exists`);
  return [...match[1].matchAll(/\b(p_[a-z_]+)\s*:/g)].map((item)=>item[1]);
};
for(const rpc of canonical){
  const sqlNames=sqlParameterNames(rpc);
  assert.deepEqual(declaredParameterNames(rpc),sqlNames,`${rpc} declared parameters match migration 00300`);
  const wrapperNames=[...wrapperParameterNames(rpc),'p_idempotency_key'];
  assert.deepEqual(wrapperNames.sort(),[...sqlNames].sort(),`${rpc} wrapper arguments match migration 00300`);
}
assert.match(workflow,/actualParameters[\s\S]*expectedParameters[\s\S]*frontend arguments do not match/,'runtime RPC parameter guard exists');

const legacy=[
  'client_approve_project_milestone','submit_client_revision','submit_revised_proof','client_respond_revision',
  'apply_revision_request_timeline','mark_project_revision_requested','apply_project_timeline',
  'create_timeline_deadline_notifications','create_project_notifications','notify_revision_watchers',
  'set_revision_completed_at','notify_revised_proof_uploaded','log_project_status_change','auto_link_client_project_access',
];
for(const rpc of legacy) assert.doesNotMatch(source,new RegExp(`\\.rpc\\(\\s*['\"]${rpc}['\"]`),`legacy RPC ${rpc} absent`);

const metadataBody=tracker.match(/function projectMetadataPayload\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1]??'';
assert.ok(metadataBody,'metadata allowlist helper exists');
const protectedFields=[
  'project_status','workflow_stage_key','workflow_stage_status_key','workflow_waiting_on_key','workflow_version',
  'requires_print','requires_ebook','service_capability_status','capabilities_resolved_by','capabilities_resolved_at',
  'workflow_settings','stage_started_at','stage_due_at','stage_completed_at','final_due_at','delivered_at','revision_count',
  'production_seconds_total','client_wait_seconds_total','status','current_stage','stage_status','waiting_on','timeline_status',
  'progress_percentage','client_action_required','production_days_used','production_time_used','client_wait_time','stage_states',
  'files_received_date','design_concept_due_date','design_concept_submitted_date','design_concept_approval_date',
  'concept_revision_due_date','print_version_due_date','print_version_submitted_date','print_version_approval_date',
  'print_revision_due_date','ebook_due_date','ebook_submitted_date','ebook_approval_date','final_delivery_date','delay_reason',
];
for(const field of protectedFields) assert.doesNotMatch(metadataBody,new RegExp(`\\b${field}\\s*:`),`metadata update excludes ${field}`);
const metadataType=types.match(/export type ProjectMetadataUpdate[\s\S]*?;\s*\n\s*export interface RevisionNote/)?.[0]??'';
assert.ok(metadataType,'ProjectMetadataUpdate declaration exists');
for(const field of protectedFields) assert.doesNotMatch(metadataType,new RegExp(`['"]${field}['"]`),`ProjectMetadataUpdate excludes ${field}`);
assert.equal((tracker.match(/\.from\('projects'\)\.update\(/g)||[]).length,1,'one direct project update site remains');
assert.match(tracker,/\.from\('projects'\)\.update\(payload\)/,'project update uses allowlisted payload');
assert.doesNotMatch(source,/\.from\('project_stage_skips'\)[\s\S]{0,160}\.(?:insert|update)\(/);
assert.doesNotMatch(source,/\.from\('admin_workflow_overrides'\)[\s\S]{0,160}\.insert\(/);

const revisionUpdate=tracker.match(/const updateRevisionRequest[\s\S]*?const updateRevisionItem/)?.[0]??'';
for(const field of ['status','canonical_status','stage_key','revision_round','due_at','completed_at'])
  assert.doesNotMatch(revisionUpdate,new RegExp(`\\b${field}\\s*:`),`revision lifecycle excludes ${field}`);

assert.match(tracker,/rpc\('get_client_project_summaries'\)/);
for(const rpc of ['get_client_revision_requests','get_client_revision_items','get_client_revision_attachments','get_client_revision_activity','get_client_stage_skips'])
  assert.match(tracker,new RegExp(`rpc\\('${rpc}'\\)`));
assert.match(tracker,/rpc\('get_collaboration_directory'\)/);
assert.match(tracker,/rpc\('phase6_create_direct_conversation',[\s\S]*p_other_user_id:/);
assert.doesNotMatch(source,/\.from\('notifications'\)[\s\S]{0,100}\.insert\(/,'frontend does not insert ordinary notifications');
assert.match(notifications,/\.update\(\{ is_read: true \}\)/);
assert.doesNotMatch(notifications,/\.update\([^)]*(?:read_at|recipient_id|project_id)/);
assert.match(tracker,/const financeTransactionsPromise = canManage[\s\S]*?: emptyResult/);
assert.match(tracker,/const paymentsPromise = canManage[\s\S]*?: emptyResult/);
assert.match(tracker,/profile\.role === 'admin'[\s\S]*?isEmployee[\s\S]*?: emptyResult/);
for(const fn of ['saveEmployeeCompensation','addEmployeeLedgerEntry','deleteEmployeeLedgerEntry'])
  assert.match(tracker,new RegExp(`const ${fn}[\\s\\S]{0,500}currentProfile\\.role !== 'admin'`),`${fn} Admin-only`);
const financeUpdate=tracker.match(/const updateFinanceTransaction[\s\S]*?const softDeleteFinanceTransaction/)?.[0]??'';
assert.match(financeUpdate,/currentProfile\.role==='admin'\?\{project_id\}:\{\}/,'only Admin forwards project_id on finance update');
const financeUpdatePayload=financeUpdate.match(/const updatePayload=definedValues\(\{([\s\S]*?)\}\);/)?.[1]??'';
assert.ok(financeUpdatePayload);
assert.doesNotMatch(financeUpdatePayload,/amount_pkr\s*:/,'finance update omits caller amount_pkr');
const financeInsert=tracker.match(/const createFinanceTransaction[\s\S]*?const updateFinanceTransaction/)?.[0]??'';
const dbInsert=financeInsert.match(/\.from\('finance_transactions'\)[\s\S]*?\.insert\(\{([\s\S]*?)\}\)/)?.[1]??'';
assert.ok(dbInsert);
assert.doesNotMatch(dbInsert,/amount_pkr\s*:/,'finance insert omits caller amount_pkr');
assert.match(dbInsert,/created_by:currentProfile\.id/);
assert.match(tracker,/currentProfile\.role !== 'admin'[\s\S]*?\.from\('team_members'\)\.upsert/,'team member upsert is Admin-controlled');
assert.match(tracker,/\.update\(\{ last_read_at: now \}\)[\s\S]*?\.eq\('user_id', currentProfile\.id\)/);
assert.doesNotMatch(tracker,/\.from\('conversation_members'\)\.upsert/);
assert.doesNotMatch(tracker,/return \{ data: \[\], error: null \};[\s\S]{0,120}isMissingSchemaError/);

const between=(text,start,end)=>{
  const from=text.indexOf(start); const to=text.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,`source block ${start} exists`); return text.slice(from,to);
};
const provisionTeamMember=between(tracker,'const provisionTeamMember =','const updateProfile =');
assert.match(provisionTeamMember,/currentProfile\.role !== 'admin'/,'pre-provisioning is explicitly Admin-only');
assert.match(provisionTeamMember,/\['employee', 'junior_assistant', 'project_manager'\]\.includes\(role\)/,'pre-provisioning accepts staff roles only');
assert.match(provisionTeamMember,/\.from\('team_members'\)[\s\S]*\.upsert\([\s\S]*full_name:[\s\S]*email:[\s\S]*role,[\s\S]*phone:[\s\S]*status: 'active'/);
assert.doesNotMatch(provisionTeamMember,/auth\.signUp|service_role|serviceRole/);
const signupBlock=between(tracker,'const signUp =','const signOut =');
const signupMetadata=signupBlock.match(/options:\s*\{\s*data:\s*\{([\s\S]*?)\}\s*,?\s*\}/)?.[1]??'';
assert.match(signupMetadata,/full_name: cleanFullName/);
assert.doesNotMatch(signupMetadata,/\brole\s*:/,'Auth signup metadata remains role-free');
assert.match(app,/onAddEmployee=\{tracker\.provisionTeamMember\}/);
const teamRoute=app.match(/activeView === 'team'[\s\S]*?<TeamPage[\s\S]*?\/>/)?.[0]??'';
assert.doesNotMatch(teamRoute,/tracker\.signUp/,'Admin Add Employee does not call signup');
assert.doesNotMatch(teamPage,/newEmployeePassword|type="password"/,'Admin does not assign the employee password');
assert.match(teamPage,/Pre-provision Team Member/);
const createProject=between(tracker,'const createProject =','const updateProject =');
assert.match(createProject,/isCanonicalCreation[\s\S]*!canManageEverything\(currentProfile\)/,'canonical project creation is Admin/PM gated');
assert.match(createProject,/typeof draft\.requires_print !== 'boolean'[\s\S]*typeof draft\.requires_ebook !== 'boolean'/);
assert.match(createProject,/const requiresPrint = draft\.requires_print as boolean/);
assert.match(createProject,/const requiresEbook = draft\.requires_ebook as boolean/);
assert.match(createProject,/isCanonicalCreation \? \[\] : getAutoSkippedStagesForServiceType/,'canonical creation does not infer capabilities from service type');
assert.match(projectForm,/Canonical Service Capabilities[\s\S]*requires_print[\s\S]*requires_ebook/,'create/edit UI exposes capability controls');
assert.match(projectForm,/await onSubmit\(draft\)/,'project form submits the raw edited draft');
assert.doesNotMatch(projectForm,/onSubmit\(\s*deriveProjectTimeline\(/,'project form does not submit a derived timeline');
assert.equal((projectForm.match(/deriveProjectTimeline\(/g)||[]).length,1,'timeline derivation is used only for the form preview');
assert.match(createProject,/const timelineDraft = isCanonicalCreation[\s\S]*\? draft[\s\S]*: deriveProjectTimeline/,'timeline derivation remains confined to demo project creation');
assert.doesNotMatch(projectForm,/include weekends/i,'canonical form contains no misleading weekend deadline copy');
assert.match(projectForm,/configured working-day rules/,'canonical form describes database working-day calculation');
assert.match(projectForm,/\{canonical \? \([\s\S]*Current Stage Due[\s\S]*Estimated Final Due[\s\S]*\) : !isEditing \? \([\s\S]*label="Files Received Date"/,'canonical timeline is read-only and legacy controls are demo-only');
assert.match(app,/canonical=\{tracker\.mode === 'supabase'\}/,'project form receives the canonical mode boundary');

for(const [name,next] of [['getOrCreateProjectConversation','getOrCreateTaskConversation'],['getOrCreateTaskConversation','getOrCreateDM']]){
  const block=between(tracker,`const ${name} =`,`const ${next} =`);
  assert.match(block,/if \(error\) throw error/);
  assert.match(block,/if \(!created\) throw new Error/);
  assert.doesNotMatch(block,/console\.warn|catch\s*\(/,`${name} fails closed`);
  assert.match(block,/if \(existing\)[\s\S]*ensureScopedConversationSelfMembership\(existing\.id\)[\s\S]*ensureScopedConversationSelfMembership\(confirmed\.id\)/,`${name} ensures self membership for existing and newly created scope`);
  assert.doesNotMatch(block,/data\.conversationMembers|phase6_can_access_conversation/,`${name} does not use membership as scoped authorization`);
}
const scopedMembership=between(tracker,'const ensureScopedConversationSelfMembership =','const getOrCreateProjectConversation =');
assert.match(scopedMembership,/\.eq\('user_id', currentProfile\.id\)[\s\S]*\.insert\(\{ conversation_id: conversationId, user_id: currentProfile\.id \}\)/,'scoped membership reads/inserts only the current user');
assert.match(scopedMembership,/if \(insertError\)[\s\S]*selectSelfMembership\(\)[\s\S]*if \(!retry\.data\) throw insertError/,'already-existing or uncertain self membership is confirmed safely');
assert.match(scopedMembership,/if \(selectError\) throw selectError/,'self-membership select errors fail closed');
assert.doesNotMatch(scopedMembership,/otherUserId|assigned_to|project_manager|client_project_access/,'membership helper does not decide scoped authorization');
const dmBlock=between(tracker,'const getOrCreateDM =','return {\n    mode');
assert.match(dmBlock,/members\.length === 2[\s\S]*userIds\.includes\(currentProfile\.id\)[\s\S]*userIds\.includes\(otherUserId\)/);
assert.match(dmBlock,/rpc\('phase6_create_direct_conversation',[\s\S]*p_other_user_id:/,'DM creation remains canonical RPC-only');
const reactionBlock=between(tracker,'const toggleReaction =','const markConversationRead =');
assert.match(reactionBlock,/\.from\('message_reactions'\)\.delete\(\)[\s\S]*\.eq\('user_id', currentProfile\.id\)/);
assert.match(reactionBlock,/\.from\('message_reactions'\)[\s\S]*\.insert\(\{ message_id: messageId, user_id: currentProfile\.id, emoji \}\)/);
assert.match(reactionBlock,/if \(deleteError\) throw deleteError[\s\S]*if \(insertError\) throw insertError/);
const profileUpdate=between(tracker,'const updateProfile =','const markNotificationRead =');
assert.match(profileUpdate,/currentProfile\.role !== 'admin' && profileId !== currentProfile\.id/);
assert.match(profileUpdate,/\.select\('id'\)[\s\S]*\.maybeSingle\(\)/);
assert.match(profileUpdate,/if \(!updatedRow\) throw new Error[\s\S]*setData/,'profile state changes only after row confirmation');
const activity=between(tracker,'const addActivity =','const createProject =');
assert.match(activity,/Omit<ActivityLog, 'id' \| 'created_at' \| 'user_id'>/);
assert.match(activity,/user_id: currentProfile\.id/);
assert.match(activity,/if \(activityError\) throw activityError[\s\S]*setData/,'activity state changes after successful insert');
const invite=between(tracker,'const inviteClient =','const updateProfile =');
assert.match(invite,/error: accessDeleteError[\s\S]*if \(accessDeleteError\) throw accessDeleteError[\s\S]*client_project_access'\)\.insert/);
const createRevision=between(tracker,'const createRevisionRequest =','const updateRevisionRequest =');
assert.match(createRevision,/revisionSubmissionRetriesRef\.current\.get\(operationKey\)/);
assert.match(createRevision,/if \(!operation\.requestId\)[\s\S]*submitClientRevision[\s\S]*operation\.requestId = returnedId/);
assert.match(createRevision,/if \(!progress\.uploaded\)[\s\S]*if \(!progress\.inserted\)[\s\S]*ensureRevisionAttachment/);
const revisedProof=between(tracker,'const uploadRevisedProof =','const respondToRevisionRequest =');
assert.match(revisedProof,/revisedProofRetriesRef\.current\.get\(operationKey\)/);
assert.match(revisedProof,/if\(!operation\.attachment\.uploaded\)[\s\S]*if\(!operation\.attachment\.inserted\)[\s\S]*if\(!operation\.rpcComplete\)/);

const uiReachable={
  workflow_advance_stage:/onAdvanceWorkflowStage=\{\(\) => tracker\.advanceWorkflowStage/.test(app)&&/onClick=\{advanceFilesReceived\}/.test(projectDetail),
  workflow_submit_stage_for_approval:/tracker\.submitStageForApproval/.test(app)&&/onSubmitStageForApproval/.test(projectDetail),
  workflow_client_approve_stage:/tracker\.approveProjectMilestone|tracker\.respondToRevisionRequest/.test(app),
  workflow_submit_client_revision:/tracker\.createRevisionRequest/.test(app),
  workflow_submit_revised_proof:/onUploadRevisedProof=\{tracker\.uploadRevisedProof\}/.test(app)&&/onUploadRevisedProof\(request\.id/.test(revisionsPage),
  workflow_request_stage_skip:/tracker\.requestStageSkip/.test(app)&&/onRequestStageSkip/.test(projectDetail),
  workflow_respond_stage_skip:/tracker\.respondToStageSkip/.test(app),
  workflow_admin_override:/tracker\.adminWorkflowOverride/.test(app)&&/onAdminWorkflowOverride/.test(projectDetail),
  workflow_complete_final_delivery:/tracker\.completeFinalDelivery/.test(app)&&/onCompleteFinalDelivery/.test(projectDetail),
  workflow_set_project_lifecycle:/onSetProjectLifecycle: tracker\.setProjectLifecycle/.test(app)&&/onSetProjectLifecycle/.test(projectsPage),
  workflow_update_project_configuration:/tracker\.updateProjectFromDraft/.test(app)&&/updateWorkflowConfiguration\(projectId/.test(tracker),
};
assert.deepEqual(Object.keys(uiReachable),canonical);
for(const [rpc,reachable] of Object.entries(uiReachable)) assert.equal(reachable,true,`${rpc} has a component-to-useTracker UI path`);

console.log(JSON.stringify({
  staticChecks:'passed (frontend source assertions, NOT PostgreSQL execution)',
  canonicalWorkflowRpcs:canonical.length,
  legacyWorkflowRpcCalls:0,
  directProtectedProjectUpdates:0,
  reservedCutover00500:cutoverPresent ? 'authored' : 'absent',
  migrationHashes:'pinned final staging-correction bytes',
  exactRpcSignatures:'migration 00300 matched',
  uiReachable,
},null,2));
