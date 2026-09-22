import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const tracker = fs.readFileSync('src/lib/useTracker.ts', 'utf8');
const chat = fs.readFileSync('src/components/ProjectDiscussionChat.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260920000400_fix_project_window_client_messaging.sql', 'utf8');
const deliveryMigration = fs.readFileSync('supabase/migrations/20260922000100_harden_client_message_delivery.sql', 'utf8');
const deliveryCleanupMigration = fs.readFileSync('supabase/migrations/20260922000200_reuse_project_conversation_delivery_guard.sql', 'utf8');

console.log('--- Project Window Client Messaging Regression Tests ---');

assert(
  migration.includes('phase6_get_or_create_project_conversation') &&
    migration.includes('phase6_team_can_access_project') &&
    migration.includes('phase6_client_can_access_project') &&
    migration.includes('No active client portal account is linked to this project'),
  'project discussions use a role-checked server RPC and reject client messages with no real recipient',
);

assert(
  migration.includes('phase6_link_project_client_by_email') &&
    migration.includes("p.role::text = 'client'") &&
    migration.includes("p.status = 'active'") &&
    migration.includes('having count(*) = 1'),
  'missing project-client access is repaired only for one exact active client email match',
);

assert(
  migration.includes('phase6_projects_sync_client_access') &&
    migration.includes('after insert or update of client_email on public.projects'),
  'new or edited projects automatically link a unique matching active portal client',
);

assert(
  migration.includes("c.type = 'project_client'") &&
    migration.includes('insert into public.conversation_members(conversation_id, user_id)') &&
    migration.includes('join public.client_project_access a on a.project_id = c.project_id'),
  'project-client conversations include linked clients as members for unread/read tracking',
);

assert(
  tracker.includes("supabase.rpc(") &&
    tracker.includes("'phase6_get_or_create_project_conversation'") &&
    tracker.includes('p_project_id: projectId') &&
    tracker.includes('p_is_internal: isInternal') &&
    !tracker.includes(".insert({ type, project_id: projectId, created_by: currentProfile.id })\n          .select()"),
  'frontend no longer relies on INSERT RETURNING for new project conversations under RLS',
);

const projectConversationBlock = tracker.slice(
  tracker.indexOf('const getOrCreateProjectConversation'),
  tracker.indexOf('const getOrCreateTaskConversation'),
);
const projectRpcIndex = projectConversationBlock.indexOf("'phase6_get_or_create_project_conversation'");
const cachedFallbackIndex = projectConversationBlock.indexOf('if (existing) return existing;');
assert(
  projectRpcIndex >= 0 && cachedFallbackIndex > projectRpcIndex,
  'cached project conversations are revalidated through the server RPC before reuse in Supabase mode',
);

assert(
  deliveryMigration.includes('phase6_project_client_has_active_recipient') &&
    deliveryMigration.includes("c.type = 'project_client'") &&
    deliveryMigration.includes('No active client portal recipient is linked to this project conversation') &&
    deliveryMigration.includes('create or replace function public.phase6_send_message'),
  'message delivery itself blocks client-facing sends when no active linked portal recipient exists',
);

assert(
  deliveryCleanupMigration.includes('phase6_get_or_create_project_conversation(v_project_id, false)') &&
    deliveryCleanupMigration.includes('v_validated_conversation_id is distinct from p_conversation_id') &&
    deliveryCleanupMigration.includes('drop function if exists public.phase6_project_client_has_active_recipient(uuid)'),
  'send-time validation reuses the hardened project RPC and removes the temporary exposed recipient helper',
);

const awaitSend = chat.indexOf('await onSendMessage(targetConv.id, text);');
const clearDraft = chat.indexOf("setInputMsg('');", awaitSend);
assert(
  awaitSend >= 0 &&
    clearDraft > awaitSend &&
    chat.includes('const [chatError, setChatError]') &&
    chat.includes('Failed to send —') &&
    chat.includes('Connecting...'),
  'project chat preserves drafts until send succeeds and visibly reports connection/send failures',
);

if (process.exitCode) {
  console.error('Project window client messaging regression checks failed.');
} else {
  console.log('ALL PROJECT WINDOW CLIENT MESSAGING CHECKS PASSED.');
}
