-- Optional invoice display details. Existing project records remain valid.
alter table public.projects
  add column if not exists company_name text,
  add column if not exists contact_name text,
  add column if not exists billing_address text,
  add column if not exists author text,
  add column if not exists invoice_description text;
