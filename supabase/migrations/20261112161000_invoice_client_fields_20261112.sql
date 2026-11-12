-- Optional invoice display details used by the project form and invoices.
-- Supersedes supabase/phase6/migrations/00662_invoice_client_fields.sql, which
-- added the columns but not the column-level UPDATE grant that the Phase 6
-- allow-list on public.projects requires.
alter table public.projects
  add column if not exists company_name text,
  add column if not exists contact_name text,
  add column if not exists billing_address text,
  add column if not exists author text,
  add column if not exists invoice_description text;

grant update (company_name, contact_name, billing_address, author, invoice_description)
  on public.projects to authenticated;

notify pgrst, 'reload schema';
