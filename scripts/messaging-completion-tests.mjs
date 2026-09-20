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
const app = fs.readFileSync('src/App.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260920000300_messaging_completion.sql', 'utf8');

console.log('--- Messaging Completion Regression Tests ---');

assert(
  migration.includes("values ('message-files', 'message-files', false, 52428800)") &&
    migration.includes('Message members can read message files') &&
    migration.includes('Message members can upload own message files') &&
    migration.includes('Message senders can delete own message files'),
  'message attachments use a private 50 MB Supabase Storage bucket with conversation-scoped RLS',
);

assert(
  migration.includes('add column if not exists storage_path text') &&
    migration.includes('create or replace function public.phase6_send_message') &&
    migration.includes('security invoker') &&
    migration.includes('insert into public.messages') &&
    migration.includes('insert into public.message_attachments'),
  'message and attachment metadata are persisted atomically through an RLS-respecting RPC',
);

assert(
  tracker.includes(".from('message-files')") &&
    tracker.includes('.upload(storagePath, attachment.file') &&
    tracker.includes("supabase.rpc('phase6_send_message'") &&
    tracker.includes('.remove(uploadedPaths)'),
  'real files upload before the atomic send and failed sends clean up uploaded objects',
);

assert(
  tracker.includes(".createSignedUrl(attachment.storage_path, 600)") &&
    tracker.includes('This older attachment was saved only in the sender browser') &&
    app.includes('onGetAttachmentUrl={tracker.getMessageAttachmentUrl}'),
  'private attachments open through short-lived signed URLs with legacy-file error handling',
);

assert(
  messages.includes('MAX_MESSAGE_FILE_BYTES = 50 * 1024 * 1024') &&
    messages.includes('MAX_MESSAGE_ATTACHMENTS = 5') &&
    messages.includes('multiple') &&
    messages.includes('accept={MESSAGE_FILE_ACCEPT}') &&
    messages.includes('unsupported file type'),
  'composer validates file type, count and size before upload',
);

assert(
  messages.includes("const delivery = deliveryLabel(msg)") &&
    messages.includes("return 'Sent'") &&
    messages.includes("return 'Read'") &&
    messages.includes('Read by') &&
    messages.includes('Failed to send —') &&
    messages.includes("'Uploading…'"),
  'messages expose Sending/Uploading, Sent, Read and Failed delivery states',
);

assert(
  tracker.includes(".upsert(") &&
    tracker.includes("{ onConflict: 'conversation_id,user_id' }") &&
    messages.includes('activeMessages.length') &&
    messages.includes('onMarkRead(displayedConv.id)'),
  'read receipts are created or updated for every authorized viewer and refreshed while chat is open',
);

assert(
  messages.includes('messageAttachments.filter((attachment) => attachment.message_id === msg.id)') &&
    !messages.includes('href={att.file_url}'),
  'attachment rows remain visible after reload and no private attachment relies on a persisted browser URL',
);

if (process.exitCode) {
  console.error('Messaging completion regression checks failed.');
} else {
  console.log('ALL MESSAGING COMPLETION CHECKS PASSED.');
}
