-- ============================================================================
-- MH TRACKER: FIX PROJECT_STATUS ENUM TO INCLUDE MODERN STATUSES
-- ============================================================================
-- If you encountered: invalid input value for enum project_status: "Active"
-- Run this SQL in your Supabase SQL Editor to add the standard statuses:

do $$
begin
  alter type public.project_status add value if not exists 'Active';
  alter type public.project_status add value if not exists 'Awaiting Client Approval';
  alter type public.project_status add value if not exists 'Final Delivery';
exception
  when duplicate_object then null;
end $$;
