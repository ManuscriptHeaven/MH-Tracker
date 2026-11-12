grant update on public.finance_transactions to authenticated;
drop policy if exists "Managers can update finance transactions" on public.finance_transactions;
create policy "Managers can update finance transactions" on public.finance_transactions
for update to authenticated
using (public.can_manage_all_projects())
with check (public.can_manage_all_projects());
