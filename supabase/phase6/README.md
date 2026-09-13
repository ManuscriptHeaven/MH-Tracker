# Phase 6 canonical workflow migration bundle

This branch captures the Phase 6 SQL that was rehearsed and cut over on the dedicated staging Supabase project on 2026-09-13. Production has not been modified.

## Authoritative order

| Order | Staging source key | Target file | Characters | SHA-256 |
|---:|---|---|---:|---|
| 1 | `corr_00100` | `migrations/00100_canonical_foundation.sql` | 73933 | `3bdae7a341b22699cb8879a3508e3f97eb76e1e09287949ebd7fe93aed1ee21a` |
| 2 | `00200` | `migrations/00200_legacy_backfill.sql` | 80300 | `848c80db812dfa583c563fc9b73c44deebf6130d56578946712a78003cbb2cfc` |
| 3 | `corr_00300` | `migrations/00300_workflow_rpcs.sql` | 172449 | `296b77041d7af216c499c50a7e91866cb70d2f7e4fb9e36f6410e86bf6c7e767` |
| 4 | `corr_00400` | `migrations/00400_security_and_projections.sql` | 50447 | `22a852cf39d1e6d3292d98fcdc8ad90663770864e65592472a9b783565415628` |
| 5 | `corr_00450` | `migrations/00450_core_application_security.sql` | 35843 | `fcffa593f087308a87c5d58e974cfbb81f13c2335429da82c24bfe8c11c980ee` |
| 6 | `00460` | `migrations/00460_finance_payroll_security.sql` | 13609 | `927032d087c2f1cd9faaa59ba10a9dbf76afb8a47b074dff029d7ced19b76add` |
| 7 | `test_00500_v3_exact` | `migrations/00500_final_cutover_v3.sql` | 27102 | `8439ce1388eccc8bf1090a8cd3effd5c6f0e0ec6c991e1b3d84cc0d278f0038f` |

## Validation sources

| Staging source key | Target file | Characters | SHA-256 |
|---|---|---:|---|
| `test_engine_exact` | `tests/phase6_engine.test.sql` | 22418 | `3f65bfb662cc27e9699fe2d288593925d5e1b322f7083c7c2d79bec1d579ec30` |
| `test_security_v4_exact` | `tests/phase6_security.test.sql` | 19349 | `995701c590bfe7368b0ba556e57551e29e7e358cfd32096d8ad9a7a94a2c103c` |
| `test_core_v6_probe` | `tests/phase6_core_security.test.sql` | 27721 | `3b194f36dd6a2236371983fb550496f9722b30a6acfce5af55993493fd4c2a1a` |
| `test_finance_v6_probe` | `tests/phase6_finance_security.test.sql` | 18089 | `dcd71be15dab01405ccbf7a66ecc3a5373d2c972915b8b98bc5bcf688098166e` |
| `test_workflow_v6_exact` | `tests/phase6_workflow_rpcs.test.sql` | 34542 | `94de8fdec00948e037dabaa09233a1a6a6553b024347b1c6f894046788f7e4d3` |
| `test_cutover_v3_exact` | `tests/phase6_cutover.test.sql` | 22680 | `c214ea14b9d2b5d6861bd71b3c3617ca588354f09e3607af7235673402e5a2a3` |

## Staging gate result

The final workflow V6 suite passed in a rollback-only transaction. Migration 00500 V3 then passed a rollback-only cutover rehearsal together with the cutover test suite, was committed on staging, and the committed state passed the cutover suite again.

The staging-only workflow V6 test differs from the older V4 source only in test harness corrections: it avoids direct guarded canonical updates when constructing fixtures, uses an Admin claim for client-profile fixture mutation, and widens the pause/resume timing window from one second to five seconds. No workflow production logic was changed for those test corrections.

## Production rule

Do not apply any Phase 6 migration to production until every file listed above exists on this branch and its SHA-256 matches this manifest. Run a production preflight separately; do not reuse staging fixture data or staging helper schemas as production dependencies.
