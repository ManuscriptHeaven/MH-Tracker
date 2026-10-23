# Compact New Project — staging and release gate

## User-facing scope
- Only the **new** project modal is simplified. Existing project editor and
  canonical Files Received workflow are unchanged.
- Basic: client, project title, service, print/eBook flags, assigned team member,
  total price, advance, notes, optional source attachments.
- Optional extra settings (email, priority, manager, platform) are collapsed.
- All manual stage dates, delivery URLs, payment history and QA details are
  removed from the creation modal, not from existing-project records.
- Private uploads never advance Files Received to Design Concept automatically.

## Database dependency
Apply `supabase/migrations/20261023220000_staff_project_initial_attachments.sql`
on a certified staging DB first. This adds **only** the authenticated INSERT
grant and admin/project-manager INSERT policy to the existing project_initial_files
table. It does not alter client-facing project upload RPCs.

## Required staged checks
1. Create project with 0 attachments. Verify title, client, team assignment,
   print/eBook flags, payments, canonical stage `files_received`, and
   no premature workflow advancement.
2. Create project with 1 and 3 files; confirm private storage files plus
   matching rows with `project_id`, `uploaded_by=auth.uid()`.
3. Open files via manager and permitted client sessions. Ensure an unrelated
   client cannot query project metadata or sign URLs.
4. Admin and project manager may upload; employee, client, and anonymous
   attempts at metadata INSERT must fail. Spoofing `uploaded_by` fails.
5. Check 0-byte files, 101 MB files and 11-file selection rejected.
6. Induce upload failure after project INSERT. Show partial success, do not
   retry creation, then upload separately from Files & Deliverables.
7. Verify existing client source-file submission, receiving-file confirmation,
   stage approvals, legacy file URL editing and complete project edit form
   all remain functional.
8. Test mobile width, keyboard navigation, screen-reader labels and upload
   cancellation; the Save button cannot be double-clicked while saving.
9. Run project creation and Supabase RLS integration tests in staging before
   promoting any DB change to production.

## Production
- Apply only the reviewed migration after staging certification and production
  migration ledger check.
- Deploy frontend using the existing gated Cloudflare pipeline and verify
  the exact build SHA.
- Monitor attachment insert errors and verify no failed upload creates duplicate projects.
