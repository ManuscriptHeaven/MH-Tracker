# Team Status direct-production rollout and recovery

This release is intentionally not using a paid staging database. The DDL migration
`supabase/migrations/20261020090000_employee_lifecycle_status.sql` is additive;
it does not update or delete any existing employee, payroll, task or project rows.

## Preflight
- Verify the repo CI build, regression and attendance integration tests are green.
- Verify the live Supabase project and SQL schema match the migration's expected columns.
- Supabase Free does not provide a confirmed point-in-time recovery from this integration.
  Check any independent database export/backup outside this automation before relying on it.
- Do not use real employee records for synthetic offboarding tests.

## Release
1. Apply the migration atomically and verify its schema, RLS policies and EXECUTE grants.
2. Confirm no production profile `status` values changed by the migration.
3. Merge the fresh-main PR, await the Cloudflare build, then check the Team & Workload UI.
4. Test the dialog without submitting status changes on real employees.
5. Verify actual offboarding with an explicitly provisioned test account in a future test cycle.

## Limited rollback (ONLY if no lifecycle change has been recorded)
Run on the intended Supabase project through a trusted administrator after assessing effects.
A lifecycle event makes schema rollback unsafe because it would discard the audit
history; instead disable the UI and make a compensating audited status change.

```sql
begin;
do $guard$
begin
  if exists (select 1 from public.employee_condition_audit limit 1) then
    raise exception 'Stop: audit data exists. Do not drop lifecycle schema.';
  end if;
end;
$guard$;
drop function if exists public.admin_set_team_employment_condition(uuid,text,date,date,text);
drop table if exists public.employee_condition_audit;
alter table public.profiles
  drop column if exists employment_condition,
  drop column if exists condition_start_date,
  drop column if exists condition_end_date,
  drop column if exists employment_end_date,
  drop column if exists employment_return_date;
commit;
```

This is not a substitute for a database backup. App changes can be reverted
through GitHub if a frontend regression is detected.
