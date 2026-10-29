-- AI Assistant Phase 1 security hardening.
-- This is a fail-closed interim rule until tenant-scoped knowledge access exists.
-- The current knowledge tables have no workspace/tenant ownership columns.
-- Do not expose internal SOP/pricing/chunks to every signed-in user.
--
-- RELEASE GATE: verify role-based PostgreSQL tests and inspect actual production\n-- schema/policies/grants/migration history before applying. Staging may require\n-- paid restoration, so never promote an unverified Edge Function as a substitute.

DO $$
BEGIN
  IF to_regprocedure('public.phase6_app_actor_class()') IS NULL THEN
    RAISE EXCEPTION 'Phase 6 actor classification is required for the AI knowledge boundary';
  END IF;
END
$$;

ALTER TABLE public.knowledge_base_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_base_chunks ENABLE ROW LEVEL SECURITY;

-- Old bootstrap granted anonymous users table privileges. RLS still blocked
-- them, but remove that unnecessary Data API capability as defense in depth.
-- Keep authenticated/service_role privileges intact for the audited policy.
REVOKE ALL ON TABLE public.knowledge_base_documents, public.knowledge_base_chunks FROM anon, PUBLIC;

DROP POLICY IF EXISTS "All authenticated users can read knowledge_base_documents"
  ON public.knowledge_base_documents;
DROP POLICY IF EXISTS "Admin can insert/update/delete knowledge_base_documents"
  ON public.knowledge_base_documents;
DROP POLICY IF EXISTS "AI knowledge documents admin only"
  ON public.knowledge_base_documents;

CREATE POLICY "AI knowledge documents admin only"
  ON public.knowledge_base_documents
  FOR ALL TO authenticated
  USING ((SELECT public.phase6_app_actor_class()) = 'admin')
  WITH CHECK ((SELECT public.phase6_app_actor_class()) = 'admin');

DROP POLICY IF EXISTS "All authenticated users can read knowledge_base_chunks"
  ON public.knowledge_base_chunks;
DROP POLICY IF EXISTS "Admin or service role can insert chunks"
  ON public.knowledge_base_chunks;
DROP POLICY IF EXISTS "AI knowledge chunks admin only"
  ON public.knowledge_base_chunks;

CREATE POLICY "AI knowledge chunks admin only"
  ON public.knowledge_base_chunks
  FOR ALL TO authenticated
  USING ((SELECT public.phase6_app_actor_class()) = 'admin')
  WITH CHECK ((SELECT public.phase6_app_actor_class()) = 'admin');

-- Keep service-role activity internal; client connections must use the caller's JWT,
-- not a privileged service-role client, when reading these tables.
COMMENT ON TABLE public.knowledge_base_documents
  IS 'MH AI knowledge documents; admin-only until tenant-aware authorization is implemented.';
COMMENT ON TABLE public.knowledge_base_chunks
  IS 'MH AI vector chunks; admin-only until tenant-aware authorization is implemented.';
