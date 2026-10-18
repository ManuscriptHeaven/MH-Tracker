// Static security regression guard only. Does NOT replace staging RLS/HTTP E2E tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const chat = read('supabase/functions/ai-chat/index.ts');
const rag = read('supabase/functions/ai-rag/index.ts');
const migration = read('supabase/migrations/20261019001000_ai_knowledge_base_admin_boundary.sql');
const bootstrap = read('supabase/ai-assistant-schema.sql');

assert.doesNotMatch(chat, /SUPABASE_SERVICE_ROLE_KEY/, 'AI chat must never use service-role access');
assert.match(chat, /SUPABASE_ANON_KEY/, 'AI chat uses a caller-scoped DB client');
assert.match(chat, /supabase\.auth\.getUser\(/, 'AI chat authenticates the bearer token');
assert.match(chat, /\.eq\('id', conversationId\)\.eq\('user_id', user\.id\)/, 'Caller conversation ownership is checked');
assert.match(chat, /Conversation not found/, 'Foreign conversation IDs fail closed');
assert.doesNotMatch(chat, /from\('ai_response_cache'\)/, 'Legacy unscoped AI cache cannot be queried');
assert.doesNotMatch(chat, /queryHash|cachedResponse/, 'Cross-user cache is absent');
assert.doesNotMatch(chat, /conversation_id: currentConversationId,\s*user_id:/, 'Message inserts match live schema');

assert.doesNotMatch(rag, /SUPABASE_SERVICE_ROLE_KEY/, 'RAG may not bypass user RLS');
assert.match(rag, /\.eq\('id', user\.id\)/, 'RAG checks the actual user profile');
assert.match(rag, /profile\?\.role !== 'admin'/, 'Unscoped knowledge search is admin-only');
assert.match(rag, /profile\?\.status !== 'active'/, 'Suspended users cannot search knowledge');

for (const name of ['knowledge_base_documents','knowledge_base_chunks']) {
  assert.match(migration, new RegExp('ALTER TABLE public\\.' + name + ' ENABLE ROW LEVEL SECURITY'));
  assert.match(migration, new RegExp('CREATE POLICY "AI knowledge (?:documents|chunks) admin only"\\s+ON public\\.' + name));
  assert.doesNotMatch(bootstrap.match(new RegExp('CREATE POLICY[^;]+ON ' + name + '[^;]+;', 'g'))?.join('\n') || '', /USING \(true\)/i);
}
assert.match(migration, /phase6_app_actor_class\(\)/, 'Authorization consults server-side Phase 6 role');
console.log('AI security static regression checks passed. Live staging authorization checks remain required.');
