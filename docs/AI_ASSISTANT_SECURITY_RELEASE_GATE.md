# AI Assistant — reliability and security release gate (2026-10-19)

## Scope of this branch

1. Add admin-only RLS on `knowledge_base_documents` and `knowledge_base_chunks`.
   There is no tenant/workspace identifier on these tables. **Do not** share
   pricing, SOPs, client documents, or embeddings with every authenticated user.
   A future multi-tenant release should introduce explicit ownership, resource
   classification, and tested role scopes before broadening access.
2. Update the **not-yet-deployed** `ai-chat` Edge Function to use a caller-scoped
   Supabase client and verify ownership of a provided `conversationId`.
   Remove the legacy global response cache and invalid `ai_messages.user_id` writes.
3. Update the **not-yet-deployed** `ai-rag` endpoint to require an active admin
   and query with the caller's JWT, not `service_role`.
4. Add CI static guards and a database policy-catalog test. Passing static tests
   **does not** certify browser behavior, RLS, or Edge Function deployment.

## Current deployed baseline

- Active project: `emhvwdhdmajpakoscuyn` (MH Tracker production).
- At review: `ai-planner` v7 is deployed. `ai-chat`, `ai-rag`,
  `ai-embed`, and `ai-daily-summary` are **not** listed as deployed.
- `match_knowledge_base_chunks` RPC is absent in production and knowledge-base
  tables are empty. This PR does not claim to enable document search.
- Current test suites are largely unit/static. Production AI action telemetry
  does not yet demonstrate verified end-to-end mutations.

## Before merge/deploy

**Database gate:** restore an approved, isolated staging database and verify its
actual project identity and migration ledger. **Do not test the migration directly
against production.** Apply `20261019001000_ai_knowledge_base_admin_boundary.sql`
to staging. Run `supabase/tests/database/ai_knowledge_base_admin_boundary.test.sql`.

**JWT/RLS integration test:** using real, disposable accounts and seeded staging
documents/chunks, assert:

| Caller | SELECT knowledge documents | SELECT chunks | INSERT/UPDATE/DELETE |
| --- | --- | --- | --- |
| Active admin | allowed | allowed | allowed |
| Manager | denied | denied | denied |
| Employee | denied | denied | denied |
| Client | denied | denied | denied |
| Suspended user | denied | denied | denied |
| Anonymous | denied | denied | denied |

Prove **no cross-account reads**, including direct REST queries. Test all protected
operations through the public API with real JWTs; a catalog-only check is not enough.

**Edge Function gate:** validate `ai-chat` and `ai-rag` transpilation and test:
- Missing/invalid Authorization: 401 and no data.
- Foreign/nonexistent `conversationId`: 404 and no history, cache, or writes.
- Owner conversation: streaming answer plus user/assistant messages saved under
  the owned conversation, with no `user_id` column on `ai_messages`.
- A second user giving identical text/context never receives another user's
  cached text or messages.
- Non-admin RAG request: 403 before generating embeddings.
- An admin RAG request is rejected safely until a correctly scoped vector-match
  RPC is migrated and separately reviewed.
- Repeated requests, interrupted streams, invalid bodies and model outages
  produce clear errors without cross-user output or unhandled background promises.

**Existing AI action gate:** for admin, manager, employee and client, use real
staging sessions to test task creation/assignment, invoice generation, payment
recording, stage submission and messaging. Assert DB state and recorded
verification status after each approved mutation; cancellations must not write.

## Production release

Only after staging results are recorded and reviewed:
1. Confirm the DB ledger/source migration parity.
2. Apply the RLS migration in a controlled production cutover.
3. Re-run RLS access tests and advisors.
4. Deploy Edge Functions **separately** only when the backend dependencies and
   runtime verification checks pass.
5. Review telemetry for permission failures, wrong recipients, missing records,
   and unverifiable operations.

Never revert the knowledge-base boundary to `USING (true)` as a quick rollback.
Fix authorization problems by supplying proper tenant and role policies instead.
