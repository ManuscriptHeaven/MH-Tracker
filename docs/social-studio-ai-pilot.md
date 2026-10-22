# Social Studio AI pilot — release and QA checklist

Target: MH Tracker admin-only Cloudflare preview, PR #79 (cumulative of PR #78).
Tracking specification: #56. The older PR #57 uses an incompatible social schema;
do not merge its migrations over the deployed pilot tables.

## Features
- Admin can save or edit a marketing-only brand brief.
- Supabase Edge Function social-draft generates editable caption suggestions,
  hashtags, Facebook/Instagram/LinkedIn alternatives and 1080x1350 visual briefs.
- The browser saves caption, artwork brief and AI provenance only when the admin
  chooses a suggestion and presses Save Draft.
- Revising a post creates an immutable revision and revokes former approval.
- Scheduled targets are plans: publishing worker and OAuth do not exist.
- Never enter client manuscripts, client private details or unpublished work
  into the marketing brand brief or topic.

## Deployment
1. Verify this branch passes CI and npm run test:social-studio-ai on Node 22.
2. Apply 20261023003000_social_studio_ai_revision_briefs.sql to the verified
   MH Tracker database. Do not reapply PR #78 migration ledger entries.
3. Verify social table RLS, client and staff denied, immutability and approval
   invalidation after edits.
4. Deploy social-draft Edge Function with verify_jwt=true and server-side
   GEMINI_API_KEY; optional GEMINI_DRAFT_MODEL.
5. Unauthenticated request must fail 401 and non-admin must fail 403.
   Verify an authenticated admin can generate, edit and save a draft.
6. Check Cloudflare preview deployment corresponds to latest PR head SHA.
7. Keep preview separate from main. No external publishing enabled.

## Acceptance checklist
- Desktop and mobile navigation is admin-only.
- Saved brief is used for each generation.
- Missing model secrets or provider errors show actionable errors.
- Captions, hashtags and visual brief can be edited before saving.
- Choosing a platform variant sets the matching post target.
- Editing any post appends revision and invalidates its previous approval.
- All planned dates clearly state they do not automatically publish.
- No secret, client content or unpublished post is sent to public storage.

## Before publishing
Needs private asset storage, OAuth and permission review, worker with
transactional claims and retries, reconciling ambiguous outcomes, account
reconnect and provider URL tracking, and real end-to-end publishing tests.
