-- Migration: Add Invoice columns to projects table
alter table public.projects add column if not exists invoiced boolean default false;
alter table public.projects add column if not exists invoice_id text;
alter table public.projects add column if not exists invoiced_at timestamptz;

-- Re-create client_project_summaries view if exists to include new columns
create or replace view public.client_project_summaries as
select 
  p.*
from public.projects p;
