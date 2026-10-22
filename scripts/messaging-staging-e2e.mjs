/**
 * MH Tracker Messaging — isolated staging-only multi-user integration test.
 *
 * This is an authenticated backend/WebSocket/Storage test, NOT a browser UI E2E.
 * It intentionally creates messages and a file in an isolated QA project.
 *
 * Required secrets:
 *   MH_STAGE_SUPABASE_URL, MH_STAGE_SUPABASE_ANON_KEY, MH_STAGE_SUPABASE_REF,
 *   MH_STAGE_QA_PROJECT_ID, MH_STAGE_ADMIN_EMAIL/PASSWORD,
 *   MH_STAGE_EMPLOYEE_EMAIL/PASSWORD, MH_STAGE_CLIENT_EMAIL/PASSWORD
 *
 * Write gate: MH_STAGE_WRITES_ACK=I_CONFIRM_ISOLATED_STAGING
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PROD_REFS = new Set([
  'emhvwdhdmajpakoscuyn', // MH Tracker
  'weomrqzammqldszitgcf', // Tahir-Tracker
  'atazylptnaonohucldfg', // inactive historical project
]);
const RUN_ID = randomUUID().slice(0, 12);
const TEST_LABEL = '[MH-MESSAGING-QA]';
const completed = [];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Missing isolated-staging configuration: ' + name);
  return value;
}

function config() {
  const url = new URL(required('MH_STAGE_SUPABASE_URL'));
  const ref = required('MH_STAGE_SUPABASE_REF');
  const projectId = required('MH_STAGE_QA_PROJECT_ID');

  assert.match(ref, /^[a-z0-9]{20}$/, 'Invalid isolated staging project ref');
  assert.equal(url.protocol, 'https:', 'Staging must use HTTPS');
  assert.equal(url.hostname, ref + '.supabase.co', 'URL must match the staging project ref');
  assert.equal(url.pathname, '/', 'Use the project API root URL');
  assert.ok(!PROD_REFS.has(ref), 'Refusing to write to a known production/historical project');
  assert.match(projectId, /^[0-9a-f-]{36}$/i, 'A dedicated staging project UUID is required');
  assert.equal(
    required('MH_STAGE_WRITES_ACK'),
    'I_CONFIRM_ISOLATED_STAGING',
    'The isolated staging write acknowledgement is required',
  );

  return {
    url: url.origin,
    key: required('MH_STAGE_SUPABASE_ANON_KEY'),
    projectId,
    creds: {
      admin: [required('MH_STAGE_ADMIN_EMAIL'), required('MH_STAGE_ADMIN_PASSWORD')],
      employee: [required('MH_STAGE_EMPLOYEE_EMAIL'), required('MH_STAGE_EMPLOYEE_PASSWORD')],
      client: [required('MH_STAGE_CLIENT_EMAIL'), required('MH_STAGE_CLIENT_PASSWORD')],
    },
  };
}

function makeClient(cfg) {
  return createClient(cfg.url, cfg.key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
}

function unwrap(result, action) {
  if (result.error) throw new Error(action + ': ' + result.error.message);
  return result.data;
}

async function signIn(cfg, role) {
  const api = makeClient(cfg);
  const [email, password] = cfg.creds[role];
  const session = unwrap(await api.auth.signInWithPassword({ email, password }), role + ' sign-in');
  assert.ok(session.user?.id, role + ' missing user ID');
  const profile = unwrap(
    await api.from('profiles').select('id,role,status').eq('id', session.user.id).single(),
    role + ' profile',
  );
  assert.equal(profile.status, 'active');
  assert.equal(profile.role, role);
  completed.push(role + ' authentication');
  return { api, id: profile.id };
}

function makeText(action) {
  return TEST_LABEL + ' ' + action + ' ' + RUN_ID + ' ' + randomUUID().slice(0, 8);
}

async function send(user, conversationId, body, attachments = []) {
  const id = randomUUID();
  unwrap(await user.api.rpc('phase6_send_message', {
    p_message_id: id,
    p_conversation_id: conversationId,
    p_body: body,
    p_parent_message_id: null,
    p_attachments: attachments,
    p_mentioned_user_ids: [],
  }), 'send message');
  return id;
}

async function realtimeDelivery(receiver, conversationId, id, sendAction) {
  const channel = receiver.api.channel('mh-qa-' + randomUUID());
  let resolveEvent, rejectEvent;
  const delivery = new Promise((resolve, reject) => {
    resolveEvent = resolve;
    rejectEvent = reject;
  });
  // Always attach a handler so a failed send cannot produce an unhandled timeout.
  void delivery.catch(() => {});
  let subscribed = false;
  let timer;
  channel.on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
    filter: 'conversation_id=eq.' + conversationId,
  }, payload => {
    if (payload.new?.id === id) resolveEvent(payload.new);
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Realtime subscribe timed out')), 15000);
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          subscribed = true;
          clearTimeout(timeout);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timeout);
          reject(new Error('Realtime subscription failed: ' + status));
        }
      });
    });
    assert.ok(subscribed);
    timer = setTimeout(() => rejectEvent(new Error('Realtime INSERT was not delivered')), 18000);
    await sendAction();
    await delivery;
  } finally {
    clearTimeout(timer);
    await receiver.api.removeChannel(channel);
  }
}

async function visible(user, table, column, id) {
  const rows = unwrap(await user.api.from(table).select('id').eq(column, id), 'read ' + table);
  return rows.length;
}

async function main() {
  // Check every write-prevention condition before connecting or authenticating.
  const cfg = config();
  const admin = await signIn(cfg, 'admin');
  const employee = await signIn(cfg, 'employee');
  const client = await signIn(cfg, 'client');
  assert.equal(new Set([admin.id, employee.id, client.id]).size, 3, 'Test identities must differ');

  const project = unwrap(
    await admin.api.from('projects')
      .select('id,project_title,assigned_to,client_profile_id')
      .eq('id', cfg.projectId).single(),
    'QA project lookup',
  );
  assert.ok(project.project_title?.startsWith(TEST_LABEL),
    'Refusing to message a project without the dedicated QA title prefix');
  assert.equal(project.assigned_to, employee.id, 'QA project must be assigned to Employee');
  if (project.client_profile_id !== client.id) {
    const links = unwrap(
      await admin.api.from('client_project_access')
        .select('id').eq('project_id', cfg.projectId).eq('client_id', client.id),
      'QA client access link',
    );
    assert.ok(links.length > 0, 'QA project must be explicitly linked to Client');
  }
  completed.push('isolated QA project and recipient preflight');

  // Direct message: client must neither create nor read the staff DM.
  const dm = unwrap(
    await admin.api.rpc('phase6_create_direct_conversation', { p_other_user_id: employee.id }),
    'Admin to Employee DM',
  );
  const forbiddenDM = await client.api.rpc('phase6_create_direct_conversation', {
    p_other_user_id: employee.id,
  });
  assert.ok(forbiddenDM.error, 'Client must be denied direct-message creation');
  assert.equal(await visible(client, 'conversations', 'id', dm), 0,
    'Client must not see staff DM');
  const directId = randomUUID();
  await realtimeDelivery(employee, dm, directId, async () => {
    unwrap(await admin.api.rpc('phase6_send_message', {
      p_message_id: directId, p_conversation_id: dm, p_body: makeText('admin-dm'),
      p_parent_message_id: null, p_attachments: [], p_mentioned_user_ids: [],
    }), 'DM send');
  });
  assert.equal(await visible(employee, 'messages', 'id', directId), 1);
  assert.equal(await visible(client, 'messages', 'id', directId), 0);
  const directRow = unwrap(
    await employee.api.from('messages').select('created_at').eq('id', directId).single(),
    'DM read timestamp',
  );
  const receipt = unwrap(await employee.api.from('conversation_members').upsert({
    conversation_id: dm, user_id: employee.id,
    last_read_at: new Date(Date.now() + 2000).toISOString(),
  }, { onConflict: 'conversation_id,user_id' }).select('last_read_at').single(), 'DM read receipt');
  assert.ok(new Date(receipt.last_read_at) >= new Date(directRow.created_at));
  completed.push('DM realtime, unread-to-read receipt, and Client isolation');

  // Project internal: employee receives the assigned project's messages,
  // and the linked client is still denied internal conversation/messages.
  const internal = unwrap(
    await admin.api.rpc('phase6_get_or_create_project_conversation', {
      p_project_id: cfg.projectId, p_is_internal: true,
    }), 'internal project chat',
  );
  assert.equal(await visible(client, 'conversations', 'id', internal), 0);
  const internalId = randomUUID();
  await realtimeDelivery(employee, internal, internalId, async () => {
    unwrap(await admin.api.rpc('phase6_send_message', {
      p_message_id: internalId, p_conversation_id: internal,
      p_body: makeText('internal'), p_parent_message_id: null,
      p_attachments: [], p_mentioned_user_ids: [],
    }), 'internal message send');
  });
  assert.equal(await visible(client, 'messages', 'id', internalId), 0);
  completed.push('Internal project realtime and Client invisibility');

  // Project-client conversation: both participants must receive replies live.
  const clientConversation = unwrap(
    await admin.api.rpc('phase6_get_or_create_project_conversation', {
      p_project_id: cfg.projectId, p_is_internal: false,
    }), 'client project chat',
  );
  assert.notEqual(clientConversation, internal, 'Project internal/client rooms must differ');
  assert.equal(await visible(client, 'conversations', 'id', clientConversation), 1);
  const firstId = randomUUID();
  await realtimeDelivery(client, clientConversation, firstId, async () => {
    unwrap(await admin.api.rpc('phase6_send_message', {
      p_message_id: firstId, p_conversation_id: clientConversation,
      p_body: makeText('admin-to-client'), p_parent_message_id: null,
      p_attachments: [], p_mentioned_user_ids: [],
    }), 'Admin to Client');
  });
  const secondId = randomUUID();
  await realtimeDelivery(admin, clientConversation, secondId, async () => {
    unwrap(await client.api.rpc('phase6_send_message', {
      p_message_id: secondId, p_conversation_id: clientConversation,
      p_body: makeText('client-to-admin'), p_parent_message_id: null,
      p_attachments: [], p_mentioned_user_ids: [],
    }), 'Client to Admin');
  });
  completed.push('bidirectional Admin/Client project realtime');

  // Private Storage / signed downloads. Test a staff-only DM object so
  // Client is an actual outsider for the Storage denial assertion.
  const fileName = 'mh-messaging-qa-' + RUN_ID + '.pdf';
  const path = dm + '/' + admin.id + '/' + randomUUID() + '-' + fileName;
  const contents = Buffer.from('%PDF-1.4\n% MH Tracker staged QA\n%%EOF\n');
  unwrap(await admin.api.storage.from('message-files').upload(path, contents, {
    contentType: 'application/pdf', upsert: false,
  }), 'private Storage upload');
  const attachmentId = randomUUID();
  const fileMessage = await send(admin, dm, makeText('file'), [{
    id: attachmentId, file_name: fileName, file_type: 'pdf',
    file_size: contents.length, file_url: '', storage_path: path,
  }]);
  const metadata = unwrap(await employee.api.from('message_attachments')
    .select('id,storage_path,message_id').eq('id', attachmentId).single(),
  'persisted attachment metadata');
  assert.equal(metadata.message_id, fileMessage);
  assert.equal(metadata.storage_path, path);
  const signed = unwrap(
    await employee.api.storage.from('message-files').createSignedUrl(path, 90),
    'authorized signed URL',
  );
  assert.ok(signed?.signedUrl, 'Authorized user needs signed download URL');
  const download = await fetch(signed.signedUrl);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), contents);
  const forbiddenFile = await client.api.storage.from('message-files').createSignedUrl(path, 90);
  assert.ok(forbiddenFile.error, 'Client must not sign a staff DM attachment URL');
  completed.push('private upload, persisted attachment, signed download and access denial');

  for (const user of [client, employee, admin]) {
    await user.api.auth.signOut({ scope: 'local' });
  }
  console.log('PASS: all ' + completed.length + ' isolated staging messaging scenarios');
  completed.forEach(x => console.log(' ✓ ' + x));
  console.log('Staging artifacts intentionally retained in the dedicated QA project for evidence.');
}

main().catch(error => {
  console.error('FAIL: isolated staging messaging certification:', error.message);
  console.error('Completed checks:', completed.join('; ') || 'none');
  process.exitCode = 1;
});
