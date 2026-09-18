# Phase 6 Step 3B Backfill Report

Date: 2026-09-08  
Revision: Step 3B.1 correctness and migration-safety corrections applied  
Scope: repository-derived legacy normalization and canonical shadow backfill only. Step 3C RPC work, frontend changes, RLS replacement, legacy trigger/function removal, deployment, and live database access were explicitly excluded.

## 1. Scope

Step 3B adds the second ordered Phase 6 migration. It conservatively maps supported legacy project, capability, revision, skip, override, time-total, and history evidence into the nullable canonical shadow model created by Step 3A.

The migration is forward-only, schema-qualified, deterministic, data-preserving, and idempotent where practical. It inserts diagnostics for business ambiguity rather than forcing a value. It does not delete business data or fabricate a complete historical workflow.

**NO LIVE DATABASE WAS MODIFIED.**

## 2. Files Created or Modified

Created in Step 3B:

- `supabase/phase6/migrations/00200_phase6_legacy_backfill.sql`
- `docs/PHASE6_STEP3B_BACKFILL_REPORT.md`

Existing files modified in the original Step 3B: none.

Step 3B.1 modifies only the two existing Phase 6 migrations and the Step 3A/3B reports. No new file is created. The paragraph below describes the original Step 3B scope.

The Step 3A migration/report, Phase 6 audit/design, frontend files, root-level historical `supabase/*.sql` scripts, configuration, and package manifest were not edited. The build regenerated ignored `dist/` output only.

## 3. Lifecycle Mapping

Five canonical lifecycle outcomes are recognized:

| Evidence | Canonical lifecycle |
|---|---|
| `final_delivery_date`, explicit `Completed`, or explicit `Delivered` | `completed` |
| Explicit `Archived` | `archived` |
| Explicit `Cancelled` | `cancelled` |
| Explicit `On Hold` | `on_hold` |
| Repository-recognized production, approval, revision, and normal work labels | `active` |

The terminal rule has highest precedence. A terminal milestone conflicting with Archived, Cancelled, or On Hold produces `WORKFLOW_STATE_CONTRADICTORY`. Unknown status text remains NULL and produces `PROJECT_STATUS_UNRECOGNIZED`. Existing non-NULL `project_status` values are never overwritten.

Step 3B.1 also diagnoses populated canonical lifecycle values that disagree with the same independent evidence rule. `WORKFLOW_STATE_CONTRADICTORY` now includes a `lifecycle_contradiction` object with existing/inferred lifecycle, legacy status, delivery fields, and `existing_canonical_value_preserved`. It merges these details into an existing issue rather than losing a second finding to issue uniqueness. Delivery evidence still wins; absent delivery, explicit Archived/Cancelled/On Hold evidence is compared with the canonical value.

The repository contains 33 recognized project status values. `Final Delivery` remains an active lifecycle until reliable delivery/completion evidence exists.

## 4. Workflow Stage Mapping

All eight canonical stage targets are recognized from 27 exact project-stage/status labels:

| Canonical stage | Exact recognized legacy/current labels |
|---|---|
| `files_received` | Files Required, Files Received, New, Waiting for Files, Ready to Start |
| `design_concept` | Design Concept in Progress, Design Concept |
| `concept_approval` | Awaiting Concept Approval, Concept Approval, Concept Revisions |
| `print_version` | Print Version in Progress, Print Version |
| `print_approval` | Awaiting Print Approval, Print Approval, Print Revisions |
| `ebook_version` | eBook in Progress, eBook Conversion, Ebook Version, eBook Version |
| `ebook_approval` | eBook Review, Ebook Approval |
| `final_delivery` | Final Quality Check, Final Delivery, Ready for Delivery, Final QA, Completed, Delivered |

Evidence precedence is terminal evidence, a chronologically compatible latest open revision, dated milestones from latest to earliest, exact `current_stage`, then exact workflow-shaped project status.

Milestones are stronger than stale text. Concept or print approval does not guess the next format stage when capabilities are unresolved; the latest proven approval stage is retained as completed/none and capability diagnostics remain open. Formatting, Cover Design, First Proof Ready, Sent to Client, Client Review, and Revision Requested are recognized as active lifecycle labels but are not treated as exact stage evidence without a milestone/current-stage corroboration.

## 5. Stage Status and Waiting Mapping

| Evidence/state | Canonical stage status | Waiting owner |
|---|---|---|
| Running production stage | `active` | `team` |
| Approval/revised proof awaiting client | `awaiting_client` | `client` |
| Active revision on an approval stage | `revision_active` | `team` |
| Files required/waiting | `pending` | `client` |
| New with no explicit client wait | `pending` | `none` |
| On hold, cancelled, or archived | `paused` | `none` |
| Completed delivery | `completed` | `none` |
| Proven approval with unresolved next-format route | `completed` | `none` |

Existing canonical stage/status/waiting values are preserved. A mismatch between populated canonical state and inferred repository evidence is reported as `WORKFLOW_STATE_CONTRADICTORY`.

## 6. Service Capability Mapping

Normalization trims the value, collapses whitespace, and compares case-insensitively. Nine exact normalized values are deterministic:

| Exact normalized service type | Print | Ebook | Result |
|---|---:|---:|---|
| `formatting` | true | false | inferred |
| `print formatting` | true | false | inferred |
| `print formatting & cover` | true | false | inferred |
| `print cover design` | true | false | inferred |
| `print only` | true | false | inferred |
| `ebook formatting` | false | true | inferred |
| `ebook cover design` | false | true | inferred |
| `ebook only` | false | true | inferred |
| `print + ebook` | true | true | inferred |

`Print Cover Design`, `Print Only`, and `eBook Only` are documented examples in the routing helper. `Print Formatting & Cover` and `eBook Cover Design` are asserted by timeline tests. `Formatting` is classified as print-only by the current routing implementation. `Print + eBook` is the explicit combined creation default.

Migration inference leaves `capabilities_resolved_by` and `capabilities_resolved_at` NULL. It never marks inferred data confirmed. A valid pre-existing confirmed pair is not overwritten; a confirmed pair that conflicts with deterministic evidence or disables both formats is preserved and diagnosed.

## 7. Unresolved Capability Behavior

The following exact repository values remain unresolved because the repository does not deterministically identify print, ebook, or combined routing:

- `Cover Design`
- `Children's Book`
- `Children Book`
- `Workbook / Journal`
- `Workbook`
- `Magazine`
- `Revision Only`
- `Other`

Blank and any other unknown values are also unresolved. They receive NULL capability booleans, `needs_review`, and `CAPABILITY_UNRESOLVED`. No unknown is silently treated as a combined project.

Bare `Cover Design` additionally receives `CAPABILITY_CONFLICT`: repository tests qualify ebook cover work as `eBook Cover Design`, so the unqualified offering cannot prove which format is required.

## 8. Revision Status Mapping

| Legacy status | Canonical status |
|---|---|
| Submitted | `submitted` |
| Under Review | `under_review` |
| Assigned | `under_review` |
| In Progress | `in_progress` |
| Ready for Client Review | `ready_for_client_review` |
| Additional Revision Required | `changes_requested` |
| Approved | `approved` |
| Completed with stage-matched approval DATE strictly later than submission's local DATE | `approved` |
| Completed with same-day, earlier, absent, or unresolved approval evidence | `ready_for_client_review` plus `REVISION_STATUS_AMBIGUOUS` |

For Concept, Print, and Ebook Approval separately, submission uses `(coalesce(submitted_at, created_at) AT TIME ZONE 'Asia/Karachi')::date`. A same-day approval DATE does not prove which event occurred first: the missing canonical status is filled as `ready_for_client_review` and `REVISION_STATUS_AMBIGUOUS` records the date-order uncertainty. Only a strictly later approval DATE proves `approved`. Existing populated canonical revision statuses remain preserved, including on rerun; an earlier rehearsal must be rebuilt to test corrected inference. Revision stage-window comparisons use the same explicit timezone.

No cancelled status is invented. Drift-only values such as `Pending` or `In Revision`, if present despite the repository table contract, remain NULL and are diagnosed as `REVISION_STATUS_AMBIGUOUS`.

## 9. Revision Stage, Round, Parent, and Due Strategy

Revision stages are limited to Concept Approval, Print Approval, and Ebook Approval. The latest request may use an exact current approval/revision label only when later milestone evidence does not disprove it. Other requests use dated concept/print/ebook submission-to-approval windows. Titles and descriptions are not parsed, and Print Approval is never a default.

Some revision stages can remain unresolved by design and receive `REVISION_STAGE_AMBIGUOUS`.

Known-stage rounds use `ROW_NUMBER()` by project and stage, ordered by `submitted_at`, `created_at`, and UUID. Existing non-NULL rounds remain unchanged. Equal timestamps or an existing round that differs from deterministic order produce `REVISION_ROUND_CONFLICT`.

A child is linked only when the previous same-project/same-stage row explicitly has `Additional Revision Required` and a distinct next round exists. Sequential rows are not blindly chained.

Only an unambiguous latest nonterminal concept/print revision can inherit the corresponding stored revision due DATE. There is no repository-supported ebook revision due column. Step 3B.1 changes new DATE imports to the last PostgreSQL microsecond of that Asia/Karachi calendar date: `((legacy_due_date + 1)::timestamp - interval '1 microsecond') AT TIME ZONE 'Asia/Karachi'`. No new due date is calculated and existing non-NULL `due_at` values are preserved. Evidence: `src/lib/date.ts::daysUntil/isOverdue` compares DATE deadlines with today's DATE and requires a negative day difference; `deadlineLabel` returns Due today for zero; `src/lib/timeline.ts::getTimelineSummary` uses the same rule. A future timestamp-aware UI must not mark such a legacy deadline overdue at the start of its named date.

## 10. Skip Backfill Strategy

Exact stage labels map to typed stage keys. `requested_by` may copy to `requester_id`; `client_response_at` may copy to `responded_at`; and `client_notes` may copy to `response_note`. `responded_by` is not invented.

Status mapping is:

- PENDING -> `pending`
- APPROVED -> `approved`
- REJECTED -> `rejected`
- SERVICE_TYPE_PRESET -> NULL canonical status

`SERVICE_TYPE_PRESET` is preserved as automatic legacy routing evidence, not converted to a manual client approval. Preset and other skip evidence are summarized in the imported snapshot metadata. Unknown stages/statuses receive `SKIP_STAGE_AMBIGUOUS`. No cancellation is inferred without actual cancellation evidence.

## 11. Admin Override Strategy

Only exact previous/new stage strings populate missing `previous_stage_key` and `resulting_stage_key`. Each assignment now uses `coalesce(existing_key, mapped_key)` independently, so filling one key cannot clobber the other. One shared mapping feeds the update and `OVERRIDE_STATE_AMBIGUOUS` diagnostic; conflicts preserve both existing values and record existing keys, inferred keys, legacy text and the preservation decision. Existing issue details are updated when a new conflict is found. Legacy rows do not contain enough evidence to infer lifecycle, stage execution status, waiting owner, stage-start timestamp, or due timestamp, so those fields remain unchanged/NULL. An unrecognized before/after stage receives `OVERRIDE_STATE_AMBIGUOUS`. Legacy override columns and rows are not rewritten.

## 12. Legacy Time-Total Decision

Repository code copies `production_time_used` directly to `active_seconds` and `client_wait_time` directly to `client_wait_seconds`; this is the only direct unit evidence. Integral nonnegative values therefore seed the corresponding canonical seconds cache 1:1 only when that cache is still zero.

`production_days_used` is not converted. Its legacy calendar-date calculation cannot separate production time from client wait or reproduce the canonical elapsed-time model. Positive `production_days_used`, negative values, and fractional second candidates produce `LEGACY_TOTAL_UNIT_UNCERTAIN`. No elapsed time is reconstructed from milestone differences.

## 13. History Import Strategy

Existing unsequenced history rows are appended after the current maximum. Timestamp precedence is `completed_at`, `paused_at`, `resumed_at`, `started_at`, original legacy `created_at`, then `occurred_at` only for a row with populated canonical `event_type`. This uses stored event-boundary evidence before insertion-time fallback; due timestamps are never event-order evidence. The choice between differently meaningful boundaries is explicitly a migration ordering convention. Existing non-NULL sequence numbers are never rewritten. All unsequenced legacy events, missing evidence timestamps and ties receive `HISTORY_SEQUENCE_CONFLICT`; UUID breaks ties deterministically without asserting historical order.

A unique partial index enforces at most one `legacy_snapshot_imported` event per project. Every project lacking that event receives exactly one snapshot after existing history. The event has zero production/client deltas, NULL actor identity, and migration execution time as `occurred_at`.

Metadata explicitly says that occurrence time is import time, not historical stage-entry time. It contains only compact workflow evidence: legacy state fields, milestone dates, service type, capability result, revision reconciliation, legacy totals, proven skipped `stage_states`, skip summaries, and project issue codes. It excludes client notes, files, messages, and other large/private content. The migration does not invent eight stage entries.

## 14. Backfill Issue Codes

Fourteen stable codes are defined:

1. `CAPABILITY_UNRESOLVED`
2. `CAPABILITY_CONFLICT`
3. `PROJECT_STATUS_UNRECOGNIZED`
4. `WORKFLOW_STAGE_AMBIGUOUS`
5. `WORKFLOW_STATE_CONTRADICTORY`
6. `REVISION_STAGE_AMBIGUOUS`
7. `REVISION_STATUS_AMBIGUOUS`
8. `REVISION_ROUND_CONFLICT`
9. `REVISION_COUNT_DISCREPANCY`
10. `TIMESTAMP_UNRELIABLE`
11. `LEGACY_TOTAL_UNIT_UNCERTAIN`
12. `HISTORY_SEQUENCE_CONFLICT`
13. `SKIP_STAGE_AMBIGUOUS`
14. `OVERRIDE_STATE_AMBIGUOUS`

Issues are stored in internal `public.phase6_backfill_issues` with a stable expression-based uniqueness key. RLS is enabled, and all table privileges are revoked from `anon` and `authenticated`; no ordinary-user policy is created in Step 3B.

## 15. Validation Queries and Counts Available

The migration ends with queryable counts for:

- total projects;
- NULL canonical lifecycle/stage/status/waiting fields;
- needs-review, inferred, and confirmed capability totals;
- unresolved revision stage/status totals;
- projects missing an imported snapshot;
- duplicate history sequence groups;
- unresolved issues grouped by code and severity.

Structural validation fails the migration for duplicate canonical sequence numbers, multiple snapshot events for one project, or a project missing its snapshot. Business ambiguity does not fail migration success.

No actual database row counts are claimed because no database was executed or queried.

## 16. Repository-Derived `service_type` Inventory

Exact project service values found in frontend options, creation defaults, sample/evaluation data, tests, and routing-helper examples are:

- Print Formatting
- eBook Formatting
- Cover Design
- Print + eBook
- Children's Book
- Workbook / Journal
- Magazine
- Revision Only
- Other
- Formatting
- Print Formatting & Cover
- Print Cover Design
- Print Only
- eBook Cover Design
- eBook Only
- Children Book
- Workbook

The first nine are current form choices. The additional values come from project fixtures/evaluations, timeline tests, and explicit helper examples. Display-only invoice fallbacks such as “Publishing Service” were not treated as persisted project service evidence.

## 17. Repository-Derived State and Status Inventory

Recognized project statuses (33): Active, In Progress, Awaiting Client Approval, In Revision, Final Delivery, Completed, On Hold, Cancelled, New, Waiting for Files, Files Required, Files Received, Design Concept in Progress, Awaiting Concept Approval, Concept Revisions, Print Version in Progress, Awaiting Print Approval, Print Revisions, eBook in Progress, eBook Review, Final Quality Check, Ready to Start, Formatting, Cover Design, eBook Conversion, First Proof Ready, Sent to Client, Client Review, Revision Requested, Final QA, Ready for Delivery, Delivered, and Archived.

Recognized project stage labels (27 exact labels into eight canonical targets) are listed in section 4. Stage execution evidence recognizes ACTIVE, PAUSED_CLIENT_REVIEW, REVISION_ACTIVE, COMPLETED, PENDING, and SKIPPED without modifying the legacy field.

Revision statuses mapped: Submitted, Under Review, Assigned, In Progress, Ready for Client Review, Additional Revision Required, Approved, and conditionally Completed. Skip statuses mapped: PENDING, APPROVED, REJECTED; SERVICE_TYPE_PRESET is deliberately preserved with NULL canonical status.

## 18. Local Database Execution Status

**LOCAL DB VALIDATION BLOCKED: `supabase`, `psql`, and `docker` commands are not installed or available on PATH.**

Results:

```text
supabase --version -> exit 1, command not found
psql --version     -> exit 1, command not found
docker --version   -> exit 1, command not found
```

No packages were installed. The migration was not executed against a local or remote database and must still be rehearsed on an isolated restored staging copy before any real upgrade.

## 19. npm Build Result

`npm run build` succeeded after Step 3B.1:

```text
> manuscript-heaven-tracker@1.0.0 build
> tsc && vite build

vite v6.4.3 building for production...
✓ 1715 modules transformed.
✓ built in 16.20s
```

Vite emitted its existing advisory that the generated JavaScript chunk exceeds 500 kB. No frontend modification was required.

## 20. Known Uncertainties Before Step 3C

- The migration has not been parsed or executed by PostgreSQL because local database tooling is unavailable.
- Actual production values/counts, enum definitions, constraints, installed trigger variants, and RLS ownership remain unknown until a read-only schema capture and staging rehearsal.
- Unknown service offerings require business confirmation before canonical workflow mutation.
- Revision stages remain NULL where milestone/current-stage chronology cannot prove Concept, Print, or Ebook Approval.
- `Completed` revision rows without approval evidence remain explicitly ambiguous even though their conservative projection is ready for client review.
- DATE-backed delivery/revision deadlines retain only date precision; exact historical time of day is unknown.
- Existing non-NULL revision rounds are preserved even when deterministic ordering disagrees; those issues must be reviewed before a future strict uniqueness constraint.
- Legacy time counters were not reliably accumulated by database code. Imported second values are evidence-preserving seeds, not proof of complete historical elapsed time.
- Legacy stage derivation functions/triggers and frontend direct writes remain active compatibility behavior until their later owned steps.

## 21. Step 3B.1 Upgrade Timestamp Corrections

The Step 3A upgrade ALTER now adds history `occurred_at/created_at` and skip `created_at/updated_at` as nullable TIMESTAMPTZ without defaults. Separate ALTER COLUMN SET DEFAULT statements configure future inserts only. Existing rows stay NULL when a column was absent, and pre-existing values stay unchanged; no upgrade NOT NULL is introduced. Clean CREATE TABLE definitions retain their defaults.

This prevents new timestamp contamination; it cannot identify or undo timestamps written by an earlier applied version. Rebuild disposable staging rehearsals from their pre-Phase-6 fixture before comparing results. Do not null or rewrite indistinguishable old timestamps by guesswork. [PostgreSQL ALTER defaults semantics](https://www.postgresql.org/docs/15/ddl-alter.html).

The newly inserted `legacy_snapshot_imported` event still uses `clock_timestamp()` for `occurred_at`, because the import really occurs then. Its metadata continues to say `migration_import_time_not_historical_stage_entry_time`.

## 22. Step 3B.1 Transaction and Write-Freeze Runbook

Both a single transaction with table locks AND a deployment write freeze are required. These are application instructions for a later authorized rehearsal/deployment; neither was performed here.

The file now starts an explicit transaction, sets READ COMMITTED before any queries, and acquires `EXCLUSIVE ... NOWAIT` locks on projects, revision_requests, project_stage_history, project_stage_skips and admin_workflow_overrides before data inference. It commits only after normalization, history sequencing, snapshot insertion, structural assertions, result counts and comments. The locks block other writers and SELECT FOR UPDATE/SHARE calls, while allowing ordinary SELECT. [PostgreSQL locking modes](https://www.postgresql.org/docs/15/explicit-locking.html).

Application checklist:

1. Freeze frontend, API, scheduled/background jobs, service clients and administrative workflow writers; drain in-flight transactions. Pause overlapping schema migrations as well.
2. Use one database connection and execute the entire file. Never run selected sections or use statement-by-statement connections. Require stop-on-error behavior.
3. Rehearse how the actual Supabase runner handles explicit BEGIN/SET TRANSACTION/COMMIT and its migration ledger on an isolated copy. Repository config specifies PostgreSQL 15, but contains no installed/pinned migration runner that proves its transaction/ledger behavior. An outer transaction that already queried data may reject SET TRANSACTION; do not bypass that failure.
4. On lock contention, deadlock or any SQL/assertion failure, roll back and diagnose under the freeze, then retry the whole file. NOWAIT deliberately fails instead of reading a racing dataset. Verify failure rollback and reader/writer behavior in a two-session rehearsal.
5. Verify the successful commit, migration ledger, snapshot cardinality, sequence uniqueness and diagnostics before lifting the freeze. The freeze is required even with locks because runner integration is unverified and queued legacy writers can resume after commit.
6. Rehearse existing triggers as installed. Table locks do not suppress same-transaction triggers: the audited legacy project trigger can rewrite workflow fields on updates. No trigger is disabled or changed here; a staging preservation failure must be resolved within a separately authorized trigger/cutover step before real application.

The SQL expresses the intended transaction/lock guarantees; runtime concurrency safety and atomic migration-ledger behavior are NOT claimed as tested. No local or live database was accessed. Locks are only effective while the containing transaction remains open. [PostgreSQL LOCK transaction requirements](https://www.postgresql.org/docs/15/sql-lock.html).

## 23. Step 3B.1 DATE Precision Decision

- `delivered_at`: retain start-of-local-day normalization in Asia/Karachi. Source precision is DATE only, and midnight is not observed delivery time. Source preference remains final_delivery_date, then delivery_date only with completion evidence.
- `revision_requests.due_at`: new imports use end of the named local day, 23:59:59.999999 Asia/Karachi, supported by the repository's Due today/day-based overdue behavior. This avoids prematurely expiring the entire due date in a future timestamp-aware UI. Existing non-NULL canonical timestamps are protected.
- Snapshot metadata and column comments distinguish the two conventions and explicitly reject historical time-of-day precision. The current frontend is unchanged.

Step 3C has not started. No workflow RPC or trigger was created, replaced, or dropped.

## 24. Step 3B.1 Validation Results

Repository/static checks passed:

- Exactly two Phase 6 migrations; no Step 3C file.
- Exactly eight workflow_stage_definitions seed rows.
- No workflow function/RPC definitions, trigger changes, destructive DROP TABLE or business DELETE statements.
- Project UPDATE assignment inspection found no assignments to status/current_stage/stage_status/waiting_on/timeline_status; revision legacy status has no assignment.
- The four corrected timestamp additions are nullable and have no ADD COLUMN default, with future defaults set separately.
- All three Completed approval comparisons use strict greater-than against an explicit Asia/Karachi local DATE.
- Both override assignments independently preserve populated keys; lifecycle conflicts use an independent inference.
- One snapshot insertion path and its unique partial index remain; snapshot occurred_at is import time.
- Explicit transaction starts before locks/inference and commits after validation. Five target table locks precede business reads/writes.
- SQL parentheses balance with strings/comments excluded; these lexical checks are not a PostgreSQL parse/execution test.
- An independent date-rule probe confirmed that 2026-09-07 20:00 UTC is 2026-09-08 in Asia/Karachi: approval dates September 7/8 do not prove approval, September 9 does.
- No installed supabase/psql/docker command was discovered. No packages were installed.

Build: exit 0, 1,715 modules transformed, Vite build 16.20s; existing large-chunk advisory only. No frontend source files changed.

Static comparisons establish direct SQL assignment preservation, not protection from existing trigger side effects. Runtime clean-install, upgrade, two-session concurrency, failure rollback and runner-ledger validation remain required under the runbook above.
