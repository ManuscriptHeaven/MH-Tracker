begin;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  client_name text not null,
  current_version integer not null default 1 check (current_version >= 1),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_versions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  invoice_number text not null,
  client_name text not null,
  client_email text not null default '',
  month integer not null check (month between 1 and 12),
  year integer not null check (year between 2000 and 2200),
  month_label text not null,
  due_date date not null,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  total_paid numeric(12,2) not null default 0 check (total_paid >= 0),
  total_due numeric(12,2) not null default 0 check (total_due >= 0),
  notes text not null default '',
  status text not null default 'Sent' check (status in ('Draft','Sent','Paid')),
  change_note text not null default '',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (invoice_id, version_number)
);

create table if not exists public.invoice_project_links (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  project_number text not null,
  first_version_number integer not null default 1,
  created_at timestamptz not null default now(),
  unique (invoice_id, project_number)
);

create index if not exists invoice_versions_invoice_idx
  on public.invoice_versions(invoice_id, version_number desc);
create index if not exists invoice_versions_created_idx
  on public.invoice_versions(created_at desc);
create index if not exists invoice_project_links_project_idx
  on public.invoice_project_links(project_id);

alter table public.invoices enable row level security;
alter table public.invoice_versions enable row level security;
alter table public.invoice_project_links enable row level security;

revoke all on public.invoices, public.invoice_versions, public.invoice_project_links from public, anon;
grant select on public.invoices, public.invoice_versions, public.invoice_project_links to authenticated;

drop policy if exists invoice_staff_select on public.invoices;
create policy invoice_staff_select on public.invoices
for select to authenticated
using (public.phase6_app_actor_class() in ('admin','project_manager'));

drop policy if exists invoice_versions_staff_select on public.invoice_versions;
create policy invoice_versions_staff_select on public.invoice_versions
for select to authenticated
using (public.phase6_app_actor_class() in ('admin','project_manager'));

drop policy if exists invoice_project_links_staff_select on public.invoice_project_links;
create policy invoice_project_links_staff_select on public.invoice_project_links
for select to authenticated
using (public.phase6_app_actor_class() in ('admin','project_manager'));

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
    on conflict (invoice_id, project_number) do update
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
