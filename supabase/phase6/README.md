# Phase 6 authoritative database chain

This directory is the authoritative, ordered Phase 6 database migration chain for MH Tracker. Apply files in numeric order. Do not copy these files into a second migration history or run the historical baseline again against an environment that already contains it.

| Order | Migration | Status |
| --- | --- | --- |
| 00100 | `00100_phase6_canonical_foundation.sql` | Historical, immutable |
| 00200 | `00200_phase6_legacy_backfill.sql` | Historical, immutable |
| 00300 | `00300_phase6_workflow_rpcs.sql` | Historical, immutable |
| 00400 | `00400_phase6_security_and_projections.sql` | Historical, immutable |
| 00450 | `00450_phase6_core_application_security.sql` | Historical, immutable |
| 00460 | `00460_phase6_finance_payroll_security.sql` | Historical, immutable |
| 00500 | `00500_phase6_cutover_and_validation.sql` | Historical, immutable |
| 00600 | `00600_task_management_v2.sql` | Task Management V2 |
| 00610 | `00610_task_management_v2_advisor_fixes.sql` | Staging advisor corrections |

The historical migration hashes remain pinned in the Phase 6 static tests and in `PHASE6_00500_MANIFEST.txt`. Moving the files into this authoritative directory did not change their bytes.

## Deployment discipline

- Verify the exact project ref and environment history before executing SQL. A display name is not sufficient.
- Record schema, policies, helper functions, advisors, and core row counts before deployment.
- Rehearse `00600` inside a transaction and roll it back before applying it as a migration.
- Apply only 00600–00610 when 00100–00500 are already present. Never apply this chain to production as part of a staging task.
- Run `supabase/tests/database/task_management_v2.test.sql` against a disposable or verified staging database. It owns its fixture transaction and rolls back.

## Historical frontend attestation

The Phase 6 security reviews recorded a historical frontend snapshot of 128 files with aggregate SHA-256 `f7299751ed2a80e9cfa82d5d46dea521637879f0394ede7514906e6add97bf99`.

That value is an historical attestation, not a current whole-repository invariant. Post-Phase-6 features necessarily add and edit frontend files. Static tests preserve and verify the recorded value while continuing to validate the current Phase 6 semantic requirements and the byte-for-byte hashes of migrations 00100–00600 as applicable.
