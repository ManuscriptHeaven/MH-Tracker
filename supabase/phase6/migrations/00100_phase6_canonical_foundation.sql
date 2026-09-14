-- =============================================================================
-- MH Tracker Phase 6 Step 3A: Canonical database foundation
-- =============================================================================
-- This migration is intentionally additive and data preserving. It supports:
--   1. bootstrap of an empty Supabase database; and
--   2. upgrade from the repository's known loose-SQL schema variants.
--
-- It does NOT backfill legacy workflow data, convert legacy state columns,
-- install the canonical workflow RPCs, replace RLS policies, or remove legacy
-- functions/triggers. A clean database receives no legacy workflow mutation
-- trigger from this migration. An upgrade database keeps any such trigger until
-- the Phase 6 cutover migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 01 Extensions
-- -----------------------------------------------------------------------------

create schema if not exists extensions;

create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;

-- -----------------------------------------------------------------------------
-- 02 Existing Application Enum Types
-- -----------------------------------------------------------------------------

do $phase6$
declare
  value_to_add text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'app_role'
  ) then
    create type public.app_role as enum (
      'admin', 'project_manager', 'employee', 'junior_assistant', 'manager', 'client'
    );
  elsif not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'app_role' and t.typtype = 'e'
  ) then
    raise exception 'public.app_role exists but is not an enum';
  else
    foreach value_to_add in array array[
      'admin', 'project_manager', 'employee', 'junior_assistant', 'manager', 'client'
    ] loop
      execute format('alter type public.app_role add value if not exists %L', value_to_add);
    end loop;
  end if;
end
$phase6$;

do $phase6$
declare
  value_to_add text;
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'project_priority'
  ) then
    create type public.project_priority as enum ('Low', 'Normal', 'High', 'Urgent');
  elsif not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'project_priority' and t.typtype = 'e'
  ) then
    raise exception 'public.project_priority exists but is not an enum';
  else
    foreach value_to_add in array array['Low', 'Normal', 'High', 'Urgent'] loop
      execute format('alter type public.project_priority add value if not exists %L', value_to_add);
    end loop;
  end if;
end
$phase6$;

do $phase6$
declare
  value_to_add text;
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'project_status'
  ) then
    create type public.project_status as enum (
      'New',
      'Waiting for Files',
      'Files Required',
      'Files Received',
      'Design Concept in Progress',
      'Awaiting Concept Approval',
      'Concept Revisions',
      'Print Version in Progress',
      'Awaiting Print Approval',
      'Print Revisions',
      'eBook in Progress',
      'eBook Review',
      'Final Quality Check',
      'Completed',
      'Ready to Start',
      'In Progress',
      'Formatting',
      'Cover Design',
      'eBook Conversion',
      'First Proof Ready',
      'Sent to Client',
      'Client Review',
      'Revision Requested',
      'In Revision',
      'Final QA',
      'Ready for Delivery',
      'Delivered',
      'On Hold',
      'Archived',
      'Cancelled',
      'Active',
      'Awaiting Client Approval',
      'Final Delivery'
    );
  elsif not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'project_status' and t.typtype = 'e'
  ) then
    raise exception 'public.project_status exists but is not an enum';
  else
    foreach value_to_add in array array[
      'New', 'Waiting for Files', 'Files Required', 'Files Received',
      'Design Concept in Progress', 'Awaiting Concept Approval', 'Concept Revisions',
      'Print Version in Progress', 'Awaiting Print Approval', 'Print Revisions',
      'eBook in Progress', 'eBook Review', 'Final Quality Check', 'Completed',
      'Ready to Start', 'In Progress', 'Formatting', 'Cover Design',
      'eBook Conversion', 'First Proof Ready', 'Sent to Client', 'Client Review',
      'Revision Requested', 'In Revision', 'Final QA', 'Ready for Delivery',
      'Delivered', 'On Hold', 'Archived', 'Cancelled', 'Active',
      'Awaiting Client Approval', 'Final Delivery'
    ] loop
      execute format('alter type public.project_status add value if not exists %L', value_to_add);
    end loop;
  end if;
end
$phase6$;

do $phase6$
declare
  value_to_add text;
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'payment_status'
  ) then
    create type public.payment_status as enum (
      'Not Started', 'Advance Paid', 'Partially Paid', 'Fully Paid', 'Pending', 'Refunded'
    );
  elsif not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'payment_status' and t.typtype = 'e'
  ) then
    raise exception 'public.payment_status exists but is not an enum';
  else
    foreach value_to_add in array array[
      'Not Started', 'Advance Paid', 'Partially Paid', 'Fully Paid', 'Pending', 'Refunded'
    ] loop
      execute format('alter type public.payment_status add value if not exists %L', value_to_add);
    end loop;
  end if;
end
$phase6$;

do $phase6$
declare
  value_to_add text;
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'revision_status'
  ) then
    create type public.revision_status as enum ('Pending', 'In Progress', 'Completed');
  elsif not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'revision_status' and t.typtype = 'e'
  ) then
    raise exception 'public.revision_status exists but is not an enum';
  else
    foreach value_to_add in array array['Pending', 'In Progress', 'Completed'] loop
      execute format('alter type public.revision_status add value if not exists %L', value_to_add);
    end loop;
  end if;
end
$phase6$;

do $phase6$
declare
  value_to_add text;
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'note_type'
  ) then
    create type public.note_type as enum (
      'general', 'internal', 'client_instruction', 'qa', 'delivery', 'work'
    );
  elsif not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'note_type' and t.typtype = 'e'
  ) then
    raise exception 'public.note_type exists but is not an enum';
  else
    foreach value_to_add in array array[
      'general', 'internal', 'client_instruction', 'qa', 'delivery', 'work'
    ] loop
      execute format('alter type public.note_type add value if not exists %L', value_to_add);
    end loop;
  end if;
end
$phase6$;

-- -----------------------------------------------------------------------------
-- 03 Existing Application Tables
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role public.app_role not null default 'employee',
  avatar_url text,
  phone text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create sequence if not exists public.projects_project_number_seq start with 1001;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  project_number text not null unique
    default ('MH-' || nextval('public.projects_project_number_seq'::regclass)),
  client_name text not null,
  client_email text,
  client_profile_id uuid references public.profiles(id) on delete set null,
  project_title text not null,
  service_type text not null,
  genre text,
  trim_size text,
  page_count integer not null default 0,
  word_count integer not null default 0,
  image_count integer not null default 0,
  platform text,
  assigned_to uuid references public.profiles(id) on delete set null,
  project_manager uuid references public.profiles(id) on delete set null,
  priority public.project_priority not null default 'Normal',
  start_date date,
  due_date date,
  internal_deadline date,
  delivery_date date,
  status public.project_status not null default 'New',
  general_notes text not null default '',
  internal_notes text not null default '',
  client_instructions text not null default '',
  qa_notes text not null default '',
  delivery_notes text not null default '',
  source_file_link text not null default '',
  drive_folder_link text not null default '',
  client_brief_link text not null default '',
  proof_pdf_link text not null default '',
  final_print_pdf_link text not null default '',
  final_ebook_link text not null default '',
  cover_file_link text not null default '',
  other_links text not null default '',
  files_received_date date,
  design_concept_due_date date,
  design_concept_due_date_manual boolean not null default false,
  design_concept_submitted_date date,
  design_concept_approval_date date,
  concept_revision_due_date date,
  print_version_due_date date,
  print_version_due_date_manual boolean not null default false,
  print_version_submitted_date date,
  print_version_approval_date date,
  print_revision_due_date date,
  ebook_due_date date,
  ebook_due_date_manual boolean not null default false,
  ebook_submitted_date date,
  ebook_approval_date date,
  final_delivery_date date,
  current_stage text,
  progress_percentage integer not null default 0,
  waiting_on text not null default 'None',
  timeline_status text not null default 'Paused',
  production_days_used integer not null default 0,
  delay_reason text not null default '',
  client_action_required text not null default '',
  print_timeline_days integer not null default 5,
  stage_status text not null default 'ACTIVE',
  stage_started_at timestamptz default now(),
  stage_due_at timestamptz,
  stage_completed_at timestamptz,
  final_due_at timestamptz,
  production_time_used numeric not null default 0,
  client_wait_time numeric not null default 0,
  revision_count integer not null default 0,
  stage_states jsonb default '{}'::jsonb,
  workflow_settings jsonb default '{"files_received_days":2,"design_concept_days":3,"design_concept_revision_days":2,"print_version_days":5,"print_version_revision_days":2,"ebook_version_days":5,"ebook_version_revision_days":2,"final_delivery_days":2,"revision_days":2,"exclude_weekends":true}'::jsonb,
  invoiced boolean default false,
  invoice_id text,
  invoiced_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Known repository variants may have only the base projects shape. These are
-- compatibility columns, not canonical state conversions. Defaults above are
-- valid only when this migration creates a brand-new empty projects table.
-- Upgrade additions below intentionally remain nullable and have no default so
-- migration time is not fabricated as workflow history and historical projects
-- are not blanket-classified as ACTIVE/zero revisions/zero elapsed time.
alter table public.projects
  add column if not exists client_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists invoiced boolean default false,
  add column if not exists invoice_id text,
  add column if not exists invoiced_at timestamptz,
  add column if not exists stage_status text,
  add column if not exists stage_started_at timestamptz,
  add column if not exists stage_due_at timestamptz,
  add column if not exists stage_completed_at timestamptz,
  add column if not exists final_due_at timestamptz,
  add column if not exists production_time_used numeric,
  add column if not exists client_wait_time numeric,
  add column if not exists revision_count integer,
  add column if not exists stage_states jsonb,
  add column if not exists workflow_settings jsonb;

-- Canonical stage/final deadlines are database-owned timestamptz columns.
-- The legacy CRM due date must not force the frontend to invent a value.
alter table public.projects alter column due_date drop not null;

create table if not exists public.project_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  total_price numeric(10, 2) not null default 0,
  advance_paid numeric(10, 2) not null default 0,
  remaining_balance numeric(10, 2)
    generated always as (greatest(total_price - advance_paid, 0)) stored,
  payment_status public.payment_status not null default 'Not Started',
  due_date date,
  payment_month text,
  payment_year integer,
  payment_date date,
  notes text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.revision_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  revision_number integer not null,
  note text not null,
  status public.revision_status not null default 'Pending',
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  note_type public.note_type not null default 'work',
  note text not null,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  action text not null,
  old_value text,
  new_value text,
  user_id uuid references public.profiles(id) on delete set null,
  activity_type text,
  description text,
  attachment_url text,
  internal_note text,
  created_at timestamptz not null default now()
);

alter table public.activity_logs
  add column if not exists activity_type text,
  add column if not exists description text,
  add column if not exists attachment_url text,
  add column if not exists internal_note text;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  revision_request_id uuid,
  type text not null default 'general',
  title text not null default 'Notification',
  message text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications
  add column if not exists recipient_id uuid references public.profiles(id) on delete cascade,
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists revision_request_id uuid,
  add column if not exists type text not null default 'general',
  add column if not exists title text not null default 'Notification',
  add column if not exists message text not null default '',
  add column if not exists is_read boolean not null default false,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.client_project_access (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (client_id, project_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  project_id uuid references public.projects(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'To Do'
    check (status in ('To Do', 'In Progress', 'Done')),
  priority public.project_priority not null default 'Normal',
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.revision_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  instructions text not null default '',
  team_response text,
  priority text not null default 'Normal'
    check (priority in ('Normal', 'Important', 'Urgent')),
  status text not null default 'Submitted'
    check (status in (
      'Submitted', 'Under Review', 'Assigned', 'In Progress',
      'Ready for Client Review', 'Additional Revision Required',
      'Approved', 'Completed'
    )),
  assigned_to uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.revision_requests
  add column if not exists instructions text not null default '',
  add column if not exists team_response text;

create table if not exists public.revision_items (
  id uuid primary key default gen_random_uuid(),
  revision_request_id uuid not null references public.revision_requests(id) on delete cascade,
  sort_order integer not null default 1,
  page_reference text not null default '',
  instruction text not null,
  status text not null default 'Open'
    check (status in ('Open', 'Under Review', 'In Progress', 'Completed')),
  client_attachment_url text,
  team_response text,
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.revision_attachments (
  id uuid primary key default gen_random_uuid(),
  revision_request_id uuid not null references public.revision_requests(id) on delete cascade,
  revision_item_id uuid references public.revision_items(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  file_type text not null default 'client_attachment',
  uploaded_by uuid not null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.revision_activity (
  id uuid primary key default gen_random_uuid(),
  revision_request_id uuid not null references public.revision_requests(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  previous_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null unique,
  role public.app_role not null default 'employee',
  phone text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('income', 'expense')),
  category text not null,
  description text not null,
  amount numeric(12, 2) not null check (amount > 0),
  transaction_date date not null default current_date,
  project_id uuid references public.projects(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  currency text not null default 'PKR',
  exchange_rate numeric(10, 4) not null default 1.0,
  amount_pkr numeric(12, 2) not null default 0.0,
  client_name text,
  invoice_id text,
  payment_method text default 'Bank Transfer',
  reference_no text,
  vendor text,
  recurring_status text default 'none',
  next_recurring_date date,
  notes text,
  attachment_url text,
  is_soft_deleted boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz default now(),
  expense_type text,
  payment_status text check (payment_status in ('Paid', 'Pending', 'Partially Paid')),
  paid_date date,
  financial_account text,
  tax_amount numeric(12, 2) not null default 0,
  fee_amount numeric(12, 2) not null default 0,
  recurring_end_date date,
  created_at timestamptz not null default now()
);

alter table public.finance_transactions
  add column if not exists currency text not null default 'PKR',
  add column if not exists exchange_rate numeric(10, 4) not null default 1.0,
  add column if not exists amount_pkr numeric(12, 2) not null default 0.0,
  add column if not exists client_name text,
  add column if not exists invoice_id text,
  add column if not exists payment_method text default 'Bank Transfer',
  add column if not exists reference_no text,
  add column if not exists vendor text,
  add column if not exists recurring_status text default 'none',
  add column if not exists next_recurring_date date,
  add column if not exists notes text,
  add column if not exists attachment_url text,
  add column if not exists is_soft_deleted boolean not null default false,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists expense_type text,
  add column if not exists payment_status text,
  add column if not exists paid_date date,
  add column if not exists financial_account text,
  add column if not exists tax_amount numeric(12, 2) not null default 0,
  add column if not exists fee_amount numeric(12, 2) not null default 0,
  add column if not exists recurring_end_date date;

create table if not exists public.finance_budgets (
  category text primary key,
  monthly_budget_pkr numeric(12, 2) not null default 0.0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_compensation (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  monthly_salary numeric(12, 2) not null default 0 check (monthly_salary >= 0),
  per_project_rate numeric(12, 2) not null default 0 check (per_project_rate >= 0),
  salary_type text not null default 'Monthly'
    check (salary_type in ('Monthly', 'Per Project', 'Per Task')),
  default_currency text not null default 'USD'
    check (default_currency in ('USD', 'PKR')),
  joining_date date,
  responsibilities text not null default '',
  performance_rating numeric(5, 2) check (performance_rating between 0 and 100),
  updated_at timestamptz not null default now()
);

alter table public.employee_compensation
  add column if not exists salary_type text not null default 'Monthly',
  add column if not exists default_currency text not null default 'USD',
  add column if not exists joining_date date,
  add column if not exists responsibilities text not null default '',
  add column if not exists performance_rating numeric(5, 2),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.employee_ledger (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  entry_type text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'USD' check (currency in ('USD', 'PKR')),
  salary_month date,
  payment_method text,
  reference text,
  status text not null default 'Pending',
  project_id uuid references public.projects(id) on delete set null,
  description text not null default '',
  notes text not null default '',
  paid_at date not null default current_date,
  created_at timestamptz not null default now(),
  check (entry_type in (
    'Salary', 'Project Payment', 'Bonus', 'Advance',
    'Deduction', 'Payment', 'Other'
  ))
);

alter table public.employee_ledger
  add column if not exists currency text not null default 'USD',
  add column if not exists salary_month date,
  add column if not exists payment_method text,
  add column if not exists reference text,
  add column if not exists status text not null default 'Pending',
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists description text not null default '',
  add column if not exists notes text not null default '',
  add column if not exists paid_at date not null default current_date,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (
    type in ('team_channel', 'dm', 'project_internal', 'project_client', 'task')
  ),
  name text,
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default timezone('utc'::text, now()),
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  parent_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  file_type text not null,
  file_size bigint default 0,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.message_mentions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (message_id, user_id, emoji)
);

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text default 'New Conversation',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.knowledge_base_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  file_name text not null,
  file_url text,
  file_type text,
  category text check (
    category in ('sop', 'template', 'pricing', 'indesign', 'epub', 'kdp', 'internal', 'other')
  ),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- pgvector can already be installed in either public or extensions on an
-- upgrade database. Resolve its actual schema rather than assuming one.
do $phase6$
declare
  vector_schema text;
begin
  select n.nspname
  into vector_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'vector';

  if vector_schema is null then
    raise exception 'The vector extension is required for the existing AI tables';
  end if;

  execute format($sql$
    create table if not exists public.knowledge_base_chunks (
      id uuid primary key default gen_random_uuid(),
      document_id uuid not null references public.knowledge_base_documents(id) on delete cascade,
      chunk_index integer not null,
      content text not null,
      embedding %I.vector(768),
      created_at timestamptz default now()
    )
  $sql$, vector_schema);

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'knowledge_base_chunks'
      and column_name = 'embedding'
  ) then
    execute format(
      'alter table public.knowledge_base_chunks add column embedding %I.vector(768)',
      vector_schema
    );
  end if;
end
$phase6$;

create table if not exists public.ai_response_cache (
  id uuid primary key default gen_random_uuid(),
  query_hash text unique not null,
  response text not null,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.ai_error_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  error_type text,
  error_message text,
  provider text,
  created_at timestamptz default now()
);

create table if not exists public.ai_daily_summary_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dismissed_date date not null,
  created_at timestamptz default now(),
  unique (user_id, dismissed_date)
);

create table if not exists public.ai_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  voice_enabled boolean default false,
  voice_language text default 'en-US',
  tts_enabled boolean default true,
  auto_speak boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- 04 Canonical Phase 6 Types
-- -----------------------------------------------------------------------------

do $phase6$
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'project_lifecycle_status'
  ) then
    create type public.project_lifecycle_status as enum (
      'active', 'on_hold', 'completed', 'cancelled', 'archived'
    );
  end if;
end
$phase6$;

do $phase6$
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'workflow_stage'
  ) then
    create type public.workflow_stage as enum (
      'files_received', 'design_concept', 'concept_approval', 'print_version',
      'print_approval', 'ebook_version', 'ebook_approval', 'final_delivery'
    );
  end if;
end
$phase6$;

do $phase6$
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'workflow_stage_status'
  ) then
    create type public.workflow_stage_status as enum (
      'pending', 'active', 'awaiting_client', 'revision_active',
      'paused', 'completed', 'skipped'
    );
  end if;
end
$phase6$;

do $phase6$
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'workflow_waiting_on'
  ) then
    create type public.workflow_waiting_on as enum ('team', 'client', 'none');
  end if;
end
$phase6$;

do $phase6$
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'workflow_revision_status'
  ) then
    create type public.workflow_revision_status as enum (
      'submitted', 'under_review', 'in_progress', 'ready_for_client_review',
      'changes_requested', 'approved', 'cancelled'
    );
  end if;
end
$phase6$;

do $phase6$
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'workflow_skip_status'
  ) then
    create type public.workflow_skip_status as enum (
      'pending', 'approved', 'rejected', 'cancelled'
    );
  end if;
end
$phase6$;

do $phase6$
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'workflow_event_type'
  ) then
    create type public.workflow_event_type as enum (
      'legacy_snapshot_imported',
      'stage_entered',
      'stage_submitted',
      'stage_approved',
      'revision_requested',
      'revised_proof_submitted',
      'revision_changes_requested',
      'revision_approved',
      'stage_skip_requested',
      'stage_skipped',
      'stage_skip_rejected',
      'stage_skip_cancelled',
      'project_paused',
      'project_resumed',
      'project_cancelled',
      'project_archived',
      'project_unarchived',
      'workflow_configuration_updated',
      'admin_override_applied',
      'final_delivery_completed'
    );
  end if;
end
$phase6$;

do $phase6$
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'service_capability_status'
  ) then
    create type public.service_capability_status as enum (
      'inferred', 'confirmed', 'needs_review'
    );
  end if;
end
$phase6$;

-- -----------------------------------------------------------------------------
-- 05 Core Project Canonical Columns
-- -----------------------------------------------------------------------------

alter table public.projects
  add column if not exists project_status public.project_lifecycle_status,
  add column if not exists workflow_stage_key public.workflow_stage,
  add column if not exists workflow_stage_status_key public.workflow_stage_status,
  add column if not exists workflow_waiting_on_key public.workflow_waiting_on,
  add column if not exists requires_print boolean,
  add column if not exists requires_ebook boolean,
  add column if not exists service_capability_status public.service_capability_status
    not null default 'needs_review',
  add column if not exists capabilities_resolved_by uuid
    references public.profiles(id) on delete set null,
  add column if not exists capabilities_resolved_at timestamptz,
  add column if not exists workflow_version bigint not null default 0,
  add column if not exists production_seconds_total bigint not null default 0,
  add column if not exists client_wait_seconds_total bigint not null default 0,
  add column if not exists delivered_at timestamptz;

-- Critical upgrade rule: legacy rows are not classified in Step 3A. A prior,
-- incompatible partial definition must be reviewed rather than silently altered.
do $phase6$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'project_status'
      and (is_nullable <> 'YES' or column_default is not null)
  ) then
    raise exception 'projects.project_status must be nullable and have no default before Phase 6 backfill';
  end if;
end
$phase6$;

-- These checks are safe for new canonical counters. They are NOT VALID so a
-- partial prior installation can be assessed before validation in Step 3B/3E.
do $phase6$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_workflow_version_nonnegative'
  ) then
    alter table public.projects
      add constraint projects_workflow_version_nonnegative
      check (workflow_version >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_production_seconds_total_nonnegative'
  ) then
    alter table public.projects
      add constraint projects_production_seconds_total_nonnegative
      check (production_seconds_total >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_client_wait_seconds_total_nonnegative'
  ) then
    alter table public.projects
      add constraint projects_client_wait_seconds_total_nonnegative
      check (client_wait_seconds_total >= 0) not valid;
  end if;
end
$phase6$;

-- Capability consistency and canonical state constraints are deliberately
-- deferred until legacy data has been backfilled and validated.
-- During migrations 1-4, current_stage/stage_status/waiting_on/timeline_status
-- remain frontend compatibility text. The three nullable *_key columns are the
-- Phase 6 canonical shadows populated by Step 3B and owned by RPCs in Step 3C.

-- -----------------------------------------------------------------------------
-- 06 Workflow Stage Definitions
-- -----------------------------------------------------------------------------

create table if not exists public.workflow_stage_definitions (
  stage_key public.workflow_stage primary key,
  stage_order smallint not null unique check (stage_order between 1 and 8),
  display_name text not null unique,
  default_production_days smallint not null
    check (default_production_days between 0 and 365),
  client_controlled boolean not null,
  clock_paused boolean not null,
  is_delivery_stage boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_stage_definitions_control_semantics check (
    (client_controlled and default_production_days = 0 and clock_paused)
    or
    (not client_controlled and not clock_paused)
  )
);

create unique index if not exists workflow_stage_definitions_one_delivery_idx
  on public.workflow_stage_definitions (is_delivery_stage)
  where is_delivery_stage;

insert into public.workflow_stage_definitions (
  stage_key,
  stage_order,
  display_name,
  default_production_days,
  client_controlled,
  clock_paused,
  is_delivery_stage
)
values
  ('files_received', 1, 'Files Received', 2, false, false, false),
  ('design_concept', 2, 'Design Concept', 3, false, false, false),
  ('concept_approval', 3, 'Concept Approval', 0, true, true, false),
  ('print_version', 4, 'Print Version', 5, false, false, false),
  ('print_approval', 5, 'Print Approval', 0, true, true, false),
  ('ebook_version', 6, 'Ebook Version', 5, false, false, false),
  ('ebook_approval', 7, 'Ebook Approval', 0, true, true, false),
  ('final_delivery', 8, 'Final Delivery', 2, false, false, true)
on conflict (stage_key) do update
set
  stage_order = excluded.stage_order,
  display_name = excluded.display_name,
  default_production_days = excluded.default_production_days,
  client_controlled = excluded.client_controlled,
  clock_paused = excluded.clock_paused,
  is_delivery_stage = excluded.is_delivery_stage,
  updated_at = now();

-- -----------------------------------------------------------------------------
-- 07 Workflow Calendar
-- -----------------------------------------------------------------------------

create table if not exists public.workflow_calendar_exceptions (
  calendar_date date primary key,
  is_working_day boolean not null,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Precedence contract for Step 3C:
-- An explicit row overrides normal weekend classification. For example,
-- Saturday/true is working even when weekends are excluded, and Wednesday/false
-- is non-working. This migration intentionally seeds no calendar dates.

-- -----------------------------------------------------------------------------
-- 08 Workflow Audit Structures
-- -----------------------------------------------------------------------------

create table if not exists public.project_stage_skips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  stage text not null,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  reason text not null,
  status text not null default 'PENDING',
  client_response_at timestamptz,
  client_notes text,
  stage_key public.workflow_stage,
  requester_id uuid references public.profiles(id) on delete set null,
  canonical_status public.workflow_skip_status,
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  response_note text,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_stage_skips
  add column if not exists stage_key public.workflow_stage,
  add column if not exists requester_id uuid references public.profiles(id) on delete set null,
  add column if not exists canonical_status public.workflow_skip_status,
  add column if not exists responded_by uuid references public.profiles(id) on delete set null,
  add column if not exists responded_at timestamptz,
  add column if not exists response_note text,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists idempotency_key uuid,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

-- Upgrade rows retain NULL when these columns were absent. SET DEFAULT affects
-- future inserts only; requested_at/client_response_at remain legacy evidence.
alter table public.project_stage_skips
  alter column created_at set default now(),
  alter column updated_at set default now();

create table if not exists public.admin_workflow_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  previous_stage text not null,
  new_stage text not null,
  reason text not null,
  explanation text not null,
  previous_project_status public.project_lifecycle_status,
  previous_stage_key public.workflow_stage,
  previous_stage_status public.workflow_stage_status,
  previous_waiting_on public.workflow_waiting_on,
  previous_stage_started_at timestamptz,
  previous_stage_due_at timestamptz,
  resulting_project_status public.project_lifecycle_status,
  resulting_stage_key public.workflow_stage,
  resulting_stage_status public.workflow_stage_status,
  resulting_waiting_on public.workflow_waiting_on,
  resulting_stage_started_at timestamptz,
  resulting_stage_due_at timestamptz,
  idempotency_key uuid,
  created_at timestamptz not null default now()
);

-- CREATE TABLE uses RESTRICT because actor_id is immutable audit evidence. An
-- existing upgrade table may still have the historical SET NULL FK; Step 3A.1
-- does not destructively replace it without staging schema evidence.

alter table public.admin_workflow_overrides
  add column if not exists previous_project_status public.project_lifecycle_status,
  add column if not exists previous_stage_key public.workflow_stage,
  add column if not exists previous_stage_status public.workflow_stage_status,
  add column if not exists previous_waiting_on public.workflow_waiting_on,
  add column if not exists previous_stage_started_at timestamptz,
  add column if not exists previous_stage_due_at timestamptz,
  add column if not exists resulting_project_status public.project_lifecycle_status,
  add column if not exists resulting_stage_key public.workflow_stage,
  add column if not exists resulting_stage_status public.workflow_stage_status,
  add column if not exists resulting_waiting_on public.workflow_waiting_on,
  add column if not exists resulting_stage_started_at timestamptz,
  add column if not exists resulting_stage_due_at timestamptz,
  add column if not exists idempotency_key uuid;

create table if not exists public.project_stage_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  stage text,
  previous_stage text,
  status text,
  started_at timestamptz,
  paused_at timestamptz,
  resumed_at timestamptz,
  completed_at timestamptz,
  due_at timestamptz,
  active_seconds numeric default 0,
  client_wait_seconds numeric default 0,
  actor_id uuid references public.profiles(id) on delete set null,
  action text,
  notes text,
  sequence_no bigint not null,
  event_type public.workflow_event_type not null,
  from_stage public.workflow_stage,
  to_stage public.workflow_stage,
  from_stage_status public.workflow_stage_status,
  to_stage_status public.workflow_stage_status,
  from_waiting_on public.workflow_waiting_on,
  to_waiting_on public.workflow_waiting_on,
  occurred_at timestamptz not null default clock_timestamp(),
  production_seconds_delta bigint not null default 0,
  client_wait_seconds_delta bigint not null default 0,
  actor_role public.app_role,
  revision_request_id uuid references public.revision_requests(id) on delete set null,
  stage_skip_id uuid references public.project_stage_skips(id) on delete set null,
  admin_override_id uuid references public.admin_workflow_overrides(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key uuid,
  created_at timestamptz not null default now()
);

alter table public.project_stage_history
  add column if not exists sequence_no bigint,
  add column if not exists event_type public.workflow_event_type,
  add column if not exists from_stage public.workflow_stage,
  add column if not exists to_stage public.workflow_stage,
  add column if not exists from_stage_status public.workflow_stage_status,
  add column if not exists to_stage_status public.workflow_stage_status,
  add column if not exists from_waiting_on public.workflow_waiting_on,
  add column if not exists to_waiting_on public.workflow_waiting_on,
  add column if not exists occurred_at timestamptz,
  add column if not exists production_seconds_delta bigint default 0,
  add column if not exists client_wait_seconds_delta bigint default 0,
  add column if not exists actor_role public.app_role,
  add column if not exists revision_request_id uuid references public.revision_requests(id) on delete set null,
  add column if not exists stage_skip_id uuid references public.project_stage_skips(id) on delete set null,
  add column if not exists admin_override_id uuid references public.admin_workflow_overrides(id) on delete set null,
  add column if not exists reason text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists idempotency_key uuid,
  add column if not exists created_at timestamptz;

-- Legacy history required a display stage even when its source is unknown.
-- Match clean-install nullability so Step 3B can preserve p.current_stage NULL
-- in an imported snapshot. This relaxes a constraint only; no row is rewritten.
alter table public.project_stage_history
  alter column stage drop not null;

-- Do not stamp existing history with migration time. Adding nullable columns
-- first keeps old rows NULL; these defaults apply only to future inserts.
-- Existing timestamp values and upgrade nullability are not rewritten.
alter table public.project_stage_history
  alter column occurred_at set default clock_timestamp(),
  alter column created_at set default now();

do $phase6$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.project_stage_history'::regclass
      and conname = 'project_stage_history_production_delta_nonnegative'
  ) then
    alter table public.project_stage_history
      add constraint project_stage_history_production_delta_nonnegative
      check (production_seconds_delta is null or production_seconds_delta >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.project_stage_history'::regclass
      and conname = 'project_stage_history_client_wait_delta_nonnegative'
  ) then
    alter table public.project_stage_history
      add constraint project_stage_history_client_wait_delta_nonnegative
      check (client_wait_seconds_delta is null or client_wait_seconds_delta >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.project_stage_history'::regclass
      and conname = 'project_stage_history_metadata_object'
  ) then
    alter table public.project_stage_history
      add constraint project_stage_history_metadata_object
      check (metadata is null or jsonb_typeof(metadata) = 'object') not valid;
  end if;
end
$phase6$;

-- Revision fields remain nullable and the legacy text status remains unchanged
-- until Step 3B can normalize existing rows.
alter table public.revision_requests
  add column if not exists stage_key public.workflow_stage,
  add column if not exists canonical_status public.workflow_revision_status,
  add column if not exists revision_round integer,
  add column if not exists parent_revision_request_id uuid
    references public.revision_requests(id) on delete set null,
  add column if not exists due_at timestamptz;

-- -----------------------------------------------------------------------------
-- 09 Existing Application Supporting Structures
-- -----------------------------------------------------------------------------

-- Add the notifications FK only after revision_requests exists. NOT VALID keeps
-- unknown legacy rows available for Step 3B assessment.
do $phase6$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.notifications'::regclass
      and conname = 'notifications_revision_request_id_fkey'
  ) then
    alter table public.notifications
      add constraint notifications_revision_request_id_fkey
      foreign key (revision_request_id)
      references public.revision_requests(id)
      on delete cascade
      not valid;
  end if;
end
$phase6$;

-- Structural bucket record only. Storage authorization is intentionally left
-- for Step 3D; this migration creates no storage.objects policy.
insert into storage.buckets (id, name, public)
values ('revision-files', 'revision-files', false)
on conflict (id) do update
set name = excluded.name,
    public = false;

-- Preserve the repository's current realtime dependencies without duplicate
-- publication entries. Absence of the Supabase publication is valid in a plain
-- PostgreSQL/static-validation environment and does not cause one to be invented.
do $phase6$
declare
  relation_name text;
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    foreach relation_name in array array[
      'notifications', 'projects', 'revision_requests', 'finance_transactions'
    ] loop
      if not exists (
        select 1
        from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = relation_name
      ) then
        execute format(
          'alter publication supabase_realtime add table public.%I',
          relation_name
        );
      end if;
    end loop;
  end if;
end
$phase6$;

-- RLS is enabled structurally. Step 3A creates no policy and no broad grant.
-- Existing upgrade policies are deliberately preserved for replacement in 3D.
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_payments enable row level security;
alter table public.revision_notes enable row level security;
alter table public.project_notes enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.client_project_access enable row level security;
alter table public.tasks enable row level security;
alter table public.revision_requests enable row level security;
alter table public.revision_items enable row level security;
alter table public.revision_attachments enable row level security;
alter table public.revision_activity enable row level security;
alter table public.team_members enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.finance_budgets enable row level security;
alter table public.employee_compensation enable row level security;
alter table public.employee_ledger enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_mentions enable row level security;
alter table public.message_reactions enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.knowledge_base_documents enable row level security;
alter table public.knowledge_base_chunks enable row level security;
alter table public.ai_response_cache enable row level security;
alter table public.ai_error_logs enable row level security;
alter table public.ai_daily_summary_dismissals enable row level security;
alter table public.ai_user_settings enable row level security;
alter table public.workflow_stage_definitions enable row level security;
alter table public.workflow_calendar_exceptions enable row level security;
alter table public.project_stage_history enable row level security;
alter table public.project_stage_skips enable row level security;
alter table public.admin_workflow_overrides enable row level security;

-- -----------------------------------------------------------------------------
-- 10 Indexes
-- -----------------------------------------------------------------------------

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists projects_assigned_to_idx on public.projects (assigned_to);
create index if not exists projects_project_manager_idx on public.projects (project_manager);
create index if not exists projects_client_profile_id_idx on public.projects (client_profile_id);
create index if not exists projects_due_date_idx on public.projects (due_date);
create index if not exists projects_status_idx on public.projects (status);
create index if not exists projects_current_stage_idx on public.projects (current_stage);
create index if not exists projects_timeline_status_idx on public.projects (timeline_status);
create index if not exists projects_files_received_date_idx on public.projects (files_received_date);
create index if not exists projects_stage_status_idx on public.projects (stage_status);
create index if not exists projects_project_status_idx on public.projects (project_status);
create index if not exists projects_workflow_stage_key_idx
  on public.projects (workflow_stage_key);
create index if not exists projects_workflow_stage_status_key_idx
  on public.projects (workflow_stage_status_key);
create index if not exists projects_service_capability_status_idx
  on public.projects (service_capability_status);

create index if not exists project_payments_project_id_idx
  on public.project_payments (project_id);
create index if not exists project_payments_payment_status_idx
  on public.project_payments (payment_status);
create index if not exists revision_notes_project_id_idx
  on public.revision_notes (project_id);
create index if not exists project_notes_project_id_idx
  on public.project_notes (project_id);
create index if not exists activity_logs_project_id_idx
  on public.activity_logs (project_id);
create index if not exists notifications_recipient_id_idx
  on public.notifications (recipient_id);
create index if not exists notifications_project_id_idx
  on public.notifications (project_id);
create index if not exists notifications_revision_request_id_idx
  on public.notifications (revision_request_id);
create index if not exists client_project_access_client_id_idx
  on public.client_project_access (client_id);
create index if not exists client_project_access_project_id_idx
  on public.client_project_access (project_id);
create index if not exists tasks_project_id_idx on public.tasks (project_id);
create index if not exists tasks_assigned_to_idx on public.tasks (assigned_to);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists tasks_status_idx on public.tasks (status);
create index if not exists tasks_due_date_idx on public.tasks (due_date);
create index if not exists revision_requests_project_id_idx
  on public.revision_requests (project_id);
create index if not exists revision_requests_client_id_idx
  on public.revision_requests (client_id);
create index if not exists revision_requests_assigned_to_idx
  on public.revision_requests (assigned_to);
create index if not exists revision_requests_status_idx
  on public.revision_requests (status);
create index if not exists revision_requests_stage_round_idx
  on public.revision_requests (project_id, stage_key, revision_round);
create index if not exists revision_requests_project_canonical_status_idx
  on public.revision_requests (project_id, canonical_status)
  where canonical_status is not null;
create index if not exists revision_requests_parent_idx
  on public.revision_requests (parent_revision_request_id);
create index if not exists revision_items_request_id_idx
  on public.revision_items (revision_request_id);
create index if not exists revision_attachments_request_id_idx
  on public.revision_attachments (revision_request_id);
create index if not exists revision_activity_request_id_idx
  on public.revision_activity (revision_request_id);

create index if not exists finance_transactions_date_idx
  on public.finance_transactions (transaction_date desc);
create index if not exists finance_transactions_project_idx
  on public.finance_transactions (project_id);
create index if not exists finance_transactions_type_idx
  on public.finance_transactions (type);
create index if not exists finance_transactions_category_idx
  on public.finance_transactions (category);
create index if not exists finance_transactions_deleted_idx
  on public.finance_transactions (is_soft_deleted);
create index if not exists employee_ledger_employee_paid_at_idx
  on public.employee_ledger (employee_id, paid_at desc);
create index if not exists employee_ledger_salary_month_idx
  on public.employee_ledger (salary_month);

create index if not exists idx_conversations_type on public.conversations (type);
create index if not exists idx_conversations_project_id on public.conversations (project_id);
create index if not exists idx_conversations_task_id on public.conversations (task_id);
create index if not exists idx_conversation_members_user
  on public.conversation_members (user_id);
create index if not exists idx_messages_conversation_id
  on public.messages (conversation_id);
create index if not exists idx_messages_created_at on public.messages (created_at);
create index if not exists idx_message_attachments_message_id
  on public.message_attachments (message_id);

create index if not exists idx_ai_conversations_user_id
  on public.ai_conversations (user_id);
create index if not exists idx_ai_messages_conversation_id
  on public.ai_messages (conversation_id);
create index if not exists idx_knowledge_base_chunks_document_id
  on public.knowledge_base_chunks (document_id);
create index if not exists idx_ai_daily_summary_dismissals_lookup
  on public.ai_daily_summary_dismissals (user_id, dismissed_date);

do $phase6$
declare
  vector_schema text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'idx_knowledge_base_chunks_embedding'
      and c.relkind = 'i'
  ) then
    select n.nspname
    into vector_schema
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'vector';

    execute format(
      'create index idx_knowledge_base_chunks_embedding on public.knowledge_base_chunks using ivfflat (embedding %I.vector_cosine_ops) with (lists = 100)',
      vector_schema
    );
  end if;
end
$phase6$;

create unique index if not exists project_stage_history_project_sequence_uidx
  on public.project_stage_history (project_id, sequence_no)
  where sequence_no is not null;
create index if not exists project_stage_history_project_id_idx
  on public.project_stage_history (project_id);
create index if not exists project_stage_history_event_type_idx
  on public.project_stage_history (event_type);
create index if not exists project_stage_history_idempotency_idx
  on public.project_stage_history (project_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists project_stage_skips_project_id_idx
  on public.project_stage_skips (project_id);
create index if not exists project_stage_skips_canonical_status_idx
  on public.project_stage_skips (canonical_status);
create unique index if not exists project_stage_skips_idempotency_uidx
  on public.project_stage_skips (project_id, requester_id, idempotency_key)
  where requester_id is not null and idempotency_key is not null;

create index if not exists admin_workflow_overrides_project_id_idx
  on public.admin_workflow_overrides (project_id);
create unique index if not exists admin_workflow_overrides_idempotency_uidx
  on public.admin_workflow_overrides (project_id, actor_id, idempotency_key)
  where idempotency_key is not null;

-- -----------------------------------------------------------------------------
-- 11 Structural Validation
-- -----------------------------------------------------------------------------

do $phase6$
declare
  actual_values text[];
begin
  select array_agg(e.enumlabel order by e.enumsortorder)
  into actual_values
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  join pg_catalog.pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and t.typname = 'project_lifecycle_status';

  if actual_values is distinct from array[
    'active', 'on_hold', 'completed', 'cancelled', 'archived'
  ]::text[] then
    raise exception 'Unexpected public.project_lifecycle_status definition: %', actual_values;
  end if;

  select array_agg(e.enumlabel order by e.enumsortorder)
  into actual_values
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  join pg_catalog.pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and t.typname = 'workflow_stage';

  if actual_values is distinct from array[
    'files_received', 'design_concept', 'concept_approval', 'print_version',
    'print_approval', 'ebook_version', 'ebook_approval', 'final_delivery'
  ]::text[] then
    raise exception 'Unexpected public.workflow_stage definition: %', actual_values;
  end if;

  select array_agg(e.enumlabel order by e.enumsortorder)
  into actual_values
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  join pg_catalog.pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and t.typname = 'workflow_stage_status';

  if actual_values is distinct from array[
    'pending', 'active', 'awaiting_client', 'revision_active',
    'paused', 'completed', 'skipped'
  ]::text[] then
    raise exception 'Unexpected public.workflow_stage_status definition: %', actual_values;
  end if;

  select array_agg(e.enumlabel order by e.enumsortorder)
  into actual_values
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  join pg_catalog.pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and t.typname = 'workflow_waiting_on';

  if actual_values is distinct from array['team', 'client', 'none']::text[] then
    raise exception 'Unexpected public.workflow_waiting_on definition: %', actual_values;
  end if;

  select array_agg(e.enumlabel order by e.enumsortorder)
  into actual_values
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  join pg_catalog.pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and t.typname = 'workflow_revision_status';

  if actual_values is distinct from array[
    'submitted', 'under_review', 'in_progress', 'ready_for_client_review',
    'changes_requested', 'approved', 'cancelled'
  ]::text[] then
    raise exception 'Unexpected public.workflow_revision_status definition: %', actual_values;
  end if;

  select array_agg(e.enumlabel order by e.enumsortorder)
  into actual_values
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  join pg_catalog.pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and t.typname = 'workflow_skip_status';

  if actual_values is distinct from array[
    'pending', 'approved', 'rejected', 'cancelled'
  ]::text[] then
    raise exception 'Unexpected public.workflow_skip_status definition: %', actual_values;
  end if;

  select array_agg(e.enumlabel order by e.enumsortorder)
  into actual_values
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  join pg_catalog.pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and t.typname = 'workflow_event_type';

  if actual_values is distinct from array[
    'legacy_snapshot_imported', 'stage_entered', 'stage_submitted',
    'stage_approved', 'revision_requested', 'revised_proof_submitted',
    'revision_changes_requested', 'revision_approved', 'stage_skip_requested',
    'stage_skipped', 'stage_skip_rejected', 'stage_skip_cancelled',
    'project_paused', 'project_resumed', 'project_cancelled',
    'project_archived', 'project_unarchived', 'workflow_configuration_updated',
    'admin_override_applied', 'final_delivery_completed'
  ]::text[] then
    raise exception 'Unexpected public.workflow_event_type definition: %', actual_values;
  end if;

  select array_agg(e.enumlabel order by e.enumsortorder)
  into actual_values
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  join pg_catalog.pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and t.typname = 'service_capability_status';

  if actual_values is distinct from array[
    'inferred', 'confirmed', 'needs_review'
  ]::text[] then
    raise exception 'Unexpected public.service_capability_status definition: %', actual_values;
  end if;

  if (select count(*) from public.workflow_stage_definitions) <> 8 then
    raise exception 'workflow_stage_definitions must contain exactly eight rows';
  end if;

  if exists (
    select 1
    from public.workflow_stage_definitions
    where (stage_order in (3, 5, 7)) is distinct from client_controlled
       or (stage_order = 8) is distinct from is_delivery_stage
  ) then
    raise exception 'workflow_stage_definitions seed does not match canonical control semantics';
  end if;

  if exists (select 1 from public.workflow_calendar_exceptions) then
    raise exception 'Step 3A must not seed workflow_calendar_exceptions';
  end if;
end
$phase6$;

-- This migration intentionally defines no persistent function, workflow RPC,
-- trigger, view, policy, environment-specific user, email, UUID, or URL.

-- -----------------------------------------------------------------------------
-- 12 Comments
-- -----------------------------------------------------------------------------

comment on type public.project_lifecycle_status is
  'Canonical Phase 6 project lifecycle; projects.project_status remains nullable until backfill.';
comment on type public.workflow_stage is
  'Canonical eight-stage workflow keys; legacy project state columns remain text in Step 3A.';
comment on type public.workflow_stage_status is
  'Canonical execution/clock status for a workflow stage.';
comment on type public.workflow_waiting_on is
  'Canonical ownership of the next workflow action.';
comment on type public.workflow_revision_status is
  'Canonical revision-round status; legacy revision_requests.status remains text until backfill.';
comment on type public.workflow_skip_status is
  'Canonical manual stage-skip request status.';
comment on type public.workflow_event_type is
  'Immutable workflow history event vocabulary from the Phase 6 design.';
comment on type public.service_capability_status is
  'Whether print/ebook capabilities were inferred, confirmed, or require review.';

comment on column public.projects.project_status is
  'Canonical lifecycle. Intentionally nullable/no default before Phase 6 legacy backfill.';
comment on column public.projects.workflow_stage_key is
  'Nullable canonical stage shadow; current_stage remains compatibility text through frontend cutover.';
comment on column public.projects.workflow_stage_status_key is
  'Nullable canonical execution-state shadow; stage_status remains compatibility text through frontend cutover.';
comment on column public.projects.workflow_waiting_on_key is
  'Nullable canonical waiting-owner shadow; waiting_on remains compatibility text through frontend cutover.';
comment on column public.projects.requires_print is
  'Canonical print capability. Null means unresolved legacy data.';
comment on column public.projects.requires_ebook is
  'Canonical ebook capability. Null means unresolved legacy data.';
comment on column public.projects.workflow_version is
  'Monotonic optimistic-concurrency value; canonical RPC ownership begins in Step 3C.';
comment on column public.projects.production_seconds_total is
  'Future DB-maintained cache; not populated from legacy fields in Step 3A.';
comment on column public.projects.client_wait_seconds_total is
  'Future DB-maintained cache; not populated from legacy fields in Step 3A.';

comment on table public.workflow_stage_definitions is
  'Authoritative Phase 6 stage order and default metadata; structural changes require migrations.';
comment on table public.workflow_calendar_exceptions is
  'Explicit dates override weekend classification; intentionally empty in Step 3A.';
comment on table public.project_stage_history is
  'Additive canonical event-ledger columns coexist with legacy history columns until backfill.';
comment on table public.project_stage_skips is
  'Canonical skip columns coexist with legacy text columns until backfill.';
comment on table public.admin_workflow_overrides is
  'Canonical before/after audit columns coexist with legacy override columns until backfill.';
comment on column public.revision_requests.status is
  'Legacy/frontend compatibility revision status until Phase 6 cutover.';
comment on column public.revision_requests.canonical_status is
  'Nullable Phase 6 revision status shadow populated by Step 3B.';
comment on table public.knowledge_base_documents is
  'Current AI foundation only; knowledge-base naming and authorization repair belong to Phase 6B.';
