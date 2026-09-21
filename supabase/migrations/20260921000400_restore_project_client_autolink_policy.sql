-- Restore the hardened auto-link INSERT policy for the security-definer trigger.
drop policy if exists phase6_access_app_security_insert on public.client_project_access;
create policy phase6_access_app_security_insert
on public.client_project_access
for insert
to phase6_app_security_owner
with check (current_user = 'phase6_app_security_owner'::name);
