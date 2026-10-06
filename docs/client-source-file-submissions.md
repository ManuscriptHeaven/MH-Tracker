# Client source-file shortcut and message-only submission

Client Dashboard, Needs Your Attention, and Projects cards show **Submit Files**
only for canonical active projects in Files Received (pending/active). The shortcut
opens the existing Files & Deliverables form directly; regular details still open
Timeline & Info. No mutation occurs when opening the form or selecting files.

The client may attach files, leave a message confirming files were already sent by
email/WhatsApp, or do both. Without attachments a nonblank message is mandatory.
Submission starts the next canonical production stage. It does not verify delivery
through external services or fetch their files. The UI states that production starts.

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
