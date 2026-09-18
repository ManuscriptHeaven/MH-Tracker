# Phase 6 Step 3C.1 — Canonical Workflow Engine Foundation

Date: 2026-09-08  
Status: foundation and Step 3C.1.1 data-minimization corrections authored; static checks/build passed; PostgreSQL execution blocked.  
**NO LIVE DATABASE WAS MODIFIED.**

## 1. Scope

The third migration contains engine structural objects and internal helpers only. It defines **zero of the eleven public mutation RPCs**. Step 3C.2 must extend the same migration after review. No frontend switch, deployment, RLS-policy replacement, legacy trigger/function removal, or Step 3D work was performed.

The audit, design, Step 3A/3B reports and both existing migrations were re-read. The reviewed `project_stage_history.stage DROP NOT NULL` correction is present in migration 1. No additional true migration-chain blocker was found during this foundation work. Migrations 1 and 2 remain unchanged and unexecuted/unverified against PostgreSQL.

## 2. Files Created / Modified and Structural Objects

Created during the original Step 3C.1 foundation:

- `supabase/phase6/migrations/00300_phase6_workflow_rpcs.sql`
- `supabase/tests/database/phase6_business_days.test.sql`
- `supabase/tests/database/phase6_engine.test.sql`
- `scripts/phase6-engine-static-tests.mjs`
- `docs/PHASE6_STEP3C1_ENGINE_REPORT.md`

Step 3C.1.1 modifies four of those files: migration 3, `phase6_engine.test.sql`, the static-test script and this report. It creates no additional files. **`phase6_business_days.test.sql` is unchanged**, as are migrations 1 and 2. The build regenerates ignored `dist/` artifacts only. No frontend code, package manifest, dependency, historical root SQL, prior migration or prior report was changed.

New structural objects: **one table**, `public.workflow_idempotency_receipts`, and **one composite type**, `public.workflow_mutation_result`. There are **42 helper functions** (three named calendar functions plus 39 underscore-prefixed internal helpers), three Phase 6 migrations, and the unchanged eight stage seeds.

The mutation-result type has `project_id uuid`, `workflow_version bigint`, `project_snapshot jsonb`, `affected_entity_ids jsonb`, `history_event_ids uuid[]`, and `already_applied boolean`. `_workflow_project_snapshot` uses a least-privilege, client-safe allowlist shared by future team and client mutations. Internal `production_seconds_total`, `client_wait_seconds_total` and `workflow_settings` are intentionally excluded; production-duration settings are not needed for this generic workflow-result contract. It also excludes internal/QA notes, finance, employee/payroll information, actor identities, capability-resolution audit fields, backfill diagnostics and raw history metadata. `_workflow_make_result` builds that contract; it never serializes `projects.*` into the response. Internal accounting remains available to the protected reconciliation helpers, not this generic response.

The exact 20 snapshot fields are: `id`, `project_status`, `workflow_stage_key`, `workflow_stage_status_key`, `workflow_waiting_on_key`, `workflow_version`, `requires_print`, `requires_ebook`, `service_capability_status`, `stage_started_at`, `stage_due_at`, `stage_completed_at`, `final_due_at`, `revision_count`, `delivered_at`, plus the five compatibility fields `status`, `current_stage`, `stage_status`, `waiting_on`, `timeline_status`.

## 3. Idempotency Design

Receipts have a generated UUID ID, RPC name, project/actor FKs with `ON DELETE RESTRICT`, idempotency UUID, request fingerprint, JSON result and creation/update timestamps. Uniqueness is `(rpc_name, project_id, actor_id, idempotency_key)`. RLS is enabled and all table privileges are revoked from PUBLIC, anon and authenticated; no ordinary-user policy is added.

`_workflow_request_fingerprint` constructs exactly `jsonb_build_object('contract', 'phase6-v1', 'rpc', p_rpc_name, 'project_id', p_project_id, 'parameters', p_parameters)::text`, then returns its **SHA-256 digest encoded as 64 lowercase hexadecimal characters**. JSONB orders object keys deterministically, including nested objects. Arrays retain their order, and an absent property is distinct from explicit JSON null. Raw canonical request text exists transiently during hashing; the receipt fingerprint stores only the digest. No other receipt column was added to retain request notes, reasons, instructions or files. A digest minimizes duplicated content; it is not encryption.

Migration 1 uses `CREATE EXTENSION IF NOT EXISTS pgcrypto` without fixing a schema, and an existing installation may use another schema. The helper therefore reads `pg_catalog.pg_extension` joined to `pg_catalog.pg_namespace`, resolves pgcrypto's actual installed schema, and calls its identifier-quoted, schema-qualified `digest` with bound text input and the explicit `sha256` algorithm, followed by `pg_catalog.encode(..., 'hex')`. It does not assume `public` or `extensions`. The helper is STABLE rather than IMMUTABLE because it reads that catalog; a missing extension raises `workflow_pgcrypto_unavailable`.

Step 3C.2 must supply **every behavior-changing argument**, including expected workflow version, explicit defaults/NULLs, notes/reasons/instructions, decisions, revision/skip/stage/request IDs, file references, workflow settings and capability values. Hashing does not permit omitted parameters. Normalize typed timestamps to one representation before constructing JSON; the helper cannot recover omitted arguments or normalize strings that callers already serialized differently. Server-generated mutation timestamps are not request parameters.

`_workflow_receipt_lookup` derives its actor through `_workflow_current_actor`; an absent receipt returns a NULL composite. `_workflow_retry_result` compares fingerprints and returns the original response with `already_applied=true`; mismatch raises `idempotency_key_reused`. `_workflow_receipt_store` remains unchanged: it validates a new response against the stored project version and the now-reduced safe snapshot, without depending on excluded accounting/settings fields. It inserts once, preserves existing receipts, and rejects inconsistent replacement results. Retry returns the originally committed safe payload, not a reconstruction from current project state; only `already_applied` becomes true. The supplied mutation timestamp is used for both receipt timestamps.

## 4. Correct Idempotency Retry Order

This intentionally corrects section 16 of the Step 2 design:

1. Authenticate the active actor and validate the action's role/access.
2. Lock the project with `SELECT ... FOR UPDATE` (project first, then related rows).
3. Inspect the receipt and compare the fingerprint.
4. If identical, return the previous result with `already_applied=true`.
5. **Only for a new request**, call `_workflow_check_version`.
6. Validate current state and execute the mutation atomically.
7. Increment `workflow_version`, build the safe result and store the receipt.

An original version-0 request that already produced version 1 must be retryable even if later mutations have advanced the project again. It must not fail the new-request version gate. `_workflow_lock_project` does not check version; receipt lookup does not check version. Specific RPC role authorization remains mandatory even though the lock helper checks general team/client access.

## 5. Business-Day Semantics

Created `workflow_add_production_days`, `workflow_production_seconds_between`, and `workflow_production_days_between` with the requested signatures/defaults: exclude weekends by default, timezone `Asia/Karachi`.

Whole-day addition starts searching on the next local date. Friday +1/+2 is Monday/Tuesday, not Friday/Monday. Zero returns the identical input instant, including subseconds; negative/NULL durations are rejected. Local wall-clock time is preserved. Timestamps must be finite and timezone names valid. A requested local time that does not exist because of a DST gap/skipped date raises `workflow_local_time_unrepresentable`; it is not silently shifted. PostgreSQL's timezone conversion resolves repeated local times according to its timezone rules.

## 6. Exact Production-Seconds and Production-Days Semantics

`workflow_production_seconds_between` intersects the half-open interval `[start,end)` with each eligible local date's midnight-to-midnight interval. It sums actual elapsed seconds, including partial first/last dates, then floors fractional seconds **once** to return bigint. Equal endpoints return zero; reversed, NULL or infinite endpoints are rejected. The calculation does not assume that every local date is 86400 seconds, so included DST dates can contribute 23 or 25 hours.

`workflow_production_days_between` means **eligible whole elapsed seconds divided by 86400**, returning numeric fractional 24-hour-equivalent days. Twelve eligible hours equals 0.5. It is not an inclusive date count, an eight-hour staff workday, or necessarily an inverse of whole-day addition. Its subsecond precision is the same as the integer-seconds helper. This explicit choice resolves the previously unspecified meaning of the numeric result.

`_workflow_add_production_seconds` consumes eligible elapsed time starting at the supplied instant, supports partial-day continuation, honors exceptions, rejects negative/NULL seconds, and returns the original instant for zero. Exact exhaustion at midnight returns that midnight without advancing to another workday. It preserves fractional residual duration internally while crossing date boundaries.

## 7. Calendar Exceptions

`_workflow_is_production_date` checks `workflow_calendar_exceptions` first. Explicit true makes a weekend date working; explicit false makes any date nonworking, even when weekend exclusion is disabled. Absence of a row falls back to the weekend flag. Calendar functions are STABLE readers, not IMMUTABLE. No exceptions are seeded by the migration; test calendar fixtures exist only inside rollback-only SQL tests.

## 8. Settings Helpers

`_workflow_validate_settings` accepts a JSON object or SQL NULL (no overrides). `exclude_weekends` must be a JSON boolean. The six canonical duration keys must be integral JSON numbers in 0..365: `files_received_days`, `design_concept_days`, `print_version_days`, `ebook_version_days`, `final_delivery_days`, `revision_days`. Invalid types, JSON null values for known keys, fractions and out-of-range values are rejected.

Additional legacy keys are tolerated, including stage-specific revision durations, but do not override canonical keys. `_workflow_stage_duration_days` uses reference-table production defaults when absent and always returns zero for approvals. `_workflow_revision_duration_days` supplies database default 2; `_workflow_exclude_weekends` supplies database default true. No stage order, name or authority is read from project JSON.

## 9. Authorization Helpers

`_workflow_current_actor` starts at `auth.uid()`, requires the exact profile with `status='active'`, and returns its raw role plus normalized role. No caller identity parameter, JWT role string, fuzzy name or email lookup authorizes access.

| Stored role | Normalized behavior |
|---|---|
| `admin` | Admin |
| `project_manager`, `manager` | Project Manager |
| `employee`, `junior_assistant` | Employee |
| `client` | Client |

`_workflow_is_admin` is exact Admin only. `_workflow_is_manager` permits Admin/PM. `_workflow_can_team_work` permits Admin/PM for a project and Employee only when `projects.assigned_to` matches the actor; Client is never team access. `_workflow_can_client_access` requires Client plus an exact access row or `projects.client_profile_id` match. `_workflow_lock_project` authenticates, locks and checks general project access. It returns a private row composite for future trusted RPC code, not a public project API.

## 10. Compatibility Projection

`_workflow_compatibility_projection` maps the actual canonical shadow columns, not the design's eventual renamed columns. Official `current_stage` display values come from `workflow_stage_definitions`, including **Ebook Version / Ebook Approval**. Unknown stage remains NULL, and stopped lifecycle states retain the real stage.

| Canonical condition (lifecycle precedence first) | Legacy project status | Legacy timeline |
|---|---|---|
| completed | Completed | Completed |
| on_hold | On Hold | On Hold |
| cancelled | Cancelled | Cancelled |
| archived | Archived | Paused |
| awaiting_client | Awaiting Client Approval | Paused |
| revision_active | In Revision | Active |
| active Final Delivery | Final Delivery | Active |
| other active workflow | Active | Active for running production; Paused for stopped/waiting execution |

Clock mapping: active → ACTIVE, revision_active → REVISION_ACTIVE, awaiting_client → PAUSED_CLIENT_REVIEW, pending → PENDING, skipped → SKIPPED, completed → COMPLETED, paused → COMPLETED. The last mapping follows the existing frontend stopped-clock convention because `ClockState` has no PAUSED value; canonical `paused` remains authoritative and is not changed. Waiting maps to Manuscript Heaven / Client / None.

The historical SQL check admits only Active, Paused, Completed, On Hold and Cancelled for `timeline_status`. Therefore the helper deliberately does **not** write the design's unsupported Waiting for Client / Revision Active / Archived timeline strings, or the frontend-only Revision Required / Skipped strings. Archive projects retain `status='Archived'` while using the compatible stopped timeline Paused. No SQL check or frontend vocabulary was changed.

## 11. Legacy-Trigger Conflict Handling

`_workflow_assert_project_projection` is VOLATILE so its post-UPDATE query observes completed statement/trigger effects. Given the expected project row, it compares the actual safe canonical snapshot and the five expected compatibility fields, plus raw settings and capability-resolution audit fields. Step 3C.1.1 adds explicit internal comparisons of both accounting caches because they no longer appear in the safe snapshot. This preserves the existing conflict-detection coverage without exposing those caches to clients; it does not change accounting or routing behavior. Divergence raises `legacy_workflow_trigger_conflict` and the future RPC transaction must abort.

No suppression flag, trigger drop, replacement or bypass was introduced. The SQL test simulates a conflicting stored projection by changing a fixture field; it does not install a test trigger. Step 3C.2 must call this helper after each project UPDATE and separately verify its action-specific milestone/file fields and related-table effects. Actual legacy-trigger variants still require staging rehearsal. A trigger may also reject an UPDATE before this helper can run; that error must abort too.

## 12. History Append Helper

`_workflow_append_history` assumes the caller already holds the project's FOR UPDATE lock. It allocates `max(sequence_no)+1`, inserts exactly one canonical event and returns its UUID. It accepts explicit from/to fields, actor snapshot, revision/skip/override links, nonnegative deltas, reason, object metadata, due timestamp and idempotency key. Supplied actor ID/role are verified against `auth.uid()` and the active profile; they are audit data, not authorization inputs. Linked entities must belong to the same project.

The supplied mutation timestamp is used for occurred/created times; history never reads a new clock for each event. Events preceding existing canonical occurrence time are rejected. New imported-snapshot events are rejected by this helper. Legacy stage/status/action aliases are populated explicitly, supporting inherited NOT NULL status/action constraints without fake stage labels. No existing event is edited/deleted.

Future RPCs must close an interval exactly once, even when emitting several skip events; subsequent events in the same mutation get zero additional elapsed deltas. They must advance/reset the running clock anchor after accounting, including mutations that leave the same stage active. The helper's append-only implementation is not a claim that legacy direct-table privileges have already been secured; that remains Step 3D.

## 13. Accounting Baseline

`_workflow_accounting_baseline` finds the unique `legacy_snapshot_imported` event and reads its `metadata.canonical_snapshot.production_seconds_total` and `client_wait_seconds_total`. Malformed, negative, fractional, missing or overflowing baseline values raise `workflow_accounting_corrupt`. No snapshot means zero baselines.

For each total:

`calculated total = imported snapshot baseline + sum(canonical event deltas with sequence_no > snapshot sequence)`

Without a snapshot, all canonical deltas are added to zero. Pre-snapshot deltas and untyped legacy rows do not enter the migrated calculation. The import event's own zero deltas remain unchanged. Sequence order, not equal/ambiguous timestamps, determines the accounting boundary. Invalid canonical delta/sequence data raises an error rather than being silently treated as zero.

## 14. Effective Clock Boundary

`_workflow_effective_clock_start` returns `greatest(stage_started_at, snapshot.occurred_at)` when a snapshot exists. With a NULL old start, the snapshot timestamp supplies the boundary. With no snapshot, it returns the supplied stage start. With neither, it returns NULL. No pre-import elapsed time is fabricated, and no history timestamp is rewritten.

## 15. Interval Accounting

`_workflow_interval_delta` returns production/client-wait bigint deltas without updating projects. Active and revision_active count calendar-eligible elapsed seconds; awaiting_client counts actual wall-clock seconds including weekends. Pending, paused, completed and skipped return zero. No usable anchor returns zero. Invalid/reversed/infinite timestamps are errors, including corrupt future anchors on stopped states; they are not silently clamped away. The production timezone is Asia/Karachi.

## 16. Reconciliation

`_workflow_accounting_totals` implements the baseline formula. `_workflow_reconcile` returns project ID, stored/calculated production and client-wait totals and numeric differences defined as **stored minus calculated**. It does not update caches or include the still-open interval: caches should represent already-booked events. Missing projects or corrupt accounting evidence fail clearly. These are internal, not broad reporting APIs.

## 17. Routing

Pure-state/read-only helpers cover required stages, paired approvals, approved manual targets, next executable stage, ordered skipped stages and matching skip reasons. `_workflow_next_stage` reads the reference-table order and returns `next_stage`, `skipped_stages[]`, `skip_reasons[]`; reaching the end returns NULL next stage, not an implicit project-completion mutation.

- Print-only: 1→2→3→4→5→8.
- Ebook-only: 1→2→3→6→7→8.
- Combined: all eight.

Only design_concept, print_version and ebook_version are manual targets; their paired approvals are skipped with them. Files Received, Final Delivery and standalone approvals cannot be passed as manual targets. Only canonical approved request rows are recognized; pending rows and legacy SERVICE_TYPE_PRESET do not grant manual authority. Historical standalone approved approval rows are not treated as valid production skips. No client approval records are fabricated for automatic disabled formats.

Future manual skips are retained but only emitted when routing reaches them. `p_include_current=true` supports skipping a newly approved current production pair. `_workflow_route_project` loads stored capabilities/approved skips and delegates. Unresolved or all-disabled capabilities are rejected, never parsed from service_type. These functions do not themselves authorize or execute a transition; future RPC preconditions remain mandatory.

## 18. Capability-Resolution Resume Routing

`_workflow_capability_resume_route` accepts the special active/completed/none Concept Approval or Print Approval state only after capabilities are confirmed. It delegates to the same router:

- Concept Approval + print required → Print Version.
- Concept Approval + ebook-only → Ebook Version, emitting ordered automatic Print Version/Print Approval skips.
- Print Approval + ebook required → Ebook Version.
- Print Approval + ebook disabled → Final Delivery, with the Ebook pair skipped.

Approved manual future targets are also honored. The helper is read-only and takes the proposed confirmed state so the later configuration RPC can plan the change transactionally. No project is resumed in Step 3C.1.

## 19. Final-Due Estimation

`_workflow_estimate_remaining_production` is the pure-state core; `_workflow_estimate_final_due` loads the project, approved skips and an unambiguous current revision due date. It starts from the active stage/revision due if known, then adds required future production durations using the calendar engine. Pending production uses its full configured budget. Approval/client waiting contributes no predicted duration. When awaiting client approval, the result means **"estimated production completion if the client action occurred at p_as_of"**. It is not a contractual delivery date, a prediction of client response time, or a promise that approval happens at `p_as_of`. No estimation behavior or helper name changed in Step 3C.1.1.

It returns NULL for unresolved state/capabilities, contradictory control/ownership, a disabled current stage, a stopped non-completed lifecycle, absent required current due, ambiguous open revisions, or an already-overdue active due. An overdue deadline does not prove completion or remaining effort. Completed projects return their known delivered timestamp, if any. It does not write `final_due_at`, forecast client response time, infer extra revisions, or promise an actual delivery date.

## 20. Internal Function Security / Grants

All 42 functions explicitly use **SECURITY INVOKER**, `search_path = pg_catalog, pg_temp`, schema-qualified application relations/calls and explicit EXECUTE revocations from PUBLIC, anon and authenticated. Even the three named calendar functions have no application grant yet. Trusted future SECURITY DEFINER RPCs can call these helpers under a reviewed owner; this step does not invent that owner or grant BYPASSRLS. Objects and revocations are bracketed by one migration transaction.

No legacy RLS policies or grants were replaced. Existing upgrade vulnerabilities therefore remain until their authorized security/cutover work. Step 3D must establish the dedicated owner, least-privilege table/function access and final RLS/projections. Do not expose these helpers or allow frontend direct writes in the meantime. Final owner-role behavior, RLS recursion/visibility and migration-runner transaction handling are unverified.

No notification insertion helper was needed. Action-specific notification recipients/content and related writes are wholly deferred to Step 3C.2.

## 21. Tests and Static Validation

The two SQL files use plain assertions and DO blocks, not pgTAP. Run as the migration owner **only on an unlinked, disposable local database** after migrations 1–3, with `psql -X -v ON_ERROR_STOP=1 -f <test-file>`. Each test uses an explicit transaction and ROLLBACK, including deterministic calendar/project/skip/history fixtures. No fake Auth users or emails are created. No test disables triggers or RLS. Tests are authored, **not executed** here.

Business-day tests cover all requested Friday/weekend/zero/negative/exception/partial-day/start-day/timezone cases, reverse intervals, fractional rounding, partial production-seconds resume, exact midnight, a 23-hour DST date and an unrepresentable local time. **The business-day test file is unchanged in Step 3C.1.1; no assertions were weakened.** Calendar, accounting, clock-boundary, history, routing, manual-skip, capability-resume and production-estimate functions remain unchanged.

Engine SQL tests cover settings/defaults/errors, all three complete routes, paired/current/future skips, approved-row recognition, all four resume examples, baseline plus later deltas, clean zero baseline, effective anchors, production/client-wait differences, stopped/missing anchors, reconciliation, preserved snapshot zero deltas, compatibility conflict detection, production-only final estimates, key-order-stable fingerprints, mismatch rejection and old-version retry result behavior. Table/function privilege assertions are included.

Step 3C.1.1 retains those assertions and adds nested-value fingerprint divergence, absence of raw JSON, SHA-256 hex shape/length, snapshot exclusion of both accounting caches/settings/resolver identity, retained core workflow keys and exactly 20 fields. Tests also check that changing excluded internal fields does not alter the safe snapshot, that a retry preserves the entire committed payload except `already_applied`, and that either accounting-cache conflict still raises the legacy-trigger conflict error. Static assertions verify the exact allowlist, catalog-resolved schema-qualified SHA-256 call, reduced-snapshot receipt validation and retained internal cache-conflict checks. These SQL assertions are authored only, not PostgreSQL execution evidence.

Full actor-role/assignment/cross-client integration, history-append actor/link behavior, receipt persistence with real Auth identities, two-session races, actual legacy-trigger execution and end-to-end atomic rollback are deferred to a disposable authorized integration fixture in Step 3C.2/3D. The pure retry test demonstrates the intended response contract but does not prove concurrency or receipt persistence.

`node scripts/phase6-engine-static-tests.mjs` **passed**. The dependency-free script checks source structure, explicit grants, safe paths/invoker posture, zero public mutation RPC definitions, narrow writes, key accounting/routing prerequisites, migration/stage counts, test rollback wrappers and lexical delimiter/parenthesis balance. It is not a PostgreSQL parser or execution test.

```text
migrations=3
stageSeeds=8
newTables=1
newTypes=1
helperFunctions=42
publicMutationRPCs=0
sqlTestFiles=2
genericSnapshotFields=20
fingerprint=SHA-256 hex via catalog-resolved pgcrypto
```

## 22. Local Database Execution Status

**LOCAL DB VALIDATION BLOCKED.** Rechecked `supabase --version`, `psql --version`, and `docker --version` during Step 3C.1.1; all failed with command-not-found. The foundation inspection found no installed PostgreSQL/PGlite parser/runtime among project dependencies. No tools, packages or pgTAP were installed. No local or live database connection was opened. SQL syntax/runtime (including catalog-resolved digest invocation), clean-install parity, upgrade behavior, privileges and concurrency remain unverified against PostgreSQL.

## 23. npm Build

`npm run build` passed again during Step 3C.1.1: `tsc && vite build`, Vite 6.4.3, 1715 modules transformed, Vite build time 14.72s. The existing advisory that a JavaScript chunk exceeds 500 kB remains. This verifies the unchanged frontend build, not the SQL migration or SQL assertions.

## 24. Review Gates Before Step 3C.2

No newly discovered blocker requires changing migrations 1/2. Required gates are review of the Step 3C.1.1 corrections and execution/rehearsal once local PostgreSQL/Supabase tooling is available. Step 3C.2 remains stopped. Do not claim production readiness or database success. Pay particular attention to the client-safe result allowlist, catalog-resolved digest invocation, deliberate timeline/paused compatibility aliases, 24-hour-equivalent day semantics, overdue-estimate NULL behavior, actor/grant integration, receipt parameter normalization, and caller-held-lock/clock-reset contracts.

Step 3C.2 must add the eleven public RPCs to this same migration, enforce action-specific authorization/state/version rules, use the corrected retry order, close time exactly once, validate post-trigger state, and test concurrent/failed/replayed writes. No RPC, wrapper, frontend change or Step 3D implementation is included here. Nothing was staged, committed, pushed or deployed.

## 25. Future Deployment Write Freeze

The eventual workflow-write freeze starts **before Step 3B** and must **not end immediately after that backfill**. It remains active until Step 3C/3D are installed, the compatible canonical frontend is deployed, and all legacy direct workflow writers are no longer in use. Drain in-flight work and include frontend, API, scheduled/background, service and administrative writers.

Step 3B creates canonical shadow state once; it does not continuously synchronize later legacy writes. Resuming old writers after backfill can make legacy and canonical state diverge. The earlier Step 3B runbook's commit/ledger/data validation is necessary but **not sufficient to release the freeze**. Confirm the RPC/security/frontend switch and legacy-writer shutdown before lifting it. No freeze, migration or deployment was performed in this task.

**NO LIVE DATABASE WAS MODIFIED. Step 3C.2 has not started.**
