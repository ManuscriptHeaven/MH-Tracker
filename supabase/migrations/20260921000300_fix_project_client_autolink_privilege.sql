-- The project client auto-link trigger runs as phase6_app_security_owner.
-- It already has a restrictive INSERT RLS policy; grant the matching table privilege.
grant insert on public.client_project_access to phase6_app_security_owner;
