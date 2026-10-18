# Client source-file shortcut and message-only submission

Client Dashboard, Needs Your Attention, and Projects cards show **Submit Files**
only for canonical active projects in Files Received (pending/active). The shortcut
opens the existing Files & Deliverables form directly; regular details still open
Timeline & Info. No mutation occurs when opening the form or selecting files.

The client may attach files, leave a message confirming files were already sent by
email/WhatsApp, or do both. Without attachments a nonblank message is mandatory.
Submission starts the next canonical production stage. It does not verify delivery
through external services or fetch their files. The UI states that production starts.

## Team confirmation of files already received

The team dashboard and project details offer **Files Already Received — Start
Design Concept** while intake is pending (or in a legacy active intake state).
Admins, project managers, and the assigned employee may record receipt through
Email, WhatsApp, or Other. Other requires receipt details. The confirmation screen
explains that it starts production; selecting a channel or opening the screen
does not change the project.

The action uses the existing `workflow_advance_stage` RPC. Migration
`20261018162003_team_confirm_received_files.sql` changes its intake transition to
complete both pending and active intake in one transaction, preserving existing
authorization, optimistic version checks, idempotency receipts, routing (including
approved future skips), timers, notifications, and audit history. A nonblank receipt
note is mandatory. Intake completion stamps `files_received_date` and
`requirements_submitted_at`; it never creates an attachment for files received
elsewhere. The source and receipt note are recorded in workflow history.

Waiting intake displays **Waiting for Files**. Progress stays at **0%** for both
intake and active Design Concept, including after client uploads or team receipt.
Concept submission starts progress at the existing **35%** Concept Approval
milestone. Canonical stage names are unchanged; waiting wording is a display label.

Apply the team-confirmation migration before releasing its frontend. The old RPC
does not complete pending intake in one call. No existing projects are advanced
automatically. Production migration/deployment needs explicit approval.

## Backend change and deployment

`20261006062254_optional_client_source_files.sql` narrowly patches the existing
`workflow_client_submit_files` definition. It fails closed on unexpected definition
drift. Client access, active lifecycle, workflow version, receipts, timer/routing,
history, notifications, function owner/ACL/search path remain unchanged.

Message-only submissions create **no artificial attachment**. The note stays in
workflow history and is also inserted atomically into the team's existing
`project_notes` as `client_instruction`. Receipt replay precedes insertion so a
retry cannot duplicate notes or notifications. The existing non-login workflow RPC
owner gains only INSERT on project_notes with a scoped owner-only RLS policy that
checks note type, client identity and project access. No ordinary caller grants or
existing RLS policies are changed; clients cannot directly insert project notes.

Apply the reviewed migration before deploying the frontend. Until it is applied,
the old backend rejects message-only submissions. Do not merge/deploy only the UI
and claim that message-only submission works. No existing project records require
backfill. Production migration/deployment needs explicit approval.

## Verification

- `npm test` includes the new client submission checks via pretest.
- `npm run build` checks TypeScript and production bundling.
- `npm run test:file-intake` checks waiting labels, progress milestones, receipt
  details and team action eligibility.
- `node scripts/team-file-receipt-database-tests.mjs <file-URL-to-pglite/dist/index.js>`
  exercises the real team RPC and migration with synthetic rows and isolated
  helper contracts: both intake states, role/project access, lifecycle, version
  conflicts, atomic routing, receipt audit, clocks, retries and approved skips.
- A disposable in-memory Postgres harness runs the actual original RPC plus the
  migration, with isolated synthetic rows and mocked canonical helpers. This is
  not a full Supabase/Auth/RLS integration test and never connects to production.

To run the database harness, obtain PGlite 0.3.14 from npm using
`npx --yes --package=@electric-sql/pglite@0.3.14 node -p process.env.PATH`, locate
that temporary package's node_modules directory, then run:

`node scripts/client-file-submission-database-tests.mjs <file-URL-to-pglite/dist/index.js>`

Cases: files/no-note, no-files/note, blank/missing note, malformed file array,
too many files, unauthorized actor, lifecycle/other stage rejection, stale version,
canonical transition, auditable note, empty attachment IDs, one notification/receipt,
idempotent replay, owner/ACL/search-path preservation, and definition drift.
