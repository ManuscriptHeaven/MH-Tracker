-- Two-step verification for finance and payroll data.
--
-- A user who has a verified authenticator (TOTP) factor must have an aal2
-- session (password + code) to read or write these tables. Users without a
-- factor are unaffected, so nothing changes until someone turns MFA on in
-- Settings. The policies are RESTRICTIVE: they are ANDed with the existing
-- role-based policies and never grant extra access.

create or replace function public.mfa_requirement_met()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (
        select 1
          from auth.mfa_factors f
         where f.user_id = auth.uid()
           and f.status = 'verified'
      );
$$;

revoke all on function public.mfa_requirement_met() from public;
revoke all on function public.mfa_requirement_met() from anon;
grant execute on function public.mfa_requirement_met() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'finance_transactions',
    'finance_budgets',
    'project_payments',
    'employee_compensation',
    'employee_ledger',
    'task_incentives',
    'invoices',
    'invoice_versions',
    'invoice_project_links'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists mfa_required on public.%I', t);
      execute format(
        'create policy mfa_required on public.%I as restrictive for all to authenticated '
        'using ((select public.mfa_requirement_met())) '
        'with check ((select public.mfa_requirement_met()))',
        t
      );
    end if;
  end loop;
end
$$;
