# MH Tracker Attendance V2 — Production Cutover Gate

**Production project:** existing MH Tracker Supabase (PostgreSQL 17).
**Release state (2026-10-21):** Both database migrations applied successfully to the shared MH Tracker Supabase database. Project owner expressly waived the backup for this deployment because existing attendance entries are test-only. This is not a general recommendation to skip future backups. Cloudflare live frontend is not yet released; Windows QA remains outstanding.

**Change scope:** `20261021080547_attendance_daily_credits_v2_20261019.sql` followed by `20261021080615_attendance_admin_reconciliation_v2_20261020.sql`.
**Policy:** no deletion, no historical backfill, no automatic correction to old `attendance_sessions.verified_seconds`.

## Preconditions — all mandatory

1. GitHub PR #61 head must be mergeable and all jobs green on the **same current commit**:
   - Full regression
   - TypeScript/build
   - Disposable PostgreSQL 17 ledger/RLS integration
   - Admin-only reconciliation/audit tests
   - Cloudflare Pages PR preview build
2. Record the production migration list and schema definition versions.
3. Create a restorable, encrypted **local database export** and record where it is stored **outside GitHub and the web app**.
4. Record a baseline of attendance row counts and verified seconds by session status/month, without changing rows.
5. Confirm the maintenance window and a small dedicated test-user account.
6. Confirm production use of the Cloudflare Preview uses the **same** Supabase database as the live site; do not perform write tests there until migration and backup are complete.
7. Real Windows Chromium acceptance is pending and must pass before PR #61 is merged/live.

## Local backup (Supabase Free plan)

Free plans should not rely on a restorable Dashboard-managed daily backup. Use a **local export** from an administrator-controlled PC before any production DDL. The Supabase CLI command requires a linked project and may require Docker:

```powershell
# On Windows PowerShell with the Supabase CLI installed, from the project folder:
supabase --version
supabase link --project-ref emhvwdhdmajpakoscuyn

# Use paths outside the repository, preferably encrypted storage.
New-Item -ItemType Directory -Force "C:\MH-Tracker-Private-Backups" | Out-Null
supabase db dump --linked -f "C:\MH-Tracker-Private-Backups\mh-pre-attendance-v2-schema.sql"
supabase db dump --linked --data-only -f "C:\MH-Tracker-Private-Backups\mh-pre-attendance-v2-data.sql"
```

The CLI's default export excludes Supabase-managed schemas such as `auth` and `storage`, and the default schema dump excludes table data. These two files safeguard the **public app schema and data**, not a complete Supabase disaster-recovery image. Evaluate whether auth, storage, and custom-role state also need separate backup. Never upload backups to a public repository or include connection passwords in issues or chats.

**Normal required sign-off:** identify and verify backup files, ideally with a test restore. **Exception granted for 2026-10-21 attendance-only cutover:** the owner declined backup protection for test-only attendance data, acknowledged the recovery risk, and authorized applying the database migrations without an export.

Official instructions: https://supabase.com/docs/guides/platform/backups and https://supabase.com/docs/reference/cli/supabase-db-dump

## Migration compatibility and order

- Production already has `attendance_sessions`, `attendance_breaks`, `profiles`, `attendance_record_heartbeat`, `attendance_start_break`, `attendance_clock_out` and the existing `attendance_admin_adjust_session`.
- Migration 1 first revokes unsafe direct API privileges on legacy attendance tables, including `TRUNCATE` (which bypasses RLS), and restores only authenticated `SELECT`. Existing attendance owner-checked security-definer RPCs remain the write path.
- Migration 1 creates date-specific daily credits, RLS, source-key idempotent RPC, day totals and historical reconciliation view; it updates break/clock-out to stop automatic stale-heartbeat credits.
- Migration 2 creates the append-only reconciliation audit, protected admin correction RPC and audited replacement for the existing clock-time correction RPC.
- **Do not deploy the PR frontend until both migrations complete successfully.** On one shared database, an early Cloudflare preview may display unavailable daily-ledger data before the migrations; do not use it to test writes until cutover.
- Do not treat schema existence as proof that users have correct permissions: verify `anon` cannot directly write, truncate, trigger or select attendance tables and `authenticated` can select only RLS-authorized attendance rows.
- Review and monitor pre-ledger `attendance_record_heartbeat` traffic after cutover; legacy client heartbeats can still add unattributed aggregate seconds. Old clients should not be treated as source of newly dated work.
- Existing attendance totals must be preserved. Never invent historical work dates.

## Read-only verification queries (safe before/after migration)

```sql
select
  to_regclass('public.attendance_daily_credits') is not null as ledger_exists,
  to_regclass('public.attendance_reconciliation_audit') is not null as audit_exists,
  to_regclass('public.attendance_daily_totals') is not null as daily_view_exists,
  to_regprocedure('public.attendance_sync_daily_slices(jsonb)') is not null as credit_rpc_exists,
  to_regprocedure('public.attendance_admin_reconcile_session(uuid,bigint,bigint,text,text)') is not null as admin_rpc_exists;

select status, count(*) as sessions, coalesce(sum(verified_seconds),0)::bigint as recorded_seconds
from public.attendance_sessions group by status order by status;

select t.table_name, r.role_name,
  has_table_privilege(r.role_name, format('public.%I',t.table_name), 'SELECT') as can_select,
  has_table_privilege(r.role_name, format('public.%I',t.table_name), 'TRUNCATE') as can_truncate,
  has_table_privilege(r.role_name, format('public.%I',t.table_name), 'INSERT') as can_insert,
  has_table_privilege(r.role_name, format('public.%I',t.table_name), 'DELETE') as can_delete
from (values ('attendance_sessions'),('attendance_breaks')) t(table_name)
cross join (values ('anon'),('authenticated')) r(role_name);
```

## Windows laptop / Cloudflare preview acceptance

Using a **test account** and short intervals only, document each result:

- [ ] Verify clock-in and daily credit increases without duplication.
- [ ] Two same-session browser tabs: one leader, one secondary, controlled handover and no overlap.
- [ ] Tracker minimized while InDesign is actively used: follow the agreed activity policy.
- [ ] Five minutes with no user input: confirm idle policy and no delayed bulk credit on resume.
- [ ] Win+L lock / suspend / hibernate: no lock/sleep credit.
- [ ] Browser permission denied / unsupported Web Locks: visible warning and fail-closed timing.
- [ ] Offline + reconnect: valid queued slices credited once; no duplicate retries.
- [ ] Midnight boundary/timezone changes: slices dated correctly with no invented date.
- [ ] Break and clock-out: no stale automatic credit; accepted credits remain intact.
- [ ] Admin correction: completed-only, evidence required, prior seconds conflict checks, append-only audit.
- [ ] Manager/employee/client permissions and CSV exports match authorized RLS.
- [ ] Dashboard actual, dated and historical/unattributed aggregates reconcile to ledger.

Any failed P0 case blocks live frontend merge/deployment.

## Production apply and rollback strategy

- Require explicit release authorization **after** the backup and P0 checks. Use recorded, sequential migrations (not untracked SQL snippets), validating each phase.
- Prefer a low-traffic window. Avoid interruption of employees actively clocked in; schedule a coordinated log out / restart when moving legacy clients to the ledger.
- If new frontend must be rolled back, revert Cloudflare to its previous known-good build. **The database migrations should normally remain in place** because audit/ledger data may have been written. Do not delete or truncate new tables as a rollback.
- If a database change must be reversed, review impacted ledger/audit writes and restore from a tested backup only under a separate recovery decision. A restored older snapshot can lose newer production edits.
- Monitor attendance RPC errors, API permissions, active sessions, idempotent retries and unauthorized reads. Block salary/payroll reliance on unreconciled historical totals.

## Status

Preflight and automated PostgreSQL certification are separate from a user-created restorable backup and real Windows browser proof. Neither backup existence nor manual P0 completion is implied by a green GitHub workflow.
