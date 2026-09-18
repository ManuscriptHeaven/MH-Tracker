# Phase 6 Step 4 Staging Rehearsal Report

Date: 2026-09-11  
Scope: pre-00500 disposable/staging runtime rehearsal  
Outcome: **STAGING SAFETY GATE FAILED** and **PRE-PHASE6 BASELINE REQUIRED**

No SQL was executed, no database connection was opened, and no production or staging environment was modified.

## Target classification and safety proof

No disposable/staging database target was supplied or discoverable. `supabase/config.toml` identifies only the local development label `tracker-mh-local` and local ports. The repository `.env` contains a configured frontend URL host (`mh-tracker.pages.dev`) plus an anon-key value, but it does not identify a Supabase database host or project reference. The production Supabase project reference therefore cannot be identified from the available configuration, and no distinct staging reference can be compared with it.

The mandatory local marker `MH_PHASE6_STAGING=1` is absent. Because neither the target identity nor its separation from production can be proved, the safety gate failed before SQL execution. Secret-bearing values were inspected only for presence and were never printed.

## Tool preflight

| Tool or library | Result |
|---|---|
| Supabase CLI | unavailable (`supabase` is not installed/on PATH) |
| `psql` | unavailable |
| Docker | unavailable |
| Node.js | available, `v24.18.0` |
| `@supabase/supabase-js` | installed, `2.110.0` |
| Direct PostgreSQL runtime library/runner | none found at the project top level |

The installed Supabase JavaScript client is a PostgREST/Auth client; by itself it is not a safe arbitrary-SQL migration runner. With no CLI, `psql`, Docker, direct PostgreSQL client, verified target, or credentials, there is no SQL execution mechanism for this rehearsal. Nothing was installed.

## Pre-Phase 6 baseline classification

Classification: **C — only an incomplete/stale bootstrap exists**.

The authoritative files now live in `supabase/phase6/migrations/`; migrations 00100–00460 were the numbered Phase 6 chain at the time of this rehearsal. There is no numbered authoritative historical chain preceding Phase 6. The older database is represented by loose `supabase/*.sql` scripts and Git commits. Those scripts overlap and replace the same functions, triggers, policies, views, and table definitions, and the repository audit explicitly describes their order as inferred rather than executable or authoritative. `supabase/schema.sql` is documented as stale and cannot create the full database expected by the current application.

Migration 00100 can create structural objects on an empty database, but an empty bootstrap would not exercise the required upgrade/backfill behavior. The authoritative installed definitions and legacy data state are not reconstructible for:

- the legacy `projects` state, milestone, clock, capability, date, accounting, and compatibility columns that migration 00200 classifies;
- legacy `revision_requests`, `project_stage_history`, `project_stage_skips`, and `admin_workflow_overrides` rows and their historical constraint/FK variants;
- the installed variants of legacy workflow, revision, timeline, notification, signup, client-access, and status-change functions/triggers;
- the effective legacy enum contents for `app_role`, `project_status`, `project_priority`, `payment_status`, `revision_status`, and `note_type`;
- the effective RLS policies, grants, storage policies/buckets, and realtime publication membership;
- the application tables added by unordered supplemental scripts, including conversations/messages, finance/budgets, compensation/ledger, AI tables, invoice columns, client links, and time-aware workflow objects.

No approved production-like staging clone, sanitized backup, schema-only dump, or migration ledger was found. Applying 00100 to a blank database was therefore prohibited by the task instructions.

## Migration execution

| Migration | Result |
|---|---|
| `00100_phase6_canonical_foundation.sql` | **BLOCKED — NOT RUN** |
| `00200_phase6_legacy_backfill.sql` | **BLOCKED — NOT RUN** |
| `00300_phase6_workflow_rpcs.sql` | **BLOCKED — NOT RUN** |
| `00400_phase6_security_and_projections.sql` | **BLOCKED — NOT RUN** |
| `00450_phase6_core_application_security.sql` | **BLOCKED — NOT RUN** |
| `00460_phase6_finance_payroll_security.sql` | **BLOCKED — NOT RUN** |

No SQLSTATE or failing statement exists because execution stopped before connecting.

## SQL tests

Six actual Phase 6 database test files were discovered. All are **BLOCKED — NOT RUN**:

- `phase6_business_days.test.sql`
- `phase6_engine.test.sql`
- `phase6_workflow_rpcs.test.sql`
- `phase6_security.test.sql`
- `phase6_core_security.test.sql`
- `phase6_finance_security.test.sql`

No source/static assertion is reported as a PostgreSQL pass.

## Runtime scenario results

| Area | Result |
|---|---|
| Legacy backfill fixtures | **BLOCKED** |
| Admin role matrix | **BLOCKED** |
| Project Manager role matrix | **BLOCKED** |
| Employee/Junior Assistant role matrix | **BLOCKED** |
| Client role matrix | **BLOCKED** |
| New canonical project creation | **BLOCKED** |
| Eleven workflow RPCs | **BLOCKED** |
| Idempotency/receipt replay | **BLOCKED** |
| Stale workflow version | **BLOCKED** |
| Real two-session concurrency | **BLOCKED** |
| Revisions and attachments | **BLOCKED** |
| Skips, overrides, and final delivery | **BLOCKED** |
| PostgreSQL business-day calculations | **BLOCKED** |
| Core application security/RLS | **BLOCKED** |
| Finance and payroll security/RLS | **BLOCKED** |
| Admin Add Employee provisioning | **BLOCKED** |
| Frontend against staging | **BLOCKED** |

The same-mounted-session scope of the frontend attachment retry state remains documented; page reload does not preserve it and does not require a schema redesign in this phase.

## Static and build regression

All five required dependency-free static suites passed:

- Phase 6 engine static checks: **PASS**
- workflow security static checks: **PASS**
- core security static checks: **PASS**
- finance/payroll security static checks: **PASS**
- frontend cutover static checks: **PASS**

`npm run build` passed (`tsc` and Vite; 1,716 modules). Vite emitted only the existing large-chunk advisory.

These results validate repository source only. They do not validate PostgreSQL execution, Auth identities, RLS, concurrency, storage, or database triggers.

## Migration integrity

The six accepted hashes remain:

| Migration | SHA-256 |
|---|---|
| 00100 | `7d772fc20cd855883a83bab133f9ec14501001d1eb9dfa7b18fdcf93c4e4837d` |
| 00200 | `848c80db812dfa583c563fc9b73c44deebf6130d56578946712a78003cbb2cfc` |
| 00300 | `d95d9f6f960d496ab21ade7bd9bf8172cfbe4dfa63d0e785180a125f726f9bf6` |
| 00400 | `ecb81173ee708871b5ae9de3701a41b0aa0203bbf78ff060e1f3e7013ef17629` |
| 00450 | `540d7cfa426a387cf2044fb80c5ba872847f1e58632cc76501e9237be9c3006b` |
| 00460 | `891f6923d7cc35770f191e1936da7ac2275ed4ca7367a0bceb3454e9d4b499df` |

Migration 00500 remains absent and reserved.

## Blockers and recommendation

No new source defect was established because runtime execution never began. Before this rehearsal can resume, provide all of the following:

1. a named disposable/staging Supabase project or local database target;
2. the production Supabase project reference through a safe, non-secret channel so the staging reference can be proved different;
3. `MH_PHASE6_STAGING=1` in the local execution environment;
4. an approved production-like staging clone/sanitized backup, or an authoritative schema-only baseline plus migration ledger representing the real pre-Phase 6 database;
5. an installed SQL execution mechanism such as Supabase CLI plus Docker for a local stack, or `psql`/an existing direct PostgreSQL runner configured only for the proved staging target;
6. separate disposable authenticated identities for Admin, Project Manager, Employee/Junior Assistant, and Client role/RLS tests.

Recommendation: **BLOCK 00500**.
