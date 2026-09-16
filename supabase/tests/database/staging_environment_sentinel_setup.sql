-- ============================================================================
-- One-Time Staging/Test Database Sentinel Setup
-- DO NOT RUN ON PRODUCTION.
-- This script provisions the non-production environment guard required by
-- task_management_v2.test.sql and other automated database test suites.
-- ============================================================================

create table if not exists public.phase6_test_environment_guard (
  environment text primary key check (environment in ('staging', 'test')),
  created_at timestamptz not null default clock_timestamp()
);

-- Revoke write privileges from public / authenticated roles to maintain immutability
revoke all on public.phase6_test_environment_guard from public, anon, authenticated;
grant select on public.phase6_test_environment_guard to public, anon, authenticated, service_role;

-- Seed staging environment identifier
insert into public.phase6_test_environment_guard(environment)
values ('staging')
on conflict (environment) do nothing;
