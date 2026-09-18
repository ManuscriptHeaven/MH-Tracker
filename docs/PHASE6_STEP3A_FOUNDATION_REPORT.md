# Phase 6 Step 3A Foundation Report

Date: 2026-09-08  
Revision: Step 3A.1 compatibility corrections, Step 3B.1 upgrade timestamp corrections, and history display-stage nullability correction applied  
Scope: deterministic structural foundation only. No live Supabase connection, legacy backfill, workflow RPC implementation, frontend workflow switch, final RLS replacement, deployment, or legacy-trigger removal was performed.

## 1. Files Created or Modified

Created:

- `supabase/config.toml`
- `supabase/phase6/migrations/00100_phase6_canonical_foundation.sql`
- `docs/PHASE6_STEP3A_FOUNDATION_REPORT.md`

Existing tracked files modified: none.

Step 3A.1 modified only the untracked foundation migration and this report, as required. The subsequent Step 3B.1 correction modifies both existing migrations and both foundation/backfill reports; it creates no file.

The existing root-level `supabase/*.sql` scripts, application source, `package.json`, deployment files, Phase 6 audit, and Phase 6 design were not modified. `npm run build` regenerated ignored `dist/` output only.

## 2. Supabase Tooling Detected

| Command | Result |
|---|---|
| `supabase --version` | Exit 1: command not found |
| `psql --version` | Exit 1: command not found |
| `docker --version` | Exit 1: command not found |

No packages or tools were installed from the network.

## 3. Clean-Database Validation

**LOCAL DB VALIDATION BLOCKED: Supabase CLI, PostgreSQL `psql`, and Docker are all unavailable on this machine.**

The migration was not executed against a database. It must not be described as clean-install-verified or production-upgrade-safe. Static validation was performed instead and is documented below.

## 4. Structural Objects Added

The foundation describes 37 application tables: the 35 repository-effective tables plus the new `workflow_stage_definitions` and `workflow_calendar_exceptions` tables.

The migration creates or extends:

- core/project structures: profiles, projects, project payments, notes, activity, notifications, client access, tasks, revision tables, and team members;
- finance and payroll structures;
- all six communication tables;
- all eight currently defined AI tables;
- the three workflow audit tables;
- the two new workflow reference/calendar tables.

It also establishes the projects number sequence, `pgcrypto`, `vector`, the private `revision-files` bucket record, the four currently required realtime publication memberships, and 68 named indexes. It defines no application user seed.

## 5. Canonical Enum/Types Added

Eight canonical Phase 6 enum types are defined:

1. `project_lifecycle_status`
2. `workflow_stage`
3. `workflow_stage_status`
4. `workflow_waiting_on`
5. `workflow_revision_status`
6. `workflow_skip_status`
7. `workflow_event_type`
8. `service_capability_status`

The migration also defensively creates/preserves six existing application enums and their known current values. No legacy enum value is removed.

## 6. Canonical Project Columns Added

Thirteen additive canonical columns are added to `public.projects`:

1. `project_status`
2. `workflow_stage_key`
3. `workflow_stage_status_key`
4. `workflow_waiting_on_key`
5. `requires_print`
6. `requires_ebook`
7. `service_capability_status`
8. `capabilities_resolved_by`
9. `capabilities_resolved_at`
10. `workflow_version`
11. `production_seconds_total`
12. `client_wait_seconds_total`
13. `delivered_at`

`project_status` is explicitly nullable and has no default. No lifecycle or service capability inference occurs. Existing `current_stage`, `stage_status`, `waiting_on`, and `timeline_status` remain their legacy types and receive no new canonical check constraint.

The three nullable shadow keys let migrations 1-4 and the legacy frontend coexist safely: Step 3B can populate canonical state without overwriting the text fields the current UI still reads and writes. `timeline_status` remains compatibility-only and will eventually be derived. Only stage and stage-status shadows are indexed; no evidence justified a low-selectivity waiting-owner index.

For an existing projects table missing the time-aware compatibility columns, `stage_status`, `stage_started_at`, time totals, revision count, stage JSON, and workflow settings are now added nullable with no defaults. Clean `CREATE TABLE` defaults remain unchanged. This prevents migration time, blanket `ACTIVE`, zero counters, or default settings from being presented as historical evidence.

## 7. Stage Definition Seed Verification

Static inspection found exactly eight deterministic UPSERT rows in canonical order:

1. Files Received — 2 days
2. Design Concept — 3 days
3. Concept Approval — 0 days, client controlled
4. Print Version — 5 days
5. Print Approval — 0 days, client controlled
6. Ebook Version — 5 days
7. Ebook Approval — 0 days, client controlled
8. Final Delivery — 2 days, delivery stage

The table constrains order, display-name uniqueness, production-day range, client/clock semantics, and a single delivery-stage row. A migration-time validation block requires exactly eight rows. Database execution of this assertion is still blocked by missing local tooling.

## 8. Workflow Audit-Table Compatibility Approach

Existing rows and legacy columns are preserved.

- `project_stage_history` receives nullable canonical columns on upgrade via `ADD COLUMN IF NOT EXISTS`. On a clean database its core event, sequence, timestamp, delta, and metadata fields use the stricter canonical nullability. A partial unique index enforces project/sequence uniqueness only for populated canonical rows.
- `project_stage_skips` retains legacy `stage`, `requested_by`, `status`, response timestamp, and client notes. Typed `stage_key`, `requester_id`, `canonical_status`, responder/cancellation fields, idempotency key, and timestamps are additive.
- `admin_workflow_overrides` retains legacy text before/after columns. Typed `previous_stage_key` and `resulting_stage_key`, lifecycle/status/waiting/timestamp snapshots, and idempotency key are additive and nullable for legacy rows.

No audit table receives a new permissive policy or application grant. Existing upgrade policies are not removed until Step 3D.

## 9. Revision Compatibility Approach

`revision_requests` retains its existing text `status` and all legacy values. The migration adds nullable `canonical_status`, `stage_key`, `revision_round`, `parent_revision_request_id`, and `due_at` fields plus non-unique lookup indexes. `revision_requests.status` remains the frontend compatibility field; `revision_requests.canonical_status` is the Phase 6 shadow populated by Step 3B. No legacy row is normalized, no uniqueness rule is imposed before backfill, and no revision trigger or RPC is created/replaced.

## 10. Storage and Realtime Handling

The migration creates/normalizes only the structural private bucket record `revision-files`. It creates no `storage.objects` policy; final storage authorization belongs to Step 3D.

If `supabase_realtime` exists, a guarded block adds `notifications`, `projects`, `revision_requests`, and `finance_transactions` only when they are not already members. It does not create a publication in a non-Supabase PostgreSQL environment and does not swallow publication errors.

## 11. Objects Deliberately Deferred

Deferred to Step 3B:

- lifecycle/stage/waiting/capability/revision/history backfill;
- imported legacy snapshot events;
- strict canonical constraints dependent on normalized data.

Deferred to Step 3C:

- production-day functions;
- time-accounting behavior;
- idempotency receipts;
- all eleven canonical workflow/configuration RPCs;
- compatibility RPC wrappers.

Deferred to Step 3D/3E and frontend cutover:

- final RLS and storage policy replacement;
- SECURITY DEFINER hardening and grants;
- safe profile/client projections;
- direct-write guards;
- removal of obsolete workflow functions/triggers/views;
- frontend state and persistence changes;
- final validation of deferred constraints.

Deferred to Phase 6B:

- undefined `knowledge_base` naming repair;
- `match_knowledge_base_chunks`;
- AI authorization redesign.

## 12. Known Upgrade Uncertainties Requiring Schema Evidence

Production upgrade safety cannot be claimed until a read-only live schema dump and staging rehearsal confirm:

- actual enum definitions/order and whether any same-named object is not an enum;
- actual table column types, defaults, generated expressions, constraints, and FK delete actions;
- which legacy workflow/revision triggers and duplicate functions/views are installed;
- existing RLS/storage policies and grants;
- whether `vector` is installed in `public` or `extensions` and supports the expected operator class;
- publication ownership/permissions and existing realtime membership;
- legacy rows that violate future capability, revision, sequence, or time constraints;
- the existing `project_stage_history`/skip/override FK delete behavior.

For a clean database, `admin_workflow_overrides.actor_id` now uses `ON DELETE RESTRICT`, matching immutable audit evidence. The historical upgrade FK is not destructively replaced; its reconciliation remains a staging-evidence/cutover task.

The migration fails clearly for incompatible canonical enum definitions, missing vector support, conflicting stage-definition seeds, or a non-empty Step 3A calendar. It does not catch those errors merely to report success.

## 13. Validation Command Outputs

Tool detection:

```text
supabase --version -> exit 1, command not found
psql --version     -> exit 1, command not found
docker --version   -> exit 1, command not found
```

Static migration inventory:

```text
TABLE_COUNT=37
TABLE_DUPLICATES=
TYPE_COUNT=14
TYPE_DUPLICATES=
INDEX_COUNT=68
INDEX_DUPLICATES=
FUNCTION_DEFS=0
TRIGGER_DEFS=0
POLICY_DEFS=0
VIEW_DEFS=0
DESTRUCTIVE_DROP=0
DELETE_FROM=0
LEGACY_STATE_TYPE_ALTERS=0
STAGE_SEED_ROWS=8
PHASE6_DELIMITERS=44
SQL_DELIMITERS=2
PARENS_OPEN=449 PARENS_CLOSE=449
STAGE_STATUS_CLEAN_DEFAULT_OCCURRENCES=1
STAGE_STARTED_CLEAN_DEFAULT_OCCURRENCES=1
UPGRADE_STAGE_STATUS_DEFAULT_OCCURRENCES=0
UPGRADE_STAGE_STARTED_DEFAULT_OCCURRENCES=0
```

Expected table-set comparison:

```text
EXPECTED=37 ACTUAL=37
```

Application build:

```text
> manuscript-heaven-tracker@1.0.0 build
> tsc && vite build

vite v6.4.3 building for production...
✓ 1715 modules transformed.
✓ built in 44.31s
```

Vite emitted its existing advisory that a generated JavaScript chunk exceeds 500 kB. The build completed successfully.

Final repository checks:

```text
git status --short --untracked-files=all
?? docs/PHASE6_CANONICAL_DATABASE_WORKFLOW_DESIGN.md
?? docs/PHASE6_DATABASE_WORKFLOW_AUDIT.md
?? docs/PHASE6_STEP3A_FOUNDATION_REPORT.md
?? supabase/config.toml
?? supabase/phase6/migrations/00100_phase6_canonical_foundation.sql
```

```text
git diff --stat
(no output; all Phase 6 files are currently untracked)
```

```text
git ls-files --others --exclude-standard
docs/PHASE6_CANONICAL_DATABASE_WORKFLOW_DESIGN.md
docs/PHASE6_DATABASE_WORKFLOW_AUDIT.md
docs/PHASE6_STEP3A_FOUNDATION_REPORT.md
supabase/config.toml
supabase/phase6/migrations/00100_phase6_canonical_foundation.sql
```

## 14. Deviations from the Step 2 Design

The canonical behavior is unchanged. Step 3A.1 adds the compatibility shadows required to preserve the legacy frontend through migrations 1-4. Four additive compatibility details differ from final-state naming/strictness:

1. `workflow_revision_status` is created now even though it was not in the Step 3A minimum list, because it is an explicit canonical type in the approved design. The legacy revision status column is not converted.
2. `previous_stage_key`/`resulting_stage_key` are used in the additive override structure because existing rows already use `previous_stage`/`new_stage` as legacy text columns. This avoids destructive type conversion.
3. `project_stage_skips.canonical_status` coexists with legacy text `status` until Step 3B can normalize it safely.
4. A clean database uses `ON DELETE RESTRICT` for project-linked history/skip/override audit rows. An upgrade database's existing `ON DELETE CASCADE` constraints are not replaced in Step 3A; reconciling those FKs requires live/staging evidence and a later reviewed migration.

The clean `admin_workflow_overrides.actor_id` FK also uses `ON DELETE RESTRICT`; an existing historical `SET NULL` actor FK is intentionally untouched pending staging evidence.

No design change is required before Step 3B. The required prerequisite is an executed clean-database test once the local Supabase toolchain is available, followed by a staging-schema rehearsal before any real upgrade.

## 15. Step 3B.1 Timestamp and Backfill Safety Corrections

The upgrade ALTER for `project_stage_history` now adds `occurred_at` and `created_at` nullable with no default. Separate ALTER COLUMN SET DEFAULT statements establish clock_timestamp()/now() for future inserts only. Legacy rows do not acquire Phase 6 execution time. No upgrade NOT NULL is added. Clean CREATE TABLE defaults remain appropriate for new rows.

The same strategy applies to `project_stage_skips.created_at/updated_at`: nullable additions first, defaults afterward. Existing `requested_at/client_response_at` retain the original request/response evidence. Pre-existing timestamp columns and values are not rewritten.

Step 3B.1 orders missing history sequences from legacy completed/paused/resumed/started boundaries, then original created_at, then occurred_at only on a canonical event. Unknown order is diagnosed. Its new snapshot event retains the actual import clock timestamp.

The companion backfill/report also correct same-day Completed revision ambiguity with Asia/Karachi comparisons, independently preserve existing override keys, diagnose canonical lifecycle conflicts, and require one explicit transaction with locks plus a write freeze and runner rehearsal. Delivery DATE imports retain local day start; new revision due DATE imports use inclusive local day end according to the frontend's day-based overdue logic.

An earlier rehearsal that already applied the old timestamp defaults must be rebuilt from its pre-Phase-6 fixture. The corrections cannot distinguish manufactured timestamps from real timestamps in previously modified rows and do not erase evidence.

The counts/build/Git output in section 13 describe the earlier Step 3A.1 run. Step 3B.1 validation is recorded in the companion backfill report. Local PostgreSQL/Supabase execution remains unavailable; no live database was modified.

## 16. Migration-Chain Correction: History Display-Stage Nullability

The legacy `supabase/time-aware-production-timeline.sql` defines `project_stage_history.stage TEXT NOT NULL`, but `projects.current_stage` can legitimately remain NULL when historical evidence is unresolved. Step 3B copies `p.current_stage` directly into its `legacy_snapshot_imported` event. An inherited NOT NULL constraint could therefore abort the backfill transaction.

After creating/extending history, the foundation now explicitly executes `ALTER TABLE public.project_stage_history ALTER COLUMN stage DROP NOT NULL`. Clean creation already declares `stage text` nullable; the upgrade now matches it. This is an idempotent compatibility relaxation, not a data update. Existing stage values, canonical enums, project state, history sequences, and event data are unchanged. No fallback or fabricated stage is introduced. An imported snapshot may retain `stage=NULL`; an ambiguous `workflow_stage_key` may likewise remain NULL. The snapshot is an evidence boundary, not reconstructed history.

### Narrow Snapshot-Target NOT NULL Parity Audit

The snapshot INSERT in migration 2 was compared with the repository's legacy history definition and the foundation's clean/upgrade declarations. Only the `stage` constraint is changed.

| Target | Snapshot value / omission | Repository constraint and result |
|---|---|---|
| `id` | Omitted; generated UUID default | Legacy primary key/default supplies a non-null value. |
| `project_id` | `p.id` | Non-null source primary key satisfies legacy NOT NULL. |
| `stage` | `p.current_stage` | Actual conflict: source is nullable, legacy target was NOT NULL. Corrected by the foundation relaxation. |
| `status` | `p.stage_status` | The same legacy time-aware script adds `projects.stage_status TEXT NOT NULL DEFAULT 'ACTIVE'` before creating history with `status NOT NULL`. No other repository legacy definition makes the source nullable. For older schemas lacking these objects, the foundation adds nullable project status and creates nullable history status. No second conflict established from repository SQL. |
| `actor_id`, `actor_role` | Explicit NULL | Legacy actor ID is nullable; foundation actor role is nullable. No conflict. |
| `action` | Literal `legacy_snapshot_imported` | Non-null literal satisfies legacy NOT NULL. |
| `notes` | Omitted | Legacy and clean definitions allow NULL. |
| `occurred_at` | `clock_timestamp()` | Non-null; this column is absent from legacy history and added by the foundation. |
| `event_type` | Typed `legacy_snapshot_imported` literal | Non-null; absent from legacy history and added by the foundation. |
| `sequence_no` | `coalesce(max(sequence_no) + 1, 1)` | Non-null; absent from legacy history and added by the foundation. |
| `created_at` | `now()` | Non-null value satisfies legacy NOT NULL. |
| `active_seconds`, `client_wait_seconds` | Nonnegative coalesced legacy totals | Non-null expressions; legacy targets are nullable. |
| Canonical production/client deltas | Literal zero | Non-null; clean NOT NULL requirements satisfied. |
| `metadata` | Constructed JSON object | Non-null; clean NOT NULL requirement satisfied. |
| `reason` | Import-boundary literal | Non-null; target is nullable. |
| `started_at`, `due_at`, canonical from/to stage/status/waiting fields | Nullable source values or explicit NULL | All corresponding targets are nullable. |
| Other omitted fields | Defaults or NULL | Previous stage, paused/resumed/completed times, linked request/skip/override IDs, and idempotency key are nullable. |

No additional equivalent blocker was found in this narrow repository-schema audit. This does not establish the constraints of a live database. An externally drifted schema, including a pre-existing nullable `projects.stage_status` combined with a constrained history status, still requires schema inspection during an authorized staging rehearsal; no such additional legacy definition was found in the repository. No other constraint is relaxed here.

Only the existing foundation migration and this report are edited for this correction. Migration 2 remains unchanged and continues to insert `p.current_stage` directly, without COALESCE or a guessed label. No Step 3C migration, RPC, trigger, or test file is created. Exactly two Phase 6 migrations and eight stage seed rows remain. Static checks and the application build are recorded below; neither constitutes PostgreSQL migration execution.

### Correction Validation

In-memory comparison against the pre-edit contents verified that the foundation's only change is the six-line comment/ALTER insertion above its existing timestamp-default block. Migration 2 and the Step 3B report are unchanged. Consequently this correction introduces no history-row UPDATE, fallback value, project-state change, enum change, or sequence/event rewrite.

```text
ONLY_EXPECTED_FOUNDATION_INSERTION=true
BACKFILL_UNCHANGED=true
BACKFILL_REPORT_UNCHANGED=true
CLEAN_HISTORY_STAGE_NULLABLE=true
UPGRADE_STAGE_DROP_NOT_NULL_COUNT=1
SNAPSHOT_STAGE_AND_STATUS_DIRECT=true
FOUNDATION_FUNCTION_DEFINITIONS=0
FOUNDATION_TRIGGER_CHANGES=0
STAGE_SEED_ROWS=8
PHASE6_MIGRATIONS=2
STEP3C_MIGRATION_EXISTS=false
```

`npm run build` passed (`tsc && vite build`, Vite 6.4.3, 1715 modules, Vite build time 5.33s). The existing advisory about chunks larger than 500 kB remains. Only ignored `dist/` build output was regenerated; no frontend source was edited. No dependency or tool was installed. No PostgreSQL migration was executed, and database success is not claimed.

NO LIVE DATABASE WAS MODIFIED. Step 3C.1 remains stopped pending review of this correction.
