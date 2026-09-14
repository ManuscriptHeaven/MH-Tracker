# Phase 6 staging-proven source corrections

## Scope and safety

This source-only correction incorporates defects observed on a disposable managed Supabase staging project. Production was not connected to or modified. No migration was deployed, and `00500_phase6_cutover_and_validation.sql` remains absent and reserved.

## Corrected files

- `supabase/phase6/migrations/00100_phase6_canonical_foundation.sql`
- `supabase/phase6/migrations/00300_phase6_workflow_rpcs.sql`
- `supabase/phase6/migrations/00400_phase6_security_and_projections.sql`
- `supabase/phase6/migrations/00450_phase6_core_application_security.sql`
- `supabase/phase6/migrations/00460_phase6_finance_payroll_security.sql`
- `src/App.tsx`
- `src/lib/useTracker.ts`
- `src/pages/TeamPage.tsx`
- `scripts/phase6-engine-static-tests.mjs`
- `scripts/phase6-security-static-tests.mjs`
- `scripts/phase6-core-security-static-tests.mjs`
- `scripts/phase6-finance-security-static-tests.mjs`
- `scripts/phase6-frontend-cutover-static-tests.mjs`
- `docs/PHASE6_STAGING_CORRECTIONS_REPORT.md`

Migration `00200_phase6_legacy_backfill.sql` was not changed; its final hash is included below because all six Phase 6 migration bytes are pinned by the applicable static suites.

## Final migration SHA-256

| Migration | SHA-256 |
| --- | --- |
| `00100_phase6_canonical_foundation.sql` | `3bdae7a341b22699cb8879a3508e3f97eb76e1e09287949ebd7fe93aed1ee21a` |
| `00200_phase6_legacy_backfill.sql` | `848c80db812dfa583c563fc9b73c44deebf6130d56578946712a78003cbb2cfc` |
| `00300_phase6_workflow_rpcs.sql` | `296b77041d7af216c499c50a7e91866cb70d2f7e4fb9e36f6410e86bf6c7e767` |
| `00400_phase6_security_and_projections.sql` | `22a852cf39d1e6d3292d98fcdc8ad90663770864e65592472a9b783565415628` |
| `00450_phase6_core_application_security.sql` | `fcffa593f087308a87c5d58e974cfbb81f13c2335429da82c24bfe8c11c980ee` |
| `00460_phase6_finance_payroll_security.sql` | `927032d087c2f1cd9faaa59ba10a9dbf76afb8a47b074dff029d7ced19b76add` |

## Staging defects and corrections

1. **Nullable legacy project due date.** The clean `projects` definition now leaves `due_date` nullable, and the compatibility path explicitly drops its legacy `NOT NULL` constraint. `internal_deadline` remains nullable. Canonical `stage_due_at` and `final_due_at` remain database-owned.
2. **Managed Auth boundary.** Migration 00300 defines the narrow `public.phase6_auth_uid()` bridge as `STABLE SECURITY DEFINER` with `search_path = pg_catalog, pg_temp`. It remains owned by the migration executor, returns `auth.uid()`, and is revoked from `PUBLIC`, `anon`, and `authenticated`. `_workflow_current_actor()` uses the bridge and still derives the actor from the session.
3. **Workflow owner provisioning.** Migration 00400 creates the NOLOGIN owner with all restrictive attributes when absent, uses only supported attributes in `ALTER ROLE`, and fails closed after checking every unsafe role attribute in `pg_catalog.pg_roles`. It grants only public-schema usage and bridge execution. PostgreSQL membership plus public-schema `CREATE` are granted temporarily for function ownership transfer and revoked before commit. Owner-owned security-definer functions use the bridge; the authenticated-callable `client_has_project_access` default remains `auth.uid()`.
4. **Application owner provisioning.** Migration 00450 applies the same managed-role pattern to `phase6_app_security_owner`. Its owner-owned security-definer helpers use the bridge, while RLS expressions and security-invoker trigger code retain direct session identity where appropriate.
5. **Employee provisioning order.** Before this correction, Admin Add Employee called `tracker.signUp`, creating the Auth user before trusted staff evidence existed and allowing the Auth trigger to create a Client profile. It now calls Admin-only `provisionTeamMember`, which upserts only a staff role plus name, normalized email, optional phone, and active status into `team_members`. It neither calls Auth signup nor writes role metadata or replaces the Admin session. The employee signs up normally with the same email and chooses their password. A security-invoker `phase6_sync_profile_from_team_member` trigger reconciles an already-existing matching profile as a reversed-order backstop without changing profile identity, email, or creation time.
6. **Finance/payroll schema compatibility.** Migration 00460 UPDATE grants now contain only columns present in the production-derived staging baseline. No compatibility columns were invented.
7. **Static contract updates.** Every static suite that pins migration hashes now pins the exact final bytes. Checks cover nullable `projects.due_date`, the private auth bridge, safe owner attributes and temporary grants, absence of direct Auth-schema grants, bridge use by owner security definers, exact finance grant columns, Admin-only team pre-provisioning, role-free signup metadata, the exact 11 workflow RPC signatures and UI paths, and continued absence of 00500.

## Validation

- `node scripts/phase6-engine-static-tests.mjs`: passed; source assertions only, 11 mutation RPCs and 55 non-mutation functions including the auth bridge.
- `node scripts/phase6-security-static-tests.mjs`: passed; source assertions only.
- `node scripts/phase6-core-security-static-tests.mjs`: passed; source assertions only.
- `node scripts/phase6-finance-security-static-tests.mjs`: passed; source assertions only.
- `node scripts/phase6-frontend-cutover-static-tests.mjs`: passed; source assertions only, all 11 RPCs reachable.
- Additional Phase 6 static suites discovered: none beyond those five.
- `npm run build`: passed (`tsc` and Vite); Vite emitted its existing advisory that a minified chunk exceeds 500 kB.
- Supabase CLI, `psql`, and Docker are unavailable locally. PostgreSQL migration and SQL-test execution were not rerun locally.

## Remaining validation

The corrected migration chain still requires a fresh disposable managed Supabase rehearsal before 00500. SQL tests and true independent two-session concurrency remain unproven in this local environment. These are runtime validation items; no remaining source blocker was found in the requested correction scope.
