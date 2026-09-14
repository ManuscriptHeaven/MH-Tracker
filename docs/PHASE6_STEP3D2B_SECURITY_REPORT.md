# Phase 6 Step 3D.2B Finance / Payroll Security Report

## 1. Scope

Step 3D.2B hardens the existing business-finance and payroll tables with explicit ACLs, normalized active-profile RLS, and trigger guards. It does not modify frontend code, workflow/collaboration behavior, AI/RAG objects, or final project-creation cutover behavior.

## 2. Migration-name decision

The migration is `00460_phase6_finance_payroll_security.sql`. It follows accepted migration 00450 without rewriting migrations 00100-00450. Migration 00500 remains absent and reserved for final cutover and validation.

## 3. Exact finance/payroll table inventory

The repository contains five dedicated data tables in scope:

| Table | Purpose |
| --- | --- |
| `project_payments` | Project price, advance, remaining balance, payment status, and payment dates |
| `finance_transactions` | Income/expense records, currency conversion, invoices, accounts, taxes, fees, and recurrence |
| `finance_budgets` | Monthly budget per finance category |
| `employee_compensation` | Salary, project rate, salary type, currency, joining date, responsibilities, and rating |
| `employee_ledger` | Salary, project payment, bonus, advance, deduction, payment, and other employee entries |

`projects` is a mixed operational table with `invoiced`, `invoice_id`, and `invoiced_at`. `team_members` is a mixed provisioning/private-contact table for security-owner privilege analysis. No separate dues, payroll-period, payroll-run, project-profitability, revenue-summary, or database financial-summary table exists.

## 4. Table classification

- Business finance: `project_payments`, `finance_transactions`, `finance_budgets`, and the three invoice metadata fields on `projects`.
- Payroll/compensation: `employee_compensation` and `employee_ledger`. Advances and deductions are ledger entry types, so the ledger is also the employee-dues model.
- Client-safe billing: no database object is required by the current client portal.
- Mixed: `projects` contains operational and invoice metadata. `team_members` contains provisioning data and private contact fields, but no compensation columns.

## 5. Business-finance read model

Active Admin and normalized Project Manager roles can read all three business-finance tables. Employee and Client roles have no business-finance RLS branch. Employee assignment to a project does not confer finance access.

## 6. Business-finance write model

Admin and Project Manager may insert and update project payments, finance transactions, and budgets. Project-payment and budget deletion remain Admin-only. Transaction deletion remains available to Admin/PM because the current product supports finance transaction deletion and soft deletion for that role group. Guards stamp audit fields, protect immutable identities, and prevent a PM from relinking an existing transaction to another project. Admin may correct a transaction project link.

The `projects` metadata guard allows only Admin/PM to change invoice metadata while preserving the workflow-owner bypass and the accepted client/profile and Employee project-manager protections.

## 7. Payroll read model

Admin can read all payroll rows. An active Employee or Junior Assistant, normalized to `employee`, can read only a row whose `employee_id = auth.uid()`. The exact profile UUID relationship fails closed when no matching row exists. PM and Client have no payroll read policy.

## 8. Payroll write model

Only Admin may insert, update, or delete compensation. Only Admin may insert or delete employee-ledger entries. Employees have no payroll mutation path. The ledger has no authenticated UPDATE ACL or UPDATE policy.

## 9. Employee dues model

There is no separate dues table or acknowledgment field. `employee_ledger` represents advances, deductions, payments, and related dues. Admin manages all entries; an Employee reads only their own entries. No self-acknowledgment mutation was invented.

## 10. Client billing exposure

The current client projection omits internal payment and invoice fields, and no client portal call reads the raw finance tables. No client billing projection or definer RPC was created. Clients have no raw finance/payroll access.

## 11. Currency/settings model

`finance_transactions` stores transaction currency, exchange rate, and calculated PKR amount. Admin/PM may maintain legitimate business transaction values; the trigger recalculates `amount_pkr` from `amount * exchange_rate`. The UI's display/default exchange setting is local storage rather than a database finance-setting table. Payroll default currency remains Admin-managed through compensation. Employee and Client roles cannot mutate these database values.

## 12. Profitability security

The application derives revenue, expense, balances, and profitability client-side from raw finance data. No database profitability view or RPC exists. Because raw business finance is Admin/PM only, those derived figures remain Admin/PM only at the database boundary.

## 13. team_members field classification

Actual fields are `id`, `full_name`, `email`, `role`, `phone`, `status`, and `created_at`. No salary, rate, payroll, or compensation field exists. `full_name`, `role`, and `status` are provisioning/collaboration fields; `email` and `phone` are private contact/provisioning fields; `id` and `created_at` are system identity/audit fields.

## 14. phase6_app_security_owner privilege narrowing

Before 00460, `phase6_app_security_owner` had table-level `SELECT` on `team_members`. After 00460, table-level `SELECT` is revoked and replaced with column-level `SELECT(email, full_name, role, phone, status)`, the exact fields used by signup provisioning. It receives no `id` or `created_at` read privilege. Accepted signup behavior remains intact.

## 15. Finance definer owner if created

No finance SECURITY DEFINER function is required, so `phase6_finance_security_owner` is not created. The five new guard/stamp functions are SECURITY INVOKER trigger functions with fixed `search_path` and no direct application EXECUTE grant.

## 16. Existing finance/payroll RPC inventory

No table-specific finance/payroll RPC or PostgREST-exposed database function was found. Finance/payroll operations are direct table calls governed by ACL and RLS. Historical `current_user_role()` and `can_manage_all_projects()` are generic classification helpers, not finance RPCs; 00460 does not depend on their JWT-era authorization. Remaining AI policy use is deferred to Phase 6B.

## 17. Revoked legacy RPCs

None. There was no unsafe finance/payroll RPC to revoke. All five trigger-only functions introduced here revoke direct EXECUTE from PUBLIC, `anon`, and `authenticated`.

## 18. ACL matrix

| Object | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `project_payments` | authenticated + RLS | authenticated + RLS | explicit payload columns + RLS/guard | authenticated + Admin RLS |
| `finance_transactions` | authenticated + RLS | authenticated + RLS | explicit mutable columns + RLS/guard | authenticated + Admin/PM RLS |
| `finance_budgets` | authenticated + RLS | authenticated + RLS | explicit category/value/audit columns + RLS/guard | authenticated + Admin RLS |
| `employee_compensation` | authenticated + RLS | authenticated + Admin RLS | explicit compensation columns + Admin RLS/guard | authenticated + Admin RLS |
| `employee_ledger` | authenticated + RLS | authenticated + Admin RLS | none | authenticated + Admin RLS |

All pre-existing table and column privileges for PUBLIC, `anon`, and `authenticated` are cleared before exact authenticated grants are rebuilt. No sequences are used for these UUID-keyed tables.

## 19. RLS matrix

| Data | Admin | PM | Employee | Client |
| --- | --- | --- | --- | --- |
| Business finance read | all | all | none | none |
| Business finance insert/update | allowed | allowed | none | none |
| Payment/budget delete | allowed | none | none | none |
| Transaction delete | allowed | allowed | none | none |
| Payroll read | all | none | exact self | none |
| Compensation mutation | allowed | none | none | none |
| Ledger insert/delete | allowed | none | none | none |
| Ledger update | none | none | none | none |

Every role decision uses `phase6_app_actor_class()`, which normalizes Manager to Project Manager and Junior Assistant to Employee and requires an active profile.

## 20. Audit/immutability behavior

Project payment identity, project linkage, and creation time are immutable after insert; actor and update time are stamped. Finance transaction identity, creator, and creation time are immutable; PM project relinking is rejected; actor/update time and PKR value are stamped. Budget category is immutable after insert. Compensation employee linkage is immutable. Employee-ledger entries are append/delete only for Admin, with creation time stamped; corrections can use deletion and a replacement record under the existing model.

## 21. Removed permissive policies

00460 discovers and drops every existing policy on the five in-scope data tables, then creates the exact policy matrix above. This removes historical all-auth and role-helper variants deterministically, including policies whose names differ between installations.

## 22. JWT-role cleanup

No finance/payroll policy introduced or retained by 00460 uses `auth.jwt()->>'role'`, `USING(true)`, or `WITH CHECK(true)`. All new policies use the accepted active-profile actor helper. JWT-based defects outside this scope, particularly AI/RAG policy work, remain deferred.

## 23. SQL tests

`supabase/tests/database/phase6_finance_security.test.sql` is rollback-only. It checks catalog ACLs, exact policy sets, normalized authorization, trigger security and immutability, payroll self-binding, team-member column narrowing, absence of a client billing projection, and absence of an unnecessary finance owner. Fixture-dependent runtime checks cover PM finance access, PM payroll denial, PM transaction relink denial, Employee finance denial and exact self-payroll visibility, and Client finance denial. They skip unless a disposable harness supplies synthetic active profiles. PostgreSQL execution remains unverified.

## 24. Static tests

`scripts/phase6-finance-security-static-tests.mjs` pins accepted migrations 00100-00450 and the frontend digest, validates the six-file migration inventory and reserved 00500 gap, and asserts the finance/payroll ACL, RLS, guard, owner, projection, and SQL-test contracts. Existing static inventories include 00460 while retaining prior checks. The engine, workflow-security, core-security, and finance-security static suites all passed. These are source assertions, not PostgreSQL execution.

## 25. Frontend cutover inventory

`src/lib/useTracker.ts` contains 19 direct calls across the five finance/payroll tables: four `project_payments`, three `employee_compensation`, four `employee_ledger`, six `finance_transactions`, and two `finance_budgets` calls. Two additional direct `team_members` upserts relate to signup/invitation, producing 21 finance-adjacent/provisioning calls reviewed in total.

Required later frontend alignment:

- payroll loading currently includes the normalized Manager/PM branch; the database now permits Admin all-payroll and Employee self-payroll only;
- finance transaction updates spread a partial object that may carry `project_id`; PM updates must omit an unchanged project link or treat relinking as Admin-only;
- current Admin/PM project-payment and finance/budget behavior remains compatible;
- the current UI does not load Employee self-payroll even though the database safely supports it.

No frontend file was modified in this step.

## 26. PostgreSQL validation status

LOCAL DB VALIDATION BLOCKED. `supabase --version`, `psql --version`, and `docker --version` each reported that the command is unavailable. The SQL test was not executed. No live Supabase connection was made.

## 27. npm build

`npm run build` passed with the existing local dependencies (`tsc` and Vite; 1,715 modules transformed). No dependency was installed.

## 28. Known blocker before frontend canonical switch/final cutover

The source boundary itself has no known design blocker. Before the frontend canonical switch, payroll loading must match Admin/self and PM finance updates must avoid sending a project relink. PostgreSQL migration and SQL-test execution in a disposable database remain required before final cutover.

## 29. Deferred AI/RAG

AI documents, embeddings, RAG policies, knowledge-base objects, and James actions were not modified. Any remaining JWT-role authorization in that area remains Phase 6B work.

## 30. Reserved 00500 status

`00500_phase6_cutover_and_validation.sql` remains absent and reserved. Step 3D.2B does not begin final cutover or canonical project-insert enforcement.

## 31. Workflow write-freeze implications

Accepted workflow RPCs, workflow RLS, stage security, collaboration, messages, tasks, notes, client exact-access logic, and migrations 00100-00450 remain unchanged. The project metadata guard preserves the workflow RPC owner bypass. No workflow redesign or application write switch occurs here.

**NO LIVE DATABASE WAS MODIFIED.**
