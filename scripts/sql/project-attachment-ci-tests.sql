-- Executed on disposable PostgreSQL 17 after the real migration.
-- Assert caller identity, per-project authorization, and storage-path/size checks.

CREATE FUNCTION public.try_attachment_insert(
  fid uuid, pid uuid, uploader uuid, filename text, storagepath text, bytes bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.project_initial_files
    (id,project_id,uploaded_by,file_name,file_type,file_size,storage_path)
  VALUES(fid,pid,uploader,filename,'application/pdf',bytes,storagepath);
  RETURN true;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION public.try_attachment_insert(uuid,uuid,uuid,text,text,bigint) TO authenticated,anon;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
DO $$
BEGIN
IF NOT public.try_attachment_insert(
 '00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101',
 '00000000-0000-4000-8000-000000000001','admin.pdf',
 '00000000-0000-4000-8000-000000000101/00000000-0000-4000-8000-000000000001/admin.pdf',1024
) THEN RAISE EXCEPTION 'Active admin should upload'; END IF;

IF public.try_attachment_insert(
 '00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000101',
 '00000000-0000-4000-8000-000000000003','spoof.pdf',
 '00000000-0000-4000-8000-000000000101/00000000-0000-4000-8000-000000000003/spoof.pdf',1024
) THEN RAISE EXCEPTION 'Admin must not spoof uploaded_by'; END IF;

IF public.try_attachment_insert(
 '00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000101',
 '00000000-0000-4000-8000-000000000001','mismatch.pdf',
 '00000000-0000-4000-8000-000000000102/00000000-0000-4000-8000-000000000001/mismatch.pdf',1024
) THEN RAISE EXCEPTION 'Storage path must match project ID'; END IF;

IF public.try_attachment_insert(
 '00000000-0000-4000-8000-000000000204','00000000-0000-4000-8000-000000000101',
 '00000000-0000-4000-8000-000000000001','other-user.pdf',
 '00000000-0000-4000-8000-000000000101/00000000-0000-4000-8000-000000000002/other-user.pdf',1024
) THEN RAISE EXCEPTION 'Storage path must match uploader'; END IF;

IF public.try_attachment_insert(
 '00000000-0000-4000-8000-000000000205','00000000-0000-4000-8000-000000000101',
 '00000000-0000-4000-8000-000000000001','oversized.pdf',
 '00000000-0000-4000-8000-000000000101/00000000-0000-4000-8000-000000000001/oversized.pdf',104857601
) THEN RAISE EXCEPTION 'Oversized metadata must fail'; END IF;

IF public.try_attachment_insert(
 '00000000-0000-4000-8000-000000000206','00000000-0000-4000-8000-000000000101',
 '00000000-0000-4000-8000-000000000001','empty.pdf',
 '00000000-0000-4000-8000-000000000101/00000000-0000-4000-8000-000000000001/empty.pdf',0
) THEN RAISE EXCEPTION 'Empty metadata must fail'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
DO $$
BEGIN
IF NOT public.try_attachment_insert(
 '00000000-0000-4000-8000-000000000207','00000000-0000-4000-8000-000000000102',
 '00000000-0000-4000-8000-000000000002','manager.pdf',
 '00000000-0000-4000-8000-000000000102/00000000-0000-4000-8000-000000000002/manager.pdf',2048
) THEN RAISE EXCEPTION 'Active project manager should upload'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
DO $$
BEGIN
IF public.try_attachment_insert(
 '00000000-0000-4000-8000-000000000208','00000000-0000-4000-8000-000000000101',
 '00000000-0000-4000-8000-000000000003','employee.pdf',
 '00000000-0000-4000-8000-000000000101/00000000-0000-4000-8000-000000000003/employee.pdf',1024
) THEN RAISE EXCEPTION 'Employee must not upload metadata using manager policy'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
DO $$
BEGIN
IF public.try_attachment_insert(
 '00000000-0000-4000-8000-000000000209','00000000-0000-4000-8000-000000000101',
 '00000000-0000-4000-8000-000000000004','client.pdf',
 '00000000-0000-4000-8000-000000000101/00000000-0000-4000-8000-000000000004/client.pdf',1024
) THEN RAISE EXCEPTION 'Client must not upload staff metadata'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',false);
DO $$
BEGIN
IF public.try_attachment_insert(
 '00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000101',
 '00000000-0000-4000-8000-000000000005','inactive-admin.pdf',
 '00000000-0000-4000-8000-000000000101/00000000-0000-4000-8000-000000000005/inactive-admin.pdf',1024
) THEN RAISE EXCEPTION 'Inactive admin must not upload'; END IF;
END $$;
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$
BEGIN
IF public.try_attachment_insert(
 '00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000101',
 '00000000-0000-4000-8000-000000000001','anonymous.pdf',
 '00000000-0000-4000-8000-000000000101/00000000-0000-4000-8000-000000000001/anonymous.pdf',1024
) THEN RAISE EXCEPTION 'Anonymous users must not insert metadata'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE actual_count bigint;
BEGIN
  SELECT count(*) INTO actual_count FROM public.project_initial_files;
  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two successful writes, got %', actual_count;
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='project_initial_files' AND policyname='project_initial_files_staff_insert') <> 1 THEN
    RAISE EXCEPTION 'Staff insert policy missing';
  END IF;
END $$;
SELECT 'Project attachments: disposable JWT/RLS simulations passed' AS result;
