# Phase 6 Frontend Canonical Switch Report

This report covers the pre-00500 frontend/application cutover to the accepted Phase 6 database interfaces. It does not claim deployment or PostgreSQL execution.

## 1. Frontend files modified

The cutover changes `src/App.tsx`, `src/components/ProjectDetail.tsx`, `src/pages/ProjectsPage.tsx`, `src/pages/RevisionRequestsPage.tsx`, `src/lib/types.ts`, `src/lib/useTracker.ts`, and `src/lib/notifications.ts`, and adds `src/lib/workflowClient.ts`. Static inventory baselines were updated in the three security checkers, and `scripts/phase6-frontend-cutover-static-tests.mjs` was added.

## 2. Fresh frontend inventory

The pre-edit inventory found four legacy workflow RPC call sites, five direct protected project workflow-update sites outside the generic helper, three direct revision lifecycle updates, two direct stage-skip mutations, one direct override insert, six workflow/mention notification inserts, two-row client-side DM creation, and a broad generic project payload. The final source has zero legacy RPC invocations, zero direct protected workflow updates, zero direct stage-skip/override writes, and zero frontend notification inserts.

## 3. Canonical workflow APIs

`CanonicalWorkflowClient` contains exactly these eleven mutations: `workflow_advance_stage`, `workflow_submit_stage_for_approval`, `workflow_client_approve_stage`, `workflow_submit_client_revision`, `workflow_submit_revised_proof`, `workflow_request_stage_skip`, `workflow_respond_stage_skip`, `workflow_admin_override`, `workflow_complete_final_delivery`, `workflow_set_project_lifecycle`, and `workflow_update_project_configuration`. Current UI paths reach all eleven through `useTracker`; components do not issue workflow RPCs directly.

## 4. Idempotency

The client creates keys only with `crypto.randomUUID()`. It keeps a key in a map keyed by RPC and logical action input. A retry after an uncertain transport/server outcome reuses that key. Success or a recognized stable domain failure clears it, so a later new user action receives a new key.

## 5. Workflow versions

Every mutation reads the loaded project `workflow_version` and sends it as `p_expected_workflow_version`. The frontend does not pre-increment it. Success is followed by a canonical refresh. `workflow_stale_version` refreshes the data and returns a visible domain error without replaying against the newer version.

## 6. Domain errors

The client maps every required canonical code to a clear message while preserving the code on `WorkflowDomainError.domainCode` and retaining the original error as its cause. Code extraction considers structured Supabase error fields instead of matching one arbitrary prose message.

## 7. Legacy workflow removal

All four legacy workflow RPC calls were replaced. Source checks prohibit every legacy name listed in the cutover specification from appearing as a frontend `.rpc(...)` invocation. No canonical failure falls back to a legacy workflow writer.

## 8. Protected project writes

Five direct workflow project-update sites were removed. The sole remaining `projects.update` call accepts an explicit metadata payload and cannot carry canonical or compatibility workflow fields. The former broad `Partial<Project>` database update surface was removed.

## 9. Project metadata allowlist

`ProjectMetadataUpdate` and `projectMetadataPayload` allow CRM identity/linking fields, descriptive metadata, assignment, dates, notes, file links, invoice metadata, and virtual payment form fields. Payment values are written to `project_payments`; canonical workflow, capability, clocks, counters, due estimates, lifecycle, and compatibility shadows are excluded from the project update payload.

## 10. Project creation tuple

New Supabase projects insert `active / files_received / pending / none`, `workflow_version = 0`, confirmed explicit print/ebook capabilities with resolver identity/time, canonical seven-key workflow settings, zero production/client/revision counters, and null stage/final/delivery timestamps. Dual-write compatibility values are `New`, `Files Received`, `PENDING`, `None`, `Paused`, zero progress/time, and an empty client action. The frontend inserts no stage history or fabricated workflow timestamps.

## 11. Client reads

Clients load projects through `get_client_project_summaries()` and use that returned list directly. They load revision requests, items, attachments, activity, and skips through the five fixed `get_client_*` RPCs. Client code does not query raw project, revision, or skip tables.

## 12. Revision mutations

Client submission uses `workflow_submit_client_revision`; revised proof completion uses `workflow_submit_revised_proof`; client approval uses `workflow_client_approve_stage`. The direct request update helper permits only `assigned_to`, `priority`, and `team_response`. Revision status, canonical status, stage, round, due, and completion fields are not sent directly.

## 13. Stage skips

Requests and responses use `workflow_request_stage_skip` and `workflow_respond_stage_skip`. The frontend does not write `project_stage_skips` or calculate the post-skip route.

## 14. Admin overrides

Admin UI uses `workflow_admin_override` with canonical target enums, reason, and explanation. It rejects `Completed` as an override target because final completion has its own RPC. No frontend insert into `admin_workflow_overrides` remains.

## 15. Final delivery

The final-delivery buttons call `workflow_complete_final_delivery`. They do not set project completion fields, delivery dates, or compatibility status through a project update.

## 16. Lifecycle and configuration

The project lifecycle selector calls `workflow_set_project_lifecycle` for active, hold, cancel, and archive transitions. It does not offer Completed. Project editing sends capability/settings changes through `workflow_update_project_configuration` with all seven canonical settings keys.

## 17. Notifications

Six workflow/mention notification insertion paths were removed. Workflow RPCs create workflow notifications, and the database mention trigger creates mention notifications. The frontend only selects notifications, subscribes to them, and updates `{ is_read: true }`.

## 18. Collaboration directory

Project Manager and Employee directory loading uses `get_collaboration_directory()` and maps only its four returned fields. Admin retains the broad authorized profile path; Client loads only self.

## 19. Profile editing and signup

Ordinary profile updates are typed to `full_name`, `avatar_url`, and `phone`. Supabase signup metadata sends `full_name` only and relies on the trusted Auth trigger; caller-controlled role metadata and post-signup profile/team upserts were removed.

## 20. Direct messages

DM creation uses `phase6_create_direct_conversation(p_other_user_id)`, then refreshes authorized conversation data. The frontend no longer inserts a DM and two memberships.

## 21. Mentions

Message creation inserts the message and mention rows. It does not insert mention notifications because the accepted trigger owns them.

## 22. Read receipts

Notification updates contain only `is_read`. Conversation read receipts update only `last_read_at` on the row matching both the conversation and current authenticated profile. They no longer upsert a missing membership.

## 23. Tasks, notes, and activity

Employee/Junior Assistant task updates omit `assigned_to`, `project_id`, and `created_by`; Admin/Project Manager retain allowed management fields. Notes and activity remain append-only frontend paths with actor IDs sourced from the current profile. Client loading skips internal task/note/activity tables.

## 24. Business-finance loading

`project_payments`, `finance_transactions`, and `finance_budgets` are queried only when `canManageEverything` identifies Admin or Project Manager. Employee and Client branches use a local empty result and issue no business-finance query.

## 25. Payroll loading

Admin loads all compensation and ledger rows. Employee and Junior Assistant query only `employee_id = current profile`. Project Manager and Client issue no payroll query.

## 26. Finance and payroll writes

Payroll mutations check for Admin. Ledger correction remains delete/re-entry with no update path. Finance inserts force `created_by` to the current profile and omit `amount_pkr`; the trigger remains authoritative. Finance updates omit creator/audit/derived amounts, and only Admin can include `project_id`. Project-payment updates omit `project_id`, while inserts include it only as the immutable row key.

## 27. `team_members` upserts

Signup no longer writes `team_members`. One upsert remains in the explicitly Admin-only client invitation/access path, consistent with the accepted Admin policy.

## 28. Type changes

Canonical lifecycle, stage, stage-status, waiting-on, capability status, project state/version/counter fields, and the seven-key `WorkflowSettings` are typed. Narrow `ProjectMetadataUpdate` and `FinanceTransactionUpdate` types prevent protected fields from leaking into broad update payloads.

## 29. Compatibility fields

Legacy project status, stage, waiting, progress, stage-state, milestone, and display dates remain in `Project` and UI reads during the dual-write period. Canonical Supabase mutations do not derive or persist them. Timeline helpers remain for previews and demo-mode presentation only; database/RPC timestamps are authoritative in Supabase mode.

## 30. Static validation

The frontend cutover, engine, workflow-security, core-security, and finance-security static suites all pass. These are dependency-free source assertions and do not execute PostgreSQL.

## 31. Existing tests

The existing timeline and voice suites could not be executed without installing `tsx`: it is absent from local `node_modules`, `npx --no-install` could not resolve a cached runner, and Node's built-in TypeScript stripping cannot resolve the extensionless imports used by those suites. No dependency was installed.

## 32. Build

`npm run build` passes (`tsc` plus Vite). Vite reports only its existing large-chunk advisory.

## 33. Remaining blocker before 00500

No frontend source blocker remains. Runtime behavior must still be tested against a local/staging database containing accepted migrations 00100–00460 before 00500 is authored or deployed.

## 34. Database execution status

No SQL test was executed and no live Supabase connection was made. PostgreSQL/RLS/RPC execution remains unverified in this environment.

## 35. Cutover sequencing

Deploy the accepted database migrations before this frontend so the required RPCs, columns, grants, and policies exist. During rollout, prevent older frontend builds from writing through revoked legacy/direct paths. Keep 00500 reserved until staging validates canonical reads, all eleven actions, idempotent retry, stale-version handling, role-specific finance/payroll access, collaboration, and trigger-owned notifications.

## FC.1 corrections — fail-closed integration and action retry safety

- **Project creation authorization:** Supabase creation now rejects every actor outside the normalized Admin/Project Manager/manager set before issuing an insert. Demo behavior remains local and separate.
- **Explicit new-project capabilities:** The create form exposes visible Print and eBook controls. Service selection deterministically initializes those controls, but the persistence path requires both `draft.requires_print` and `draft.requires_ebook` to be booleans, requires at least one to be true, and writes those exact values. Confirmed canonical capabilities are no longer inferred from `service_type` or auto-skipped stages.
- **Fail-closed conversation creation:** Project and task conversation inserts check the returned error and row. A rejection, missing row, or other database failure is thrown; no local conversation is appended. DMs continue through `phase6_create_direct_conversation()`.
- **Exact DM reuse:** A local DM is reused only when it has exactly two membership `conversation_members` rows and their IDs are exactly the current user and requested peer. Malformed legacy group DMs proceed to the canonical RPC lookup.
- **Reaction persistence:** Supabase reaction toggles insert `{ message_id, user_id: currentProfile.id, emoji }` or delete the exact current-user reaction. Every error is checked, inserts require a returned row, and local state changes only after confirmed database success.
- **Fail-closed profiles:** A non-Admin may update only `currentProfile.id`; Admin retains safe-field edits for another profile. The update returns `id` with `maybeSingle()`. Zero rows or an error prevents local mutation and success reporting.
- **Activity identity:** `addActivity` no longer accepts `user_id`. It binds both the local object and database insert to `currentProfile.id`, checks the insert error, and appends local state only after database success.
- **Client-access replacement:** The prior access-set DELETE error is checked before any replacement INSERT. Profile updates require a returned row, access inserts are checked, and password-reset request errors are also surfaced.
- **Client revision retry:** An in-memory logical-operation record retains the returned `revision_request_id`, deterministic attachment IDs/paths, upload completion, and row-insert completion. After the canonical create succeeds, an attachment failure resumes from that request rather than calling `workflow_submit_client_revision` again.
- **Revised-proof retry:** The in-memory operation retains deterministic attachment work and `rpcComplete`. A retry skips confirmed upload/row work and replays or retries `workflow_submit_revised_proof`; an uncertain attachment insert is checked by its stable ID before another insert. This guarantee lasts for the same mounted application session. A full page reload clears the retry state and remains a staging consideration.
- **Workflow argument drift:** Pending workflow state stores the idempotency UUID and a stable fingerprint of the exact canonical argument object. Reusing a pending logical action with changed arguments or `workflow_version` fails locally before making a request. A runtime parameter-name guard also checks each outgoing payload against the accepted signature.
- **Exact SQL signature validation:** The frontend static checker parses all eleven function parameter lists from migration 00300, compares them to the frontend signature declarations and wrapper payload keys, and verifies the runtime parameter guard.
- **Actual UI reachability:** Source-backed component-to-`useTracker` paths exist for all eleven RPCs: advance stage, submit stage, client approve, client revision, revised proof, request skip, respond skip, Admin override, final delivery, lifecycle, and configuration. The checker validates the relevant App and component wiring rather than treating wrapper existence as UI reachability.

## FC.2 corrections — final pre-staging boundaries

- **Malformed workflow success:** `CanonicalWorkflowClient` validates a successful RPC payload before clearing its pending logical-action entry. The result must contain a non-empty `project_id`, a non-negative integer `workflow_version`, and a boolean `already_applied`. Empty or malformed success data is treated as uncertain: the original UUID and argument fingerprint remain pending so an identical retry can reach receipt replay. The pending entry is cleared only after this validation succeeds.
- **Raw project form submission:** `ProjectFormModal` submits the edited `draft` directly. Its `deriveProjectTimeline` call remains a display preview, and demo project creation may still derive the local timeline. Canonical persistence does not receive the preview output.
- **Canonical deadline presentation:** In Supabase mode the form states that the database calculates workflow due dates from configured working-day rules. Existing projects display `stage_due_at` and `final_due_at` as read-only values. New projects explain that canonical dates appear after the database starts the workflow. The legacy calendar-day preview is explicitly demo-only.
- **Protected timeline controls:** Canonical mode does not render editable milestone, revision, final-delivery, delay-reason, or client-action controls. These legacy fields remain available only in the demo branch and remain excluded from `ProjectMetadataUpdate` and the direct project update allowlist. Canonical workflow changes continue through the eleven accepted actions.
- **Scoped conversation participation:** After an authorized project or task conversation is obtained or created, Supabase mode selects the current profile's exact `conversation_members` row and inserts that self row only when missing. Insert errors are checked; a concurrent or uncertain insert is accepted only after the exact self row is confirmed. Local participation state is updated from the confirmed database row, enabling subsequent `last_read_at` updates.
- **Authorization boundary:** Scoped project/task authorization continues to come from deterministic project, task, and client eligibility enforced by migration 00450. Membership is participation/read state and does not grant scoped access; stale membership therefore remains powerless. DM creation remains exclusively through `phase6_create_direct_conversation()`.
- **Required staging:** Static validation and compilation cannot prove PostgreSQL/RLS/RPC runtime behavior. Disposable or staging database validation of migrations 00100–00460 remains mandatory before migration 00500 or deployment.
