# Phase 6 Database and Workflow Audit

Audit date: 2026-09-07  
Scope: repository-only inspection; no live Supabase connection, SQL execution, deployment, or production behavior change.  
Evidence base: all 35 `supabase/**/*.sql` files, `src/**/*.{ts,tsx}`, Supabase Edge Functions, README/setup documentation, and Git file history.

## 1. Executive Summary

MH Tracker has a mature frontend eight-stage workflow, but it does not have one reproducible database definition for that workflow. The repository contains a large base script plus chronological hotfixes, replacement functions, independently runnable feature scripts, duplicated table definitions, and policies whose final effect depends on execution order.

Key measured results:

- SQL files inspected: **35**.
- Application-owned tables defined: **35**. Five Supabase/Postgres system relations are also referenced (`auth.users`, `storage.buckets`, `storage.objects`, `pg_publication`, `pg_publication_tables`).
- Distinct SQL function/RPC names defined: **29**, across **49 definitions**.
- Function names defined more than once: **16**.
- Confirmed frontend/database enum or state-vocabulary mismatches: **12 value-level mismatches** (three modern project statuses missing from the base enum, seven canonical/legacy stage-name pairs, and two frontend timeline states rejected by the SQL check constraint).
- Critical/high RLS or SECURITY DEFINER findings: **11** (**4 critical**, **7 high**).
- `schema.sql` alone cannot create the database expected by the current frontend.
- Frontend and SQL do not agree on business-day calculations.

The highest-risk conditions are:

1. `submit_client_revision` trusts caller-supplied `p_client_id` and does not require it to equal `auth.uid()`.
2. `submit_revised_proof` performs privileged writes without authorizing the caller or binding `p_uploader_id` to `auth.uid()`.
3. Communication RLS permits all authenticated users to read/write all messages and related rows.
4. All authenticated users can create purported admin override audit rows.
5. All authenticated users can mutate or delete any stage-skip request.
6. Migration order determines active trigger/function behavior and can undo the atomic revision workflow.
7. SQL uses calendar-day arithmetic while the frontend defaults to working days.
8. The base schema lacks current workflow columns/tables and three required enum values.
9. Persisted stage history is never loaded by the normal frontend data loader.
10. Several frontend persistence paths suppress database errors and can present stale or apparently successful state.

This report is an audit only. No remediation described here has been implemented.

## 2. SQL Migration Inventory

There is no Supabase CLI migration directory or `supabase/config.toml`. The files are loose SQL scripts, so “order” must be inferred from dependencies and Git history. The order below is a likely historical/intended sequence, not an executable guarantee.

Status meanings: **current** = newest intended behavior; **supplemental** = still needed outside the base schema; **obsolete** = superseded copy; **conflicting** = can replace or contradict another definition; **seed** = environment-specific data; **unknown** = final production applicability cannot be proven.

| Likely order | SQL file | Purpose and database objects | Security/storage/realtime/index effects | Assessment |
|---:|---|---|---|---|
| 1 | `schema.sql` | Base extensions, enums, 14 tables, 5 client views, 16 functions, and core triggers. Creates `profiles`, `projects`, payments, notes, activity, notifications, client access, tasks, revision tables, and `team_members`. | Enables RLS and policies on all base tables; grants authenticated CRUD broadly then relies on RLS; revokes anon table access; creates indexes; creates revision storage bucket/policies; adds notifications/projects/revisions to realtime. | Foundational but **not authoritative/current**. Missing later finance, payroll, communication, AI, invoice, client-link and time-aware workflow additions. Contains later copies of older revision functions. |
| 2 | `client-portal-step-1-role-tables.sql` | Adds `client` role, notification revision FK, and creates client access/revision tables. | RLS enablement, authenticated CRUD grants, anon revokes, revision indexes. | **Obsolete/supplemental**: objects are duplicated in `schema.sql`; unsafe before base dependencies. |
| 3 | `client-portal-step-2-functions-views.sql` | Creates `current_user_is_client`, `client_has_project_access`, `user_can_access_revision_request`, and five client views. | View grants; revokes public RPC access and grants authenticated execute. | **Obsolete/conflicting**: functions/views are replaced by later scripts and `schema.sql`. |
| 4 | `client-portal-step-4-policies.sql` | Client access and revision RLS policy set. | Per-operation project/client/assignment checks. | **Supplemental/duplicated** in `schema.sql`; generally scoped policies. |
| 5 | `client-revision-simplified-flow.sql` | Adds revision instruction/response columns and replaces `client_revision_requests`. | Replaces client read policy and grants view select. | **Obsolete** after fuller revision views/schema. |
| 6 | `client-portal-step-5-storage-seed.sql` | Creates private `revision-files` bucket and storage policies; inserts sample client team member. | Client-folder and assigned-team storage checks; admin delete. | **Supplemental + seed**; duplicated in `schema.sql` and later storage fix. Environment-specific seed should not be universal migration data. |
| 7 | `client-revision-status-and-storage-fix.sql` | Creates `mark_project_revision_requested` trigger behavior and storage fixes. | Adds projects/revision requests to realtime; replaces storage policies. | **Obsolete/conflicting** after atomic revision RPC; function is nevertheless recreated by `schema.sql`. |
| 8 | `tasks-table-and-policies.sql` | Creates `tasks` and timestamp trigger. | Task indexes, CRUD grants, anon revoke, assignment/creator/manager RLS. | **Duplicated** in `schema.sql`; depends on base types/functions/tables. |
| 9 | `client-project-summaries-created-at-fix.sql` | Replaces client project summary view and adds `created_at`. | View select grant; PostgREST schema reload. | **Obsolete/conflicting**; later atomic view is richer. |
| 10 | `add-abdullah-client-profile.sql` | Inserts/updates one named Auth-backed client and backfills BCH access rows. | No schema/security objects. | **Seed only**; requires an existing Auth user, base tables, and `client` enum. Not a clean-database migration. |
| 11 | `milestone-production-timeline.sql` | Adds legacy milestone columns/checks, activity columns, due-date helpers, legacy timeline trigger, milestone approval RPC, revision timeline trigger, deadline notification RPC, and client summary view. | Three project indexes; authenticated RPC grants. | **Legacy/conflicting**. Central source of legacy stage names and calendar-day trigger behavior. |
| 12 | `calendar-timeline-due-dates.sql` | Replaces `add_calendar_days`, `project_production_days`, `apply_project_timeline`, trigger, and deadline notifications. | Recreates timeline trigger; grants notification RPC. | **Duplicate/conflicting** with milestone script; calendar-day behavior. |
| 13 | `notifications-step-1-table.sql` | Creates/extends notifications. | Indexes, RLS, authenticated CRUD, anon revoke, realtime publication. | **Duplicated** in base schema. |
| 14 | `notifications-step-2-policies.sql` | Own-notification select/update/delete policies. | RLS policies only. | **Duplicated** in base schema. No direct authenticated INSERT policy. |
| 15 | `notifications-step-3a-function.sql` | Defines notification trigger function. | Function only. | **Obsolete duplicate**. |
| 16 | `notifications-step-3b-trigger.sql` | Installs notification trigger after function. | Revokes public function access and creates trigger. | **Obsolete duplicate**. |
| 17 | `notifications-step-3-trigger.sql` | Combined function and trigger variant. | Revokes public function access and recreates trigger. | **Obsolete duplicate/conflicting** with schema copy. |
| 18 | `client-portal-step-3-workflow-functions.sql` | Revision activity/notification functions, completion timestamp trigger, revised-proof notification trigger, response RPC. | Revokes public function access; grants `client_respond_revision`. | **Duplicated** in `schema.sql`; response RPC remains conceptually current. |
| 19 | `finance-tracker.sql` | Creates `finance_transactions`. | Date/project indexes; admin policies; authenticated select/insert/delete grants; anon revoke; realtime publication. | **Supplemental/current foundation**; must precede finance upgrades. |
| 20 | `add-invoice-columns-to-projects.sql` | Adds `invoiced`, `invoice_id`, `invoiced_at`; replaces client summary with `SELECT p.*`. | View replacement and no explicit RLS/view safety options. | **Supplemental but conflicting/unsafe view replacement**; frontend currently excludes these fields from project writes. |
| 21 | `ai-assistant-schema.sql` | Enables `vector`; creates eight AI/RAG/cache/settings tables and `set_updated_at`. | RLS/policies, vector and lookup indexes, update triggers. | **Supplemental/current**, but missing `match_knowledge_base_chunks`; Edge Function also references nonexistent `knowledge_base`. JWT role checks may not match profile roles. |
| 22 | `fix-client-bch-project-access.sql` | Broadens client access using access rows, email/name matching, creator; creates auto-link trigger. | No explicit revoke/grant for SECURITY DEFINER functions. | **Obsolete/conflicting** after direct client-profile migration; fuzzy name matching is risky. |
| 23 | `add-client-profile-id-to-projects.sql` | Adds direct `client_profile_id`, index, backfill, latest auto-link variant and direct-link access function. | SECURITY DEFINER functions; no explicit execute revocation. | **Supplemental/current intent**, but `schema.sql` later contains an older access function that omits the direct FK. |
| 24 | `fix-client-revision-dashboard-sync.sql` | Replaces revision-request trigger to update project stage. | Realtime projects/revisions. | **Obsolete** after atomic RPC. |
| 25 | `team-management-payroll-fix.sql` | Creates minimal compensation and ledger tables, expands entry types. | Admin-only RLS; ledger index. | **Obsolete duplicate**; lacks newer columns and employee self-read. |
| 26 | `team-management-payroll.sql` | Creates payroll tables and expanded entry-type check. | Admin-only RLS; ledger index. | **Obsolete duplicate**; superseded by payroll system migration. |
| 27 | `finance-enterprise-upgrade.sql` | Adds 15 transaction columns and creates `finance_budgets`. | Finance indexes and admin/manager budget policy. | **Supplemental/current**; must run after `finance-tracker.sql`. |
| 28 | `finance-expense-form-fields.sql` | Adds seven expense/payment fields. | Adds payment-status check. | **Supplemental/current**; must run after finance table exists. |
| 29 | `finance-transaction-update-policy.sql` | Enables finance transaction updates for managers. | Authenticated update grant and manager update policy. | **Supplemental/current**; depends on finance table and helper function. |
| 30 | `communication-schema.sql` | Adds project client FK and creates six communication tables plus `is_client_user`. | Indexes and RLS, but mostly `USING (TRUE)` policies. | **Supplemental/current structure; critically permissive security**. Depends on base `profiles`, `projects`, `tasks`, and client access. |
| 31 | `fix-client-revision-workflow-atomic.sql` | Drops old revision trigger/function; creates atomic `submit_client_revision`, richer client view, and `submit_revised_proof`. | SECURITY DEFINER RPC grants and realtime additions. | **Current intent but security/business-day defects**. Depends on time-aware fields/history even though it predates the time-aware script in Git chronology. |
| 32 | `payroll-system-migration.sql` | Creates/enhances compensation and ledger with currency, salary type, references/status/description. | Admin management + employee self-read RLS; two indexes. | **Current payroll migration**, though `CREATE TABLE IF NOT EXISTS` plus `ADD COLUMN` does not add all checks to pre-existing columns. |
| 33 | `fix-project-status-enum-active.sql` | Adds `Active`, `Awaiting Client Approval`, `Final Delivery`. | Enum only. | **Required/current supplement** missing from base schema. |
| 34 | `add-signup-trigger-update.sql` | Replaces Auth signup/profile synchronization; permits self insert/update. | Adds a broad all-authenticated profile SELECT policy without dropping the base owner/manager policy. | **Current intent; high privacy/order risk**. Depends on base tables/types/helpers. |
| 35 | `time-aware-production-timeline.sql` | Adds time-aware project fields, stage-history/skip/override tables, and replaces milestone approval RPC. | RLS policies and project/history indexes; permissive workflow-table policies. | **Newest workflow migration/current intent; incomplete and security-sensitive**. It does not replace the legacy timeline trigger.

### SQL objects not covered by a deterministic migration mechanism

- No numbered/timestamped migration filenames.
- No migration ledger managed by the repository.
- No command or script defines the required order.
- No schema dump reflects the effective current state.
- No generated Supabase database types are present.

## 3. Effective Database Schema

“Effective” below means the union of definitions found across all SQL files, not a claim about the live database. PK/FK/default details are abbreviated but complete enough to reproduce object intent. All UUID `id` PKs default to `gen_random_uuid()` unless noted.

### Core, workflow, revisions, and operations

| Table | Columns, PK/FKs, defaults/checks | Indexes | RLS/policies | Frontend use |
|---|---|---|---|---|
| `profiles` | PK/FK `id -> auth.users`; `full_name`, unique `email`, `role app_role='employee'`, `avatar_url`, `phone`, `status='active'`, `created_at=now()` | `role` | Enabled. Base owner/manager read and admin CUD; later signup script adds all-auth read plus self insert/update. | `useTracker`, team/settings/auth, communication, payroll, AI context. |
| `projects` | PK `id`; unique sequenced `project_number`; client/service/genre/size/count/platform fields; assignee/manager/creator FKs; priority/status enums; dates; notes; file links; all milestone dates; current/progress/wait/timeline fields; later client/invoice/time-aware fields listed in §4. | assignee, manager, due date, status, current stage, timeline status, files date, stage status, client profile | Enabled. Visible-by-manager/assignment/client view; manager insert/update, assigned update, admin delete. | Central to virtually every app module. |
| `project_payments` | PK `id`; unique FK `project_id`; prices; generated `remaining_balance`; `payment_status`; due/month/year/payment dates; notes; updater FK; timestamps | project, payment status | Enabled. Managers CRUD except delete admin-only. | `useTracker`, Payments, Finance, invoices; merged into frontend `Project`. |
| `tasks` | PK `id`; title/description; project, assignee, creator FKs; status check `To Do/In Progress/Done`; priority; due/completed/timestamps | project, assignee, creator, status, due date | Enabled. Non-client assignment/creator/manager visibility and writes; admin/creator delete. | Tasks page, project detail, AI tools, communication task conversations. |
| `project_notes` | PK `id`; project FK; `note_type`; note; author FK; created | project | Enabled. Visible-project read; visible user/own-author insert. No update/delete policy. | Project detail and `useTracker`. |
| `revision_notes` | PK `id`; project FK; number/note; `revision_status`; author FK; timestamps | project | Enabled. Visible-project read/insert; manager or author update. No delete. | Legacy/internal revision notes. |
| `activity_logs` | PK `id`; nullable project FK; action/old/new/user/created; later `activity_type`, `description`, `attachment_url`, `internal_note` | project | Enabled. Visible-project select; matching user insert. No update/delete. | Project activity and workflow trigger logs. |
| `notifications` | PK `id`; recipient/project FKs; later `revision_request_id`; type/title/message/read/created defaults | recipient, project, revision request | Enabled. Recipient select/update/delete. Inserts normally occur through privileged functions/triggers; no direct authenticated insert policy. | Notification bells, workflow/revision events. |
| `client_project_access` | PK `id`; client/project FKs; created; unique pair | client, project | Enabled. Manager CRUD; client own mapping read. | Client portal visibility and auto-link trigger. |
| `revision_requests` | PK `id`; project/client/assignee FKs; title/description/instructions/team response; priority check; status check; submitted/completed/created/updated | project, client, assignee, status | Enabled. Client own read/submit for accessible project; manager/assignee read/update; admin delete. | Revision request pages/modals and atomic RPC. |
| `revision_items` | PK `id`; request FK; sort/page/instruction; status check; attachment URL; team/internal notes; timestamps | request | Enabled. Parent-request-scoped team read/CU, constrained client insert, admin delete. | Revision checklist. |
| `revision_attachments` | PK `id`; request/item FKs; file metadata; uploader FK; created | request | Enabled. Parent-request-scoped team read/insert; client own insert; no row delete policy. | Revision uploads/submissions. |
| `revision_activity` | PK `id`; request/user FKs; action/previous/new/created | request | Enabled. Parent-request-scoped team read/insert and client-own insert. | Revision audit UI. |
| `team_members` | PK `id`; unique email; name/role/phone/status/created | unique email only | Enabled. Managers read; admin all. | Signup matching and team management. |
| `project_stage_history` | PK `id`; project FK; canonical/legacy stage/status text; timestamps; active/client-wait seconds; actor FK; action/notes/created | project | Enabled. **All authenticated read and arbitrary insert**. No explicit update/delete policy. | Written by some RPCs; not loaded from Supabase. |
| `project_stage_skips` | PK `id`; project/requester FKs; stage/reason/status text; request/client-response timestamps and notes | none | Enabled. **All authenticated SELECT/INSERT/UPDATE/DELETE through `FOR ALL USING(true)`**. | `useTracker` request/respond paths; loaded only if attached elsewhere—normal loader has no query. |
| `admin_workflow_overrides` | PK `id`; project FK; actor FK; old/new stages; reason/explanation/created | none | Enabled. All authenticated read; **all authenticated insert with `WITH CHECK(true)`**. | `useTracker.adminWorkflowOverride`; normal loader has no query. |

### Finance and payroll

| Table | Columns, PK/FKs, defaults/checks | Indexes | RLS/policies | Frontend use |
|---|---|---|---|---|
| `finance_transactions` | PK `id`; type/category/description/amount/date/project/creator; later currency/rate/PKR amount/client/invoice/payment/reference/vendor/recurrence/notes/attachment/soft-delete/updater/updated; later expense type/payment status/paid date/account/tax/fee/end date | date, project, type, category, soft-delete | Enabled. Admin select/insert/delete; managers update through `can_manage_all_projects`. | Finance page, AI actions, `useTracker`. |
| `finance_budgets` | PK `category`; budget PKR; updater FK; updated | PK | Enabled. Admin/manager all. | Finance budgets/reports. |
| `employee_compensation` | PK/FK `employee_id -> profiles`; salary/rate; later salary type/currency; joining/responsibilities/rating/updated | PK | Enabled. Admin all; current payroll script adds employee self-read. | Team payroll components and AI actions. |
| `employee_ledger` | PK `id`; employee/project FKs; entry type/amount; later currency/reference/status/description; month/method/notes/paid/created | employee+paid date, salary month | Enabled. Admin all; current payroll script adds employee self-read. | Team payroll and AI actions. |

### Communication

| Table | Columns, PK/FKs, defaults/checks | Indexes | RLS/policies | Frontend use |
|---|---|---|---|---|
| `conversations` | PK `id`; type check; name; project/task/creator FKs; timestamps | type, project, task | Enabled. Client-scoped SELECT exists, but a second `messages_select` policy on this table grants SELECT to every authenticated user; any authenticated insert. | Communication page and project/task/DM initialization. |
| `conversation_members` | PK `id`; conversation/user FKs; last-read/created; unique pair | user | Enabled. All authenticated all rows/all operations. | Membership and read receipts. |
| `messages` | PK `id`; conversation/sender FKs; body; parent self-FK; timestamps | conversation, created | Enabled. All authenticated all rows/all operations. | Chats and notifications. |
| `message_attachments` | PK `id`; message FK; filename/URL/type/size/created | message | Enabled. All authenticated all rows/all operations. | Message attachments. |
| `message_mentions` | PK `id`; message/user FKs; created | none | Enabled. All authenticated all rows/all operations. | Mentions. |
| `message_reactions` | PK `id`; message/user FKs; emoji/created; unique triple | unique constraint | Enabled. All authenticated all rows/all operations. | Reactions. |

### AI/RAG

| Table | Columns, PK/FKs, defaults/checks | Indexes | RLS/policies | Frontend/Edge use |
|---|---|---|---|---|
| `ai_conversations` | PK `id`; user FK; title; timestamps | user | Enabled. Owner-only all. | AI service. |
| `ai_messages` | PK `id`; conversation FK; role check; content/metadata/created | conversation | Enabled. Owner-through-conversation all. | AI service. |
| `knowledge_base_documents` | PK `id`; title/file metadata/category check/uploader FK/created | none | Enabled. Authenticated read; JWT-role admin all. | AI document ingestion. |
| `knowledge_base_chunks` | PK `id`; document FK; index/content; `vector(768)`; created | document, IVFFlat embedding | Enabled. Authenticated read; JWT admin/service role insert. | `ai-embed`; intended RAG. |
| `ai_response_cache` | PK `id`; unique query hash; response/expiry/created | unique hash | Enabled. Service-role all. | AI Edge Functions. |
| `ai_error_logs` | PK `id`; user/error/provider/created | none | Enabled. Service-role insert; JWT admin read. | AI Edge Functions. |
| `ai_daily_summary_dismissals` | PK `id`; user FK/date/created; unique user+date | user+date | Enabled. Owner all. | AI daily popup. |
| `ai_user_settings` | PK/FK `user_id`; voice/TTS flags/language/timestamps | PK | Enabled. Owner all. | AI settings. |

### Referenced but not defined as application tables

| Relation/object | Finding |
|---|---|
| `auth.users` | Supabase-managed; parent of profiles and AI user rows; signup trigger attached here. |
| `storage.buckets`, `storage.objects` | Supabase-managed; revision bucket and object policies reference these. |
| `pg_publication`, `pg_publication_tables` | PostgreSQL catalogs used to conditionally add realtime tables. |
| `knowledge_base` | Referenced by `supabase/functions/ai-rag/index.ts` but no table/view definition exists. |
| `match_knowledge_base_chunks` | Called by `ai-rag`, but no SQL function definition exists. |

### Views

The repository defines `client_project_summaries`, `client_revision_requests`, `client_revision_items`, `client_revision_attachments`, and `client_revision_activity`. `client_project_summaries` has at least five competing definitions; an execution order can replace a safe projection with `SELECT p.*`, remove the time-aware fields needed by clients, or revert the richer atomic-revision view.

## 4. Projects Table Analysis

The current frontend `Project` interface is in `src/lib/types.ts`; persistence shaping is in `src/lib/useTracker.ts::supabaseProjectPayload`. Classification is exclusive:

- **A**: present in `schema.sql` as a physical `projects` column.
- **B**: physical column added only by a later SQL file.
- **C**: expected/referenced by the frontend but not found as a physical `projects` column in SQL.
- **D**: legacy or compatibility field physically present but not part of the canonical workflow model, or data merged onto `Project` from another table.

### A — present in base `schema.sql`

`id`, `project_number`, `client_name`, `client_email`, `project_title`, `service_type`, `genre`, `trim_size`, `page_count`, `word_count`, `image_count`, `platform`, `assigned_to`, `project_manager`, `priority`, `start_date`, `due_date`, `internal_deadline`, `delivery_date`, `status`, `general_notes`, `internal_notes`, `client_instructions`, `qa_notes`, `delivery_notes`, `source_file_link`, `drive_folder_link`, `client_brief_link`, `proof_pdf_link`, `final_print_pdf_link`, `final_ebook_link`, `cover_file_link`, `other_links`, `files_received_date`, `design_concept_due_date`, `design_concept_due_date_manual`, `design_concept_submitted_date`, `design_concept_approval_date`, `concept_revision_due_date`, `print_version_due_date`, `print_version_due_date_manual`, `print_version_submitted_date`, `print_version_approval_date`, `print_revision_due_date`, `ebook_due_date`, `ebook_due_date_manual`, `ebook_submitted_date`, `ebook_approval_date`, `final_delivery_date`, `current_stage`, `progress_percentage`, `waiting_on`, `timeline_status`, `production_days_used`, `delay_reason`, `client_action_required`, `print_timeline_days`, `created_by`, `created_at`, `updated_at`.

### B — added only by later SQL

| Column | Source | Frontend behavior |
|---|---|---|
| `client_profile_id` | `add-client-profile-id-to-projects.sql`; duplicated in communication schema | Typed, but intentionally removed from generic project payload; used in access SQL rather than normal UI writes. |
| `invoiced`, `invoice_id`, `invoiced_at` | `add-invoice-columns-to-projects.sql` | Used to filter invoice candidates, but explicitly removed from `supabaseProjectPayload`; no dedicated persistence path was found for setting them on projects. |
| `stage_status` | `time-aware-production-timeline.sql` | Central clock state; written by stage/revision/approval flows. |
| `stage_started_at`, `stage_due_at`, `stage_completed_at` | same | Current stage clock timestamps. |
| `final_due_at` | same | Frontend final estimate cache. |
| `production_time_used`, `client_wait_time` | same | Read when synthesizing history entries; no reliable SQL accumulation mechanism exists. |
| `revision_count` | same | Incremented in frontend and atomic revision RPC. |
| `stage_states` | same | JSON state used mainly for skipped stages. |
| `workflow_settings` | same | JSON durations and `exclude_weekends` override. |

### C — frontend expectation with no physical projects column

| Field | Actual situation |
|---|---|
| `requirements_submitted_at` | Declared in the TypeScript interface; no SQL column and no runtime use found. |
| `stage_skip_requests` | Relation-shaped frontend array; stored in `project_stage_skips`, not selected/joined by normal loading. |
| `admin_workflow_overrides` | Relation-shaped frontend array; stored separately, not selected/joined by normal loading. |
| `stage_history` | Relation-shaped frontend array; stored separately, not selected/joined by normal loading. |

### D — compatibility/merged fields

| Field(s) | Actual source/status |
|---|---|
| `total_price`, `advance_paid`, `remaining_balance`, `payment_status`, `payment_date`, `payment_notes` | Not `projects` columns. Loaded from `project_payments` and merged into frontend projects. Correctly stripped from project payloads. |
| `production_days_used` | Base legacy integer calculated by legacy SQL from milestone dates; overlaps newer `production_time_used`. |
| `print_timeline_days` | Fixed legacy value of 5; overlaps workflow JSON setting. |
| milestone-specific due/manual/revision date columns | Still actively read for compatibility and calendar display, but overlap generic `stage_due_at` and `workflow_settings`. |
| `timeline_status` | Legacy constrained vocabulary conflicts with newer frontend values `Revision Required` and `Skipped`. |

There is no dedicated `project_type`, `needs_print`, or `needs_ebook` column. Product routing is inferred from free-text `service_type`. That makes automatic skip behavior dependent on string matching.

## 5. Enum/Status Mismatches

### PostgreSQL types

| Type | SQL values | Frontend representation | Result |
|---|---|---|---|
| `app_role` | Base: admin, project_manager, employee, junior_assistant; later adds manager and client | Exact six-value `Role` union | Effective union matches only after enum alterations. |
| `project_priority` | Low, Normal, High, Urgent | Exact `Priority` union | Match. |
| `project_status` | Large legacy set in base; later fix adds Active, Awaiting Client Approval, Final Delivery | Standard + legacy `ProjectStatus` union | Effective union matches after fix; base alone misses three active values. |
| `payment_status` | Not Started, Advance Paid, Partially Paid, Fully Paid, Pending, Refunded | Exact union | Match. |
| `revision_status` | Pending, In Progress, Completed | Exact union | Match. |
| `note_type` | general, internal, client_instruction, qa, delivery, work | Exact union | Match. |

Task, client-revision, revision-item, finance-payment, payroll-entry and AI-message states are text columns with `CHECK` constraints rather than PostgreSQL enums.

### Twelve confirmed value-level mismatches

| # | Frontend/current value | Base/legacy SQL value or constraint | Consequence |
|---:|---|---|---|
| 1 | Project status `Active` | Missing from base enum; added by `fix-project-status-enum-active.sql` | Base installs reject current project writes. |
| 2 | `Awaiting Client Approval` | Missing from base enum; added by same fix | Approval submissions require fallback/failed write without fix. |
| 3 | `Final Delivery` | Missing from base enum; added by same fix | Final-stage writes require fix. |
| 4 | Stage `Design Concept` | Legacy `Design Concept in Progress` | Normalization required; SQL trigger can rewrite current stage. |
| 5 | `Concept Approval` | `Awaiting Concept Approval` | Same. |
| 6 | `Print Version` | `Print Version in Progress` | Same. |
| 7 | `Print Approval` | `Awaiting Print Approval` | Same. |
| 8 | `Ebook Version` | `eBook in Progress` | Capitalization and wording mismatch. |
| 9 | `Ebook Approval` | `eBook Review` | Same. |
| 10 | `Final Delivery` stage | `Final Quality Check` | Same; also overlaps project status value. |
| 11 | Timeline status `Revision Required` | Rejected by `projects_timeline_status_check` | Atomic/frontend revision updates can fail if legacy check is installed. |
| 12 | Timeline status `Skipped` | Rejected by the same check | Cannot persist the full frontend union. |

Additional validation gaps, not included in the count above:

- `stage_status`, stage-history status, and skip status are unconstrained text despite frontend unions.
- Frontend client-revision type includes `Assigned` and `Additional Revision Required`, but the `clientRevisionStatuses` UI list omits both.
- `project_stage_skips.status` has no check for `PENDING/APPROVED/REJECTED/SERVICE_TYPE_PRESET`.
- Payroll status/type checks depend on which duplicate payroll script was run.

## 6. Eight-Stage Workflow Mapping

| # | Canonical frontend stage | Default time | Clock/owner | Legacy SQL label | Submission/approval evidence |
|---:|---|---:|---|---|
| 1 | Files Received | 2 working days | ACTIVE / Manuscript Heaven | Files Received or Files Required | `files_received_date` |
| 2 | Design Concept | 3 working days | ACTIVE / Manuscript Heaven | Design Concept in Progress | `design_concept_submitted_date` |
| 3 | Concept Approval | 0 production days | PAUSED_CLIENT_REVIEW / Client | Awaiting Concept Approval | `design_concept_approval_date` |
| 4 | Print Version | 5 working days | ACTIVE / Manuscript Heaven | Print Version in Progress | `print_version_submitted_date` |
| 5 | Print Approval | 0 production days | PAUSED_CLIENT_REVIEW / Client | Awaiting Print Approval | `print_version_approval_date` |
| 6 | Ebook Version | 5 working days | ACTIVE / Manuscript Heaven | eBook in Progress | `ebook_submitted_date` |
| 7 | Ebook Approval | 0 production days | PAUSED_CLIENT_REVIEW / Client | eBook Review | `ebook_approval_date` |
| 8 | Final Delivery | 2 working days | ACTIVE / Manuscript Heaven | Final Quality Check | `final_delivery_date`; then status Completed |

Frontend progression is sequential through `nextStageAfterApproval` and guarded by `validateWorkflowTransition`. Client approval is required to leave approval stages unless a skip is approved; only an admin override bypasses sequence validation in the frontend.

Service-type routing:

- Print-only string patterns skip Ebook Version and Ebook Approval.
- eBook-only patterns skip Print Version and Print Approval.
- `stage_states` and approved skip requests also mark stages skipped.
- `projectRequiresEbook()` nevertheless returns `true` unconditionally, so Project Form final estimates always choose the full-project constant even while stage progression can skip eBook. This is an internal frontend inconsistency.

## 7. Workflow RPC/Function Analysis

### Function inventory

There are 29 distinct SQL function names. Non-workflow helpers are listed for completeness.

| Function | Signature/purpose | Definitions |
|---|---|---|
| `touch_updated_at` | trigger timestamp helper | schema |
| `set_updated_at` | unqualified AI timestamp trigger helper | AI schema |
| `current_user_role` | current active profile role; SECURITY DEFINER | schema |
| `can_manage_all_projects` | manager-role helper; SECURITY DEFINER | schema |
| `project_is_visible` | manager/assignee/PM visibility; SECURITY DEFINER | schema |
| `current_user_is_client` | role helper; SECURITY DEFINER | client step 2, schema |
| `is_client_user(uuid)` | communication role helper; SECURITY DEFINER | communication |
| `client_has_project_access(uuid,uuid)` | client project visibility; SECURITY DEFINER | four definitions |
| `user_can_access_revision_request(uuid)` | revision visibility; SECURITY DEFINER | client step 2, schema |
| `auto_link_client_project_access()` | project trigger to create access mappings; SECURITY DEFINER | two definitions |
| `log_project_status_change()` | activity trigger | schema |
| `create_project_notifications()` | assignment/status notifications; SECURITY DEFINER | three definitions |
| `notify_revision_watchers()` | revision activity/notifications; SECURITY DEFINER | client step 3, schema |
| `set_revision_completed_at()` | completion timestamp trigger; SECURITY DEFINER | client step 3, schema |
| `notify_revised_proof_uploaded()` | attachment notification trigger; SECURITY DEFINER | client step 3, schema |
| `client_respond_revision(uuid,text)` | validates client, row-locks ready revision, updates decision; SECURITY DEFINER | client step 3, schema |
| `create_profile_for_new_auth_user()` | Auth signup profile/team sync; SECURITY DEFINER | signup update, schema |
| `find_login_email(text)` | first-name/email lookup; SECURITY DEFINER; intentionally anon executable | schema |
| `add_business_days(date,int)` | weekend-skipping SQL helper | milestone timeline only; not used by active trigger |
| `add_calendar_days(date,int)` | direct date addition | calendar and milestone definitions |
| `timeline_progress(text)` | legacy stage progress map | milestone timeline |
| `project_production_days(projects)` | sums date differences | calendar and milestone definitions |
| `apply_project_timeline()` | legacy before-row timeline derivation | calendar and milestone definitions |
| `create_timeline_deadline_notifications()` | inserts current/tomorrow/overdue notifications | calendar and milestone definitions |
| `client_approve_project_milestone(uuid,text)` | client milestone approval | milestone and time-aware definitions |
| `apply_revision_request_timeline()` | legacy after-insert stage mutation | milestone timeline |
| `mark_project_revision_requested()` | later revision after-insert mutation | three definitions, then dropped by atomic script in historical order |
| `submit_client_revision(uuid,uuid,text,text,text,text)` | atomic revision creation/workflow/history/notifications | atomic revision fix |
| `submit_revised_proof(uuid,text,text,uuid)` | revised proof/status/project/history/notification transaction | atomic revision fix |

The Edge Function calls `match_knowledge_base_chunks`, which is not defined by any SQL file and is therefore not counted among defined functions.

### Duplicate/replacement map

Sixteen names are multiply defined: `add_calendar_days`, `apply_project_timeline`, `auto_link_client_project_access`, `client_approve_project_milestone`, `client_has_project_access`, `client_respond_revision`, `create_profile_for_new_auth_user`, `create_project_notifications`, `create_timeline_deadline_notifications`, `current_user_is_client`, `mark_project_revision_requested`, `notify_revised_proof_uploaded`, `notify_revision_watchers`, `project_production_days`, `set_revision_completed_at`, and `user_can_access_revision_request`.

Important replacement chains:

- `client_approve_project_milestone`: `milestone-production-timeline.sql` (date-only update, validates milestone, relies on legacy trigger, logs activity) → `time-aware-production-timeline.sql` (explicit stage/time update, logs stage history, but does not reject an unsupported milestone and uses calendar days). The last executed definition wins.
- `mark_project_revision_requested`: storage/status fix → dashboard sync → `schema.sql` copy. `fix-client-revision-workflow-atomic.sql` later drops the trigger and function in historical order. Running `schema.sql` afterward recreates the obsolete trigger.
- `apply_project_timeline`: milestone and calendar scripts replace each other and install the same trigger name. Both use legacy stage vocabulary and `add_calendar_days` for due dates.
- `client_has_project_access`: step-2 base → fuzzy BCH fix → direct `client_profile_id` version → `schema.sql` older version. Running schema last removes the direct-FK check from function behavior.
- `client_project_summaries` is a view, not a function, but replacement order is equally material: unrestricted `p.*`, narrow legacy projections, and richer atomic projection compete under one name.

### Detailed state-changing behavior

#### `client_approve_project_milestone(project_id uuid, milestone text)` — milestone version

- SECURITY DEFINER; checks `client_has_project_access(project_id, auth.uid())`.
- Loads without `FOR UPDATE`; no explicit current-stage validation or idempotency protection.
- Accepts only concept/print/ebook and raises for other input.
- Updates only the matching approval date; legacy `apply_project_timeline` trigger derives legacy stage/status and calendar due dates.
- Inserts `activity_logs` and team notifications.
- Project-type handling is indirect through the legacy trigger’s `needs_ebook`; print-only skips eBook, but eBook-only does not skip print.

#### Same RPC — time-aware version

- SECURITY DEFINER; same access check; no row lock.
- Does not validate that the requested milestone matches the current stage and does not reject unsupported milestone strings before attempting a history insert.
- Explicitly sets the next canonical stage, clock state, owner, timestamps and due date.
- Due date is `current_date + days_alloc`, ignoring `exclude_weekends`.
- Always moves print approval to Ebook Version; no print-only skip logic and no eBook-only handling.
- Does not update `projects.status`; any legacy trigger still installed may override its canonical `current_stage` based on milestone dates.
- Inserts stage history and team notifications.

#### `apply_project_timeline()`

- Trigger invoker behavior, before project insert/update; no caller authorization inside the function.
- Derives legacy stage/status from milestone date presence.
- Uses calendar days and hard-coded durations, not project `workflow_settings`.
- Infers only whether eBook is needed. It does not implement the frontend’s eBook-only print-stage skip.
- Rewrites `due_date`, `internal_deadline`, `current_stage`, status, progress, wait owner, and legacy production-day count on every project write.
- No row locking is needed for a before-row trigger, but its broad rewrite conflicts with explicit frontend canonical updates.

#### `submit_client_revision(...)`

- SECURITY DEFINER; locks the project row `FOR UPDATE` and performs request, project, history and notification writes in one transaction.
- Validates access using caller-supplied `p_client_id`, but **does not require `p_client_id = auth.uid()`**. This permits authenticated impersonation if another client UUID is known.
- Does not restrict revisions to approval/review stages.
- Reads stage-specific revision days from JSON, but computes `now + N * interval '1 day'` despite calling them business days.
- Sets status `In Revision`, clock `REVISION_ACTIVE`, increments count, and writes history.
- If the legacy timeline constraint/trigger is present, `timeline_status='Active'` differs from the frontend’s `Revision Required` and stage behavior can diverge.

#### `submit_revised_proof(...)`

- SECURITY DEFINER; locks the related project but not the revision request.
- Has no authorization check for manager/assignee/project access and trusts arbitrary `p_uploader_id`.
- Inserts attachment, marks request ready, pauses project for client, notifies client, and inserts stage history atomically.
- No due-date calculation or skip logic.
- The current frontend does not call this RPC; it performs four separate writes instead.

#### Revision triggers and `client_respond_revision`

- `apply_revision_request_timeline` and `mark_project_revision_requested` use legacy stage labels, choose Concept Revisions only for a small set and otherwise default to Print Revisions (no eBook revision branch), and do not use business-day settings.
- `client_respond_revision` is stronger: SECURITY DEFINER, binds row to `auth.uid()`, validates decision and current request status, and locks the row. It updates only the revision request; project advancement remains a separate milestone action.

#### Skip and admin override behavior

There are no SQL RPCs enforcing skip approval or admin override rules. The frontend writes the audit/request rows directly and then separately updates `projects`. Therefore the multi-row operation is non-atomic and authorization depends entirely on RLS—which is currently permissive for these tables.

#### Final delivery

There is no dedicated completion RPC. `submitStageForApproval`/project-detail actions update `projects` directly. A legacy timeline trigger may infer completion from `final_delivery_date`; the frontend sets status/stage/clock fields itself.

## 8. Business-Day Calculation Comparison

### Frontend

- `addWorkingDays` advances one date at a time and skips Saturday/Sunday when `excludeWeekends=true`.
- `calculateStageDueDate` reads `workflow_settings.exclude_weekends`, defaulting to true.
- Production defaults are 2/3/5/5/2 days for Files/Concept/Print/eBook/Final.
- Approval stages consume zero production days and have `stage_due_at=null` while waiting for the client.
- Revisions default to two working days, with stage-specific JSON overrides.
- `workingDaysBetween` uses the same weekend flag for remaining-day display.
- Final estimate sums all five production durations and calls the same working-day helper, but does not subtract service-type skipped stages.
- `production_time_used` and `client_wait_time` are displayed/copied into synthetic history but are not reliably accumulated as elapsed time.

### SQL

- `add_business_days` correctly skips weekends but is not used by the active legacy trigger or newer workflow RPCs.
- `add_calendar_days` is direct date addition.
- Both legacy `apply_project_timeline` definitions use `add_calendar_days` and hard-coded durations.
- Time-aware `client_approve_project_milestone` uses `current_date + integer` and ignores `exclude_weekends`.
- `submit_client_revision` uses `now + interval '1 day' * revision_days` and ignores weekends.
- SQL project production time is a sum of calendar-date differences; it does not subtract weekends or isolate client-wait intervals.

### Result

**The frontend and database do not agree.** A Friday start plus two production days is Tuesday in the default frontend but Sunday in SQL. SQL also does not consistently honor project-level duration/weekend settings, client-wait timing, or both directions of service-type skipping.

## 9. RLS/Security Findings

Severity model: CRITICAL permits cross-tenant privileged mutation/read or impersonation; HIGH exposes sensitive workflow/business data or undermines workflow integrity; MEDIUM is incomplete least privilege or order-sensitive broadening; LOW is hardening/clarity.

### Workflow-sensitive table policy matrix

| Table | SELECT | INSERT | UPDATE | DELETE | Finding |
|---|---|---|---|---|---|
| `projects` | Manager, assignee, PM via base policy; clients through scoped view/access function | Managers with own creator ID | Manager/assignee/PM | Admin | Generally scoped, but policy helper replacement and SECURITY DEFINER paths bypass it. |
| `project_stage_history` | Any authenticated user, every row | Any authenticated user, arbitrary actor/project/content | None | None | **HIGH** confidentiality/integrity exposure. |
| `project_stage_skips` | Any authenticated user, every row | Any authenticated user | Any authenticated user, every row | Any authenticated user, every row | **CRITICAL**: clients/employees can approve/reject/delete others’ skips. |
| `admin_workflow_overrides` | Any authenticated user, every row | Any authenticated user with arbitrary `actor_id` | None | None | **CRITICAL**: fake admin audit records. |
| `revision_requests` | Manager/assignee or owning client | Owning client for accessible project; manager | Manager/assignee | Admin | Strong direct RLS; weakened by privileged RPC impersonation. |
| `revision_items` | Parent-scoped team | Constrained client or scoped team | Scoped team | Admin | Reasonably scoped. |
| `revision_attachments` | Parent-scoped team; client exposure occurs via client view/storage | Bound client/team uploader | None | None | Medium operational gap; storage delete is admin-only. |
| `revision_activity` | Parent-scoped team | Bound caller and parent access | None | None | Reasonably scoped. |
| `client_project_access` | Managers or owning client | Managers | Managers | Managers | Reasonably scoped. |
| `activity_logs`, `project_notes`, `revision_notes` | Visible-project scoped | Visible-project/caller scoped | Limited where provided | None | Generally scoped; no cleanup policies by design. |
| `notifications` | Recipient | No direct authenticated insert policy | Recipient | Recipient | Correct read isolation; app direct inserts may fail unless privileged trigger/service behavior applies. |

### Critical/high findings counted in this audit

| ID | Severity | Finding |
|---|---|---|
| SEC-1 | CRITICAL | `submit_client_revision` permits caller-selected client identity. |
| SEC-2 | CRITICAL | `submit_revised_proof` has no authorization and permits caller-selected uploader identity. |
| SEC-3 | CRITICAL | `project_stage_skips` grants all operations on all rows to every authenticated user. |
| SEC-4 | CRITICAL | `admin_workflow_overrides` permits every authenticated user to create admin-looking audit rows. |
| SEC-5 | HIGH | Communication messages, attachments, mentions, reactions and memberships use unrestricted all-auth policies. |
| SEC-6 | HIGH | `messages_select` is mistakenly created on `conversations`, making the stricter client conversation SELECT policy ineffective because permissive policies OR together. |
| SEC-7 | HIGH | `project_stage_history` exposes all projects’ history and accepts arbitrary audit inserts. |
| SEC-8 | HIGH | Time-aware milestone approval has no current-stage validation, row lock, or repeat-approval guard. |
| SEC-9 | HIGH | Client access helpers are SECURITY DEFINER and multiple versions include fuzzy name matching; no explicit public execute revocation appears in the latest standalone replacements. |
| SEC-10 | HIGH | Signup update adds an all-authenticated profile read policy; because policy names differ, it coexists with and overrides the practical restriction of the base owner/manager policy. |
| SEC-11 | HIGH | AI admin policies rely on `auth.jwt()->>'role'='admin'`, while application authorization lives in `profiles.role`; absent custom JWT claims, legitimate admins may be denied and policy intent is inconsistent. |

Other medium/low observations:

- Workflow text states have no database checks.
- `finance_budgets` and payroll “FOR ALL” policies depend on helper correctness and script order.
- Grants are broad by design and rely on RLS; any missing/disabled policy is therefore material.
- `find_login_email` is executable by anon and can reveal an email from a first name; this may be intentional login UX but is an enumeration risk.
- Storage path policies validate owner folder but do not cross-check all path segments against the referenced project for client uploads.

## 10. Frontend Persistence/Error Handling Findings

| Location/function | Current behavior | Risk |
|---|---|---|
| `useTracker.createProject` | Retries enum errors with legacy status. | Masks missing modern enum migration and persists a status different from local canonical state. |
| `useTracker.updateProject` | Derives/normalizes locally; on enum error retries legacy status. Missing-schema errors are only warned. | A missing column can leave the DB unchanged while the calling UI continues; canonical/legacy divergence persists. |
| `useTracker.createRevisionRequest` | Optimistically changes project state before atomic RPC, then only partially rolls back three fields on RPC failure. | `timeline_status`, dates, count and other optimistic fields can remain inconsistent; attachment failure after RPC does not roll back already committed revision transaction. |
| `useTracker.approveProjectMilestone` | Calls RPC; on error directly updates project and logs direct-update errors without throwing; then reloads. | UI action can appear handled even if both RPC and fallback fail; fallback is non-atomic and may be blocked by client RLS. |
| `useTracker.submitStageForApproval` | Updates project, then separately updates revision requests and inserts notification/history only in local mode. | Partial success possible; project stage can change without notification/request state; history is not persisted. |
| `useTracker.uploadRevisedProof` | Upload + attachment insert are checked; subsequent revision, project and notification writes ignore returned errors. | Partial workflow completion can appear successful. It does not use the provided atomic `submit_revised_proof` RPC. |
| `useTracker.requestStageSkip` | Inserts skip and notification separately, then reloads. | Non-atomic; notification failure can reject after skip exists. |
| `useTracker.respondToStageSkip` | Updates skip, then separately updates project and inserts notification. | Approved skip can persist without stage advancement or vice versa. |
| `useTracker.adminWorkflowOverride` | Updates project first, then inserts audit row. | Failed audit insert leaves unaudited override; permissive RLS also permits fake records. |
| `loadSupabaseData` / `safeSelect` | Missing-table/column errors can resolve as empty results; timeline notification missing-schema errors are ignored. | Missing migrations look like empty data/features instead of a hard incompatibility. |
| Messaging persistence functions | Several inserts/upserts are warning-only. | Local or refreshed UI can disagree; not central to workflow but affects audit communication. |

No evidence was found of a global transaction spanning frontend multi-table operations. Only the atomic SQL RPCs provide database transactions.

## 11. Stage History Findings

### Writes

- Time-aware `client_approve_project_milestone` inserts `project_stage_history`.
- `submit_client_revision` and `submit_revised_proof` insert history.
- Frontend functions create in-memory `StageHistoryEntry` objects for approval, submission, skip response and admin override.
- Several Supabase-mode frontend paths do not insert those in-memory entries into the database.

### Reads

- Normal `loadSupabaseData` does **not** query `project_stage_history`, `project_stage_skips`, or `admin_workflow_overrides`.
- The client summary view does not expose relation arrays.
- No generated relationship query was found.

### Refresh and reconstruction

- In Supabase mode, in-memory history is lost on refresh unless separately persisted and later queried; the latter does not occur.
- `timeline.ts` derives current status/milestones from project dates and `current_stage`. It can synthesize a single history record with `createStageHistoryEntry`, but it does not reconstruct the actual event sequence.
- `production_time_used`/`client_wait_time` copied into synthetic entries can remain zero because no consistent accumulator exists.

### Source-of-truth problem

There are three competing sources: project snapshot fields, database history rows, and ephemeral frontend `stageHistory`. They can diverge because not every transition writes history, normal loading ignores persisted history, and the legacy trigger may rewrite project fields without a corresponding time-aware history row. The current application therefore has no reliable, refresh-stable workflow audit source of truth.

## 12. Migration Dependency Graph

```text
Supabase platform schemas (auth, storage, realtime)
  -> schema.sql (pgcrypto, enums, base tables/helpers/policies/views/triggers)
      -> client portal step 1 tables (historically; now mostly duplicated)
          -> step 2 helpers/views
              -> step 4 RLS
              -> step 3 revision functions
              -> step 5 storage
      -> tasks-table-and-policies (duplicated)
      -> notifications steps 1 -> 2 -> 3a -> 3b (or combined step 3; duplicated)
      -> milestone-production-timeline
          -> calendar-timeline-due-dates (replacement variant)
          -> time-aware-production-timeline (adds clock/history/skip/override; replaces approval RPC only)
      -> client access: fix-client-bch -> add-client-profile-id
      -> revision fixes: status/storage -> dashboard-sync -> atomic revision workflow
          -> requires time-aware columns and project_stage_history even though Git chronology/order does not ensure it
      -> fix-project-status-enum-active
      -> add-invoice-columns
      -> finance-tracker -> finance-enterprise-upgrade -> finance-expense-fields -> finance-update-policy
      -> team payroll/fix -> payroll-system-migration
      -> communication-schema (requires profiles/projects/tasks/client access)
      -> add-signup-trigger-update (requires profiles/team_members/app_role/helpers)
      -> ai-assistant-schema (requires pgvector and Supabase Auth; otherwise mostly independent)
```

Files that cannot run safely on an empty database include all `ALTER TABLE projects` scripts, client portal steps, notification steps after table creation, finance upgrades/policies, payroll scripts, communication schema, timeline scripts, access fixes, revision fixes, signup trigger update, and the named-client seed. `ai-assistant-schema.sql` is the closest to standalone but requires Supabase Auth, `pgcrypto`/`gen_random_uuid` availability, and the `vector` extension.

Execution-order hazards:

- Alphabetical execution begins with a named-client seed and project alters before `schema.sql`, so it fails immediately.
- Alphabetical execution runs finance upgrades before the finance base table.
- Alphabetical execution runs communication before base tables/tasks.
- Alphabetical execution runs atomic revision fix before milestone/schema/time-aware dependencies, then later scripts recreate legacy triggers.
- Historical Git order also has a gap: the atomic revision function references time-aware fields/history that were not reliably installed by an ordered migration framework.

## 13. Clean-Database Reproducibility Assessment

| Method | Result | Explanation |
|---|---|---|
| A. Run `schema.sql` only | **NO** | Missing 21 later application tables (finance/payroll/communication/AI/time-aware), time-aware project columns, invoice/client-link columns, modern status enum values, current workflow RPC, and RAG match function. |
| B. Run every SQL file in filesystem/name order | **NO** | Dependency failures occur before base schema; later order also resurrects obsolete functions/triggers/views and produces behavior different from historical intent. |
| C. Follow README/DEPLOYMENT instructions | **NO** | Both instruct running only `supabase/schema.sql`, explicitly treating it as the main/current schema despite the missing objects above. |

Even a manually inferred order remains **UNCERTAIN** without executing against an isolated Supabase project because duplicate policy names, enum transaction semantics, view replacement dependencies, extension availability, and final trigger interactions are not covered by database integration tests.

## 14. Critical Risks

1. Privileged revision RPC caller impersonation (`p_client_id`).
2. Unauthenticated-in-function revised-proof privilege (`p_uploader_id`).
3. Cross-client communication exposure and mutation.
4. Arbitrary stage-skip mutation/deletion by any authenticated user.
5. Forged admin override audit events.
6. Non-deterministic final database state from loose, duplicate SQL files.
7. Atomic revision workflow can be silently undone by later execution of `schema.sql`/milestone scripts.
8. Calendar-day SQL deadlines disagree with working-day UI deadlines.
9. Base install lacks required workflow state/enum fields while frontend suppresses some incompatibilities.
10. No persisted stage-history source is loaded after refresh.
11. Canonical stage names and legacy trigger names compete on every project write.
12. Free-text `service_type` is the only print/eBook routing source and SQL/frontend skip rules differ.
13. Client summary view shape depends on last replacement and can expose all project columns.
14. Missing RAG table/function definitions prevent clean AI database reproduction.
15. Several multi-row workflow actions are non-atomic and ignore secondary-write errors.

## 15. Recommended Consolidation Order

The following is a proposed future remediation sequence, not implemented by this audit:

1. Capture a read-only live schema dump and migration ledger from each environment.
2. Decide the canonical project status, canonical eight stage names, clock states, timeline states, and service capability model.
3. Produce one additive baseline migration for extensions, enums/domains/checks, tables, columns, FKs and indexes.
4. Create compatibility/backfill SQL mapping legacy stages/statuses to canonical values without deleting historical migrations.
5. Replace competing views with one explicit, least-privilege client projection.
6. Consolidate business-day logic in SQL and align frontend tests against it, including per-project weekend overrides and skipped stages.
7. Replace stage advancement, approval, skip, override, revision and completion writes with authorized, row-locked, idempotent RPCs.
8. Make each workflow RPC atomically update project snapshot, history and notifications.
9. Replace workflow and communication RLS with role/project/client-access checks; explicitly revoke public execute on SECURITY DEFINER functions before narrow grants.
10. Load persisted stage history/skips/overrides in frontend state and stop treating synthesized history as authoritative.
11. Remove warning-only success paths for required schema/workflow writes; expose actionable compatibility errors.
12. Add clean-database, migration-upgrade, RLS role-matrix, concurrency/idempotency and frontend/SQL deadline parity tests.
13. Update README and deployment documentation only after the consolidated migration is verified.

## Prioritized Issue Table

| ID | Severity | Area | Problem | Affected files | Recommended resolution |
|---|---|---|---|---|---|
| P6-001 | CRITICAL | RPC authorization | Client revision RPC trusts `p_client_id` instead of binding identity to `auth.uid()`. | `fix-client-revision-workflow-atomic.sql` | Derive client ID from `auth.uid()`, validate role/access/current stage, and reject mismatched supplied identity. |
| P6-002 | CRITICAL | RPC authorization | Revised-proof RPC has no caller authorization and trusts uploader ID. | `fix-client-revision-workflow-atomic.sql` | Derive uploader, enforce manager/assignee/project access, validate request state. |
| P6-003 | CRITICAL | RLS | Any authenticated user can mutate/delete all stage-skip rows. | `time-aware-production-timeline.sql` | Separate policies by operation and bind requester/client/manager permissions to project access. |
| P6-004 | CRITICAL | RLS/audit | Any authenticated user can forge admin override records. | `time-aware-production-timeline.sql` | Admin-only insert with `actor_id=auth.uid()`; make audit rows immutable. |
| P6-005 | HIGH | Communication RLS | All authenticated users can access all messages and related entities. | `communication-schema.sql` | Membership/project-access policies on every communication table. |
| P6-006 | HIGH | Conversation RLS | Second permissive SELECT policy defeats client-scoped conversation policy. | `communication-schema.sql` | Remove mistaken policy and test permissive-policy OR behavior across roles. |
| P6-007 | HIGH | Migration integrity | No deterministic migration order; 16 function names are duplicated. | all `supabase/*.sql` | Introduce numbered additive consolidation migration plus verified baseline. |
| P6-008 | HIGH | Workflow trigger | Legacy timeline trigger rewrites canonical frontend stages/statuses. | `milestone-production-timeline.sql`, `calendar-timeline-due-dates.sql`, `timeline.ts` | Choose one canonical DB state machine and retire trigger behavior through a future additive replacement. |
| P6-009 | HIGH | Deadlines | SQL calendar dates conflict with frontend working days and weekend override. | timeline SQL, atomic revision SQL, `date.ts`, `timeline.ts` | One tested business-calendar function used by RPCs and mirrored/tested in frontend. |
| P6-010 | HIGH | Base schema | Base schema lacks current clock/history tables and modern enum values. | `schema.sql`, `time-aware-production-timeline.sql`, enum fix | Consolidated baseline/additive migration and updated setup instructions. |
| P6-011 | HIGH | History integrity | All authenticated users can read/insert arbitrary stage history. | `time-aware-production-timeline.sql` | Project-visible SELECT; RPC/trigger-only insert; immutable rows. |
| P6-012 | HIGH | Approval RPC | No current-stage validation, row lock, repeat guard, or service-type skip handling. | both timeline SQL files | Authorized, locked, idempotent approval RPC with canonical transitions. |
| P6-013 | HIGH | Profiles privacy | Broad profile SELECT policy coexists with restrictive base policy. | `add-signup-trigger-update.sql`, `schema.sql` | Consolidate policy names/intent and expose only needed directory fields. |
| P6-014 | HIGH | Access helper | Multiple SECURITY DEFINER access definitions; fuzzy name matching and missing explicit revoke. | client access SQL, `schema.sql` | Canonical direct-FK/access-table helper; revoke public; avoid fuzzy authorization. |
| P6-015 | MEDIUM | Persistence | Milestone fallback suppresses both RPC and direct-update failures. | `useTracker.ts::approveProjectMilestone` | Throw if fallback fails and use one atomic RPC. |
| P6-016 | MEDIUM | Persistence | Project update tolerates missing schema and legacy enum fallback. | `useTracker.ts::updateProject/createProject` | Fail with explicit migration compatibility error after consolidation. |
| P6-017 | MEDIUM | Persistence | Revised-proof flow ignores several DB errors and bypasses its atomic RPC. | `useTracker.ts::uploadRevisedProof` | Call authorized atomic RPC and validate storage transaction boundary. |
| P6-018 | MEDIUM | Persistence | Skip response and admin override are non-atomic multi-write flows. | `useTracker.ts` | Dedicated transactional RPCs. |
| P6-019 | MEDIUM | Stage history | Persisted history/skips/overrides are not loaded; local history disappears. | `useTracker.ts`, `timeline.ts` | Query scoped tables and define DB history as source of truth. |
| P6-020 | MEDIUM | State validation | Clock, skip, and history states are free text; timeline constraint rejects current values. | time-aware/milestone SQL, `types.ts` | Canonical enums/check constraints after safe backfill. |
| P6-021 | MEDIUM | Service routing | Frontend and SQL disagree on print-only/eBook-only skipping; form always assumes eBook. | `timeline.ts`, `ProjectFormModal.tsx`, timeline SQL | Explicit service capabilities and shared routing tests. |
| P6-022 | MEDIUM | Client view | Competing view definitions vary from limited fields to `p.*`. | invoice/client/timeline/revision/schema SQL | One explicit secure view containing required client-safe fields. |
| P6-023 | MEDIUM | Revision triggers | Obsolete trigger can coexist with atomic RPC and has no eBook branch. | schema, milestone, revision fix SQL | Remove/redefine via future migration after state backfill; ensure one transition owner. |
| P6-024 | MEDIUM | AI schema | RAG references undefined `knowledge_base` and `match_knowledge_base_chunks`. | `ai-assistant-schema.sql`, `ai-rag/index.ts` | Define one source table/view and vector-match RPC with scoped permissions. |
| P6-025 | MEDIUM | AI authorization | Policies use JWT role rather than `profiles.role`. | `ai-assistant-schema.sql` | Use canonical role helper or documented custom-claims strategy. |
| P6-026 | LOW | Naming | Calendar-named frontend constants/functions actually use working days. | `timeline.ts` | Rename after behavior consolidation to prevent future mistakes. |
| P6-027 | LOW | Types | `requirements_submitted_at` has no SQL/runtime implementation. | `types.ts` | Remove or formally add during schema design, based on product decision. |
| P6-028 | LOW | Documentation | Setup guides claim `schema.sql` is current/complete. | README, `SIMPLE_SETUP_GUIDE.md`, `DEPLOYMENT.md` | Update only after verified consolidated migration exists. |
