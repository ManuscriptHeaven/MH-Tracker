# Phase 6 Canonical Database and Workflow Design

Status: Step 2 architecture decision  
Evidence base: `docs/PHASE6_DATABASE_WORKFLOW_AUDIT.md`, the 35 existing `supabase/**/*.sql` files, and the current TypeScript workflow implementation in `src/lib/timeline.ts`, `src/lib/types.ts`, and `src/lib/useTracker.ts`.  
Scope: target design only. This document does not authorize a production migration, live-database access, deployment, or piecemeal fixes.

## 1. Executive Decision Summary

The canonical model separates project lifecycle, workflow stage, stage execution status, and waiting ownership. The `projects` row is the current-state snapshot; an immutable `project_stage_history` event ledger is the durable workflow and time-accounting source of truth.

The principal decisions are:

1. The lifecycle values are `active`, `on_hold`, `completed`, `cancelled`, and `archived`.
2. The eight official stages are stored as machine keys and displayed with the exact official labels in this document. No legacy stage label is valid canonical data.
3. The stage execution values are `pending`, `active`, `awaiting_client`, `revision_active`, `paused`, `completed`, and `skipped`.
4. Waiting ownership is `team`, `client`, or `none`.
5. `Final Delivery` is a workflow stage only. `Completed` is a lifecycle status only.
6. `Awaiting Client Approval` is not a lifecycle status. It is represented by lifecycle `active`, stage status `awaiting_client`, and waiting owner `client`.
7. The physical `timeline_status` column is deprecated. During compatibility it is derived and dual-written; after cutover it is a projection only.
8. Explicit nullable `requires_print` and `requires_ebook` columns replace routing by free-text `service_type`. Ambiguous legacy rows remain unresolved and are blocked from workflow mutation until reviewed.
9. `workflow_stage_definitions` is a database reference table containing the authoritative stage order and default metadata. Project JSON may override durations and weekend handling, but never order, labels, or control semantics.
10. Eleven transactional workflow/configuration RPCs form the only supported workflow write surface.
11. Every workflow RPC derives identity from `auth.uid()`, validates the profile role and project access, locks the mutable rows, checks an expected workflow version, and honors an idempotency key.
12. Production deadlines and elapsed production time are calculated in PostgreSQL using one business-calendar engine. The initial organization timezone is `Asia/Karachi` and Saturday/Sunday are excluded by default.
13. History is append-only. Corrections are compensating events, never edits or deletes.
14. Projects retain DB-maintained cached time totals for reporting, while history event deltas remain authoritative and can rebuild the caches.
15. Phase 6 uses five ordered migrations. Existing root-level SQL files remain historical references and are not edited or deleted.
16. The AI/RAG schema defects are deferred to Phase 6B, after the workflow and security cutover. AI callers that read or mutate workflow fields must still be updated in the Phase 6 frontend switch.

## 2. Canonical State Vocabulary

Canonical stored values use lower-case snake case. UI labels are presentation, not database state.

| Concept | Canonical field/type | Exact allowed values | Meaning |
|---|---|---|---|
| Project lifecycle | `projects.project_status` / `project_lifecycle_status` | `active`, `on_hold`, `completed`, `cancelled`, `archived` | Overall business lifecycle, independent of the current production stage. |
| Workflow stage | `projects.current_stage` / `workflow_stage` | `files_received`, `design_concept`, `concept_approval`, `print_version`, `print_approval`, `ebook_version`, `ebook_approval`, `final_delivery` | Current position in the fixed production workflow. |
| Stage execution | `projects.stage_status` / `workflow_stage_status` | `pending`, `active`, `awaiting_client`, `revision_active`, `paused`, `completed`, `skipped` | Execution/clock condition of the current stage or of a recorded stage event. |
| Waiting owner | `projects.waiting_on` / `workflow_waiting_on` | `team`, `client`, `none` | Party whose action is required next. |
| Revision | `revision_requests.status` / `workflow_revision_status` | `submitted`, `under_review`, `in_progress`, `ready_for_client_review`, `changes_requested`, `approved`, `cancelled` | State of one explicit revision round. Assignment is a relationship, not a status. |
| Stage skip | `project_stage_skips.status` / `workflow_skip_status` | `pending`, `approved`, `rejected`, `cancelled` | State of a manual client-approved skip request. |
| Timeline display | derived projection | `Active`, `Waiting for Client`, `Revision Active`, `On Hold`, `Completed`, `Cancelled`, `Archived` | Compatibility/display value only; it is not independently writable canonical state. |

Rules:

- `Final Delivery` must not also appear in `project_status`.
- `Completed` must not appear in `current_stage`.
- `Awaiting Client Approval` must not remain in `project_status`.
- Waiting on a client is represented by `project_status='active'`, `stage_status='awaiting_client'`, and `waiting_on='client'`.
- A revision is represented by the existing approval stage as `current_stage`, `stage_status='revision_active'`, and `waiting_on='team'`; a synthetic “revisions” stage is prohibited.
- On hold retains the real current stage, sets lifecycle `on_hold`, stage status `paused`, and waiting owner `none`.
- Cancellation or archive retains the last real stage for audit context, stops all clocks, and sets waiting owner `none`.
- Successful final delivery retains `current_stage='final_delivery'`, sets its stage status to `completed`, and sets lifecycle to `completed`.

`timeline_status` is deprecated because it duplicates the other three dimensions and caused the current contradictions. A compatibility expression derives it as follows:

| Canonical state | Compatibility `timeline_status` |
|---|---|
| lifecycle `on_hold` | `On Hold` |
| lifecycle `completed` | `Completed` |
| lifecycle `cancelled` | `Cancelled` |
| lifecycle `archived` | `Archived` |
| stage status `awaiting_client` | `Waiting for Client` |
| stage status `revision_active` | `Revision Active` |
| otherwise | `Active` |

## 3. Canonical Eight-Stage Workflow

| Order | Stage key | Official display name | Default production days | Clock owner | Client controlled |
|---:|---|---|---:|---|---|
| 1 | `files_received` | Files Received | 2 | Team | No |
| 2 | `design_concept` | Design Concept | 3 | Team | No |
| 3 | `concept_approval` | Concept Approval | 0 | Client | Yes |
| 4 | `print_version` | Print Version | 5 | Team | No |
| 5 | `print_approval` | Print Approval | 0 | Client | Yes |
| 6 | `ebook_version` | Ebook Version | 5 | Team | No |
| 7 | `ebook_approval` | Ebook Approval | 0 | Client | Yes |
| 8 | `final_delivery` | Final Delivery | 2 | Team | No |

Revision work defaults to 2 production days. Production days exclude Saturday and Sunday unless `workflow_settings.exclude_weekends` is false. Approval stages have no production due date; client-wait time is measured separately.

Project capabilities select a deterministic path through the fixed stage list:

- Print-only: stages 1-5, then stage 8; stages 6-7 are automatically skipped.
- Ebook-only: stages 1-3, then stages 6-8; stages 4-5 are automatically skipped.
- Combined: all eight stages.

The canonical workflow never stores `Design Concept in Progress`, `Awaiting Concept Approval`, `Print Version in Progress`, `Awaiting Print Approval`, `eBook in Progress`, `eBook Review`, `Final Quality Check`, `Concept Revisions`, or `Print Revisions`. Those strings exist only in the backfill mapping.

## 4. Project Lifecycle Model

`project_status` represents the project as a business record, not its work queue label.

| Status | Entry rule | Workflow effect | Exit rule |
|---|---|---|---|
| `active` | New resolved-capability project; resume from hold; normal workflow | Current stage may run, wait for client, or run a revision | Pause, completion, cancellation, or archive |
| `on_hold` | Admin or Project Manager pauses an active project | Stop the current clock; retain current stage | Admin or Project Manager resumes to `active` |
| `completed` | `workflow_complete_final_delivery` completes Final Delivery | All clocks stopped; no ordinary transitions | Admin override only; reopening must be explicitly audited |
| `cancelled` | Admin or Project Manager cancels with reason | All clocks stopped; no ordinary transitions | Admin override only |
| `archived` | Admin archives a terminal or inactive record | Read-only operationally; hidden from active lists | Admin unarchives through `workflow_set_project_lifecycle`, restoring the recorded prior lifecycle |

Creating a project with unresolved service capabilities is permitted for data migration, but it enters `files_received/pending/none` and cannot use a workflow mutation RPC until the capabilities are resolved. New UI-created projects must provide both capability booleans and at least one must be true.

## 5. Projects Snapshot Model

The canonical `projects` row is a lockable current-state snapshot optimized for lists, dashboards, authorization, and the next transition. It is not historical evidence.

### Canonical fields retained on `projects`

| Field | Decision | Canonical semantics |
|---|---|---|
| `project_status` | KEEP | New canonical lifecycle enum. Legacy `status` is dual-written temporarily. |
| `current_stage` | KEEP | `workflow_stage`; always one of the eight keys. |
| `stage_status` | KEEP | `workflow_stage_status`; current execution state. |
| `stage_started_at` | KEEP | Start/resume boundary for the currently running clock. Null when no current clock is running. |
| `stage_due_at` | KEEP | Current production/revision deadline. Null for approval/client-wait and stopped states. |
| `stage_completed_at` | KEEP | Completion time of the current stage; normally null until Final Delivery completes. Historical stage completion is in history. |
| `final_due_at` | KEEP | DB-calculated estimated final completion cache; it is advisory and recomputed on relevant transitions/settings changes. |
| `waiting_on` | KEEP | Canonical enum `team`, `client`, or `none`. |
| `workflow_settings` | KEEP | Validated JSON project overrides described below. |
| `revision_count` | KEEP | DB-maintained total accepted revision rounds; never caller-supplied. |
| `workflow_version` | KEEP, NEW | Monotonic bigint incremented on every workflow mutation for stale-write detection. |
| `requires_print`, `requires_ebook`, capability audit fields | KEEP, NEW | Deterministic routing; see section 6. |
| `production_seconds_total`, `client_wait_seconds_total` | KEEP, NEW | DB-maintained caches whose authoritative deltas are in history. |
| `delivered_at` | KEEP, NEW | Canonical timestamp set only by final-delivery completion. |

`workflow_settings` has this validated shape, with missing keys inheriting database defaults:

```json
{
  "exclude_weekends": true,
  "files_received_days": 2,
  "design_concept_days": 3,
  "print_version_days": 5,
  "ebook_version_days": 5,
  "final_delivery_days": 2,
  "revision_days": 2
}
```

All duration values are integers from 0 through 365. Project JSON cannot override stage order, display names, whether a stage is client-controlled, whether a format is required, the organization timezone, or security rules.

### Existing workflow-related column disposition

No column is removed in Step 3. “Remove” below means a later major migration after all readers have switched and retention has been verified.

| Existing field(s) | Phase 6 classification | Compatibility behavior |
|---|---|---|
| `status` | KEEP TEMPORARILY FOR COMPATIBILITY | Map/dual-write from `project_status`; stop accepting workflow labels as lifecycle values. Remove in a future major migration after all callers use `project_status`. |
| `current_stage`, `stage_status`, `stage_started_at`, `stage_due_at`, `stage_completed_at`, `final_due_at`, `waiting_on`, `workflow_settings`, `revision_count` | KEEP | Convert/check against canonical types and make RPC-owned. Existing names remain except the new lifecycle column. |
| `stage_states` | MIGRATE THEN DEPRECATE | Backfill skip/history events, then expose a derived compatibility JSON object. Remove physical storage in a future major migration. |
| `production_time_used`, `client_wait_time` | MIGRATE THEN DEPRECATE | Convert trustworthy values to seconds and seed cached totals; dual-write aliases during compatibility. Replace with `production_seconds_total` and `client_wait_seconds_total`. |
| `timeline_status` | MIGRATE THEN DEPRECATE | Derived and dual-written only. Remove the column in a future major migration. |
| `production_days_used`, `print_timeline_days` | MIGRATE THEN DEPRECATE | Replace with history-derived reporting and `workflow_settings.print_version_days`. |
| `files_received_date` | KEEP TEMPORARILY FOR COMPATIBILITY | Populate from canonical events where safe; canonical truth is history. |
| `design_concept_due_date`, `design_concept_due_date_manual`, `design_concept_submitted_date`, `design_concept_approval_date` | KEEP TEMPORARILY FOR COMPATIBILITY | Read/dual-write during switchover; migrate evidence into the imported snapshot and future canonical events. |
| `concept_revision_due_date` | KEEP TEMPORARILY FOR COMPATIBILITY | Replace with current revision request due date/history. |
| `print_version_due_date`, `print_version_due_date_manual`, `print_version_submitted_date`, `print_version_approval_date`, `print_revision_due_date` | KEEP TEMPORARILY FOR COMPATIBILITY | Same approach as design fields. |
| `ebook_due_date`, `ebook_due_date_manual`, `ebook_submitted_date`, `ebook_approval_date` | KEEP TEMPORARILY FOR COMPATIBILITY | Same approach as design fields. |
| `final_delivery_date` | KEEP TEMPORARILY FOR COMPATIBILITY | Dual-write from `delivered_at`; no longer drives a trigger. |
| `start_date`, `due_date`, `internal_deadline`, `delivery_date` | KEEP | General planning/business dates remain, but they do not determine workflow state. `due_date` is not the current stage deadline. |
| `progress_percentage` | MIGRATE THEN DEPRECATE | Derive from stage definition/order and skip state; compatibility value is DB-generated. |
| `delay_reason`, `client_action_required` | KEEP | Business annotations, not state authority. |
| `requirements_submitted_at` | REMOVE IN A FUTURE MAJOR MIGRATION | It has no physical SQL column or runtime use; do not add it merely to satisfy the TypeScript interface. |
| `stage_history`, `stage_skip_requests`, `admin_workflow_overrides` relation-shaped TypeScript fields | REMOVE IN A FUTURE MAJOR MIGRATION from `Project` shape | Load through typed relations/RPCs, not as physical project columns or ephemeral synthesized arrays. |

The legacy timeline trigger must stop deriving state from milestone columns at cutover. Compatibility writes flow from canonical RPC results to legacy fields, never the reverse after backfill.

## 6. Service Capability Model

Recommended schema on `projects`:

| Column | Type | Rule |
|---|---|---|
| `requires_print` | boolean nullable | Null means unresolved legacy data; true requires Print Version and Print Approval. |
| `requires_ebook` | boolean nullable | Null means unresolved legacy data; true requires Ebook Version and Ebook Approval. |
| `service_capability_status` | enum | `inferred`, `confirmed`, or `needs_review`; default `needs_review`. |
| `capabilities_resolved_by` | uuid nullable FK to `profiles(id)` | Actor who confirmed or corrected the values; null for deterministic migration inference. |
| `capabilities_resolved_at` | timestamptz nullable | Resolution timestamp. |

Constraints:

- `needs_review` requires at least one capability to be null.
- `inferred` or `confirmed` requires both booleans non-null and `requires_print OR requires_ebook` to be true.
- New application inserts require `confirmed` and a non-null valid pair.
- Workflow RPCs reject `needs_review` and null capabilities with a specific `service_capabilities_unresolved` error.
- `service_type` remains unchanged as display/legacy data, but no canonical routing function parses it at runtime.

Backfill uses a reviewed, deterministic mapping table of normalized service strings. Exact known print-only strings map to `(true,false)`, exact known ebook-only strings map to `(false,true)`, and exact known package/both strings map to `(true,true)`, all with status `inferred`. Unknowns, blank values, and strings containing conflicting indicators map to `(null,null,'needs_review')`; they are never silently treated as combined projects.

## 7. Workflow Stage Definitions

Recommended canonical design: create `public.workflow_stage_definitions` as a seeded database reference table. The database is the transition authority and must not depend on a separately deployed JavaScript constant for stage order, control ownership, or deadlines. The small table also gives the UI and AI a stable projection and makes data-driven tests possible.

Exact columns:

| Column | Type/constraint |
|---|---|
| `stage_key` | `workflow_stage` PRIMARY KEY |
| `stage_order` | smallint NOT NULL UNIQUE, CHECK 1-8 |
| `display_name` | text NOT NULL UNIQUE |
| `default_production_days` | smallint NOT NULL CHECK 0-365 |
| `client_controlled` | boolean NOT NULL |
| `clock_paused` | boolean NOT NULL |
| `is_delivery_stage` | boolean NOT NULL DEFAULT false |
| `created_at` | timestamptz NOT NULL DEFAULT now() |
| `updated_at` | timestamptz NOT NULL DEFAULT now() |

Additional constraints/indexes:

- Client-controlled rows must have `default_production_days=0` and `clock_paused=true`.
- Non-client production rows must have `clock_paused=false`.
- A partial unique index on the constant expression where `is_delivery_stage` is true ensures exactly one delivery row after seed validation.
- A deferred validation block asserts exactly eight rows, contiguous order 1-8, and exactly one delivery stage.

Seed rows are exactly the eight rows in section 3. Application users receive SELECT only. Structural changes occur only through reviewed migrations. Application code may cache or generate TypeScript values from this table but may not override it. Project `workflow_settings` may override duration values and `exclude_weekends`; it may not override structural fields.

## 8. Stage History Model

`project_stage_history` becomes a strictly immutable append-only event ledger. It is the durable audit and time-delta source of truth; the project row is only the latest snapshot.

Exact canonical columns:

| Column | Type/constraint |
|---|---|
| `id` | uuid PRIMARY KEY DEFAULT gen_random_uuid() |
| `project_id` | uuid NOT NULL FK `projects(id)` ON DELETE RESTRICT |
| `sequence_no` | bigint NOT NULL; UNIQUE (`project_id`,`sequence_no`) |
| `event_type` | `workflow_event_type` NOT NULL |
| `from_stage`, `to_stage` | `workflow_stage` nullable |
| `from_stage_status`, `to_stage_status` | `workflow_stage_status` nullable |
| `from_waiting_on`, `to_waiting_on` | `workflow_waiting_on` nullable |
| `occurred_at` | timestamptz NOT NULL DEFAULT clock_timestamp() |
| `due_at` | timestamptz nullable; resulting active deadline if relevant |
| `production_seconds_delta` | bigint NOT NULL DEFAULT 0 CHECK >=0 |
| `client_wait_seconds_delta` | bigint NOT NULL DEFAULT 0 CHECK >=0 |
| `actor_id` | uuid nullable FK `profiles(id)`; null only for a defined system event |
| `actor_role` | `app_role` nullable; role snapshot at event time |
| `revision_request_id` | uuid nullable FK `revision_requests(id)` |
| `stage_skip_id` | uuid nullable FK `project_stage_skips(id)` |
| `admin_override_id` | uuid nullable FK `admin_workflow_overrides(id)` |
| `reason` | text nullable; required for reason-bearing event types |
| `metadata` | jsonb NOT NULL DEFAULT `{}` with object-shape check |
| `idempotency_key` | uuid nullable |
| `created_at` | timestamptz NOT NULL DEFAULT now() |

`workflow_event_type` contains: `legacy_snapshot_imported`, `stage_entered`, `stage_submitted`, `stage_approved`, `revision_requested`, `revised_proof_submitted`, `revision_changes_requested`, `revision_approved`, `stage_skip_requested`, `stage_skipped`, `stage_skip_rejected`, `stage_skip_cancelled`, `project_paused`, `project_resumed`, `project_cancelled`, `project_archived`, `project_unarchived`, `workflow_configuration_updated`, `admin_override_applied`, and `final_delivery_completed`.

Every RPC locks the project, obtains `max(sequence_no)+1` within that lock, closes the old running interval by recording its delta, writes one or more ordered events, updates the project cache totals, and updates the snapshot in one transaction. Automatic skipping of two format stages emits one `stage_skipped` event per skipped stage under the same idempotency/correlation key.

No authenticated role receives INSERT, UPDATE, or DELETE on the table. Inserts occur only inside the canonical SECURITY DEFINER RPCs and the controlled backfill migration. Corrections use a compensating `admin_override_applied` event. Client-facing timeline reads come from a safe projection that excludes internal reasons, role snapshots, and unrestricted metadata.

## 9. Stage Skip Model

`project_stage_skips` records only manual skip requests that require a client decision. Service-capability automatic skips do not create fake requests or approvals; they are represented by `stage_skipped` history events and the resulting snapshot/projection.

Canonical columns: `id uuid PK`, `project_id uuid NOT NULL`, `stage_key workflow_stage NOT NULL`, `requester_id uuid NOT NULL`, `reason text NOT NULL`, `status workflow_skip_status NOT NULL DEFAULT 'pending'`, `requested_at timestamptz NOT NULL`, `responded_by uuid NULL`, `responded_at timestamptz NULL`, `response_note text NULL`, `cancelled_by uuid NULL`, `cancelled_at timestamptz NULL`, `idempotency_key uuid NOT NULL`, `created_at`, and `updated_at`. Use a unique partial index preventing more than one pending request for the same project/stage and a unique requester/idempotency constraint.

Only `Design Concept`, `Print Version`, and `Ebook Version` are eligible manual skip targets. A granted request skips the target production stage and its paired approval stage. `Files Received`, an approval stage by itself, and `Final Delivery` cannot be normally skipped. An emergency exception requires the admin override RPC.

The requester is `auth.uid()` and must be Admin, Project Manager, or the assigned employee. The target must be current or future, required by the project capabilities, and not already completed/skipped. Only a client with current project access can approve or reject. The client actor and time are taken from `auth.uid()`/the database clock. A requester may cancel their own pending request; an Admin or Project Manager may cancel any pending request. Approved/rejected/cancelled rows are immutable and never normally deleted.

## 10. Admin Override Model

`admin_workflow_overrides` is an immutable emergency audit table, not a normal transition queue.

Exact semantics and columns:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT`
- `actor_id uuid NOT NULL REFERENCES profiles(id)` derived from `auth.uid()`
- `reason text NOT NULL CHECK (length(trim(reason)) >= 10)`
- explicit previous fields: `previous_project_status`, `previous_stage`, `previous_stage_status`, `previous_waiting_on`, `previous_stage_started_at`, `previous_stage_due_at`
- explicit resulting fields: `resulting_project_status`, `resulting_stage`, `resulting_stage_status`, `resulting_waiting_on`, `resulting_stage_started_at`, `resulting_stage_due_at`
- `idempotency_key uuid NOT NULL`
- `created_at timestamptz NOT NULL DEFAULT clock_timestamp()`
- UNIQUE (`project_id`,`actor_id`,`idempotency_key`)

Only `workflow_admin_override` inserts rows, and only an active profile whose role is exactly `admin` may invoke it. Project Manager is not Admin. Direct insert/update/delete is denied to all authenticated users. Admins, Project Managers, and assigned employees may read the fact and state change for projects they can access; clients do not see this table or the internal reason. The same transaction writes an `admin_override_applied` history event and the new project snapshot.

## 11. Revision Model

The existing revision feature remains, but each `revision_requests` row becomes one explicit revision round tied to the approval stage under review.

Required additions/constraints:

- `stage_key workflow_stage NOT NULL`, constrained to `concept_approval`, `print_approval`, or `ebook_approval`.
- `revision_round integer NOT NULL CHECK >0`.
- `parent_revision_request_id uuid NULL` for a later round prompted by changes to a revised proof.
- `due_at timestamptz NOT NULL` calculated by the DB business-day engine.
- UNIQUE (`project_id`,`stage_key`,`revision_round`).
- The canonical revision status enum from section 2.

`revision_round` is required because a project-wide `revision_count` cannot establish order within the same approval stage. The RPC allocates `max(revision_round)+1` for the project/stage while the project is locked. The project-level `revision_count` is incremented transactionally for reporting.

Flow:

1. A client may request a revision only while the matching approval stage is `awaiting_client`, or while reviewing a revised proof for that same stage.
2. The client identity is always `auth.uid()`. The request is created as `submitted`; the project remains on the approval stage but moves to `revision_active/team` and receives a revision due date.
3. Authorized team review may move the request through `under_review` and `in_progress`; assignment lives in `assigned_to`, never in status.
4. `workflow_submit_revised_proof` derives the uploader from `auth.uid()`, inserts the attachment, marks the request `ready_for_client_review`, moves the project to `awaiting_client/client`, stops revision production time, starts client wait, and writes history/notifications atomically.
5. Client approval marks the latest open round `approved`, stops client wait, and resumes canonical stage routing.
6. If the client requests more changes, the reviewed request becomes `changes_requested` and a child request with the next round number is created. Prior rounds remain immutable evidence.
7. At most one nonterminal revision round may exist for a project/stage. A stale request ID or mismatched stage is rejected.

Legacy `Assigned` maps to `under_review` with `assigned_to` preserved; `Completed` maps to `approved` only when approval evidence exists, otherwise it maps to `ready_for_client_review`; `Additional Revision Required` maps to `changes_requested` and seeds a following round only when a distinct request already exists. Ambiguity is preserved in import metadata rather than fabricated.

## 12. Transition Matrix

“Team” means Admin, Project Manager, or the assigned employee. Every transition also requires lifecycle `active`, matching `workflow_version`, and resolved service capabilities.

| Current stage/state | Allowed next state | Trigger | Client approval required? | Production clock | Normal skip | Automatic skip | Resulting stage status / waiting owner |
|---|---|---|---|---|---|---|---|
| Files Received / active | Design Concept | Team advances | No | Runs | No | None | `active/team` |
| Design Concept / active | Concept Approval | Team submits deliverable | To leave Concept Approval | Runs until submit | Request may skip Design + Concept Approval | None | `awaiting_client/client` |
| Concept Approval / awaiting_client | Print Version, Ebook Version, or Final Delivery | Accessible client approves | Yes | Stopped while waiting | No standalone approval skip | Skip Print pair if `requires_print=false`; skip Ebook pair if `requires_ebook=false` | Next production stage `active/team` |
| Concept Approval / revision_active | Concept Approval / awaiting_client | Team submits revised proof | Client reviews revised proof | Runs until submit | No | None | `awaiting_client/client` |
| Print Version / active | Print Approval | Team submits deliverable | To leave Print Approval | Runs until submit | Request may skip Print + Print Approval | Whole pair if `requires_print=false` | `awaiting_client/client` |
| Print Approval / awaiting_client | Ebook Version or Final Delivery | Accessible client approves | Yes | Stopped while waiting | No standalone approval skip | Ebook pair skipped if `requires_ebook=false` | Next production stage `active/team` |
| Print Approval / revision_active | Print Approval / awaiting_client | Team submits revised proof | Client reviews revised proof | Runs until submit | No | None | `awaiting_client/client` |
| Ebook Version / active | Ebook Approval | Team submits deliverable | To leave Ebook Approval | Runs until submit | Request may skip Ebook + Ebook Approval | Whole pair if `requires_ebook=false` | `awaiting_client/client` |
| Ebook Approval / awaiting_client | Final Delivery | Accessible client approves | Yes | Stopped while waiting | No standalone approval skip | None | `active/team` |
| Ebook Approval / revision_active | Ebook Approval / awaiting_client | Team submits revised proof | Client reviews revised proof | Runs until submit | No | None | `awaiting_client/client` |
| Final Delivery / active | Final Delivery / completed plus project Completed | Team completes delivery | No | Runs until completion | No | None | `completed/none`; lifecycle `completed` |
| Completed | None | None; Admin override only | No | Stopped | No | None | `completed/none` |

Skip routing is evaluated inside the same RPC that advances or approves. Each disabled or approved-skipped stage produces a history event before the next executable stage is entered. The database rejects backward jumps, direct jumps, wrong-stage approvals, duplicate approvals, incomplete manual skip approvals, and attempts to bypass a required format.

## 13. Business-Day Engine

PostgreSQL is the authority. The initial global calendar uses timezone `Asia/Karachi`; the frontend sends instants and settings, never calculates a persisted deadline independently.

Canonical functions:

```sql
workflow_add_production_days(
  p_start_at timestamptz,
  p_days integer,
  p_exclude_weekends boolean default true,
  p_timezone text default 'Asia/Karachi'
) returns timestamptz

workflow_production_days_between(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_weekends boolean default true,
  p_timezone text default 'Asia/Karachi'
) returns numeric

workflow_production_seconds_between(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_weekends boolean default true,
  p_timezone text default 'Asia/Karachi'
) returns bigint
```

Rules:

- Store all instants as `TIMESTAMPTZ`. Convert to the supplied organization timezone only to classify local dates and preserve local wall-clock due time.
- The start calendar day is not counted as a production day. One day means the next eligible local calendar date at the same local time.
- Zero days returns the input instant unchanged. Negative days and end-before-start are rejected.
- If weekends are excluded, Saturday and Sunday are ineligible. If weekends are included, they count unless an explicit calendar exception marks them non-working.
- `workflow_calendar_exceptions(calendar_date date PRIMARY KEY, is_working_day boolean, label text, created_at, updated_at)` supports future holidays and exceptional working weekends without changing the function signatures. It is initially empty.
- Stage durations come from validated project settings, falling back to `workflow_stage_definitions`. Revision duration falls back to 2.
- Approval stages set `stage_due_at=NULL`. Client wait is measured, but no production deadline runs.
- Due timestamps are computed when a production stage/revision clock starts or restarts. A settings change requires a controlled RPC and a recalculation event; ordinary project updates cannot rewrite due dates.
- `workflow_production_seconds_between` subtracts excluded full local calendar days but does not assume an eight-hour workday. Phase 6 measures eligible elapsed time, not staff timesheets.

The TypeScript date helpers remain display/preview helpers. A shared fixture file must assert identical inputs and outputs against the database functions and frontend preview logic.

## 14. Time Accounting Model

Recommended design: use both history and cached project totals. History deltas are authoritative; `projects.production_seconds_total` and `projects.client_wait_seconds_total` are transactionally maintained caches for dashboards and can be rebuilt by summing history.

At the start of every mutation, while holding the project row lock, the RPC closes the current open interval using `stage_started_at`:

- `active` or `revision_active`: add `workflow_production_seconds_between(stage_started_at, now(), settings)` to production.
- `awaiting_client`: add wall-clock seconds from `stage_started_at` to now to client wait. Client response time includes weekends because it measures actual waiting rather than production eligibility.
- `pending`, `paused`, `completed`, or `skipped`: add zero.

The resulting history event stores both deltas and the project caches receive the same increments. A new running state sets `stage_started_at=now()`; a stopped state sets it to null. Pausing closes the active interval. Resuming starts a new interval without losing the prior delta. No client or frontend value is accepted for a delta or total.

Required clock sequence:

```text
Production stage entered -> production clock starts
Submitted for approval  -> production stops; client wait starts
Client approves         -> client wait stops; next production starts
Revision requested      -> client wait stops; revision production starts
Revised proof submitted -> revision production stops; client wait starts
Final delivery complete -> production stops; all clocks remain stopped
```

A reconciliation query must compare cached totals to per-project history sums. Any discrepancy fails cutover validation and is repaired by a controlled rebuild, not by editing history.

## 15. Workflow RPC Surface

The final surface contains eleven public application RPCs: the nine production actions requested for evaluation plus one lifecycle RPC and one configuration RPC needed to prevent direct workflow-column writes. All return a typed result containing the canonical project snapshot, the new `workflow_version`, affected entity IDs, emitted history event IDs, and `already_applied`. Domain errors use stable codes; unexpected errors abort the transaction.

Common parameter abbreviations below: every mutation accepts `p_project_id uuid`, `p_expected_workflow_version bigint`, and `p_idempotency_key uuid`. Actor/client/uploader/requester IDs are never accepted.

| RPC | Purpose and callers | Additional parameters | Preconditions and atomic effects |
|---|---|---|---|
| `workflow_advance_stage` | Complete Files Received and enter Design Concept. Team. | optional `p_note text` | Lock project; require `files_received/active`; close production time; route to Design Concept; calculate due; update snapshot/history/notifications. |
| `workflow_submit_stage_for_approval` | Submit Design Concept, Print Version, or Ebook Version. Team. | `p_stage workflow_stage`, `p_deliverable_url text`, optional note | Require matching current production stage and assigned/team access; close production; enter paired approval as `awaiting_client`; update compatible milestone field; history and client notification atomically. |
| `workflow_client_approve_stage` | Approve the current approval or latest revised proof. Accessible client. | `p_stage workflow_stage`, optional `p_revision_request_id uuid`, optional note | Verify client access, current client-controlled stage, latest non-stale request, and no prior approval; close client wait; approve revision if supplied; route by capabilities/skips; calculate due; update history/notifications. |
| `workflow_submit_client_revision` | Create a revision round for the current approval. Accessible client. | `p_stage workflow_stage`, `p_title text`, `p_instructions text`, `p_priority`, optional attachment metadata/reference | Bind client to `auth.uid()`; validate approval stage and access; allocate round; close client wait; start revision production with default/configured duration; insert request/items/attachments as supplied, snapshot, history, notifications. |
| `workflow_submit_revised_proof` | Submit a team revision for client review. Team. | `p_revision_request_id uuid`, required proof storage reference, optional note | Lock project and request; require active latest revision and assignment/team access; bind uploader; close revision time; insert attachment; mark ready; start client wait; update snapshot/history/notifications. |
| `workflow_request_stage_skip` | Request that a skippable production/approval pair be omitted. Team. | `p_stage workflow_stage`, `p_reason text` | Validate target eligibility and project access; insert pending skip and history; notify accessible clients. Does not change stage until approved unless target is future and work continues before it. |
| `workflow_respond_stage_skip` | Approve or reject a pending skip. Accessible client. | `p_stage_skip_id uuid`, `p_decision` (`approved`/`rejected`), optional response note | Lock project and skip; verify access/pending/current version; bind responder; if approved and target is current, close clock and route; otherwise record future routing decision; update history/notifications. |
| `workflow_admin_override` | Emergency state correction. Admin only. | explicit resulting lifecycle/stage/stage status/waiting owner, optional resulting due/start, `p_reason text` | Require exact Admin role; validate resulting combination; lock project; close old clock; insert immutable before/after override and compensating history; update snapshot and notifications. It may bypass normal sequence but not type/check constraints. |
| `workflow_complete_final_delivery` | Complete Final Delivery and the project. Team. | optional delivery note and existing final file references | Require `final_delivery/active`; preserve current file requirements only—no new QC gate; close production; set stage completed, lifecycle completed, `delivered_at`; write compatibility date, history, and notifications. |
| `workflow_set_project_lifecycle` | Pause, resume, cancel, archive, or unarchive without conflating lifecycle and stage. A/PM for pause/resume/cancel; Admin only for archive/unarchive. | `p_action` and required `p_reason` for cancel/archive; optional note for pause/resume | Lock project; validate allowed lifecycle transition; close the running interval. Pause records prior stage state and remaining production duration in history. Resume restores that state, starts the appropriate clock, and recalculates production due time. Cancel stops clocks. Archive requires a non-active lifecycle. Write snapshot/history/notifications atomically. |
| `workflow_update_project_configuration` | Change validated duration/weekend settings or resolve service capabilities. A/PM. | replacement `p_workflow_settings`, `p_requires_print`, `p_requires_ebook`, and `p_capability_status='confirmed'` as applicable | Lock project; reject changes that contradict already completed format stages unless an Admin uses override; validate settings/capabilities; recalculate an active deadline from elapsed eligible time; increment version; record old/new configuration in a restricted history event and notify affected team users. |

File bytes are uploaded before an RPC and passed only as validated storage references. PostgreSQL cannot roll back an already completed storage upload; failed RPCs leave an orphan eligible for a later cleanup job, never a partially transitioned project.

## 16. RPC Authorization and Idempotency Rules

Every canonical mutation follows this order:

1. Reject an unauthenticated caller.
2. Load the caller's active `profiles` row by exact `auth.uid()`; never authorize from name, email, request metadata, or a caller-supplied UUID.
3. Begin from the target project and `SELECT ... FOR UPDATE` it. Lock the active revision/skip row too when relevant.
4. Check role and assignment/client-access conditions inside the function even if RLS would also allow the row.
5. Check `p_expected_workflow_version`. A mismatch raises `workflow_stale_version` without changing data.
6. Check the idempotency receipt keyed by `(rpc_name, project_id, actor_id, idempotency_key)`. If the completed receipt exists, return its stored result with `already_applied=true`.
7. Validate current lifecycle, stage, stage status, capability resolution, target stage, and related row freshness.
8. Close the current time interval, execute routing, calculate deadlines in the DB, update related entities, insert history and notifications, increment `workflow_version`, and store the idempotency result in one transaction.
9. Raise stable domain errors for unauthorized, unresolved capability, invalid transition, stale version, stale approval/revision, duplicate/pending conflict, or invalid input. Do not catch-and-report success after a failed required write.

Create an internal `workflow_idempotency_receipts` table with unique `(rpc_name, project_id, actor_id, idempotency_key)`, request fingerprint, result JSON, and timestamps. Reusing a key with different parameters raises `idempotency_key_reused`. Receipts are service/RPC-only and may have a documented retention window; history remains permanent.

Project-type automatic skips happen only inside routing code shared by approval, skip-response, and override validation. The frontend never chooses the post-approval stage.

## 17. RLS Role Matrix

Abbreviations: A = Admin, PM = Project Manager, E = Employee, C = Client, S/I/U/D = SELECT/INSERT/UPDATE/DELETE, “RPC” = no direct table grant/policy. A user must also have an active `profiles` row. Assignment means `projects.assigned_to=auth.uid()` or `project_manager=auth.uid()` as appropriate. “Accessible client” means an exact active `client_project_access` row or canonical direct client FK, never fuzzy name/email matching.

Reusable security predicates are schema-qualified, non-recursive helpers: `is_admin()`, `is_project_manager_or_admin()`, `can_view_project(project_id)`, `can_work_project(project_id)`, `can_view_task(task_id)`, and `can_access_conversation(conversation_id)`. Policies remain explicit per operation; there is no authenticated `USING (true)` on privileged business tables.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | A all; each user self. Others use safe directory projection. | Auth signup trigger for self; A administrative path. | Self only through constrained profile RPC for name/avatar/phone; A all approved fields. | A only through account-admin process. |
| `projects` | A/PM all; E assigned; C no direct table read—client projection RPC only. | A/PM with `created_by=auth.uid()` and resolved capabilities. | Non-workflow fields: A/PM; E assigned on allowed fields. Workflow columns: RPC only. | A only. |
| `tasks` | A/PM all; E creator or assignee; C none. | A/PM; E with `created_by=auth.uid()` and visible project. | A/PM; E creator/assignee on allowed fields. | A or task creator; never C. |
| `project_stage_history` | A/PM for visible projects; E assigned. C uses safe timeline projection. | RPC/backfill only. | Never. | Never. |
| `project_stage_skips` | A/PM all visible; E assigned; C accessible project. | RPC only. | RPC only while pending. | Never in normal operation. |
| `admin_workflow_overrides` | A/PM visible projects; E assigned. C none. | Admin override RPC only. | Never. | Never. |
| `revision_requests` | A/PM visible; E assigned/request assignee; C own accessible project. | Revision RPC only. | Workflow/team/client response RPCs only. | A only for legally approved cleanup; default app path is no delete. |
| `revision_items` | A/PM/E through parent access; C through own request with client-safe columns/view. | Revision RPC, or constrained item RPC bound to actor. | A/PM/assigned E while request nonterminal; client cannot rewrite team state. | A only before terminal state. |
| `revision_attachments` | Parent-request scoped; clients see permitted attachments for own accessible request. | RPC/storage metadata path with uploader=`auth.uid()`. | Never. | A or uploader before request terminal, through controlled RPC. |
| `revision_activity` | Parent-request scoped; client gets safe projection. | RPC/trigger only with user=`auth.uid()`. | Never. | Never. |
| `notifications` | Recipient only. | RPC/trigger/service only. | Recipient may change read state only through a constrained RPC/policy. | Recipient may delete own notification. |
| `client_project_access` | A/PM all; C own rows. E none. | A/PM only, with exact client/project FKs. | A/PM only. | A/PM only. |
| `conversations` | Authorized members via `can_access_conversation`. | Controlled create-conversation RPC validates type and eligible members. | Creator/A/PM through RPC for permitted metadata. | A only; otherwise archive, not delete. |
| `conversation_members` | Members may see membership of conversations they can access. | Membership RPC only; validates conversation type/project/task eligibility. | User may update own `last_read_at`; membership changes via RPC. | Membership RPC; cannot remove the last authorized owner; no arbitrary direct delete. |
| `messages` | Conversation access only. | Member with `sender_id=auth.uid()`. | Sender only while still authorized; body only. | Sender or A; child cleanup follows FK rules. |
| `message_attachments` | Inherit parent message/conversation access. | Message sender only with parent access. | Never. | Uploader/message sender or A. |
| `message_mentions` | Inherit parent access. | Message sender/system only; mentioned user must be an eligible conversation participant. | Never. | Message sender/system only. |
| `message_reactions` | Inherit parent access. | Member with `user_id=auth.uid()`. | Never. | Own reaction only. |
| `finance_transactions` | A/PM. | A/PM with creator=`auth.uid()`. | A/PM; soft-delete fields A only. | A only; normal behavior uses soft delete. |
| `finance_budgets` | A/PM. | A/PM with updater=`auth.uid()`. | A/PM with updater=`auth.uid()`. | A only. |
| `employee_compensation` | A all; E self. PM and C none. | A only. | A only. | A only. |
| `employee_ledger` | A all; E self. PM and C none. | A only. | A only. | A only. |

The `manager` legacy role is normalized to Project Manager behavior during compatibility, while `junior_assistant` is normalized to Employee assignment-scoped behavior. Neither receives Admin privileges.

## 18. SECURITY DEFINER Standards

Every SECURITY DEFINER function must:

- be owned by a dedicated non-login database owner, not an application user;
- specify `SET search_path = pg_catalog, public` and schema-qualify all relations and calls, including `auth.uid()`;
- revoke EXECUTE from `PUBLIC`, `anon`, and `authenticated` before granting only the necessary application role;
- derive actor/client/uploader/requester identity exclusively from `auth.uid()`;
- load an exact active profile role from `public.profiles`, not `auth.jwt()->>'role'` unless a separately validated claim design is introduced;
- validate project/revision/task/conversation access within the function;
- validate current state and input enum/domain values;
- lock mutable project and related workflow rows in a consistent order;
- implement expected-version and idempotency checks for retryable mutations;
- never use fuzzy name/email matching for authorization;
- write all required snapshot, history, related entity, and notification changes atomically;
- return a typed result and allow any required-write error to abort the transaction;
- have explicit tests for anonymous, wrong-role, cross-project, stale, duplicate, and valid callers.

Replace rather than layer more definitions over the existing workflow/security functions: both versions of `client_approve_project_milestone`, `submit_client_revision`, `submit_revised_proof`, `client_respond_revision`, `apply_revision_request_timeline`, `mark_project_revision_requested`, `apply_project_timeline`, `client_has_project_access`, `current_user_is_client`, `is_client_user`, `project_is_visible`, `can_manage_all_projects`, and the workflow-related notification helpers. Compatibility wrappers may keep old names temporarily, but they must delegate to canonical functions and must not retain old authority rules. `find_login_email` is outside workflow but must receive a separate enumeration-risk decision before clean-install signoff.

## 19. Client Portal Data Projection

Recommended target: a SECURITY DEFINER read RPC, `get_client_project_summaries()`, with a fixed `RETURNS TABLE` contract and no client direct SELECT grant on `projects`. This is safer than competing owner-rights views and simpler to audit than granting clients a wide project row and relying on column privileges.

The RPC binds the caller to `auth.uid()`, requires an active Client profile, joins exact project access, and returns only:

- identity/display: project ID, project number, project title, client name, service type, priority;
- canonical state: project status, official current-stage label/key, stage status, waiting owner, progress derived from stage order/skips;
- dates: start date, general due date, current stage due timestamp, estimated final due timestamp, delivered timestamp;
- client workflow evidence: relevant submitted/approval timestamps, latest client-visible revision ID/status/round/due date, revision count, pending skip request ID/stage/status;
- client-facing files: source/proof/final print/final ebook/cover/approved other client links;
- created/updated timestamps.

It excludes internal notes, QA notes, delay/internal-deadline details, employee IDs/private profiles, finance/payroll fields, invoice internals, actor IDs, admin reasons, and raw history metadata. Separate `get_client_project_timeline(project_id)` and existing revision projections return client-safe details after the same access check.

During switchover, one compatibility `client_project_summaries` view may be retained with the exact same explicit columns and backed by the canonical projection logic. `SELECT p.*` is prohibited. The frontend must switch to the RPC before the view is retired.

## 20. Communication Security Model

Conversation membership is the immediate read/write gate; conversation type and linked entity determine who is eligible to become a member.

- Direct conversation: only listed members are eligible and may read it.
- Project internal conversation: eligible members are Admins, Project Managers, the assigned employee, and other explicitly authorized internal project users. Clients are never eligible.
- Project client conversation: eligible internal users are Admin, Project Manager, and assigned employee; an accessible client is eligible only when explicitly added/allowed. Project access alone does not silently expose every project-client conversation.
- Task conversation: eligible users are Admin, Project Manager, task creator, task assignee, and eligible project workers for the linked task project. Clients are excluded unless a future explicit client-task product feature is designed.

`can_access_conversation` first requires membership, then revalidates linked project/task eligibility so stale membership cannot preserve access after reassignment or access removal. Membership creation/removal uses controlled RPCs that validate these rules. Client membership is removed or disabled when `client_project_access` is revoked.

Messages require conversation access and `sender_id=auth.uid()`. Attachments, mentions, and reactions inherit the parent message and conversation access; they never have an independent broad policy. Mentions can target only eligible conversation members. Reactions bind `user_id` to the caller. Client and employee directory lookups use the safe profile projection. Realtime subscriptions receive only rows the same RLS policies allow.

The permissive `USING (true)`/`WITH CHECK (true)` communication policies and the mistakenly placed `messages_select` policy on `conversations` are dropped in the security migration and replaced per operation.

## 21. Profile Visibility Model

Full `profiles` rows are visible only to Admin and the profile owner. Project Manager, Employee, and Client callers do not need universal email/phone access to render names and avatars.

Create a read-only `profile_directory` projection with the explicit columns `id`, `full_name`, `avatar_url`, `role` as display role, and `status`. Exclude email, phone, timestamps, auth metadata, and compensation data. The projection is accessible only to authenticated active profiles and is used for assignee selectors, avatars, communication membership, and display names. Eligibility for a particular assignment or conversation is still enforced by the write RPC; directory visibility is not authorization.

The current all-authenticated full-profile SELECT policy is removed. Self-service updates are restricted to `full_name`, `avatar_url`, and `phone`; users cannot change their own role, status, email identity, or other users. Admin role/status changes use a controlled administrative path.

## 22. Legacy Compatibility and Backfill Plan

Backfill is idempotent, records source values in JSON metadata, and never invents exact historical events or timestamps.

### Legacy state mapping

| Legacy value/evidence | Canonical stage | Canonical stage status | Waiting owner / lifecycle |
|---|---|---|---|
| `New`, `Waiting for Files`, `Files Required`, no reliable files date | `files_received` | `pending` | `client` when files are required, otherwise `none`; lifecycle `active` |
| `Files Received` or reliable `files_received_date` without later evidence | `files_received` | `active` | `team`; lifecycle `active` |
| `Design Concept in Progress` | `design_concept` | `active` | `team` |
| `Awaiting Concept Approval` | `concept_approval` | `awaiting_client` | `client` |
| `Concept Revisions` | `concept_approval` | `revision_active` | `team` |
| `Print Version in Progress` | `print_version` | `active` | `team` |
| `Awaiting Print Approval` | `print_approval` | `awaiting_client` | `client` |
| `Print Revisions` | `print_approval` | `revision_active` | `team` |
| `eBook in Progress` | `ebook_version` | `active` | `team` |
| `eBook Review` | `ebook_approval` | `awaiting_client` | `client` |
| `Final Quality Check` | `final_delivery` | `active` | `team` |
| `Final Delivery` as legacy status/stage without delivery evidence | `final_delivery` | `active` | `team`; lifecycle `active` |
| Completed or reliable final-delivery evidence | `final_delivery` | `completed` | `none`; lifecycle `completed` |
| `On Hold` | retain inferred real stage | `paused` | `none`; lifecycle `on_hold` |
| `Cancelled` | retain inferred real stage | `paused` | `none`; lifecycle `cancelled` |
| `Archived` | retain inferred real stage | `paused` | `none`; lifecycle `archived` |

Milestone evidence takes precedence over a stale text label: final delivery -> Final Delivery completed; ebook approval -> Final Delivery active; ebook submitted -> Ebook Approval waiting; print approval -> Ebook Version or Final Delivery based on capabilities; print submitted -> Print Approval; concept approval -> first required format; concept submitted -> Concept Approval; files received -> Design Concept. If capability routing is unresolved, preserve the latest proven stage and mark the project `pending/none` until manual review rather than guess the next format.

### Field backfill

- `project_status`: map terminal/on-hold legacy statuses first; map all production/approval/revision labels to `active`.
- `stage_status` and `waiting_on`: derive from reliable current stage, lifecycle, latest nonterminal revision, and milestone evidence using the table above.
- capabilities: infer only exact reviewed `service_type` mappings; ambiguous values remain null/`needs_review`.
- `stage_started_at`: use a timestamp only when a milestone/revision timestamp has the same semantics as entering the inferred current state. Otherwise leave null. `created_at` or `updated_at` is not substituted merely because it exists.
- `stage_due_at`: preserve an existing current-stage manual/generic due date if its stage relationship is reliable. Otherwise compute only when `stage_started_at` is reliable and a production clock is active. Approval and stopped states receive null.
- `revision_count`: use the count of actual revision request rows, reconciled with the legacy counter by taking the supported maximum and recording the discrepancy in import metadata.
- `stage_states`: translate proven skipped entries into `stage_skipped` events, then derive compatibility JSON from canonical history/capabilities.
- time totals: import non-negative existing values only with their documented unit conversion. Mark the imported amount in metadata; do not back-calculate unobserved intervals.
- history: insert exactly one `legacy_snapshot_imported` event per existing project containing the available legacy state/milestone/counter/capability evidence. Add distinct skip/revision linkage only for actual existing rows. Do not fabricate a full eight-stage event sequence.

During compatibility, canonical RPCs dual-write legacy status/timeline/milestone fields. Reads prefer canonical fields. A telemetry query identifies remaining direct legacy writers. Cutover removes the legacy state-derivation trigger and rejects direct changes to canonical workflow columns except from approved functions.

## 23. Migration Architecture

Use five deterministic ordered migrations, not one monolith. The exact proposed files are:

1. `supabase/phase6/migrations/00100_phase6_canonical_foundation.sql`
2. `supabase/phase6/migrations/00200_phase6_legacy_backfill.sql`
3. `supabase/phase6/migrations/00300_phase6_workflow_rpcs.sql`
4. `supabase/phase6/migrations/00400_phase6_security_and_projections.sql`
5. `supabase/phase6/migrations/00500_phase6_cutover_and_validation.sql`

Responsibilities:

1. Foundation establishes extensions, consolidated existing application structures for clean installs, canonical enums/columns/reference and calendar tables, constraints initially `NOT VALID` where an upgrade needs backfill, indexes, and private helper types. It is rerunnable against the known repository schema without redefining objects in order-dependent ways.
2. Backfill normalizes existing project/revision/skip data, creates imported snapshot events, infers service capabilities conservatively, seeds definitions, detects duplicate triggers/functions/views, and produces validation exceptions without fabricating data.
3. Workflow RPCs add the business-day engine, idempotency receipts, eleven canonical RPCs, canonical notification/history writes, and temporary safe wrappers for old callable names. New writes become available while old UI remains compatible.
4. Security and projections replace RLS per operation, harden all SECURITY DEFINER grants, secure communications, create safe profile/client/timeline projections, and remove the dangerous competing view/policy definitions.
5. Cutover and validation disable/drop the legacy timeline/revision mutation triggers and obsolete function bodies, enable canonical workflow-column write guards, validate deferred constraints, assert the exact eight-stage seed, reconcile histories/totals, and fail if unresolved structural defects remain. It does not delete business history.

For an existing environment, deploy migrations 1-4, deploy the compatible frontend, run validation, then deploy migration 5. For a clean environment, all five run sequentially before the application starts. The old root-level SQL scripts remain untouched historical artifacts and are no longer installation inputs.

AI/RAG structural repairs are intentionally absent from these five migrations except that foundation preserves the currently defined AI tables needed for a complete clean install. New `knowledge_base` compatibility and matching/search repairs belong to Phase 6B.

## 24. Clean Install Strategy

The only supported clean install becomes `supabase db reset`/Supabase migration execution in lexicographic migration order. No operator manually runs `schema.sql` or chooses root SQL patches.

The foundation migration must contain the idempotent consolidated structure needed by all present application areas—core, projects, tasks, client access, revisions, notifications, finance, payroll, communication, and the currently defined AI tables—before the Phase 6 deltas are applied. CI starts an empty local Supabase/PostgreSQL instance, applies all migrations, runs pgTAP/integration tests, and generates TypeScript types.

After clean-install and upgrade parity are proven, `supabase/schema.sql` becomes a generated, read-only schema snapshot produced from the canonical migrated database. It is useful for inspection and diffs but is not executable installation authority. The existing root feature SQL files remain archived references; they are not copied into the migration runner. README, setup, and deployment documentation must point only to deterministic migrations.

## 25. Upgrade Strategy

The upgrade is forward-only and observable:

1. Before Step 3 execution against any real environment, capture a schema-only dump, migration history, row counts, invalid-state reports, and a tested backup. This Step 2 does not connect to the live database.
2. Rehearse the upgrade on a restored staging copy, including ambiguous service types, duplicate objects, legacy enum values, and existing revisions.
3. Apply foundation using additive columns/types/tables and non-blocking indexes where needed. Do not rename/drop legacy data at this point.
4. Run idempotent backfill in bounded batches. Persist an exception report for unresolved capabilities or contradictory evidence. Workflow writes for those projects remain gated.
5. Install canonical RPCs and compatibility wrappers, then security/projections. Validate grants and cross-role access before application rollout.
6. Deploy the frontend that reads canonical fields and uses RPCs. Keep legacy read aliases and dual-writes for one release window. Required database errors surface to the UI; there is no warning-only success fallback.
7. Confirm no legacy direct workflow writes, reconcile cached totals, compare client projections, and run the full upgrade test suite.
8. Apply cutover: retire conflicting triggers/functions/views, validate constraints, and enable workflow write guards.
9. Roll back application code only while compatibility wrappers remain. Database rollback is by restore or a separately reviewed forward repair migration, never by editing or deleting applied migration files.
10. Remove legacy columns/wrappers only in a future major migration after usage telemetry and retention approval.

## 26. Testing Strategy

Database tests use pgTAP/SQL transactions with seeded users for each role; frontend parity tests use the same checked-in JSON date fixtures. Required scenarios:

| ID | Scenario | Expected result |
|---|---|---|
| A | Clean empty database | All five migrations apply once and on reset; exact expected objects, eight seeds, grants, and generated types exist. |
| B | Upgrade fixture from repository-effective legacy schema | Migrations preserve row counts/links, report ambiguities, create one imported snapshot per project, and are idempotent. |
| C | Canonical combined transition sequence | Only 1->2->3->4->5->6->7->8->Completed succeeds; snapshot/history/notifications agree. |
| D | Invalid transitions | Backward jump, wrong approval stage, duplicate approval, direct Completed, and stale revision are rejected with no partial writes. |
| E | Print-only | Concept approval enters Print Version; Print approval auto-skips both Ebook stages and enters Final Delivery. |
| F | Ebook-only | Concept approval auto-skips both Print stages and enters Ebook Version. |
| G | Combined | No capability stage is auto-skipped. |
| H | Weekend exclusion | Friday plus 1/2 production days yields Monday/Tuesday at the same local time; starts on weekends follow start-day-not-counted rules. |
| I | Weekends included | Friday plus 1/2 days yields Saturday/Sunday unless an explicit exception applies. |
| J | Revision deadline | Revision requested near a weekend uses configured/default 2 production days and the same timezone semantics. |
| K | Client approval authorization | Only an authenticated accessible client may approve the current non-stale approval. |
| L | Cross-client isolation | Client A cannot read/mutate Client B projects, revisions, skips, history projections, messages, or files. |
| M | Employee assignment isolation | An unassigned employee cannot mutate/read protected project workflow; assigned employee can perform only team-allowed actions. |
| N | Project Manager permissions | PM manages project workflow/finance within matrix but cannot invoke admin override or access compensation/ledger. |
| O | Admin override permissions | Admin-only, reason required, exact before/after stored, immutable, history atomic. |
| P | Stage skip approval | Authorized request, client approve/reject, paired skip routing, future target handling, and immutable terminal records all behave atomically. |
| Q | History immutability | Direct insert/update/delete by A/PM/E/C fails; RPC events have correct actor, sequence, deltas, and links. |
| R | Communication isolation | Direct/project-internal/project-client/task membership matrices and all child-table inheritance reject unauthorized users. |
| S | Retry/idempotency | Identical key/request returns prior result without duplicate rows; changed request with same key fails; concurrent expected versions yield one winner. |
| T | Frontend/SQL deadline parity | Shared fixtures match for zero days, weekdays, weekends, include-weekends, timezone boundaries, revision durations, and calendar exceptions. |

Additional assertions cover final delivery atomic completion, pause/resume deltas, history-cache reconciliation, unresolved capability gating, safe client/profile projection columns, no public function execution, no `SELECT p.*` client view, and no authenticated `USING/WITH CHECK (true)` on protected tables.

## 27. AI Schema Scope Decision

Decision: repair the undefined `knowledge_base` reference, missing `match_knowledge_base_chunks` RPC, and JWT-role-based AI policies in Phase 6B, immediately after the Phase 6 workflow/security cutover.

This sequencing is safer because the workflow migration already changes core state, RLS, client projections, and communication authorization. Mixing vector/RAG repair increases blast radius and makes rollback diagnosis harder. Phase 6 foundation preserves the currently defined AI tables for clean-install completeness, and the Phase 6 frontend work updates AI workflow readers/actions to use canonical project fields and RPCs. Phase 6B then owns RAG naming, matching function semantics, vector indexes, profile-role authorization, and Edge Function contract tests as one coherent change.

Until Phase 6B is complete, AI write tools must not bypass canonical workflow RPCs, and broken RAG paths must fail closed rather than query an undefined relation.

## 28. Step 3 Implementation Plan

Step 3 should execute in these reviewable work packages:

1. Add deterministic Supabase migration configuration and the canonical foundation migration; prove clean install before proceeding.
2. Add a dry-run/reporting query for legacy mappings, then implement idempotent backfill with imported snapshots and unresolved-capability output.
3. Implement and test business-calendar helpers, time accounting, idempotency receipts, the transition router, and eleven RPCs.
4. Replace RLS and SECURITY DEFINER grants, including communication and safe client/profile projections.
5. Generate database types and switch every frontend workflow writer/read model to canonical state/RPC results. Remove fallback direct workflow writes and surface required-write failures.
6. Run clean and upgrade suites, stage the four pre-cutover migrations and frontend, verify telemetry/reconciliation, then apply the cutover migration.
7. Regenerate the schema snapshot and update installation/deployment documentation only after tests pass.

### Exact Step 3 file plan

Create:

- `supabase/config.toml`
- `supabase/phase6/migrations/00100_phase6_canonical_foundation.sql`
- `supabase/phase6/migrations/00200_phase6_legacy_backfill.sql`
- `supabase/phase6/migrations/00300_phase6_workflow_rpcs.sql`
- `supabase/phase6/migrations/00400_phase6_security_and_projections.sql`
- `supabase/phase6/migrations/00500_phase6_cutover_and_validation.sql`
- `supabase/tests/database/phase6_clean_install.test.sql`
- `supabase/tests/database/phase6_upgrade_backfill.test.sql`
- `supabase/tests/database/phase6_workflow_transitions.test.sql`
- `supabase/tests/database/phase6_business_days.test.sql`
- `supabase/tests/database/phase6_rls.test.sql`
- `supabase/tests/database/phase6_communication_rls.test.sql`
- `supabase/tests/database/phase6_idempotency.test.sql`
- `src/lib/database.types.ts` (generated from the migrated schema)
- `src/lib/phase6DateFixtures.json`
- `docs/PHASE6_MIGRATION_RUNBOOK.md`

Modify during the frontend/cutover work:

- `src/lib/types.ts`
- `src/lib/constants.ts`
- `src/lib/date.ts`
- `src/lib/timeline.ts`
- `src/lib/timeline.test.ts`
- `src/lib/useTracker.ts`
- `src/lib/sampleData.ts`
- `src/components/ProjectFormModal.tsx`
- `src/components/ProjectDetail.tsx`
- `src/components/ClientProjectDetailModal.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/AIAssistantPage.tsx`
- `src/pages/CommunicationPage.tsx`
- `src/lib/ai/aiContext.tsx`
- `src/lib/ai/aiTypes.ts`
- `src/lib/ai/safeActionTools.ts`
- `src/lib/ai/secureTools.ts`
- `src/lib/ai/voiceQueryEngine.ts`
- `src/lib/ai/voiceAssistant.test.ts`
- `package.json`
- `supabase/schema.sql` (regenerated snapshot only; never hand-maintained)
- `README.md`
- `SIMPLE_SETUP_GUIDE.md`
- `DEPLOYMENT.md`

Do not modify or delete any of the existing root-level feature SQL files under `supabase/`; they remain historical evidence. The list above is the implementation expectation, not work performed in Step 2.

## 29. Open Questions / Deferred Product Decisions

These items do not change the canonical state model:

1. Confirm the business timezone before implementation. The decided default is `Asia/Karachi`; changing the organization default before Step 3 only changes configuration/test fixtures, not function semantics.
2. Supply the initial holiday/exception calendar. Phase 6 creates the mechanism but starts with no exceptions beyond weekend rules.
3. Business owners must resolve each `needs_review` service capability before that project can transition. The architecture deliberately does not guess.
4. Decide the retention period for idempotency receipts and orphaned pre-RPC storage uploads. Workflow history has permanent retention regardless.
5. Confirm whether Project Managers should ever receive payroll visibility. The safe Phase 6 default is Admin-only management and employee self-read.
6. Define message edit/delete retention and moderation windows. Phase 6 scopes any permitted mutation to the sender/Admin; it does not introduce content-retention product behavior.
7. Define whether archived projects can be restored by Admin in the UI. The canonical model supports an audited admin override, but no new UI is required for Phase 6.
8. Book-file QC/delivery gating is deferred. Final Delivery keeps current file requirements and does not add a new QC stage or prerequisite.
