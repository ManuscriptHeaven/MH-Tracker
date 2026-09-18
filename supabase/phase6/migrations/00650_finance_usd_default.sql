begin;

-- MH Tracker finance is USD-only going forward. Preserve historical rows as-is,
-- but make every database default align with the current product behavior.
alter table public.finance_transactions
  alter column currency set default 'USD',
  alter column exchange_rate set default 1.0;

do $verify$
begin
  if (
    select column_default
    from information_schema.columns
    where table_schema='public'
      and table_name='finance_transactions'
      and column_name='currency'
  ) not like '%USD%' then
    raise exception 'finance_usd_default_failed: currency default is not USD';
  end if;
end
$verify$;

notify pgrst, 'reload schema';

commit;
