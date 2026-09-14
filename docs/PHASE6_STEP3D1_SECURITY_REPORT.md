# Phase 6 Step 3D.1 — Workflow Security Boundary and Client Projections

Date: 2026-09-09. Status: implemented and source-checked; PostgreSQL execution remains unverified.

**NO LIVE DATABASE WAS MODIFIED. LOCAL DB VALIDATION BLOCKED.**

## 1. Scope

Step 3D.1 creates the dedicated workflow execution owner, transfers the eleven accepted mutation RPCs, grants their exact dependencies, locks canonical workflow tables at both ACL and RLS layers, protects project workflow columns, replaces unsafe client access logic, adds fixed client projections, and retires competing legacy workflow triggers and callable mutation entry points.

Messages, conversations, communication membership, finance, payroll, the broad profile directory, AI/RAG, knowledge-base security, and unrelated task policy work remain Step 3D.2 scope. No frontend source, live database, deployment, commit, or push was performed. Migrations 1–3 remain byte-for-byte unchanged from the accepted Step 3C.2.1 state.

## 2. Files created and modified

Created:

- `supabase/phase6/migrations/00400_phase6_security_and_projections.sql`
- `supabase/tests/database/phase6_security.test.sql`
- `scripts/phase6-security-static-tests.mjs`
- `docs/PHASE6_STEP3D1_SECURITY_REPORT.md`

Modified:

- `scripts/phase6-engine-static-tests.mjs` only to accept the expected fourth Phase 6 migration while retaining all prior engine checks.

Frontend files and migrations 1–3 were not modified.

## 3. Dedicated owner design

Migration 4 creates `phase6_workflow_rpc_owner` when absent and restates its attributes as `NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. Membership is revoked from `anon` and `authenticated`. The role does not own workflow tables.

The role owns the eleven canonical mutation RPCs and the narrowly reviewed security/projection functions. It receives schema usage, `auth.uid()` execution, explicit helper execution, and operation-specific table privileges. Migration 4 also discovers pgcrypto's actual schema from `pg_extension`/`pg_namespace`, fails closed if the extension or its extension-owned `digest(text,text)` overload is missing, and grants only schema `USAGE` plus `EXECUTE` on that exact overload. No `GRANT ALL`, schema-wide function grant, extension-schema `CREATE`, superuser privilege, login, or RLS bypass is used.

## 4. Exact owned RPC inventory

The following eleven `SECURITY DEFINER` RPCs are transferred to `phase6_workflow_rpc_owner`:

1. `workflow_advance_stage`
2. `workflow_submit_stage_for_approval`
3. `workflow_client_approve_stage`
4. `workflow_submit_client_revision`
5. `workflow_submit_revised_proof`
6. `workflow_request_stage_skip`
7. `workflow_respond_stage_skip`
8. `workflow_admin_override`
9. `workflow_complete_final_delivery`
10. `workflow_set_project_lifecycle`
11. `workflow_update_project_configuration`

All retain `SET search_path = pg_catalog, pg_temp`, exact `auth.uid()` actor derivation through active profiles, project-first locking, receipt handling, and the accepted Step 3C.2 behavior.

## 5. Function grant matrix

| Function group | PUBLIC | anon | authenticated | workflow owner |
|---|---:|---:|---:|---:|
| Eleven canonical mutations | None | None | EXECUTE | Owner/EXECUTE |
| 51 `_workflow_*` helpers | None | None | None | Explicit EXECUTE |
| Three named engine calendar helpers | None | None | None | Explicit EXECUTE |
| Client/security projection functions | None | None | EXECUTE where client-facing/RLS-required | Owner |
| Legacy workflow mutators | None | None | None | No application grant |

Migration 4 explicitly closes the missing `_workflow_format_evidence(public.projects,text)` default execute surface. No underscore-prefixed workflow helper is application-callable.

## 6. Internal-helper security

The owner receives 54 explicit engine-helper EXECUTE grants: 51 `_workflow_*` helpers and the three named production-calendar helpers. There is no `EXECUTE ON ALL FUNCTIONS IN SCHEMA public`. The named calendar helpers remain unavailable to ordinary application roles.

## 7. Workflow table privilege matrix

| Table | authenticated direct privileges | workflow owner privileges |
|---|---|---|
| `projects` | SELECT/INSERT/DELETE plus explicit non-workflow UPDATE columns; RLS still decides rows | SELECT, UPDATE |
| `project_stage_history` | SELECT only | SELECT, INSERT |
| `project_stage_skips` | SELECT only | SELECT, INSERT, UPDATE |
| `revision_requests` | SELECT plus UPDATE of `assigned_to`, `priority`, `team_response` only | SELECT, INSERT, UPDATE |
| `admin_workflow_overrides` | SELECT only | SELECT, INSERT |
| `workflow_idempotency_receipts` | None | SELECT, INSERT |
| `notifications` | Existing user posture retained for Step 3D.2 | SELECT, INSERT only |

PUBLIC and anon have no direct access to the protected workflow tables. The workflow owner receives no notification UPDATE or DELETE privilege.

## 8. Workflow RLS matrix

All historical policies on `projects`, history, skips, revisions, overrides, receipts, and client access are removed using catalog-discovered, identifier-quoted policy names. Explicit operation policies replace them.

| Table | Team read | Client read | Direct mutation |
|---|---|---|---|
| `projects` | Admin/PM all; Employee assigned | No raw rows | Team metadata columns only; workflow owner handles canonical columns |
| history | Admin/PM all accessible; Employee assigned | None | Owner INSERT only |
| skips | Admin/PM all accessible; Employee assigned | Safe projection RPC | Owner INSERT/UPDATE only |
| revisions | Admin/PM all accessible; Employee assigned | Safe projection RPC/view | Owner lifecycle writes; narrow team metadata update |
| overrides | Admin only | None | Owner INSERT only |
| receipts | None | None | Owner SELECT/INSERT only |
| client access | Admin/PM manage; Client reads own mapping | Own mapping only | Admin/PM only |

No protected workflow policy contains `USING (true)` or `WITH CHECK (true)`.

## 9. Project workflow-column protection

Migration 4 removes the authenticated table-level UPDATE grant and grants UPDATE only on explicit CRM, assignment, file-link, invoice, and timestamp metadata columns. PostgreSQL performs column privilege checks even for `SET protected_column = protected_column`, so a no-op assignment is not a bypass.

Protected columns include all canonical state/capability/version/counter fields; stage clocks and final/delivery timestamps; settings; lifecycle/stage/waiting compatibility fields; progress/client-action/time-accounting/state JSON fields; and every workflow milestone/due compatibility field. The canonical RPC owner retains table UPDATE.

The old project timestamp trigger is replaced with a narrow invoker trigger whose boundary is `current_user`. When the dedicated `phase6_workflow_rpc_owner` executes a canonical RPC, the trigger returns `NEW` unchanged. This preserves the RPC's explicit `v_mutation_at`, including the later workflow-version-only project UPDATE. Every ordinary direct metadata writer is stamped with `clock_timestamp()` regardless of a supplied value, so an authenticated caller cannot forge or preserve an arbitrary `updated_at`. The revision metadata trigger applies the same owner-preserve/ordinary-stamp rule.

The project trigger also treats `client_profile_id` as access-control metadata. A direct change requires `phase6_current_actor_class()` to be Admin or Project Manager and otherwise raises the stable `workflow_project_client_access_denied` access error. Assigned Employees and Junior Assistants retain their other permitted metadata edits but cannot change this client authorization route. The dedicated workflow owner returns before this direct-writer guard and is not accidentally blocked.

## 10. Team raw project read policy

`phase6_current_actor_class()` loads only the exact active profile at `auth.uid()` and normalizes roles. Admin and Project Manager classes read all projects. Employee-class users read only rows where `assigned_to=auth.uid()`. Client class receives no raw-project SELECT policy.

Project creation remains available to Admin/PM with `created_by=auth.uid()`; deletion is Admin-only. The current INSERT policy does not independently validate the complete initial canonical workflow tuple. Creation therefore relies on the eventual canonical frontend supplying a valid initial canonical workflow payload. Initial-project-state enforcement must be explicitly validated before the workflow write freeze is lifted.

## 11. Client project projection

The primary read RPC is:

```sql
public.get_client_project_summaries()
returns table (...48 explicitly declared fields...)
```

It is `STABLE SECURITY DEFINER`, uses `search_path = pg_catalog, pg_temp`, derives identity from `auth.uid()`, requires an active normalized Client profile, and authorizes only `projects.client_profile_id=auth.uid()` or an exact `client_project_access(project_id,client_id)` membership.

The historical `client_has_project_access(uuid,uuid default auth.uid())` signature is retained for repository compatibility but replaced with exact caller binding. A supplied UUID different from `auth.uid()` returns false. Email, name, fuzzy matching, and `created_by` are not authorization inputs.

Because `client_profile_id` is one of those exact authorization inputs, its direct project metadata mutation is guarded: only Admin/PM may change it. `client_project_access` INSERT, UPDATE, and DELETE policies likewise remain Admin/PM-only; Employees and Clients cannot mutate either access path.

The compatibility `client_project_summaries` view remains temporarily for the current frontend. It is a `security_invoker=true` view over the RPC with an explicit field list; it does not read `projects` directly.

## 12. Client raw-project denial

Authenticated retains a table SELECT privilege because team and client sessions share the same database role. RLS supplies no Client branch, so an active Client receives zero raw `projects` rows. Client reads use the projection RPC or compatibility view.

## 13. Client-safe project field list

The 48 returned fields are:

`id`, `project_number`, `project_title`, `client_name`, `service_type`, `genre`, `priority`, `project_status`, `workflow_stage_key`, `workflow_stage_status_key`, `workflow_waiting_on_key`, `status`, `current_stage`, `stage_status`, `waiting_on`, `timeline_status`, `progress_percentage`, `client_action_required`, `start_date`, `due_date`, `stage_started_at`, `stage_due_at`, `stage_completed_at`, `final_due_at`, `delivered_at`, `files_received_date`, `design_concept_due_date`, `design_concept_submitted_date`, `design_concept_approval_date`, `concept_revision_due_date`, `print_version_due_date`, `print_version_submitted_date`, `print_version_approval_date`, `print_revision_due_date`, `ebook_due_date`, `ebook_submitted_date`, `ebook_approval_date`, `final_delivery_date`, `delivery_date`, `revision_count`, `source_file_link`, `proof_pdf_link`, `final_print_pdf_link`, `final_ebook_link`, `cover_file_link`, `client_brief_link`, `created_at`, `updated_at`.

The projection excludes internal/QA/general/delivery notes, staff IDs, client email, workflow settings, resolver evidence, production/client counters, state JSON, invoice data, finance/payroll data, internal deadlines/delay reasons, and unrestricted miscellaneous links. It never uses `p.*`, `to_jsonb(p)`, or `row_to_json(p)`.

## 14. History security

History is immutable to ordinary users: authenticated has no INSERT, UPDATE, or DELETE privilege and no such RLS policy. Admin/PM may read project history; assigned Employees may read their project's history. Clients receive no raw history. No client timeline projection was added because the current client portal does not query history. A future timeline projection must omit actor IDs, reasons, unrestricted metadata, accounting deltas, backfill diagnostics, and idempotency keys.

The project-wide history count invariant remains valid because canonical history writers run under the project lock and ordinary direct writes are now denied.

## 15. Revision security

Canonical revision creation/status/stage/round/deadline/completion mutation is RPC-only. Admin/PM and assigned Employees may read project-authorized raw rows. Direct team updates remain only for the existing non-workflow metadata fields `assigned_to`, `priority`, and `team_response`; lifecycle fields are denied by column ACL.

Clients use `get_client_revision_requests()` and the compatibility view. Exact current project access and caller-owned revision rows are required. Client-safe item and attachment projections retain useful content but omit item internal notes and attachment uploader identity. Client revision activity exposes only neutral action/timestamp records; actor ID and raw previous/new values are excluded. Raw child-table Client SELECT policies are removed. Exact-access Client insert policies preserve submitted-revision item/attachment/activity flows, and scoped team mutation policies preserve the unrelated upload/item workflow.

## 16. Skip security

Authenticated has no direct INSERT, UPDATE, or DELETE. Admin/PM and assigned Employees may read raw project-authorized rows. Clients use the canonical request/response RPCs and may read `get_client_stage_skips()`, which exposes only request identity, project/stage, reason, client-visible status/response, and timestamps after exact project access.

## 17. Override security

Authenticated cannot insert, update, or delete overrides. Only the canonical admin override RPC inserts. Raw read is Admin-only and project-linked. PM, Employee, and Client receive no raw override row, reason, explanation, actor identity, or before/after audit metadata.

## 18. Receipt security

`workflow_idempotency_receipts` remains completely internal. PUBLIC, anon, and authenticated receive no SELECT/INSERT/UPDATE/DELETE. Only the workflow owner receives SELECT and INSERT, matching receipt lookup/store behavior.

## 19. Notification dependency privileges

The owner receives only SELECT and INSERT plus owner-specific RLS policies so `_workflow_notify` can insert and verify its own rows. It receives no UPDATE or DELETE. Existing recipient read/mark/delete posture is left for Step 3D.2. The historical recipient UPDATE policy permits changing more than `is_read` when addressed directly; constraining that path to read-state-only is a recorded Step 3D.2 issue. A clean-database user-notification policy review also remains in that later scope; neither issue expands the RPC owner's authority.

## 20. Legacy workflow function inventory and revocation

Migration 4 revokes every existing overload of these catalog-discovered names from PUBLIC, anon, and authenticated while retaining the functions for migration compatibility:

`client_approve_project_milestone`, `submit_client_revision`, `submit_revised_proof`, `client_respond_revision`, `apply_revision_request_timeline`, `mark_project_revision_requested`, `apply_project_timeline`, `create_timeline_deadline_notifications`, `create_project_notifications`, `notify_revision_watchers`, `set_revision_completed_at`, `notify_revised_proof_uploaded`, `log_project_status_change`, and `auto_link_client_project_access`.

Competing project/revision/notification triggers are dropped. Revocation alone is insufficient because PostgreSQL trigger execution is not an application function call. Generic revision timestamp replacement is retired; the new conditional metadata timestamp triggers preserve canonical RPC timestamps. Unrelated revision attachment/item flows and their timestamp trigger are retained.

## 21. Removed or replaced unsafe policies

All prior policy-name variants on the seven boundary tables are removed before replacement. This removes the historical all-auth history read/insert, all-operation skip policy, all-auth override read/insert, raw Client project visibility, and direct revision lifecycle mutation policies. Client access management policies are also replaced with active canonical role normalization.

## 22. RLS recursion handling

Project policies do not query `projects` through another project policy. They call the small `phase6_current_actor_class()` definer helper, which returns a fixed classification from the exact active profile only. Child-table policies may query `projects`; that query resolves through the non-recursive team project policy. Owner-specific RLS policies are operation-specific and test `current_user` against the NOLOGIN owner role.

The exact client-access helper is narrow rather than generic: it accepts a project and compatibility client argument, requires the argument to equal `auth.uid()`, verifies active Client class, and checks only the direct FK/access table.

## 23. Role normalization

`admin → admin`, `project_manager/manager → project_manager`, `employee/junior_assistant → employee`, and `client → client`. Only Admin gets Admin behavior. Manager has Project Manager scope. Junior Assistant remains assigned-project Employee scope.

## 24. SQL tests

`supabase/tests/database/phase6_security.test.sql` is rollback-only and creates no Auth users or emails. Catalog assertions cover owner attributes/membership, exact RPC ownership and ACLs, internal helper denial/owner grants, legacy revocation, protected-table ACLs, project/revision column ACLs, both timestamp trigger definitions and installation, catalog-discovered pgcrypto schema and exact digest privilege, client access guards, client projection source/output, raw Client project-policy absence, and absence of unconditional protected-table policies. Runtime role-matrix and Employee `client_profile_id` mutation cases explicitly report their disposable-fixture dependency instead of claiming a pass.

The SQL test was authored but not executed because PostgreSQL/Supabase tooling is unavailable.

## 25. Static tests

`scripts/phase6-security-static-tests.mjs` is dependency-free. It pins the accepted hashes for migrations 1–3 and the 127-file frontend digest, requires exactly four Phase 6 migrations, verifies role attributes, eleven ownership transfers and grants, 54 explicit internal grants, the owner/non-owner timestamp contract, all eleven workflow-version-only writes, least-privilege catalog-discovered pgcrypto grants, the `client_profile_id` guard, Admin/PM-only access-map mutation, protected table/column ACL source, fixed projections, exact access logic, policy restrictions, trigger retirement, and the legacy inventory.

Static checks prove source invariants only. They do not parse or execute PostgreSQL.

The first security-static run failed because the assertion expected the direct-FK predicate inside the project projection body even though the projection delegates to the hardened exact-access helper. The checker was corrected to assert the delegation and then inspect the helper's caller/FK/membership predicates. The first engine-static run after adding migration 4 failed its former exactly-three-migrations inventory; its expected inventory was minimally extended to the required fourth migration. No accepted engine behavior was changed. Both final runs pass.

## 26. Frontend cutover inventory

There are **20 workflow/client-read source call sites** in `src/lib/useTracker.ts` that need canonical conversion before deployment, plus five companion workflow notification inserts that become redundant when their actions use canonical RPCs:

| Line | Current call | Required cutover |
|---:|---|---|
| 752 | Client reads `client_project_summaries` | Call `get_client_project_summaries` RPC; compatibility view works temporarily |
| 1662, 1675 | Generic full-row project UPDATE and enum fallback | Split non-workflow metadata from canonical transitions |
| 1890 | `addRevision` writes project status/waiting | Replace legacy note-driven workflow mutation |
| 2091 | `submit_client_revision` | `workflow_submit_client_revision` with version/idempotency |
| 2240 | Direct revision request UPDATE | Keep metadata-only changes separate; canonical statuses use RPCs |
| 2381, 2385 | Revised-proof revision/project UPDATEs | `workflow_submit_revised_proof` after upload |
| 2433 | `client_respond_revision` | Canonical approval/revision RPC flow |
| 2530, 2537 | Legacy milestone RPC plus direct fallback | `workflow_client_approve_stage`; remove fallback |
| 2615 | Final Delivery through generic `updateProject` | `workflow_complete_final_delivery` |
| 2669, 2677 | Stage submission project/revision writes | `workflow_submit_stage_for_approval` |
| 2736 | Direct skip INSERT | `workflow_request_stage_skip` |
| 2878, 2880, 2888 | Direct skip UPDATE/project route | `workflow_respond_stage_skip` |
| 2958, 2961 | Project UPDATE plus override INSERT | `workflow_admin_override` |

Companion notification inserts at lines 2386, 2540, 2681, 2737, and 2882 must be removed with those conversions because canonical RPCs emit their own notifications. Team raw project/revision reads at lines 754 and 801 remain compatible with the new team RLS. Project create/delete and non-workflow file/CRM edits remain direct paths subject to role, row, and column restrictions.

## 27. Local DB execution status

`supabase --version`, `psql --version`, and `docker --version` were rechecked without installation. All are unavailable.

**LOCAL DB VALIDATION BLOCKED.** Migration parsing/application, effective ACL/RLS behavior, role creation under the real migration runner, PostgREST schema exposure, trigger interaction, and cross-session behavior remain unverified. No database connection was opened.

## 28. npm build

`npm run build` passed (`tsc && vite build`): Vite 6.4.3 transformed 1,715 modules and completed in 9.28 seconds. The existing >500 kB chunk advisory remains. The frontend is unchanged, and this build is not SQL validation.

## 29. Known blockers before Step 3D.2

No source-level blocker remains before Step 3D.2. Disposable PostgreSQL execution is required before runtime acceptance. Initial canonical project-state enforcement must be validated before the workflow write freeze is lifted. Step 3D.2 still owns the broad profile policy conflict, recipient notification policy completion and read-state-only update enforcement, communication `USING(true)` policies, finance/payroll, AI/RAG/JWT-role defects, and unrelated task/security work.

## 30. Deployment write freeze

The workflow write freeze begins before Step 3B and remains active until migrations 3/4 are installed, the canonical frontend is deployed, old workflow writers are retired, security validation passes, and staging checks complete. Migration 4 and the old frontend must not be deployed independently. No deployment or write freeze operation was performed here.

**NO LIVE DATABASE WAS MODIFIED.**
