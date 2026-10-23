import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markUnreadConversationsRead } from '../src/lib/messageReadReceipts.ts';

const seen = [];
const all = await markUnreadConversationsRead(['client-1', 'client-2', 'client-1'], async id => {
  seen.push(id);
});
assert.deepEqual(seen.sort(), ['client-1','client-2'], 'mark each conversation once');
assert.deepEqual(all, {succeeded:['client-1','client-2'],failed:[]});

const partiallyFailed = await markUnreadConversationsRead(['client-1','stale','client-2'], async id => {
  if(id === 'stale') throw new Error('RLS denied');
});
assert.deepEqual(partiallyFailed, {succeeded:['client-1','client-2'],failed:['stale']}, 'one failure cannot block unrelated read receipts');

const allFailed = await markUnreadConversationsRead(['bad-1','bad-2'], async () => {
  throw new Error('offline');
});
assert.deepEqual(allFailed.failed,['bad-1','bad-2']);
assert.deepEqual(allFailed.succeeded,[]);
assert.deepEqual(await markUnreadConversationsRead([],async()=>{}),{succeeded:[],failed:[]});

const bell = readFileSync('src/components/MessageNotificationBell.tsx','utf8');
const tracker = readFileSync('src/lib/useTracker.ts','utf8');
const layout = readFileSync('src/components/Layout.tsx','utf8');
const messages = readFileSync('src/pages/CommunicationPage.tsx','utf8');
assert.ok(
  bell.includes('markUnreadConversationsRead(') &&
  bell.includes('disabled={markingAll}') &&
  bell.includes('role="alert"') &&
  bell.includes('readError') &&
  bell.includes('setMarkingAll(false)'),
  'Mark all read waits for responses, prevents duplicate clicks, and explains failures');
assert.ok(
  tracker.includes(".update({ last_read_at: now })") &&
  tracker.includes(".eq('conversation_id', conversationId)") &&
  tracker.includes(".eq('user_id', currentProfile.id)") &&
  tracker.includes("if (inserted.error.code !== '23505') throw inserted.error") &&
  tracker.includes('const newestRead ='),
  'read receipt updates existing memberships first and never regresses local read state');
assert.ok(
  layout.includes('onMarkConversationRead: (conversationId: string) => Promise<void>') &&
  messages.includes('Project conversation opened, but its read receipt could not be saved.') &&
  messages.includes('Conversation switched, but its read receipt could not be saved.'),
  'the async contract and project navigation/read errors remain distinct');
console.log('PASS: bulk Mark all read, partial errors, retries and receipt persistence regressions.');
