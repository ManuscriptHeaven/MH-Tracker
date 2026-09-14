# Phase 6 — Step 3D.2A Core Application Security Report

## 1. Scope

Step 3D.2A hardens the core application boundary for profiles, notifications, conversations, conversation membership/read state, messages and their collaboration children, tasks, revision notes, project notes, activity logs, and team-member provisioning. It adds the narrow directory and direct-message entry points required by the existing product.

Finance, payments, invoices, payroll, salary, employee dues, profitability, AI/RAG, knowledge-base behavior, workflow-engine redesign, frontend implementation, deployment, and production access remain outside this step.

## 2. Migration filename decision

The approved migration is `supabase/phase6/migrations/00450_phase6_core_application_security.sql`. It follows migrations 00100, 00200, 00300, and 00400. `00500_phase6_cutover_and_validation.sql` remains absent and reserved for final cutover/validation.

## 3. Files created/modified

Created:

- `supabase/phase6/migrations/00450_phase6_core_application_security.sql`
- `supabase/tests/database/phase6_core_security.test.sql`
- `scripts/phase6-core-security-static-tests.mjs`
- `docs/PHASE6_STEP3D2A_SECURITY_REPORT.md`

Updated only to recognize migration 00450 in the accepted Phase 6 inventory:

- `scripts/phase6-engine-static-tests.mjs`
- `scripts/phase6-security-static-tests.mjs`

Migrations 00100–00400 and all frontend files are unchanged.

## 4. Profiles security

Raw `profiles` rows are readable only by the active user for their own row and by an active Admin. Project Managers and Employees use the safe directory function described below. Clients cannot browse arbitrary staff profiles. Admin-only RLS controls profile insert, update of other users, and delete.

The signup trigger no longer trusts `raw_user_meta_data.role`. It uses an exact active `team_members.email` provisioning match when present; otherwise it creates an active Client profile without granting project access.

## 5. Safe directory model

`get_collaboration_directory()` returns only `id`, `full_name`, `role`, and `avatar_url` for active internal team profiles. It is callable only by authenticated active Admin, Project Manager/Manager, Employee, or Junior Assistant actors. It returns no client profiles, email, phone, status, timestamps, auth metadata, or employment/payroll fields and does not select `p.*`.

## 6. Self-profile update model

Authenticated column privileges expose `full_name`, `avatar_url`, and `phone` for self-service. The shared authenticated grant also includes `role` and `status` so an Admin can manage them, while RLS plus `phase6_guard_profile_update` prevents a non-Admin from changing `id`, `email`, `role`, `status`, or `created_at`. The trigger also prevents a user from using the self policy against another profile.

## 7. Notification read model

Authenticated users can select only rows with `recipient_id = auth.uid()`. The same recipient rule governs the existing delete behavior. Staff-only or workflow notifications are not visible merely because the caller is authenticated.

## 8. Notification update model

Only the existing `is_read` column has authenticated UPDATE privilege. The update policy requires the caller to be the recipient before and after the update. `read_at` does not exist and was not invented. Recipient, project, revision request, type, title, message, creation time, and other linkage fields cannot be changed through the authenticated ACL.

## 9. Notification creation model

Authenticated users receive no direct notification INSERT privilege. The workflow owner retains exactly SELECT and INSERT access required by migration 00400. Message mention rows invoke a trusted trigger owned by the new application-security owner, which inserts a generic mention notification after validating the associated message, conversation, sender, and target through the message/mention policies. Existing frontend direct workflow-notification and mention-notification inserts require cutover.

## 10. Conversation membership

Conversation authority is type-specific. `project_internal` always requires current team project eligibility; `project_client` always requires current team eligibility or exact current client-project access; and `task` always requires current task eligibility. A stored `conversation_members` row cannot override a later project-access revocation or task/project reassignment. Team-channel and DM access require explicit active membership. Unknown types fail closed. Email, name, `client_name`, and fuzzy identity matching are not authorization inputs.

## 11. Conversation creation/member management

Authenticated direct conversation creation is limited to eligible project-internal, project-client, and task conversations with `created_by = auth.uid()`. Direct DM creation is excluded. `phase6_create_direct_conversation(other_user_id)` atomically finds or creates an exact two-member internal-team DM and inserts both membership rows under the narrow owner. Before lookup, it constructs the same `least(actor, other):greatest(actor, other)` key for A→B and B→A, hashes it with `pg_catalog.hashtextextended`, and acquires `pg_catalog.pg_advisory_xact_lock`. The existing-DM lookup and conditional insert therefore run under one transaction-scoped unordered-pair lock.

Ordinary membership INSERT can add only the caller to a supported conversation while the caller is currently eligible. Ordinary membership DELETE is denied. UPDATE is limited to the caller's `last_read_at`; identity and conversation linkage columns have no UPDATE privilege. If scoped eligibility is later revoked, the retained row remains state only and no longer permits conversation access or receipt updates.

## 12. Message read/write model

Messages are selectable only through current conversation access. INSERT requires `sender_id = auth.uid()`, current conversation access, and any parent message to belong to the same conversation. Stale scoped membership cannot preserve message, attachment, mention, or reaction access. Authenticated UPDATE and DELETE are denied, so sender, conversation, body, and parent linkage cannot be rewritten after insertion.

Attachments and mentions are readable only through message access and insertable only by the message sender. Mention targets must have current type-specific eligibility; stale membership cannot make a revoked Client or Employee mentionable. The trusted notification trigger revalidates that target immediately before inserting the mention notification. Reactions are visible to current conversation participants; users may insert or delete only reactions whose `user_id` is their own.

## 13. Read receipts

The repository has no separate `message_reads` table. Read state is `conversation_members.last_read_at`. An authenticated user can update only that column on their own membership row and only while the conversation remains accessible. No user can write another member's receipt or alter membership identity/linkage through the receipt update.

## 14. Task security

Admin and Project Manager/Manager actors have management scope. Employee/Junior Assistant project eligibility is strictly `projects.assigned_to = auth.uid()` and never `projects.project_manager`; task access may additionally arise from task assignee or creator as already accepted. Clients receive no internal task policy. Insert requires the caller as creator, a valid team assignee, and project eligibility when linked. Employees may create only self-assigned tasks. Updates require existing and resulting access. `phase6_guard_task_update` prevents Employees from changing `assigned_to`, `project_id`, or `created_by`; direct task delete is denied.

Migration 00450 replaces the migration-00400 project metadata trigger function while preserving its early return for `phase6_workflow_rpc_owner`, Admin/PM-only `client_profile_id` changes, and ordinary `updated_at` stamping. It additionally rejects an Employee/Junior Assistant change to `projects.project_manager`. Admin and Project Manager actors retain management of that field.

## 15. Notes/comments/activity

`revision_notes` and `project_notes` require canonical team project access, bind `added_by` to `auth.uid()` on insert, and are append-only to authenticated users. `activity_logs` binds `user_id` to `auth.uid()`; project rows require team project access and global rows require Admin or Project Manager scope. Activity rows are append-only. The current repository models task discussion through task conversations/messages, so the conversation and task rules apply instead of a separate task-comments policy.

## 16. Client privacy

Clients cannot use the team directory, read internal tasks or notes, browse team profiles, or see internal project conversations. Client conversation access is limited to `project_client` conversations tied to a project currently authorized by `projects.client_profile_id` or an exact `client_project_access` row. Revocation takes effect immediately even if a membership row remains. No policy authorizes by email, name, or client display name.

## 17. New definer-owner design

The migration creates `phase6_app_security_owner` as `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS`. Neither `anon` nor `authenticated` is a member. Fourteen narrowly scoped SECURITY DEFINER functions are owned by it, use `pg_catalog, pg_temp`, derive the caller from `auth.uid()`, and have explicit dependency grants and execute revocations/grants. The workflow owner is not reused for application security.

## 18. ACL matrix

| Object | Authenticated ACL | Trusted owner ACL |
|---|---|---|
| `profiles` | SELECT; INSERT/DELETE subject to Admin RLS; UPDATE only named columns | app owner fixed SELECT/INSERT columns; workflow owner retains SELECT |
| `notifications` | SELECT/DELETE; UPDATE(`is_read`); no INSERT | workflow owner SELECT/INSERT; app owner INSERT |
| `conversations` | SELECT/INSERT; no UPDATE/DELETE | app owner SELECT/INSERT |
| `conversation_members` | SELECT/INSERT; UPDATE(`last_read_at`); no DELETE | app owner SELECT/INSERT |
| `messages`, attachments, mentions | SELECT/INSERT; no UPDATE/DELETE | app owner SELECT where required by helpers |
| `message_reactions` | SELECT/INSERT/DELETE; no UPDATE | none beyond narrow helper dependencies |
| `tasks` | SELECT/INSERT; explicit UPDATE columns; no DELETE | app owner SELECT |
| notes/activity | SELECT/INSERT; no UPDATE/DELETE | none |
| `team_members` | explicit CRUD ACL gated by Admin-only RLS | app owner SELECT for trusted provisioning |

No `GRANT ALL`, all-table grant, or schema-wide function EXECUTE is introduced.

## 19. RLS matrix

| Area | Read rule | Write rule |
|---|---|---|
| Profiles | self or Admin raw rows | self safe fields; Admin management |
| Notifications | recipient only | recipient read state/delete; trusted INSERT only |
| Conversations | current project/client/task eligibility for scoped types; membership for DM/team channel | eligible project/task creation; serialized DM RPC |
| Members/read state | current conversation authority; stale rows do not bypass scope | currently eligible self join; own `last_read_at` update |
| Messages/children | accessible conversation/message | caller-bound sender/author/target rules |
| Tasks | Admin/PM or employee task/project relationship | caller/assignee/project checks plus immutable employee linkage |
| Notes/activity | team project eligibility | caller-bound append only; Admin/PM for global activity |
| Team provisioning | Admin only | Admin only |

All thirteen owned tables have RLS enabled.

## 20. Removed permissive policies

The migration discovers and drops every historical policy on the thirteen in-scope tables, then recreates the complete explicit policy set. The replacement set contains no `USING (true)` or `WITH CHECK (true)`. This removes historical-name dependence and prevents an older broad authenticated policy from remaining permissive alongside the new rules.

## 21. JWT-role removal

No in-scope policy or new helper uses `auth.jwt()` application-role claims. Authorization uses `auth.uid()`, active `profiles`, normalized repository roles, and exact project/task/access relationships. EXECUTE is revoked from the legacy `is_client_user` and `find_login_email` helpers for `PUBLIC`, `anon`, and `authenticated`; name-based login therefore requires frontend cutover to email-only login or a separately approved safe mechanism.

## 22. SQL tests

`supabase/tests/database/phase6_core_security.test.sql` exists and is rollback-only. Catalog assertions cover owner attributes and grants, fixed SECURITY DEFINER search paths, profile ACL/policies and update guard, signup role handling, notification recipient/read-state restrictions, workflow owner preservation, type-aware conversation and mention-target rules, message/read-receipt delegation, assigned-to-only Employee project access, the `project_manager` guard, unordered-pair advisory locking, direct-DM denial, task linkage protection, notes/activity immutability, team-member Admin rules, RLS, unconditional-policy absence, and JWT-role absence. It creates no real Auth users or profiles.

Fixture-gated runtime scenarios are authored for client access revocation with retained membership, Employee project reassignment with retained membership, `project_manager` non-authority, Employee mutation denial, and Admin/PM field management. Without the disposable Auth settings they emit an explicit SKIP/UNEXECUTED notice. A real simultaneous A↔B test cannot be represented honestly in one transaction: **TWO-SESSION DM CONCURRENCY TEST REQUIRED IN STAGING.**

The SQL file was not executed because PostgreSQL tooling is unavailable locally.

## 23. Static tests

All source-level checks pass:

- `node scripts/phase6-engine-static-tests.mjs`: passed; 5 Phase 6 migrations, 54 helpers, 11 public mutation RPCs.
- `node scripts/phase6-security-static-tests.mjs`: passed; 5 Phase 6 migrations, 11 canonical RPC owners, unchanged 127-file frontend digest.
- `node scripts/phase6-core-security-static-tests.mjs`: passed; exact 00100–00450 order, 00500 absent, migrations 1–4 hash-pinned, type-aware current-scope conversation/target authorization, assigned-to-only Employee project authority, Employee `project_manager` mutation denial, mention revalidation, unordered-pair advisory locking before lookup, direct-DM table denial, 14 app-security definers, 13 in-scope tables, and unchanged frontend digest.

These are source assertions and do not constitute PostgreSQL execution.

## 24. Frontend cutover inventory

The inventory reviewed 47 relevant Supabase call sites: 46 direct in-scope table calls and one revoked login helper call. Thirty-one continue to work under the caller's eligible scope. Sixteen need cutover or cleanup:

| Current call/site | Classification | Required cutover |
|---|---|---|
| `src/lib/useTracker.ts:748` full profile directory SELECT | needs RPC | use `get_collaboration_directory()` for PM/Employee collaboration lists; Admin may retain raw full-directory access |
| `src/lib/useTracker.ts:1411` signup profile upsert | needs frontend cutover | rely on the trusted Auth signup trigger; ordinary users cannot upsert role/status |
| `src/lib/useTracker.ts:1412` signup `team_members` upsert | needs frontend cutover | remove the caller-side provisioning write; only an Admin may manage the exact invitation/provisioning source |
| `src/lib/useTracker.ts:1258` `find_login_email` | needs frontend cutover | use email login or a separately approved safe lookup design |
| `src/lib/useTracker.ts:2386`, `2540`, `2681`, `2737`, `2882` workflow notification inserts | needs RPC | use the canonical workflow RPC that performs the mutation and notification |
| `src/lib/useTracker.ts:3798` mention notification insert | needs frontend cutover | remove it; the trusted mention trigger creates the notification |
| `src/lib/useTracker.ts:4025`, `4032` direct DM conversation/member inserts | needs RPC | call `phase6_create_direct_conversation()` |
| `src/lib/useTracker.ts:3002`, `3053` task insert/update | needs narrower payload and role-aware UI | Employees must self-assign on create and cannot reassign or relink projects |
| `src/lib/notifications.ts:59`, `107` legacy `user_id` notification fallback | cleanup | remove the obsolete fallback; canonical rows use `recipient_id` |

Unchanged paths include self/Admin profile reads and permitted profile updates; the Admin client-invitation `team_members` upsert; recipient notification reads and `{is_read: true}` updates; eligible conversation/member/message/attachment/mention/reaction reads and inserts; project/task conversation creation; task reads; and eligible append-only note/activity inserts. Realtime subscriptions receive only rows allowed by the resulting RLS.

No frontend file was modified. The static digest covers 127 files and remains `9dd644415939713e18aedfea1cfbfa4988895f1b89f9cf31c72df3773146b2d0`.

## 25. Local DB validation

`supabase --version`, `psql --version`, and `docker --version` were rechecked without installation. None is available.

**LOCAL DB VALIDATION BLOCKED.** PostgreSQL migration application, catalog tests, and runtime role-matrix behavior remain unverified.

## 26. npm build

`npm run build` passed after the Step 3D.2A.1 corrections (`tsc && vite build`; Vite 6.4.3, 1,715 modules, built in 46.62 seconds). Vite emitted its existing advisory that the main minified chunk exceeds 500 kB; it did not fail the build.

## 27. Known blockers before Step 3D.2B

There is no remaining Step 3D.2A/3D.2A.1 source blocker. Before deployment or final cutover, migration 00450 and `phase6_core_security.test.sql` still require clean-chain PostgreSQL execution and disposable Auth role-matrix rehearsal. The DM uniqueness contract also requires a true two-session A↔B concurrency rehearsal in staging. The sixteen frontend call sites above require the later authorized cutover; deploying this migration before that cutover would cause those writes/lookups to fail closed.

## 28. Deferred finance/payroll

No finance, payment, invoice, payroll, salary, employee-dues, profitability, or budget policy/business logic was changed. That security work remains deferred to Step 3D.2B.

## 29. Deferred AI/RAG

No AI documents, embeddings, knowledge-base/RAG, AI settings, or James action/business logic was changed. Any associated policy review remains deferred to Phase 6B.

## 30. Deployment/write-freeze implications

No migration was applied, no live or remote Supabase instance was contacted, and no deployment, staging write, Git add, commit, or push was performed. Migration 00500 remains reserved and absent.

**NO LIVE DATABASE WAS MODIFIED.**
