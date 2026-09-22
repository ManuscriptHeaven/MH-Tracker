// Runtime integration certification is intentionally LOCAL-ONLY.
// It creates disposable Auth/database fixtures and must never run against staging or production.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.API_URL || process.env.VITE_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error('Local Supabase credentials are required.');

const host = new URL(url).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') {
  throw new Error('SAFETY ABORT: runtime integration certification is local-only.');
}

const runId = crypto.randomUUID().slice(0, 8);
const testPassword = 'LocalOnly-' + runId + '-Aa1!';
const adminEmail = 'ci-admin-' + runId + '@example.test';
const employeeEmail = 'ci-team-' + runId + '@example.test';
const clientEmail = 'ci-client-' + runId + '@example.test';
const adminId = crypto.randomUUID();
const employeeId = crypto.randomUUID();
const clientId = crypto.randomUUID();

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anonymousClient = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

function ok(value, label) {
  if (!value) throw new Error('Assertion failed: ' + label);
  console.log('PASS ' + label);
}

function valueOrThrow(result, label) {
  if (result.error) throw new Error(label + ': ' + result.error.message);
  return result.data;
}

async function provisionTeamUser(id, email, fullName, role) {
  valueOrThrow(await service.from('team_members').insert({ full_name: fullName, email, role, status: 'active' }), 'insert team member');
  valueOrThrow(await service.auth.admin.createUser({
    id, email, password: testPassword, email_confirm: true, user_metadata: { full_name: fullName },
  }), 'create team auth user');

  const profile = valueOrThrow(await service.from('profiles').select('id,role,status').eq('id', id).single(), 'load team profile');
  ok(profile.role === role, email + ' receives requested application role');

  const membership = valueOrThrow(await service.from('workspace_members').select('workspace_id,role,status').eq('user_id', id).single(), 'load workspace membership');
  ok(membership.status === 'active', email + ' receives active workspace membership');
}

async function provisionClientUser() {
  valueOrThrow(await service.auth.admin.createUser({
    id: clientId, email: clientEmail, password: testPassword, email_confirm: true,
    user_metadata: { full_name: 'Runtime Client' },
  }), 'create client auth user');

  const profile = valueOrThrow(await service.from('profiles').select('id,role,status').eq('id', clientId).single(), 'load client profile');
  ok(profile.role === 'client', 'unlisted Auth user is provisioned as client');

  const membership = valueOrThrow(await service.from('workspace_members').select('workspace_id,role,status').eq('user_id', clientId).single(), 'load client membership');
  ok(membership.role === 'client' && membership.status === 'active', 'client receives tenant membership');
}

async function signIn(email) {
  const client = anonymousClient();
  valueOrThrow(await client.auth.signInWithPassword({ email, password: testPassword }), 'sign in ' + email);
  return client;
}

async function subscribeTaskInsert(employee) {
  const channel = employee.channel('runtime-task-' + runId);
  let resolveInsert;
  let rejectInsert;
  const insertPromise = new Promise((resolve, reject) => {
    resolveInsert = resolve;
    rejectInsert = reject;
  });
  const timer = setTimeout(() => rejectInsert(new Error('Employee did not receive task INSERT over Realtime')), 10000);

  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, (payload) => {
    if (payload.new && payload.new.assigned_to === employeeId && payload.new.title === 'Realtime certification ' + runId) {
      clearTimeout(timer);
      resolveInsert(payload);
    }
  });

  await new Promise((resolve, reject) => {
    const subscribeTimer = setTimeout(() => reject(new Error('Realtime subscription timeout')), 10000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(subscribeTimer);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(subscribeTimer);
        reject(new Error('Realtime subscription failed: ' + status));
      }
    });
  });

  return { channel, insertPromise };
}

async function main() {
  await provisionTeamUser(adminId, adminEmail, 'Runtime Admin', 'admin');
  await provisionTeamUser(employeeId, employeeEmail, 'Runtime Team', 'employee');
  await provisionClientUser();

  const admin = await signIn(adminEmail);
  const employee = await signIn(employeeEmail);
  const client = await signIn(clientEmail);

  const realtime = await subscribeTaskInsert(employee);
  const task = valueOrThrow(await admin.from('tasks').insert({
    title: 'Realtime certification ' + runId,
    description: 'Admin-created task expected on Team Realtime.',
    assigned_to: employeeId,
    created_by: adminId,
    status: 'To Do',
    priority: 'High',
    visibility: 'team',
    sort_order: 100,
    task_type: 'runtime-certification',
  }).select().single(), 'admin creates task');

  const realtimePayload = await realtime.insertPromise;
  ok(realtimePayload.new.id === task.id, 'assigned employee receives admin-created task through Realtime');
  await employee.removeChannel(realtime.channel);

  const visibleTask = valueOrThrow(await employee.from('tasks').select('id,assigned_to').eq('id', task.id).single(), 'employee reads assigned task');
  ok(visibleTask.assigned_to === employeeId, 'task RLS exposes assigned task to employee');

  const comment = valueOrThrow(await employee.from('task_comments').insert({
    task_id: task.id, user_id: employeeId, comment: '@Runtime Admin certification mention',
  }).select().single(), 'employee creates task comment');

  valueOrThrow(await employee.from('task_mentions').insert({
    task_id: task.id,
    comment_id: comment.id,
    mentioned_profile_id: adminId,
    mentioned_by: employeeId,
  }).select().single(), 'employee creates task mention');

  const mentionNotification = valueOrThrow(await admin.from('notifications')
    .select('id,type,recipient_id').eq('recipient_id', adminId).eq('type', 'task_mention')
    .order('created_at', { ascending: false }).limit(1).single(), 'admin receives task mention notification');
  ok(mentionNotification.recipient_id === adminId, 'task mention creates recipient-scoped notification');

  const logicalFileId = crypto.randomUUID();
  const storagePath = task.id + '/' + employeeId + '/' + logicalFileId + '/v1-runtime.txt';
  valueOrThrow(await employee.storage.from('task-files').upload(
    storagePath,
    new Blob(['runtime task file ' + runId], { type: 'text/plain' }),
    { upsert: false, contentType: 'text/plain' },
  ), 'upload task file');

  const attachment = valueOrThrow(await employee.from('task_attachments').insert({
    task_id: task.id,
    logical_file_id: logicalFileId,
    version_number: 1,
    file_name: 'runtime.txt',
    storage_path: storagePath,
    mime_type: 'text/plain',
    file_size: 32,
    uploaded_by: employeeId,
  }).select().single(), 'register task file version');
  ok(attachment.version_number === 1, 'task file version is registered');

  const downloaded = valueOrThrow(await employee.storage.from('task-files').download(storagePath), 'download task file');
  ok((await downloaded.text()).includes(runId), 'task member can download task file');

  const conversationId = valueOrThrow(await admin.rpc('phase6_create_direct_conversation', {
    p_other_user_id: employeeId,
  }), 'create direct conversation');

  const messageId = crypto.randomUUID();
  valueOrThrow(await admin.rpc('phase6_send_message', {
    p_message_id: messageId,
    p_conversation_id: conversationId,
    p_body: 'Runtime message ' + runId,
    p_parent_message_id: null,
    p_attachments: [],
    p_mentioned_user_ids: [],
  }), 'send runtime message');

  const employeeMessage = valueOrThrow(await employee.from('messages').select('id,conversation_id').eq('id', messageId).single(), 'employee receives message');
  ok(employeeMessage.conversation_id === conversationId, 'message is visible to conversation member');

  const readAt = new Date().toISOString();
  valueOrThrow(await employee.from('conversation_members').update({ last_read_at: readAt })
    .eq('conversation_id', conversationId).eq('user_id', employeeId).select('last_read_at').single(), 'update read receipt');
  const readReceipt = valueOrThrow(await admin.from('conversation_members').select('last_read_at')
    .eq('conversation_id', conversationId).eq('user_id', employeeId).single(), 'verify read receipt');
  ok(new Date(readReceipt.last_read_at).getTime() >= new Date(readAt).getTime() - 1000, 'message read state persists');

  const attendance = valueOrThrow(await employee.rpc('attendance_clock_in', { p_note: 'Runtime certification' }), 'clock in employee');
  valueOrThrow(await employee.rpc('attendance_record_heartbeat', { p_client_kind: 'desktop_web' }), 'record initial heartbeat');
  valueOrThrow(await service.from('attendance_sessions').update({
    verified_seconds: 17,
    last_app_heartbeat_at: new Date(Date.now() - 120000).toISOString(),
  }).eq('id', attendance.id), 'simulate app-closed heartbeat gap');
  const staleHeartbeat = valueOrThrow(await employee.rpc('attendance_record_heartbeat', { p_client_kind: 'desktop_web' }), 'record stale-gap heartbeat');
  ok(Number(staleHeartbeat.verified_seconds) === 17, 'heartbeat gap over 90s earns zero attendance time');
  valueOrThrow(await employee.rpc('attendance_clock_out', { p_note: 'Runtime certification complete' }), 'clock out employee');

  const now = new Date().toISOString();
  const project = valueOrThrow(await admin.from('projects').insert({
    client_profile_id: clientId,
    client_name: 'Runtime Client',
    client_email: clientEmail,
    project_title: 'Runtime Project ' + runId,
    service_type: 'Print Formatting',
    assigned_to: employeeId,
    project_manager: adminId,
    created_by: adminId,
    project_status: 'active',
    workflow_stage_key: 'files_received',
    workflow_stage_status_key: 'pending',
    workflow_waiting_on_key: 'none',
    workflow_version: 0,
    requires_print: true,
    requires_ebook: false,
    service_capability_status: 'confirmed',
    capabilities_resolved_by: adminId,
    capabilities_resolved_at: now,
    production_seconds_total: 0,
    client_wait_seconds_total: 0,
    revision_count: 0,
    stage_started_at: null,
    stage_due_at: null,
    stage_completed_at: null,
    final_due_at: null,
    delivered_at: null,
    status: 'New',
    current_stage: 'Files Received',
    stage_status: 'PENDING',
    waiting_on: 'None',
    timeline_status: 'Paused',
    progress_percentage: 0,
    client_action_required: '',
    production_days_used: 0,
    production_time_used: 0,
    client_wait_time: 0,
    workflow_template_key: 'book-formatting',
  }).select('id,project_number,workspace_id,workflow_version,workflow_stage_key,workflow_stage_status_key').single(), 'create templated project');
  ok(Boolean(project.workspace_id), 'new project is automatically workspace-scoped');

  const seededTasks = valueOrThrow(await admin.from('tasks').select('id,template_key,workflow_stage_key')
    .eq('project_id', project.id).eq('template_key', 'book-formatting'), 'load template tasks');
  ok(seededTasks.length >= 6, 'project template seeds reusable default tasks atomically');

  let workflow = project;
  valueOrThrow(await admin.rpc('workflow_advance_stage', {
    p_project_id: project.id,
    p_expected_workflow_version: workflow.workflow_version,
    p_idempotency_key: crypto.randomUUID(),
    p_note: 'Start files stage',
  }), 'start files stage');
  workflow = valueOrThrow(await admin.from('projects').select('workflow_version,workflow_stage_key,workflow_stage_status_key,workflow_waiting_on_key')
    .eq('id', project.id).single(), 'reload files stage');
  ok(workflow.workflow_stage_key === 'files_received' && workflow.workflow_stage_status_key === 'active', 'files stage becomes active');

  valueOrThrow(await admin.rpc('workflow_advance_stage', {
    p_project_id: project.id,
    p_expected_workflow_version: workflow.workflow_version,
    p_idempotency_key: crypto.randomUUID(),
    p_note: 'Advance to design',
  }), 'advance to design');
  workflow = valueOrThrow(await admin.from('projects').select('workflow_version,workflow_stage_key,workflow_stage_status_key,workflow_waiting_on_key')
    .eq('id', project.id).single(), 'reload design stage');
  ok(workflow.workflow_stage_key === 'design_concept' && workflow.workflow_stage_status_key === 'active', 'design concept enters production');

  valueOrThrow(await admin.rpc('workflow_submit_stage_for_approval', {
    p_project_id: project.id,
    p_expected_workflow_version: workflow.workflow_version,
    p_idempotency_key: crypto.randomUUID(),
    p_note: 'Submit concept to client',
  }), 'submit concept for client approval');
  workflow = valueOrThrow(await admin.from('projects').select('workflow_version,workflow_stage_key,workflow_stage_status_key,workflow_waiting_on_key')
    .eq('id', project.id).single(), 'reload approval stage');
  ok(workflow.workflow_stage_key === 'concept_approval' && workflow.workflow_stage_status_key === 'awaiting_client', 'project reaches client approval gate');

  valueOrThrow(await client.rpc('workflow_client_approve_stage', {
    p_project_id: project.id,
    p_expected_workflow_version: workflow.workflow_version,
    p_idempotency_key: crypto.randomUUID(),
    p_note: 'Approved by runtime client',
  }), 'client approves stage');
  workflow = valueOrThrow(await client.from('projects').select('workflow_version,workflow_stage_key,workflow_stage_status_key')
    .eq('id', project.id).single(), 'verify client-approved workflow');
  ok(workflow.workflow_stage_key === 'print_version' && workflow.workflow_stage_status_key === 'active', 'client approval advances canonical workflow');

  const invoiceItems = [{
    project_id: project.id,
    project_number: project.project_number,
    description: 'Runtime project',
    amount: 100,
  }];
  const invoiceOneRows = valueOrThrow(await admin.rpc('invoice_save_version', {
    p_invoice_id: null,
    p_invoice_number: 'CI-' + runId,
    p_client_name: 'Runtime Client',
    p_client_email: clientEmail,
    p_month: new Date().getUTCMonth() + 1,
    p_year: new Date().getUTCFullYear(),
    p_month_label: 'Runtime',
    p_due_date: new Date(Date.now() + 604800000).toISOString().slice(0, 10),
    p_items: invoiceItems,
    p_subtotal: 100,
    p_total_paid: 0,
    p_total_due: 100,
    p_notes: 'Runtime invoice',
    p_status: 'Draft',
    p_change_note: 'Initial version',
  }), 'create invoice v1');
  const invoiceOne = invoiceOneRows[0];
  ok(invoiceOne.version_number === 1, 'invoice starts at version 1');

  const invoiceTwoRows = valueOrThrow(await admin.rpc('invoice_save_version', {
    p_invoice_id: invoiceOne.invoice_id,
    p_invoice_number: 'CI-' + runId,
    p_client_name: 'Runtime Client',
    p_client_email: clientEmail,
    p_month: new Date().getUTCMonth() + 1,
    p_year: new Date().getUTCFullYear(),
    p_month_label: 'Runtime',
    p_due_date: new Date(Date.now() + 604800000).toISOString().slice(0, 10),
    p_items: invoiceItems,
    p_subtotal: 100,
    p_total_paid: 25,
    p_total_due: 75,
    p_notes: 'Runtime invoice revised',
    p_status: 'Sent',
    p_change_note: 'Recorded partial payment',
  }), 'create invoice v2');
  ok(invoiceTwoRows[0].version_number === 2, 'invoice revision creates immutable version 2');

  const invoiceVersions = valueOrThrow(await admin.from('invoice_versions').select('id,version_number')
    .eq('invoice_id', invoiceOne.invoice_id).order('version_number'), 'verify invoice history');
  ok(invoiceVersions.length === 2, 'invoice history preserves both revisions');

  valueOrThrow(await admin.from('ai_operator_events').insert({
    user_id: adminId,
    event_type: 'action_confirmed',
    tool_name: 'createTask',
    success: true,
    requires_confirmation: true,
    verification_status: 'verified',
    plan_step_count: 1,
    latency_ms: 1,
    metadata: { source: 'runtime-certification', task_id: task.id },
  }), 'record AI confirmation telemetry');

  const aiVerification = valueOrThrow(await admin.from('ai_operator_events').select('requires_confirmation,verification_status')
    .eq('user_id', adminId).eq('tool_name', 'createTask').order('created_at', { ascending: false }).limit(1).single(), 'verify AI telemetry');
  ok(aiVerification.requires_confirmation && aiVerification.verification_status === 'verified', 'AI confirmed mutation telemetry is verified');

  const tenantEvent = valueOrThrow(await admin.from('workspace_events').select('event_type,aggregate_id')
    .eq('aggregate_id', project.id).order('created_at', { ascending: false }).limit(1).single(), 'verify workspace event outbox');
  ok(tenantEvent.event_type.startsWith('projects.'), 'project mutation emits tenant-scoped integration event');

  console.log('Runtime integration certification PASS');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
