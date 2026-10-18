-- Run on the certified staging DB AFTER 20261019001000 migration.
-- Catalog contract check only; separately test real admin/employee/client JWT sessions.
-- Read-only: no fixtures, no Auth user changes, no mutation.
DO $$
DECLARE
  t text;
  policy_count integer;
  p_expr text;
  p_check text;
BEGIN
  FOREACH t IN ARRAY ARRAY['knowledge_base_documents', 'knowledge_base_chunks'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'Missing AI knowledge table %', t;
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION 'RLS disabled on %', t;
    END IF;

    SELECT count(*) INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = t;
    IF policy_count <> 1 THEN
      RAISE EXCEPTION '% must have exactly one admin-only policy, found %', t, policy_count;
    END IF;

    SELECT pg_get_expr(p.polqual, p.polrelid),
           pg_get_expr(p.polwithcheck, p.polrelid)
      INTO p_expr, p_check
      FROM pg_policy p
     WHERE p.polrelid = to_regclass('public.' || t)
       AND p.polname = CASE t
         WHEN 'knowledge_base_documents' THEN 'AI knowledge documents admin only'
         ELSE 'AI knowledge chunks admin only'
       END;

    IF p_expr IS NULL OR p_check IS NULL
       OR p_expr NOT ILIKE '%phase6_app_actor_class%'
       OR p_check NOT ILIKE '%phase6_app_actor_class%'
       OR p_expr NOT LIKE '%admin%'
       OR p_check NOT LIKE '%admin%' THEN
      RAISE EXCEPTION '% does not enforce app-admin authorization on reads AND writes', t;
    END IF;
  END LOOP;
END
$$;
