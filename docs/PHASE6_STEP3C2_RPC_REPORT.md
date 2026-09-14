# Phase 6 Step 3C.2 — Transactional Canonical Workflow RPC Layer

Date: 2026-09-09. Status: Step 3C.2.1 correctness hardening implemented and source-checked; PostgreSQL execution remains unverified.

**NO LIVE DATABASE WAS MODIFIED. LOCAL DB VALIDATION BLOCKED.**

## 1. Scope

Extended the existing third migration with exactly eleven public mutation RPCs and twelve private helpers. The original 42 engine functions, safe snapshot contract, receipt table, business calendar, and accounting baseline remain intact. There are still three migrations. No migration 4, frontend change, owner role, RLS replacement, deployment, commit, push, or staging operation was performed.

## 2. Files modified for Step 3C.2.1

- `supabase/phase6/migrations/00300_phase6_workflow_rpcs.sql`
- `supabase/tests/database/phase6_workflow_rpcs.test.sql`
- `scripts/phase6-engine-static-tests.mjs`
- `docs/PHASE6_STEP3C2_RPC_REPORT.md`

The existing workflow RPC SQL test file was confirmed on disk and extended; it was not recreated. Migrations 1/2, previous reports, frontend files, package files, and the existing two engine SQL test files were not modified.

## 3. Exact public signatures

Every signature below returns `public.workflow_mutation_result`. Parameter order and defaults are significant.

```sql
public.workflow_advance_stage(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid,
  p_note text default null
)
public.workflow_submit_stage_for_approval(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid,
  p_note text default null
)
public.workflow_client_approve_stage(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid,
  p_note text default null
)
public.workflow_submit_client_revision(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid,
  p_title text, p_instructions text, p_description text default '',
  p_priority text default 'Normal'
)
public.workflow_submit_revised_proof(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid,
  p_revision_request_id uuid, p_team_response text default null
)
public.workflow_request_stage_skip(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid,
  p_stage public.workflow_stage, p_reason text
)
public.workflow_respond_stage_skip(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid,
  p_stage_skip_id uuid, p_decision text, p_response_note text default null
)
public.workflow_admin_override(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid,
  p_target_lifecycle public.project_lifecycle_status,
  p_target_stage public.workflow_stage,
  p_target_stage_status public.workflow_stage_status,
  p_target_waiting_on public.workflow_waiting_on,
  p_reason text, p_explanation text
)
public.workflow_complete_final_delivery(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid,
  p_note text default null
)
public.workflow_set_project_lifecycle(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid,
  p_target_lifecycle public.project_lifecycle_status, p_reason text default null
)
public.workflow_update_project_configuration(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid,
  p_requires_print boolean, p_requires_ebook boolean, p_workflow_settings jsonb
)
```

The project/version identifies the current stage for submission and approval; no redundant stage or optional revision selector is needed. Revised proof requires its exact revision ID. Revision content uses the existing `title`, `instructions`, `description`, `priority`, and `team_response` fields. Priority accepts Normal/Important/Urgent. No storage/upload API, attachment mutation, or invented ebook due column was added.

## 4. Security and grants

All eleven RPCs are `SECURITY DEFINER SET search_path = pg_catalog, pg_temp`. Application tables, types, and helpers are schema-qualified. Each explicitly revokes all function privileges from PUBLIC, anon, and authenticated, then grants EXECUTE only to authenticated. Identity starts at `auth.uid()` through the active-profile helper; no JWT role authorization or identity arguments are accepted.

All twelve new helpers are SECURITY INVOKER and revoked from PUBLIC, anon, and authenticated. The migration owner temporarily owns the RPCs. No BYPASSRLS/dedicated role or policy is created. Step 3D must finalize ownership and RLS. Source grants are verified; effective database grants are not runtime-verified.

New helpers:

1. `_workflow_lock_mutation_rows`
2. `_workflow_validate_tuple`
3. `_workflow_operational_leaf`
4. `_workflow_checked_manual_skips`
5. `_workflow_enter_production`
6. `_workflow_event`
7. `_workflow_route_events`
8. `_workflow_write_project`
9. `_workflow_assert_milestones`
10. `_workflow_emit_events`
11. `_workflow_notify`
12. `_workflow_format_evidence`

There are 65 function definitions in migration 3: 11 public mutations and 54 protected engine/mutation helpers, including the three existing named calendar functions.

## 5. Common transaction and idempotency order

Each public body explicitly authenticates, checks action access, acquires the project FOR UPDATE lock, rechecks access against the locked project, fingerprints all business parameters including expected version, and looks up the receipt. A matching receipt returns before version/state checks or new timestamps. A changed fingerprint raises `idempotency_key_reused`.

New requests check version and source state, lock project revisions in UUID order and then skips in UUID order, validate required related evidence, and obtain one `clock_timestamp()`. Business writes and the complete expected project row are planned under these locks. Related-table trigger mutations of the project are rejected before the canonical UPDATE can conceal them. The expected project is constructed before UPDATE, projected to the five compatibility fields, written, and asserted independently of RETURNING.

Queued history is appended in order only after project assertion. Notifications follow. Version increments once, followed by another projection/milestone assertion and the serialized same-project history count check. Notification correctness is checked only for IDs inserted and returned by this mutation; there is no project-wide notification count invariant. The safe result is built and then stored in the receipt. All work shares the caller's PostgreSQL transaction; any exception aborts the mutation. No exception handler returns apparent success after a failed write.

## 6. Actor and role matrix

| Actions | Allowed active actors |
|---|---|
| Advance, submit production, revised proof, request skip, final delivery | Admin; Project Manager; assigned Employee |
| Client approval, client revision, skip response | Client with exact project FK/access membership |
| Lifecycle and configuration | Admin; Project Manager |
| Admin override | Admin only |

Legacy `manager` normalizes to Project Manager; `junior_assistant` to assignment-scoped Employee. Neither gets Admin privileges. Project Managers retain the engine's all-project management scope. Client authorization never uses email/name matching.

## 7. Advance-stage semantics

Files Received pending becomes Files Received active/team with a new clock and configured Files due date. Pending contributes zero elapsed delta. Files Received active/team normally becomes Design Concept active/team with a new due date and one production close. If the client already approved a future Design skip, normal routing honors that pair instead of starting skipped work. Any missing skip history precedes stage_entered; stage_entered owns the Files interval delta. Both cases preserve an existing files-received date or set it from the mutation's Karachi date. Other source stages/states are rejected; this RPC cannot independently bypass an approval or complete delivery.

## 8. Stage submission

Only active/team Design Concept, Print Version, or Ebook Version can submit. Required capabilities must be resolved. Submission closes production once, writes the matching submission DATE, enters the paired approval as awaiting_client/client, starts client wait, clears due/completion, appends `stage_submitted`, and notifies clients.

## 9. Client approval

Only awaiting_client/client on a current approval stage is accepted. The current operational revision leaf is locked and checked. A ready leaf becomes approved/Approved with completed_at equal to mutation time; an unready or ambiguous leaf fails closed. No leaf means base-proof approval.

`stage_approved` records the approval as completed/none and owns the client-wait delta. Optional `revision_approved` follows with zero delta. `_workflow_next_stage` selects the next production stage from capabilities and approved skips. Ordered skip events precede `stage_entered`. Final Delivery enters as active/team with two default production days. Team recipients are deduplicated.

## 10. Revision rounds and leaves

An operational leaf is a non-approved/non-cancelled row with no child. Historical changes_requested parents are therefore not competing active leaves. More than one leaf, unresolved required revision stage/status/round, duplicate rounds, or invalid linked round/project/stage evidence raises `workflow_revision_ambiguous`.

Initial revision allocates max(stage round)+1 with no parent. Additional changes require a ready leaf, mark it changes_requested/Additional Revision Required, and create a submitted/Submitted child with previous round+1. The next round must also agree with that stage's existing revision rows; conflicts are not repaired silently. New rows bind client_id to the authenticated actor.

Both cases close client wait once, increment project revision_count, enter revision_active/team, and use canonical revision_days (default two) for the new due timestamp. `revision_changes_requested`, when present, receives the interval delta; `revision_requested` then receives zero. Otherwise `revision_requested` owns the delta. Related-row legacy fields and timestamps are verified after writes.

## 11. Revised proof

Requires the explicit current leaf ID, same project/current approval stage, revision_active/team, and submitted/under_review/in_progress/changes_requested source status. It closes production, sets ready_for_client_review/Ready for Client Review, preserves team_response when SQL NULL is supplied, otherwise writes it, and starts awaiting_client/client with no due. It emits `revised_proof_submitted` and client notifications. File uploads/references remain in the existing separate repository flow.

## 12. Skip requests and responses

Requests require a nonblank reason and a required current/future Design Concept, Print Version, or Ebook Version root. Existing pending/approved requests reject duplicates. Request writes pending/PENDING, actor aliases and one timestamp, plus zero-delta `stage_skip_requested`; it does not reset the clock.

Client response requires a pending, unresponded, uncancelled project-owned row. Rejection records rejected/REJECTED and zero-delta `stage_skip_rejected`. Approval records approved/APPROVED and paired `stage_skipped` events with the same skip ID. Future approvals retain the current stage, execution status, waiting party, start anchor, and stage due; they book no production/client interval and mark metadata `effective=when_routing_reaches_target`. The newly approved pair is applied immediately to the production estimate, so `final_due_at` reflects the shorter future route without changing the current clock. Rejection alone does not recalculate the estimate.

Current active/team approval closes production on the first skip event, routes with include_current=true, and enters the next production stage. The paired and later events have zero delta. Subsequent routing suppresses already-recorded manual skip history; backfilled approved skips without canonical events receive missing events when reached. Multiple approved roots fail with `workflow_skip_ambiguous`.

## 13. Admin override

Requires a trimmed reason of at least ten characters and a nonblank existing explanation field. Accepts an explicit target lifecycle/stage/status/waiting tuple, not actor IDs or historical start times. Structural tuple checks remain mandatory. Active production gets a fresh configured due; revision_active requires an unambiguous production leaf and uses its due; awaiting_client has no due and requires any leaf to be ready. Open states restart at mutation time.

The prior interval closes once. An immutable override stores the existing canonical before/after lifecycle, stage, execution, waiting, start and due fields plus actual actor/reason/explanation/idempotency/time. History links the override and also preserves before/after delivery/completion timestamps. Milestones are retained. Completed targets need existing nonfuture delivery evidence; no delivery is fabricated. Team notifications do not contain private reasons.

The RPC deliberately does not repair arbitrary unknown history, change capabilities, or invent a missing prior stage label. A source without an execution status is rejected; if both canonical and legacy source stage are absent, `workflow_override_source_unresolved` rejects it because the existing override audit's previous_stage requires a real label. Those records need separately reviewed evidence repair, not a fabricated stage or a silent foundation change.

## 14. Final delivery

Requires active lifecycle and final_delivery/active/team with resolved capabilities. Closes production once, sets completed lifecycle/stage and none waiting, clears the clock/due, and sets stage_completed_at=delivered_at=final_due_at=mutation time. Both delivery DATE fields use the same Karachi date. `final_delivery_completed` owns the delta and clients are notified. No new file/QC gate is introduced.

## 15. Lifecycle matrix

| From | To |
|---|---|
| active | on_hold, cancelled |
| on_hold | active, cancelled |
| completed | archived |
| cancelled | archived |
| archived | exact completed/cancelled lifecycle in latest project_archived metadata |

Admin and Project Manager may perform these transitions. Cancellation/archive require a nonblank reason. Direct completion and cancelled-to-active revival are forbidden. Archive/unarchive preserves the real stage; terminal archived/cancelled states are paused/none. Restoring completed restores completed/none and requires retained delivery evidence. Latest pause/archive records are checked for stage match and intervening consumption/override events.

## 16. Pause and resume deadlines

Pause stores prior execution/waiting/stage/due, overdue fact, and remaining eligible production seconds when due is current/future. It closes the previous interval and clears the anchor and active estimate. Resume uses `_workflow_add_production_seconds` for stored remaining effort, or preserves the original overdue due timestamp. It does not grant a fresh duration to overdue work. Awaiting client restarts client wait with NULL due; pending stays stopped. The special completed approval gate can be preserved through hold/resume and still needs configuration routing.

`revision_requests.due_at` is the revision row's original/current audit deadline. Resume does not rewrite it. `projects.stage_due_at` is the canonical current operational deadline and may move when stored remaining production effort is resumed. For `revision_active`, `_workflow_estimate_final_due` still requires exactly one valid operational leaf, fails closed when the project deadline is absent, and uses `projects.stage_due_at`; it never falls back to the older revision-row due. Concept and Print project-level compatibility revision due DATE fields are refreshed from the resumed operational timestamp in Asia/Karachi. There is no ebook compatibility due column.

## 17. Configuration and capabilities

Requires both booleans, at least one true, and a JSON object. Only exclude_weekends, files_received_days, design_concept_days, print_version_days, ebook_version_days, final_delivery_days and revision_days survive new writes. Omitted supported keys inherit engine defaults. Obsolete stage-specific revision keys are dropped. New configuration is confirmed; resolver actor/time changes only when capability values/status change. Settings-only edits preserve those audit fields.

Disabling a capability examines current stage, canonical event evidence, revision stage evidence, and legacy submission/approval/revision/planning due dates. Future enabling is limited to an active project before the format is passed, including canonical historical passage after an override. Terminal capability changes are rejected. Exact stored configuration no-ops are rejected unless a completed approval gate needs routing. Historical ambiguity remains fail-closed.

## 18. Capability-resolution resume

Active/completed/none Concept Approval or Print Approval uses `_workflow_capability_resume_route` after confirmation. Examples: Concept→Print; ebook-only Concept→skip Print pair→Ebook; Print Approval→Ebook or skip Ebook pair→Final. History is configuration_updated, ordered missing skips, then stage_entered. No synthetic client approval is emitted.

## 19. Accounting and clock reset

`_workflow_interval_delta` always receives the pre-mutation state/settings. Imported snapshot boundaries remain unchanged. Caches receive exactly the production/client deltas placed on one explicitly selected primary event; all other events receive zero. The primary is normally first, except Files routing, where any missing skips precede its interval-owning stage_entered. New open intervals start at the single mutation timestamp; stopped states clear the running anchor.

Settings/configuration changes close the old open interval under the old calendar, then reset the anchor. An already-running due stays unchanged unless entering a new stage. Skip request/future approval/rejection never closes/resets the open interval. Final estimates use the pure-state engine; awaiting-client estimates assume client action at calculation time, not predicted client response. Held/cancelled/archived estimates are NULL; completed uses delivered_at.

## 20. Compatibility milestones and trigger assertions

The existing compatibility projection supplies status/current_stage/stage_status/waiting_on/timeline_status. Submission and approval dates match each format; Files date is only filled when absent. Concept/Print revision due DATE aliases follow the current operational `projects.stage_due_at`, including after revision resume; no ebook revision due alias is invented. Final delivery writes both delivery DATE fields. All local dates use Asia/Karachi.

The expected row exists before UPDATE. Projection assertions cover canonical state, the safe snapshot, settings, resolver fields and accounting caches. Separate assertions cover milestone/delivery dates and updated_at. Related revision/skip/override rows are independently compared with their expected contents. Project changes caused by related-table triggers and extra same-project history cause rollback. The history count remains valid because canonical history writers are serialized by the workflow project lock; direct history writers are scheduled for removal in Step 3D. Notifications intentionally do not use that assumption. Legacy triggers are not disabled, bypassed or rewritten. Some installed trigger variants will intentionally make these RPCs fail until the authorized cutover resolves them.

## 21. Notification matrix

| Mutation | Audience |
|---|---|
| Production submission, revised proof, skip request, final delivery | Active Client profiles with exact FK/access membership |
| Client approval/revision, skip response | Active project manager and assigned team member |
| Advance, lifecycle, configuration, override | Same conservative project team |

Recipients are DISTINCT and UUID-ordered. Team role filtering prevents a misassigned Client receiving internal notifications. No eligible recipient legitimately inserts zero rows. Generic messages contain project title and action only; private notes/reasons/settings are not included. `_workflow_notify` rejects NULL or duplicate returned IDs and verifies each returned row's ID, project, recipient, type, optional revision link, exact mutation timestamp, unread state, and generic title/message. Its final set check is constrained to those returned IDs. Unrelated concurrent notifications for the same project are outside the invariant and cannot invalidate the workflow RPC. IDs are returned in `affected_entity_ids.notification_ids`. Receipt replay returns before `_workflow_notify`, so retry inserts none.

## 22. History behavior

All actions emit canonical history after project assertion under the project lock. Allocation remains max(sequence_no)+1. Events are queued in business order and appended with one occurrence/creation timestamp. Returned history IDs include every event in sequence order. Manual skips deduplicate by project/skip ID/stage; automatic capability skips have no request link. History is never updated/deleted by these functions. Direct-write protection still belongs to Step 3D/cutover.

## 23. Stable errors

Existing engine errors are retained. Public paths use: workflow_unauthenticated, workflow_actor_inactive_or_invalid, workflow_forbidden, workflow_project_not_found, workflow_stale_version, idempotency_key_reused, workflow_invalid_state, service_capabilities_unresolved, workflow_invalid_capabilities, workflow_revision_not_ready, workflow_revision_ambiguous, workflow_revision_not_found, workflow_invalid_revision_input, workflow_invalid_skip_target, workflow_skip_already_requested, workflow_skip_not_pending, workflow_skip_ambiguous, workflow_invalid_lifecycle_transition, workflow_lifecycle_reason_required, workflow_invalid_configuration, workflow_admin_reason_required, workflow_final_delivery_required, workflow_override_source_unresolved, and legacy_workflow_trigger_conflict. Invalid settings/calendar inputs use the existing engine vocabulary. PostgreSQL rejects invalid typed enum/UUID arguments before entry.

## 24. Result contract

All RPCs return the unchanged composite and exact 20-field Step 3C.1.1 project snapshot. No settings, accounting totals, resolver IDs, private notes, finance or payroll data is reintroduced. Affected IDs include relevant revision/current-parent/skip/override IDs and notification IDs. History IDs preserve event order. New results set already_applied=false.

## 25. Replay and version behavior

New success increments workflow_version exactly once after history/notifications. Related rows never increment it. Identical replay returns the originally committed version and payload with only already_applied=true, even after later workflow transitions. Changed payload/expected version with the same key raises idempotency_key_reused. New keys require the current version. Failed transactions store no receipt.

## 26. Source assertions

`node scripts/phase6-engine-static-tests.mjs` passed. It verifies exactly eleven definitions, return/security/path/grants, common parameters, no identity arguments, fingerprint coverage, lock/receipt/version/timestamp/write/history/notification/result/receipt order, one version increment, private-helper revocations, project/milestone checks, safe snapshot allowlist, lexical balance, receipt/accounting prerequisites, leaf/routing/skip/configuration safeguards, and narrow per-function table-write allowlists. Step 3C.2.1 assertions additionally forbid notification baselines in every public RPC, verify mutation-ID-scoped notification validation and replay ordering, verify the future-approval estimate branch contains no interval/clock mutation, and verify revision resume/estimator deadline authority and compatibility dates. Top-level business writes and extra public workflow APIs are rejected.

Output: three migrations, eight stages, 65 total functions, 54 engine/private helpers, twelve new helpers, eleven public mutations, three SQL test files, twenty safe snapshot fields. These are **SOURCE ASSERTIONS**, not PostgreSQL parsing/execution or concurrency proof.

## 27. SQL tests authored and execution status

Added `phase6_workflow_rpcs.test.sql`, using plain PL/pgSQL assertions and a rollback wrapper. Catalog/grant and unauthenticated checks need no Auth users. Successful mutations require explicit disposable-local opt-in plus externally provisioned synthetic active Admin/Client Auth profiles; this file inserts no Auth user or email. Without those fixtures the integration blocks emit SKIP notices, not PASS.

Authored scenarios cover both Files transitions; Design/Print/Ebook submissions; combined, print-only and ebook-only approvals; initial revision/replay, revised proof, child revision, stale parent and revision approval; future/current skip approval, rejection, duplicate protection and routed-history deduplication; pause/resume remaining seconds, overdue preservation, cancellation/archive/unarchive; final delivery; configuration calendar/due/canonical-key behavior; gated capability resume; admin override audit; identical retry, changed payload and stale new key; history order/IDs, cache reconciliation, one nonzero interval event, and actual BEFORE-trigger milestone conflict rollback. Step 3C.2.1 adds a known-clock future skip assertion for preserved current stage/start/due, zero interval delta, and earlier final estimate; revision hold/resume assertions cover a passed audit-row due, shifted operational due, estimator output, unchanged revision-row due, and Concept/Print compatibility dates. Catalog checks cover mutation-ID notification scope and receipt-before-notify replay.

**SQL tests were not executed.** A true two-session notification concurrency rehearsal requires the unavailable disposable PostgreSQL/Supabase harness and remains a staging test. Assigned/unassigned employee and PM role integration, cross-client grants/access revocation races, multiple concurrent sessions, full legacy trigger combinations, and actual owner/RLS behavior still need an authorized disposable integration harness. Source assertions and the unchanged frontend build do not establish database success.

## 28. Local DB validation

Rechecked without installing:

| Command | Result |
|---|---|
| supabase --version | Command not found |
| psql --version | Command not found |
| docker --version | Command not found |

**LOCAL DB VALIDATION BLOCKED.** No database connection was opened. No dependencies or tools were installed. SQL syntax, clean migration application, upgrade execution, effective grants, trigger behavior and concurrency remain unverified.

## 29. Frontend build

`npm run build` passed (`tsc && vite build`), Vite 6.4.3, 1,715 modules, 48.75 seconds for Vite. The existing >500 kB chunk advisory remains. Frontend source was unchanged; this build is not SQL validation.

## 30. Repository state and gates before Step 3D

All Phase 6 files were already untracked when this task began. Git status remains untracked-only. `git diff --stat` is empty because it omits untracked files; it does not mean no work was performed. Final untracked inventory:

```text
docs/PHASE6_CANONICAL_DATABASE_WORKFLOW_DESIGN.md
docs/PHASE6_DATABASE_WORKFLOW_AUDIT.md
docs/PHASE6_STEP3A_FOUNDATION_REPORT.md
docs/PHASE6_STEP3B_BACKFILL_REPORT.md
docs/PHASE6_STEP3C1_ENGINE_REPORT.md
docs/PHASE6_STEP3C2_RPC_REPORT.md
scripts/phase6-engine-static-tests.mjs
supabase/config.toml
supabase/phase6/migrations/00100_phase6_canonical_foundation.sql
supabase/phase6/migrations/00200_phase6_legacy_backfill.sql
supabase/phase6/migrations/00300_phase6_workflow_rpcs.sql
supabase/tests/database/phase6_business_days.test.sql
supabase/tests/database/phase6_engine.test.sql
supabase/tests/database/phase6_workflow_rpcs.test.sql
```

`git status --short --untracked-files=all` reports each above with `??`. `git ls-files --others --exclude-standard` lists the same paths. Nothing was added, committed, pushed or deployed.

No remaining Step 3C.2.1 source blocker was found before Step 3D. PostgreSQL execution remains a validation blocker for runtime acceptance: execute the migration and rollback suites on disposable PostgreSQL/Supabase with safe Auth fixtures, rehearse actual legacy schemas/triggers, and verify concurrency/privileges. No implementation change to migrations 1/2 was required. Arbitrary unresolved backfill evidence remains rejected rather than silently repaired. Dedicated owner, final RLS/projections, direct-write guards and legacy writer retirement remain future work. **Step 3D was not begun.**

## 31. Future deployment write freeze

The future workflow-write freeze starts before Step 3B and remains in force through RPC/security installation, compatible canonical frontend deployment, verification, and retirement of every legacy direct writer. Drain frontend, API, background/scheduled, service and administrative writers. Backfill does not continuously synchronize later legacy writes. Do not release the freeze merely because Step 3B commits. Rehearse migration-runner transaction/ledger behavior and trigger conflicts on staging before any authorized deployment. No freeze or deployment was performed here.

**NO LIVE DATABASE WAS MODIFIED.**
