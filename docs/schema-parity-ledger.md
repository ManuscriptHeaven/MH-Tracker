# MH Tracker Schema Parity & Runtime Certification Ledger

**Authoritative source:** versioned SQL in `supabase/migrations/`. A green TypeScript build is not a release certificate.

## Environments

| Environment | Supabase project ref | State observed 2026-09-23 | Release role |
| --- | --- | --- | --- |
| Staging | `atazylptnaonohucldfg` | Inactive. Restore attempt was rejected because the owning organization is already at its active free-project limit. | Mandatory certification target before production |
| Production | `emhvwdhdmajpakoscuyn` | Active/healthy; read-only inspection only during this implementation. | Controlled cutover target |

Production was **not mutated** during this work. Do not use production as a substitute for the unavailable staging environment.

## Production migration history observed 2026-09-23

The remote migration history returned these applied versions:

```text
20260913101950 phase6_release_support
20260915073238 task_management_v2_00600
20260915073300 task_management_v2_00610_advisor_fixes
20260915073554 task_management_v2_00620_insert_returning_rls_fix
20260918072100 stabilize_project_hard_delete
20260918095955 restore_project_payment_schema_parity
20260918101918 finance_usd_default
20260918112819 invoice_version_history
20260918113005 invoice_version_rpc_conflict_fix
20260918141525 employee_compensation_update_grants
20260920132850 complete_role_messaging
20260920133510 lock_down_team_channel_trigger
20260920153035 messaging_completion
20260920155749 fix_project_window_client_messaging
20260921002014 client_files_stage_clocks
20260921002408 zero_files_received_production_time
20260921002757 fix_project_client_autolink_privilege
20260921002900 restore_project_client_autolink_policy
20260921004720 schedule_accountability_reminders
20260921005238 resolve_client_reminder_rpc
20260921153202 team_attendance
20260921165254 repair_workflow_compatibility_projection_v2
20260921173118 attendance_app_presence
20260922064816 harden_client_message_delivery
20260922065103 reuse_project_conversation_delivery_guard
20260922065817 message_conversation_integrity
20260922072351 fix_client_workflow_version_projection
20260922184409 ai_operator_intelligence
```

Read-only runtime inspection also found that the `supabase_realtime` publication currently contains `tasks` and `task_assignees`, but not `task_comments`, `task_checklist_items`, or `task_dependencies`. This is a concrete production/runtime parity gap even though the application source contains those collaboration features.

## New pending migrations in this implementation

- `20260923000100_task_collaboration_completion.sql` — versioned task files, task @mentions/notifications, private task-file storage policies, and child-record Realtime publication.
- `20260923000200_reusable_project_templates.sql` — reusable Book Formatting, Print + eBook, Cover Design and Revision Only templates with transactional task seeding.
- `20260923000300_saas_boundary_foundation.sql` — workspace/membership boundary, restrictive root RLS, tenant event outbox, API-client identity metadata and webhook delivery outbox.

These migrations are pending until the local CI chain is green and a live staging environment passes certification.

## Release certificate

A release is eligible for production only when all of the following are true:

1. **Local reproducibility:** `supabase start` and `supabase db reset` rebuild the full schema from committed migrations.
2. **Exact local ledger:** `scripts/check-migration-drift.mjs` reports exact local parity.
3. **Database lint:** Supabase DB lint returns no error-level findings.
4. **pgTAP:** `supabase/tests/ci/runtime_schema_certification.test.sql` passes.
5. **Real integration:** `scripts/runtime-integration-certification.mjs` passes against the disposable local Supabase stack. It hard-aborts for any non-localhost URL.
6. **Browser E2E:** Playwright passes the cross-user task/Reatime/file/Kanban/attendance flow and the client approval confirmation flow.
7. **Staging exact ledger:** `Schema Drift Gate` reports staging migration history exactly equal to the repository.
8. **Staging PostgreSQL/RLS:** `Staging PostgreSQL RLS Certification` passes Phase 6, Task V2, and current runtime schema suites. The Task V2 suite additionally pins the approved staging PostgreSQL system identifier and fails closed elsewhere.
9. **Production pre-cutover drift review:** production history contains no unexpected migration. Pending repository migrations are reviewed as the controlled cutover set.
10. **Controlled database cutover:** apply reviewed migrations to production.
11. **Production post-cutover parity:** rerun `Schema Drift Gate` for production and require exact parity before releasing application code.

## CI coverage map

| Critical flow | Static regression | pgTAP/schema | Real Supabase integration | Playwright |
| --- | ---: | ---: | ---: | ---: |
| Admin creates task → assigned team receives Realtime | Existing + build | Realtime publication asserted | Yes | Yes, no reload |
| Client approves stage | Existing client approval tests | Canonical RPC asserted | Yes | Yes, confirmation UI |
| Task file upload/download | — | Bucket/RLS/immutability asserted | Yes | Yes |
| Message send/read receipt | Existing messaging tests | Read-state column asserted | Yes | — |
| Attendance app-close pause | Existing attendance tests | Heartbeat RPC asserted | Yes, stale >90s gap | Yes |
| Invoice create/revise | Existing invoice tests | Versioning RPC/table asserted | Yes, v1 → v2 | — |
| AI propose/confirm/mutation verification | Existing AI reliability/operator tests | Telemetry table asserted | Confirmed mutation telemetry + DB verification | — |
| Tenant boundary/event abstraction | — | Restrictive policies/helpers asserted | Workspace membership + event outbox | — |

The browser suite is intentionally focused on UI boundaries where a DOM/state/realtime regression can differ from API behavior. The integration suite covers the remaining multi-role database contracts without duplicating every scenario in the browser.

## Current blocker

Staging cannot currently be restored because the Supabase organization has reached its active free-project limit. Resolve this by upgrading capacity or intentionally freeing one active project. Do **not** pause/delete another project automatically merely to make this gate pass.

Until staging is active and items 7–8 pass, production cutover is **blocked by design**.
