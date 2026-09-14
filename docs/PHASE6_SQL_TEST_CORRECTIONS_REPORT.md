# Phase 6 SQL test corrections for the auth UID bridge

## Scope

This change updates formal SQL test source to match the accepted, staging-proven private Auth UID bridge. No Phase 6 migration or application/frontend source was changed. No Supabase project was contacted, no deployment occurred, and migration 00500 remains absent.

## SQL tests changed

- `supabase/tests/database/phase6_security.test.sql`
  - The stale client projection assertion expected a direct `auth.uid()` call inside an owner-owned `SECURITY DEFINER` function.
  - It now requires `client_has_project_access(p.id, public.phase6_auth_uid())`, while separately preserving the public helper's `client_id uuid DEFAULT auth.uid()` signature.
  - It formally validates the zero-argument bridge return type, volatility, security mode, fixed path, body, ACLs, migration-executor ownership, and grants to the workflow and application owners when present.
  - It checks `client_has_project_access` body identity binding and fails closed if either Phase 6 owner has a `SECURITY DEFINER` body that directly calls `auth.uid()`.
- `supabase/tests/database/phase6_core_security.test.sql`
  - Employee project authority now expects `p.assigned_to = public.phase6_auth_uid()` in the owner helper and continues to reject `project_manager` as Employee authority.
  - Every application-owner `SECURITY DEFINER` body is checked for absence of direct `auth.uid()` calls.
  - New catalog assertions cover the reversed-order `phase6_sync_profile_from_team_member()` invoker trigger, its ACLs, exact trigger events/columns, case-insensitive email match, and restricted profile assignments.
- `supabase/tests/database/phase6_workflow_rpcs.test.sql`
  - Added assertions that `_workflow_current_actor()` uses `public.phase6_auth_uid()` and that ordinary application roles cannot execute the bridge directly.
  - Existing RPC signatures and authorization/runtime assertions remain intact.
- `supabase/tests/database/phase6_finance_security.test.sql`
  - Added explicit allowed-column checks for the accepted 00460 UPDATE surfaces and explicit denial checks for compatibility columns that 00460 intentionally does not expose.

The already-passing `phase6_business_days.test.sql` and `phase6_engine.test.sql` were reviewed and left byte-for-byte unchanged.

## Final SQL test SHA-256

| SQL test | SHA-256 |
| --- | --- |
| `phase6_business_days.test.sql` | `891541e11719ebbc7a6e8403fb1372e3e2fbfd48fcdac93521f45c24e1addb44` |
| `phase6_core_security.test.sql` | `3b194f36dd6a2236371983fb550496f9722b30a6acfce5af55993493fd4c2a1a` |
| `phase6_engine.test.sql` | `3f65bfb662cc27e9699fe2d288593925d5e1b322f7083c7c2d79bec1d579ec30` |
| `phase6_finance_security.test.sql` | `dcd71be15dab01405ccbf7a66ecc3a5373d2c972915b8b98bc5bcf688098166e` |
| `phase6_security.test.sql` | `995701c590bfe7368b0ba556e57551e29e7e358cfd32096d8ad9a7a94a2c103c` |
| `phase6_workflow_rpcs.test.sql` | `421076d7bcb1a75c016cf181c726e163cab48425d95cca3f524288cc950e23f8` |

## Migration integrity

All six accepted migrations remain byte-for-byte unchanged:

| Migration | SHA-256 |
| --- | --- |
| 00100 | `3bdae7a341b22699cb8879a3508e3f97eb76e1e09287949ebd7fe93aed1ee21a` |
| 00200 | `848c80db812dfa583c563fc9b73c44deebf6130d56578946712a78003cbb2cfc` |
| 00300 | `296b77041d7af216c499c50a7e91866cb70d2f7e4fb9e36f6410e86bf6c7e767` |
| 00400 | `22a852cf39d1e6d3292d98fcdc8ad90663770864e65592472a9b783565415628` |
| 00450 | `fcffa593f087308a87c5d58e974cfbb81f13c2335429da82c24bfe8c11c980ee` |
| 00460 | `927032d087c2f1cd9faaa59ba10a9dbf76afb8a47b074dff029d7ced19b76add` |

`00500_phase6_cutover_and_validation.sql` remains absent.

## Validation

- `node scripts/phase6-engine-static-tests.mjs`: passed.
- `node scripts/phase6-security-static-tests.mjs`: passed.
- `node scripts/phase6-core-security-static-tests.mjs`: passed.
- `node scripts/phase6-finance-security-static-tests.mjs`: passed.
- `node scripts/phase6-frontend-cutover-static-tests.mjs`: passed; all 11 canonical RPC UI paths remain reachable.
- Additional Phase 6 static suites discovered: none beyond these five.
- `npm run build`: passed (`tsc` and Vite). Vite emitted its non-failing advisory for a minified chunk larger than 500 kB.
- Formal PostgreSQL SQL tests were not executed locally in this source-only task.

## V4 managed Supabase extensions-schema ACL correction

Independent formal staging execution reached the pgcrypto schema ACL check after the V3 private bridge assertions passed. The test incorrectly required `anon` and `authenticated` to have no direct ACL entry on the schema containing pgcrypto. Read-only production verification established that managed Supabase already grants both roles non-grantable `USAGE` on the managed `extensions` schema before Phase 6.

The corrected assertion permits only that managed baseline. It fails if either application role has `CREATE`, any schema privilege beyond `USAGE`, or grant option. The separate assertion prohibiting direct `anon` or `authenticated` EXECUTE ACLs on pgcrypto extension functions remains unchanged. No migration behavior changed.

V4 `phase6_security.test.sql` SHA-256: `995701c590bfe7368b0ba556e57551e29e7e358cfd32096d8ad9a7a94a2c103c`.

## V5 portable enum-type deparse correction

Formal managed staging execution next failed at `directory has fixed safe fields` because `pg_get_functiondef()` rendered the visible enum type as `role app_role` instead of `role public.app_role`. PostgreSQL may omit the schema qualifier for an already-resolved visible type; this does not alter the function's underlying return type or output fields.

The V5 assertion still requires exactly `id uuid`, `full_name text`, `role app_role`, and `avatar_url text`, while allowing only an optional literal `public.` qualifier on `app_role`. The adjacent checks excluding row expansion, email, phone, and `created_at` remain unchanged. No database or migration behavior changed.

V5 `phase6_core_security.test.sql` SHA-256: `4fdf8f86aed7a231840620974bdf6540e7142d6841e329e5b1f4ad374b4037a4`.

## V6 deparsed IN-list formatting and workflow actor helper corrections

### Core security: deparsed IN-list whitespace tolerance
Independent formal staging execution of V5 core security failed at the assertion:
`Assertion failed: scoped conversations require current scope; membership is DM/team-channel state only`

The actual reviewed function is correct. PostgreSQL `pg_get_functiondef()` renders the deparsed IN-list without a space after the comma:
`when c.type in ('dm','team_channel') then`
whereas the V5 test expected the literal formatting `('dm', 'team_channel')` with mandatory post-comma whitespace.

Both occurrences in `supabase/tests/database/phase6_core_security.test.sql` (`phase6_can_access_conversation` and `phase6_conversation_target_eligible` assertions) were updated from `\(''dm'', ''team_channel''\)` to `\(''dm''\s*,\s*''team_channel''\)`.

Authorization semantics were not weakened:
- `project_internal` continues requiring current team project access
- `project_client` continues requiring team/client current project access
- `task` continues requiring current task access
- only `dm` and `team_channel` use conversation membership state
- stale project/task membership does not preserve access
- Employee project authority remains `assigned_to` only
- DM pair locking/reuse rules remain asserted

An independently tested staging probe confirmed the complete core-security test passes end-to-end after this correction.

V6 `phase6_core_security.test.sql` SHA-256: `3b194f36dd6a2236371983fb550496f9722b30a6acfce5af55993493fd4c2a1a`.

### Finance security: workflow actor helper alignment
Independent formal staging execution of V5 finance security failed at the assertion:
`Assertion failed: project invoice metadata is Admin/PM guarded without breaking workflow writes`

The accepted 00460 migration source and deployed staging implementation intentionally define `public.phase6_touch_project_metadata_updated_at()` using `public.phase6_current_actor_class()`, not `public.phase6_app_actor_class()`. This project metadata guard originated in the workflow/security layer, and 00460 explicitly preserves the accepted project metadata guard while adding finance-field control. Both functions normalize roles identically and require active profiles.

The assertion in `supabase/tests/database/phase6_finance_security.test.sql` for `project invoice metadata is Admin/PM guarded without breaking workflow writes` was updated to check `phase6_current_actor_class\(\)` instead of `phase6_app_actor_class\(\)`.
- `phase6_guard_finance_transaction()` continues using `phase6_app_actor_class()`, and that assertion remains unchanged.
- Finance grants, role matrices, RLS assertions, payroll tests, and compatibility-column assertions remain unchanged.
- No migration behavior changed.

An independently tested staging probe confirmed the complete finance-security test passes end-to-end after this correction.

V6 `phase6_finance_security.test.sql` SHA-256: `dcd71be15dab01405ccbf7a66ecc3a5373d2c972915b8b98bc5bcf688098166e`.

## Repository checks

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
?? PHASE6_SQL_TEST_MANIFEST.txt
?? docs/
?? scripts/phase6-core-security-static-tests.mjs
?? scripts/phase6-engine-static-tests.mjs
?? scripts/phase6-finance-security-static-tests.mjs
?? scripts/phase6-frontend-cutover-static-tests.mjs
?? scripts/phase6-security-static-tests.mjs
?? src/lib/workflowClient.ts
?? supabase/config.toml
?? supabase/phase6/migrations/
?? supabase/tests/
```

### `git diff --check`

Exit code: `0`.

```text
warning: in the working copy of 'src/App.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/components/ProjectDetail.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/components/ProjectFormModal.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/lib/constants.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/lib/notifications.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/lib/types.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/lib/useTracker.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/pages/ProjectsPage.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/pages/RevisionRequestsPage.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/pages/TeamPage.tsx', LF will be replaced by CRLF the next time Git touches it
```
