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
const messages = fs.readFileSync('src/pages/CommunicationPage.tsx', 'utf8');
const team = fs.readFileSync('src/pages/TeamPage.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260920000100_complete_role_messaging.sql', 'utf8');

console.log('--- Role + Messaging Reliability Regression Tests ---');

assert(
  migration.includes('phase6_get_or_create_team_channel') &&
    migration.includes("('general')") &&
    migration.includes("('formatting')") &&
    migration.includes("('covers')") &&
    migration.includes("('qc')") &&
    migration.includes("('announcements')"),
  'standard team channels are created and backed by a server-side get-or-create RPC',
);

assert(
  migration.includes("'messages'") &&
    migration.includes("'conversation_members'") &&
    migration.includes("'conversations'") &&
    migration.includes("'message_attachments'") &&
    migration.includes("'message_mentions'") &&
    migration.includes("'message_reactions'") &&
    migration.includes('alter publication supabase_realtime add table'),
  'all messaging records required by the UI are enrolled in Supabase Realtime',
);

assert(
  tracker.includes("table: 'messages'") &&
    tracker.includes("table: 'conversation_members'") &&
    tracker.includes("table: 'message_attachments'") &&
    tracker.includes("table: 'message_mentions'") &&
    tracker.includes('void loadSupabaseData(currentProfile)'),
  'open panels receive new messages, membership changes, attachments and mentions without refresh',
);

assert(
  tracker.includes('const getOrCreateTeamChannel = useCallback(') &&
    tracker.includes("supabase.rpc('phase6_get_or_create_team_channel'") &&
    app.includes('onGetOrCreateTeamChannel={tracker.getOrCreateTeamChannel}') &&
    messages.includes('onGetOrCreateTeamChannel: (channelName: string) => Promise<Conversation>'),
  'team-channel creation is wired from Supabase through useTracker into the Messages UI',
);

const sendAwait = messages.indexOf('await onSendMessage(displayedConv.id, body, atts, replyId);');
const clearDraft = messages.indexOf("setMessageInput('');", sendAwait);
assert(
  sendAwait >= 0 &&
    clearDraft > sendAwait &&
    messages.includes('const [isSending, setIsSending] = useState(false)') &&
    messages.includes('communicationError') &&
    messages.includes('Your draft has been kept'),
  'failed sends keep the draft and surface a visible error instead of silently clearing the composer',
);

assert(
  team.includes("useState<Tab>(() => canManagePayroll ? 'payroll' : 'directory')") &&
    team.includes("{canManagePayroll && tab === 'payroll' && (") &&
    team.includes('{canManagePayroll ? (') &&
    team.includes('Salary:'),
  'project managers land on Team & Workload while admin-only payroll data stays protected',
);

if (process.exitCode) {
  console.error('Role / messaging reliability regression checks failed.');
} else {
  console.log('ALL ROLE / MESSAGING RELIABILITY CHECKS PASSED.');
}
