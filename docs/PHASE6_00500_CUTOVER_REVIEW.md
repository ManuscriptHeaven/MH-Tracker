# Phase 6 Migration 00500 Cutover and Validation Review (V3)

## 1. Executive Summary & V3 Review Corrections

Migration `00500_phase6_cutover_and_validation.sql` is the final cutover and validation step of Phase 6. It transitions the database from the transitional compatibility state (enabled during Step 3 migrations 00100–00460) into the final production-safe canonical state.

### V2 Staging Rehearsal & V3 Corrections
The V2 draft was independently reviewed and executed in a transactional staging rehearsal (`BEGIN ... ROLLBACK`). **The V2 migration was NOT committed**, leaving no cutover state behind. Staging execution revealed two runtime adjustments and verified full successful execution after forward resolution:

1. **Project Rowtype Typing (`ERROR 42846` Fix):**
   - *V2 Issue:* In V2, `v_proj record;` was passed to `public._workflow_validate_tuple(v_proj)`. Managed PostgreSQL failed with `ERROR 42846: cannot cast type record to projects` because `_workflow_validate_tuple` requires the composite table type `public.projects`.
   - *V3 Correction:* In both preflight and final verification DO blocks, `v_proj` is declared as `public.projects%rowtype;`.
2. **Actionable Project Tuple Invariant Reporting:**
   - *V2 Issue:* When invalid tuples were encountered during rehearsal, the exception reported only the raw error `workflow_invalid_state` without identifying which project row caused the failure.
   - *V3 Correction:* The tuple validation call is wrapped in an exception handler that identifies the offending project number and UUID:
     `phase6_cutover_blocked_invalid_workflow_tuple: project <project_number> (<id>): <original error>`.
3. **Managed-Supabase Owner-Role Bootstrap Grants Reality:**
   - *V2 Issue:* V2 attempted `REVOKE <owner role> FROM postgres;` and required zero membership rows for `postgres` in `pg_auth_members`. On managed Supabase, ownership-bootstrap grants are created by `supabase_admin`:
     ```text
     member_name    = postgres
     grantor_name   = supabase_admin
     admin_option   = true
     inherit_option = false
     set_option     = false
     ```
     Attempting to revoke this grant as `postgres` raises `ERROR 42501: permission denied to revoke privileges granted by role "supabase_admin"`. Because `postgres` cannot impersonate `supabase_admin`, zero-membership is impossible in managed Supabase.
   - *V3 Correction:* Removed the unachievable `REVOKE <owner> FROM postgres;` statements. The security invariant is redefined from "zero membership rows" to **"no usable owner-role capability"**:
     - No role other than `postgres` is a member of either dedicated owner role.
     - Any `postgres` membership retains `inherit_option = false` and `set_option = false`.
     - `pg_has_role('postgres', role, 'USAGE') = false`
     - `pg_has_role('postgres', role, 'SET') = false`
     - Dedicated owner roles maintain all 7 safety flags (`NOSUPERUSER`, `NOINHERIT`, `NOCREATEROLE`, `NOCREATEDB`, `NOLOGIN`, `NOREPLICATION`, `NOBYPASSRLS`).
     - Dedicated owner roles hold zero `CREATE` privilege on schema `public`.
4. **Staging Synthetic Test-Data Fixtures (Explicit Notice):**
   - During staging rehearsal, three synthetic test projects (`STG-005`, `STG-006`, and `STG-009`) failed tuple validation due to intentional test ambiguities.
   - These were resolved explicitly outside 00500 using canonical RPCs (`workflow_update_project_configuration` for `STG-009`; explicit lifecycle/stage assignments for `STG-005` and `STG-006`).
   - **No repair or stage-guessing heuristics are encoded into 00500.** Production cutover remains strictly fail-closed, surfacing ambiguous rows for explicit operator remediation.
5. **Full Rehearsal Success:**
   - After applying the `projects%rowtype` correction, actionable exception handling, and managed owner-membership safety checks, the complete 00500 migration executed successfully inside a transactional probe (`BEGIN ... ROLLBACK`) on managed Supabase staging.
6. **Byte-for-Byte Migration Integrity:**
   - Migrations `00100` through `00460` remain byte-for-byte identical. No Supabase instances were mutated outside rollback probes.

---

## 2. Exact Objects Retired and Rationale

### Legacy Triggers Dropped
The following conflicting triggers bypassed canonical RPC state transitions and could asynchronously corrupt workflow state on project/revision writes:
- `apply_project_timeline_trigger` on `public.projects`: Legacy timeline calculation trigger that overwrote stages and statuses based on legacy date columns.
- `project_notifications_trigger` on `public.projects`: Legacy notification trigger replaced by canonical workflow event notification routing (`_workflow_notify`).
- `log_project_status_change` on `public.projects`: Legacy status audit trigger superseded by canonical `project_stage_history` events.
- `auto_link_client_project_access_trigger` on `public.projects`: Legacy access mapping trigger superseded by explicit client project access management.
- `touch_projects_updated_at` on `public.projects`: Superseded by canonical `phase6_touch_project_metadata_updated_at` guard trigger.
- `apply_revision_request_timeline_trigger` on `public.revision_requests`: Superseded by `workflow_submit_client_revision` and `workflow_submit_revised_proof`.
- `revision_request_timeline_trigger` on `public.revision_requests`: Competing timeline updater superseded by canonical RPCs.
- `mark_project_revision_requested_trigger` on `public.revision_requests`: Legacy status flagger superseded by canonical revision workflows.
- `revision_request_notifications_trigger` on `public.revision_requests`: Superseded by canonical notification dispatch.
- `set_revision_completed_at_trigger` on `public.revision_requests`: Replaced by atomic revision resolution inside `workflow_submit_revised_proof`.
- `touch_revision_requests_updated_at` on `public.revision_requests`: Replaced by canonical RPC timestamp stamping.
- `revised_proof_uploaded_trigger` on `public.revision_attachments`: Superseded by `workflow_submit_revised_proof`.

### Legacy Functions Dropped (RESTRICT Semantics)
The following obsolete callable entry points are dropped via catalog query with `RESTRICT`:
- `public.client_approve_project_milestone`
- `public.submit_client_revision`
- `public.submit_revised_proof`
- `public.client_respond_revision`
- `public.apply_revision_request_timeline`
- `public.mark_project_revision_requested`
- `public.apply_project_timeline`
- `public.create_timeline_deadline_notifications`
- `public.create_project_notifications`
- `public.notify_revision_watchers`
- `public.set_revision_completed_at`
- `public.notify_revised_proof_uploaded`
- `public.log_project_status_change`
- `public.auto_link_client_project_access`

---

## 3. Exact Grants and Revokes Changed

1. **Schema Privilege Clean-up**:
   - `revoke create on schema public from phase6_workflow_rpc_owner;`
   - `revoke create on schema public from phase6_app_security_owner;`
   - Closes temporary DDL creation privileges on schema public.
2. **Private Bridge Protection**:
   - `revoke all on function public.phase6_auth_uid() from public, anon, authenticated;`
   - Asserts private bridge execution remains restricted exclusively to authorized owner roles.
3. **Trigger Function ACLs**:
   - `revoke all on function public.phase6_touch_project_metadata_updated_at() from public, anon, authenticated;`
   - `revoke all on function public.phase6_guard_history_append_only() from public, anon, authenticated;`
   - Prevents direct execution of trigger functions by client callers.

---

## 4. Exact Preflight Blockers

00500 executes transaction preflight checks and halts immediately if any of the following conditions exist:
1. **Missing Owner Roles or Unsafe Attributes**: `phase6_workflow_rpc_owner` or `phase6_app_security_owner` missing or possessing any privileged attributes (`rolsuper`, `rolinherit`, `rolcreaterole`, `rolcreatedb`, `rolcanlogin`, `rolreplication`, `rolbypassrls`).
2. **Missing/Misconfigured Private Bridge**: `public.phase6_auth_uid()` missing, not `RETURNS uuid`, not `STABLE`, not `SECURITY DEFINER`, not fixed search path, body does not delegate solely to `auth.uid()`, or accessible to public/anon/authenticated.
3. **Incomplete or Drifted Stage Definitions**: `public.workflow_stage_definitions` fails exact symmetric difference comparison against canonical 8-stage rows.
4. **Drifted Canonical RPC Signatures**: Any of the 11 canonical mutation RPC signatures missing, not owned by `phase6_workflow_rpc_owner`, lacking `authenticated` EXECUTE, granting `anon` EXECUTE, or having unexpected overloads.
5. **Unresolved Error-Level Backfill Issues**: Any unresolved row in `public.phase6_backfill_issues` with `severity = 'error'`.
6. **Active Project Capability Ambiguity**: Any non-closed project (`project_status not in ('completed','cancelled','archived')`) where:
   - `service_capability_status = 'needs_review'`, OR
   - `requires_print is null`, OR
   - `requires_ebook is null`, OR
   - both `requires_print` and `requires_ebook` are `false`.
7. **Canonical Tuple Invariant Violations**: Any project row that fails `public._workflow_validate_tuple(p)` (actionably reporting project number and ID) or possesses negative counter values.

---

## 5. Distinction Between Blocking and Informational Backfill Issues

| Issue Code | Severity | Classification | Cutover Impact | Resolution / Handling |
| :--- | :--- | :--- | :--- | :--- |
| `CAPABILITY_CONFLICT` | `error` | **Blocking** | **HALTS CUTOVER** | Requires manual Admin/PM configuration resolution. |
| `WORKFLOW_STATE_CONTRADICTORY` | `error` | **Blocking** | **HALTS CUTOVER** | Milestone evidence directly contradicts format flags. Must be resolved prior to cutover. |
| `CAPABILITY_UNRESOLVED` | `warning` | **Blocking for Active Projects** | **HALTS CUTOVER IF ACTIVE** | Active projects must have a deterministic route (`requires_print` / `requires_ebook`). Closed/historical projects permitted with notice. |
| `REVISION_COUNT_DISCREPANCY` | `warning` | **Informational / Non-Blocking** | Permitted | Reconciled by 00200 to greatest supported value; no rows fabricated. |
| `REVISION_ROUND_CONFLICT` | `warning` | **Informational / Non-Blocking** | Permitted | Historical legacy round inconsistencies documented for auditing. |
| `TIMESTAMP_UNRELIABLE` | `warning` | **Informational / Non-Blocking** | Permitted | Legacy date collision preserved with timestamp precedence. |
| `REVISION_STAGE_AMBIGUOUS` | `warning` | **Informational / Non-Blocking** | Permitted | Historical legacy revisions without clear stage binding retained as-is. |
| `REVISION_STATUS_AMBIGUOUS` | `warning` | **Informational / Non-Blocking** | Permitted | Completed revision without strictly later approval timestamp documented. |
| `SKIP_STAGE_AMBIGUOUS` | `warning` | **Informational / Non-Blocking** | Permitted | `SERVICE_TYPE_PRESET` rows safely retained without canonical skip grant. |
| `OVERRIDE_STATE_AMBIGUOUS` | `warning` | **Informational / Non-Blocking** | Permitted | Historical overrides missing explicit stage keys documented. |
| `LEGACY_TOTAL_UNIT_UNCERTAIN` | `warning` | **Informational / Non-Blocking** | Permitted | Calendar-day calculations preserved in legacy column; canonical counters initialized cleanly. |
| `HISTORY_SEQUENCE_CONFLICT` | `warning` | **Informational / Non-Blocking** | Permitted | UUID tie-breaker ordering for tied legacy timestamps documented. |

---

## 6. Canonical Invariants Asserted

1. **Canonical Stage Definition Seed**: Exactly 8 stages in `workflow_stage_definitions` in valid sequential order matching authoritative attributes.
2. **Canonical Project Tuple Rules (`_workflow_validate_tuple`)**:
   - `project_status`, `workflow_stage_key`, `workflow_stage_status_key`, `workflow_waiting_on_key` are non-null.
   - Completed projects must be at `final_delivery`, status `completed`, waiting-on `none`, with non-null `delivered_at`.
   - Paused projects (`on_hold`, `cancelled`, `archived`) must have status `paused` and waiting-on `none`.
   - Active stages conform to allowed status/waiting-on matrices.
3. **Validated Deferred Constraints**:
   - `projects_workflow_version_nonnegative`: `workflow_version >= 0`
   - `projects_production_seconds_total_nonnegative`: `production_seconds_total >= 0`
   - `projects_client_wait_seconds_total_nonnegative`: `client_wait_seconds_total >= 0`
   - `project_stage_history_production_delta_nonnegative`: `production_seconds_delta >= 0`
   - `project_stage_history_client_wait_delta_nonnegative`: `client_wait_seconds_delta >= 0`
   - `project_stage_history_metadata_object`: `jsonb_typeof(metadata) = 'object'`
   - `notifications_revision_request_id_fkey`: Foreign key integrity validated.
4. **Canonical Mutation Surface**: Exactly the 11 reviewed RPCs remain executable by `authenticated` and owned by `phase6_workflow_rpc_owner`.

---

## 7. Security Invariants Asserted

1. **Owner Isolation & Managed Privileges**:
   - `phase6_workflow_rpc_owner` and `phase6_app_security_owner` remain `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOLOGIN`, `NOREPLICATION`, `NOBYPASSRLS`, `NOINHERIT`.
   - No role other than `postgres` is a member of either dedicated owner role in `pg_auth_members`.
   - Managed `postgres` membership holds `inherit_option = false` and `set_option = false`.
   - `pg_has_role('postgres', role, 'USAGE') = false` and `pg_has_role('postgres', role, 'SET') = false`.
   - Dedicated owner roles hold zero `CREATE` privilege on schema `public`.
2. **Private Identity Bridge**: `public.phase6_auth_uid()` is denied to `PUBLIC`, `anon`, and `authenticated`, and callable only by dedicated owner roles.
3. **Row-Level Security (RLS)**: Active on all 24 protected tables with zero unconditional `USING(true)` or `WITH CHECK(true)` policies for `authenticated`.
4. **Client Zero Direct Access**: Zero direct RLS policies on `public.projects` for Client roles.
5. **Client Projection Views**: All 5 client projection views maintain `security_invoker = true`.
6. **Append-Only History**: `project_stage_history` is protected by `phase6_guard_history_append_only_trigger` against UPDATE/DELETE, and authenticated callers have zero direct mutation privileges.
7. **Direct Workflow Field Write Denials**: `phase6_touch_project_metadata_updated_at` denies any direct update of workflow authority columns by callers other than `phase6_workflow_rpc_owner` on UPDATE. Trigger is never attached to INSERT.
8. **Finance & Payroll**: Business finance is strictly Admin/PM accessible; payroll is Admin-managed with self-only Employee access.

---

## 8. What Remains Intentionally Deferred to Phase 6B

- **AI/RAG Architectural Redesign**: Complete schema redesign of `knowledge_base`, embeddings, and vector similarity search functions (`match_knowledge_base`, `match_messages`).
- **Vector Extension Schema Relocation**: Relocation or alteration of `extensions.vector`.
- **Cosmetic Linter Silencing**: Unrelated legacy cleanup on historical non-Phase 6 tables.

---

## 9. Rollback / Failure Behavior

- 00500 executes within a single database transaction (`BEGIN; ... COMMIT;`).
- Any preflight failure, invariant violation, or constraint failure raises an exception and triggers an immediate PostgreSQL transaction `ROLLBACK`.
- Because the migration is atomic, an aborted migration leaves the database in the fully functional Step 3 compatibility state with zero partial state or data corruption.
- In the event of a failure, forward repair is performed via canonical RPCs before re-attempting migration.

---

## 10. Assumptions Requiring Staging Proof

1. All active staging projects have resolved print/eBook capabilities (`service_capability_status <> 'needs_review'`).
2. No active backfill issues with `severity = 'error'` remain in staging.
3. PostgREST correctly picks up schema changes following `notify pgrst, 'reload schema'`.
4. Staging validation confirms no outside unmanaged callers depend on the 14 dropped legacy functions.

---

## 11. Static Test Results

All six static test suites pass locally:

### 1. `node scripts/phase6-engine-static-tests.mjs`
```json
{
  "staticChecks": "passed (source assertions, NOT PostgreSQL execution)",
  "migrations": 6,
  "stageSeeds": 8,
  "newTables": 1,
  "newTypes": 1,
  "helperFunctions": 55,
  "newInternalHelpers": 12,
  "publicMutationRPCs": 11,
  "sqlTestFiles": 4,
  "genericSnapshotFields": 20,
  "fingerprint": "SHA-256 hex via catalog-resolved pgcrypto"
}
```

### 2. `node scripts/phase6-security-static-tests.mjs`
```json
{
  "staticChecks": "passed (source assertions, NOT PostgreSQL execution)",
  "phase6Migrations": 6,
  "canonicalRpcOwners": 11,
  "ownerInternalExecuteGrants": 54,
  "clientProjectFields": 48,
  "frontendFiles": 128,
  "frontendDigest": "staging-corrected source bytes"
}
```

### 3. `node scripts/phase6-core-security-static-tests.mjs`
```json
{
  "staticChecks": "passed (source assertions, NOT PostgreSQL execution)",
  "phase6Migrations": 6,
  "reservedCutover00500": "authored",
  "appSecurityDefiners": 14,
  "inScopeTables": 13,
  "frontendFiles": 128,
  "frontendDigest": "staging-corrected source bytes"
}
```

### 4. `node scripts/phase6-finance-security-static-tests.mjs`
```json
{
  "staticChecks": "passed (source assertions, NOT PostgreSQL execution)",
  "phase6Migrations": 6,
  "reservedCutover00500": "authored",
  "businessFinanceTables": 3,
  "payrollTables": 2,
  "financeSecurityDefiners": 0,
  "legacyUnsafeFinanceRpcs": 0,
  "clientBillingProjection": "not required",
  "frontendFiles": 128,
  "frontendDigest": "staging-corrected source bytes"
}
```

### 5. `node scripts/phase6-frontend-cutover-static-tests.mjs`
```json
{
  "staticChecks": "passed (frontend source assertions, NOT PostgreSQL execution)",
  "canonicalWorkflowRpcs": 11,
  "legacyWorkflowRpcCalls": 0,
  "directProtectedProjectUpdates": 0,
  "reservedCutover00500": "authored",
  "migrationHashes": "pinned final staging-correction bytes",
  "exactRpcSignatures": "migration 00300 matched",
  "uiReachable": {
    "workflow_advance_stage": true,
    "workflow_submit_stage_for_approval": true,
    "workflow_client_approve_stage": true,
    "workflow_submit_client_revision": true,
    "workflow_submit_revised_proof": true,
    "workflow_request_stage_skip": true,
    "workflow_respond_stage_skip": true,
    "workflow_admin_override": true,
    "workflow_complete_final_delivery": true,
    "workflow_set_project_lifecycle": true,
    "workflow_update_project_configuration": true
  }
}
```

### 6. `node scripts/phase6-cutover-static-tests.mjs`
```json
{
  "cutoverStaticChecks": "passed (00500 V3 source assertions, NOT PostgreSQL execution)",
  "migrationHashesVerified": 6,
  "cutoverMigration": "00500_phase6_cutover_and_validation.sql",
  "canonicalRpcChecks": 11,
  "deferredConstraintsValidated": 7,
  "retiresLegacySurfaces": true,
  "noCascadeInRetirement": true,
  "projectGuardIsUpdateOnly": true,
  "projectRowtypeTyped": true,
  "actionableTupleErrors": true,
  "ownerRoleAttributesChecked": true,
  "managedSupabaseMembershipSafe": true,
  "exactStageDefinitionsChecked": true,
  "exactRpcSignaturesChecked": true,
  "privateBridgeChecked": true,
  "noDestructiveMutations": true,
  "noCapabilityGuessing": true,
  "noSecretLeaks": true
}
```

---

## 12. Build Result

Command: `npm run build` (`tsc && vite build`)
Result: **Exit code 0**

---

## 13. Hashes of Migrations 00100–00500

| Migration File | SHA-256 Hash | Status |
| :--- | :--- | :--- |
| `00100_phase6_canonical_foundation.sql` | `3bdae7a341b22699cb8879a3508e3f97eb76e1e09287949ebd7fe93aed1ee21a` | Byte-for-byte unchanged |
| `00200_phase6_legacy_backfill.sql` | `848c80db812dfa583c563fc9b73c44deebf6130d56578946712a78003cbb2cfc` | Byte-for-byte unchanged |
| `00300_phase6_workflow_rpcs.sql` | `296b77041d7af216c499c50a7e91866cb70d2f7e4fb9e36f6410e86bf6c7e767` | Byte-for-byte unchanged |
| `00400_phase6_security_and_projections.sql` | `22a852cf39d1e6d3292d98fcdc8ad90663770864e65592472a9b783565415628` | Byte-for-byte unchanged |
| `00450_phase6_core_application_security.sql` | `fcffa593f087308a87c5d58e974cfbb81f13c2335429da82c24bfe8c11c980ee` | Byte-for-byte unchanged |
| `00460_phase6_finance_payroll_security.sql` | `927032d087c2f1cd9faaa59ba10a9dbf76afb8a47b074dff029d7ced19b76add` | Byte-for-byte unchanged |
| `00500_phase6_cutover_and_validation.sql` | `8439ce1388eccc8bf1090a8cd3effd5c6f0e0ec6c991e1b3d84cc0d278f0038f` | **V3 authored 00500** |

---

## 14. Confirmation: Migrations 00100–00460 Remained Unchanged

All six previously accepted migrations (`00100` through `00460`) were verified byte-for-byte via SHA-256 against their accepted canonical values. Zero modifications were made to any previously accepted migration.

---

## 15. Repository Checks

### `git diff --check`
Exit code: `0` (clean, no trailing whitespace or whitespace errors).

### `git status --short`
```text
 M src/App.tsx
 M src/components/ProjectDetail.tsx
 M src/components/ProjectFormModal.tsx
 M src/lib/constants.ts
 M src/lib/notifications.ts
 M src/lib/types.ts
 M src/lib/useTracker.ts
 M src/pages/ProjectsPage.tsx
 M src/pages/RevisionRequestsPage.tsx
 M src/pages/TeamPage.tsx
?? PHASE6_00500_MANIFEST.txt
?? PHASE6_SQL_TEST_MANIFEST.txt
?? docs/
?? scripts/phase6-core-security-static-tests.mjs
?? scripts/phase6-cutover-static-tests.mjs
?? scripts/phase6-engine-static-tests.mjs
?? scripts/phase6-finance-security-static-tests.mjs
?? scripts/phase6-frontend-cutover-static-tests.mjs
?? scripts/phase6-security-static-tests.mjs
?? src/lib/workflowClient.ts
?? supabase/config.toml
?? supabase/phase6/migrations/
?? supabase/tests/
```
