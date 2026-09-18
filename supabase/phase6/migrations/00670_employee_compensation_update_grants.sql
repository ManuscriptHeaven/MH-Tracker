begin;

-- Restore the two compensation columns edited by EditEmployeeSalaryModal.
-- Phase 6 intentionally removed broad UPDATE and rebuilt a column allow-list,
-- but salary_type/default_currency were omitted from that list.
grant update (salary_type, default_currency)
  on public.employee_compensation to authenticated;

do $verify$
begin
  if not has_column_privilege('authenticated', 'public.employee_compensation', 'salary_type', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.employee_compensation', 'default_currency', 'UPDATE') then
    raise exception 'employee_compensation update grant repair failed';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
commit;
