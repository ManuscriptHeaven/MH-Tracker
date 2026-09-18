begin;

-- Forward fix for environments that applied 00660 before the conflict target
-- was constraint-qualified. The RETURNS TABLE output parameter "invoice_id"
-- otherwise collides with the invoice_project_links column name in PL/pgSQL.
create or replace function public.invoice_save_version(
  p_invoice_id uuid,
  p_invoice_number text,
  p_client_name text,
  p_client_email text,
  p_month integer,
  p_year integer,
  p_month_label text,
  p_due_date date,
  p_items jsonb,
  p_subtotal numeric,
  p_total_paid numeric,
  p_total_due numeric,
  p_notes text,
  p_status text,
  p_change_note text default ''
)
returns table (
  invoice_id uuid,
  version_id uuid,
  version_number integer,
  invoice_number text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice_id uuid;
  v_version_id uuid := gen_random_uuid();
  v_version integer;
  v_item jsonb;
  v_project_id uuid;
  v_project_number text;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'invoice_auth_required' using errcode='42501';
  end if;

  if public.phase6_app_actor_class() not in ('admin','project_manager') then
    raise exception 'invoice_permission_denied' using errcode='42501';
  end if;

  if nullif(trim(p_invoice_number),'') is null or nullif(trim(p_client_name),'') is null then
    raise exception 'invoice_identity_required' using errcode='22023';
  end if;

  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then
    raise exception 'invoice_items_required' using errcode='22023';
  end if;

  if p_status not in ('Draft','Sent','Paid') then
    raise exception 'invoice_status_invalid' using errcode='22023';
  end if;

  if p_invoice_id is null then
    insert into public.invoices (
      invoice_number, client_name, current_version, created_by
    )
    values (
      trim(p_invoice_number), trim(p_client_name), 1, v_actor
    )
    returning id into v_invoice_id;
    v_version := 1;
  else
    select i.id, i.current_version + 1
      into v_invoice_id, v_version
    from public.invoices i
    where i.id = p_invoice_id
    for update;

    if v_invoice_id is null then
      raise exception 'invoice_not_found' using errcode='P0002';
    end if;

    update public.invoices
    set
      client_name = trim(p_client_name),
      current_version = v_version,
      updated_at = now()
    where id = v_invoice_id;
  end if;

  insert into public.invoice_versions (
    id, invoice_id, version_number, invoice_number,
    client_name, client_email, month, year, month_label,
    due_date, items, subtotal, total_paid, total_due,
    notes, status, change_note, created_by
  )
  values (
    v_version_id, v_invoice_id, v_version, trim(p_invoice_number),
    trim(p_client_name), coalesce(p_client_email,''), p_month, p_year, p_month_label,
    p_due_date, coalesce(p_items,'[]'::jsonb),
    greatest(coalesce(p_subtotal,0),0),
    greatest(coalesce(p_total_paid,0),0),
    greatest(coalesce(p_total_due,0),0),
    coalesce(p_notes,''), p_status, coalesce(p_change_note,''), v_actor
  );

  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  loop
    v_project_number := nullif(v_item->>'project_number','');
    begin
      v_project_id := nullif(v_item->>'project_id','')::uuid;
    exception when invalid_text_representation then
      v_project_id := null;
    end;

    if v_project_number is null then
      raise exception 'invoice_project_number_required' using errcode='22023';
    end if;

    insert into public.invoice_project_links (
      invoice_id, project_id, project_number, first_version_number
    )
    values (
      v_invoice_id, v_project_id, v_project_number, v_version
    )
    on conflict on constraint invoice_project_links_invoice_id_project_number_key do update
      set project_id = coalesce(excluded.project_id, public.invoice_project_links.project_id);

    if v_project_id is not null then
      update public.projects
      set
        invoiced = true,
        invoice_id = v_invoice_id::text,
        invoiced_at = coalesce(invoiced_at, now()),
        updated_at = now()
      where id = v_project_id;
    end if;
  end loop;

  return query
  select v_invoice_id, v_version_id, v_version, trim(p_invoice_number);
end;
$$;


revoke all on function public.invoice_save_version(
  uuid,text,text,text,integer,integer,text,date,jsonb,numeric,numeric,numeric,text,text,text
) from public, anon;
grant execute on function public.invoice_save_version(
  uuid,text,text,text,integer,integer,text,date,jsonb,numeric,numeric,numeric,text,text,text
) to authenticated;

notify pgrst, 'reload schema';

commit;
