# Social Studio Phase 6 — Facebook connection and fake delivery

Tracking: #56. Historical foundation PR: #87; current focused connection UI: Phase 7.
Status: **DRY RUN ONLY**, never enable real posting from this release.

## Operator setup needed for an actual Facebook authorization

Create / configure a Meta developer app that supports Facebook Login for Pages.
Request the permissions appropriate for authorized Page posting:

- pages_show_list — enumerate Pages the signed-in user manages
- pages_read_engagement — Page post access dependency
- pages_manage_posts — publish only on managed Pages

For users outside Meta app roles / testing, Meta App Review, Advanced Access and
business verification may be required. Obtain app-owner authorization in Meta.
Do not paste the Meta App Secret or Page access tokens into GitHub, chat, or Vite
environment variables. Use Supabase Edge Function secrets only.

For project emhvwdhdmajpakoscuyn, the **exact Meta Valid OAuth Redirect URI** is:

https://emhvwdhdmajpakoscuyn.supabase.co/functions/v1/social-facebook-connect

Set these Supabase Edge Function secrets:

- META_APP_ID — Meta application numeric ID
- META_APP_SECRET — server-only application secret
- META_OAUTH_REDIRECT_URI — the exact URI above
- SOCIAL_FB_RETURN_URL — trusted MH Tracker preview return URL (see latest PR
  deployment; for this branch https://feature-social-fb-connection.mh-tracker.pages.dev)
- SOCIAL_WORKER_SECRET — random 32+ byte secret for future server-to-server cron

Supabase automatically provides SUPABASE_URL, SUPABASE_ANON_KEY and
SUPABASE_SERVICE_ROLE_KEY to supported Edge Function deployments. Verify their
presence server-side only.

Do NOT set SOCIAL_PUBLISH_MODE=facebook or SOCIAL_ENABLE_LIVE_PUBLISH=true
during the pilot. No Page connection can enable real publishing from the browser.
The connection SQL defaults publish_enabled=false and the Page token is stored
encrypted in Supabase Vault. The returned UI receives only Page name and ID.

The OAuth function runs with verify_jwt=false **only** because Meta redirects a
browser without a Supabase JWT. POST/start/disconnect manually validate a live
Supabase session and admin role. GET/callback accepts only an unguessable,
one-time, 10-minute state bound to the admin and brand; callback destination is
a trusted server configuration value and is never taken from URL parameters.

## Test in preview

1. Log in as an MH Tracker admin and open Social Media Studio.
2. Select the Manuscript Heaven brand. The Facebook Connection panel must show
   disconnected or previously authorized Pages. No tokens must be visible.
3. Enter the numeric Page ID if the account manages more than one Page.
4. Click Connect through Facebook. In a configured Meta development app, the
   Page admin/tester authorizes in the Facebook-owned UI. After redirect,
   verify only the intended Page is connected and publish_enabled is false.
5. Create a Facebook draft, submit for review, approve the **exact latest**
   revision and schedule a time in the future.
6. Once that time is reached, click Run due dry-run. It must record a
   'simulated' delivery receipt **without any Graph API posting**.
7. Edit an approved draft. Its approval and future queue must be withdrawn.
8. Withdraw artwork rights. Scheduled jobs tied to the approved image must
   stop. Attempt to read private records from a client or team login: denied.
9. Disconnect a Page. Vault Page token ref is removed; posting remains blocked.

## Delivery correctness rules

- Only Facebook targets with status=scheduled, exact approved revision and
  exact scheduled timestamp enqueue jobs.
- Queue entries are unique per target/revision/scheduled instant. Duplicate
  workers lock jobs using SKIP LOCKED with a lease UUID.
- Only backend service role can claim and finalize jobs.
- Manual admin invocation is always fake and only claims that admin's work.
- If a worker loses a response, it leaves the outcome 'unknown' for manual
  reconciliation; it never blindly reposts to Facebook.
- Live mode requires all of: trusted worker secret, worker mode=scheduled-worker,
  SOCIAL_PUBLISH_MODE=facebook, SOCIAL_ENABLE_LIVE_PUBLISH=true, exactly one
  connected Page with publish_enabled=true, approved current revision and
  approved image rights. The pilot has no UI to enable that last server gate.
- Media is always downloaded from the private Storage bucket. Never expose a
  public photo URL for unpublished content.

## Release gates before real publishing

1. Verify authenticated Meta OAuth on the exact live preview URL with app owner.
2. Inspect a real Graph Page permission/token and reconnect/disconnect flow.
3. Exercise fake worker with scheduled due jobs across manual trigger and
   a concurrency/failure/recovery test on an isolated database.
4. Verify Page token encryption and app token rotation; handle permission expiry.
5. Add reconciliation and operator restart procedures for unknown outcomes.
6. Add a scheduled trusted worker using pg_cron/pg_net/Vault or Cloudflare Cron,
   and test a paused/disabled worker condition.
7. Run an explicitly approved single test Page post with known artwork and
   capture its post URL; confirm no duplicate result; get stakeholder approval.
8. Only then evaluate live feature flag and merge the release.

The Supabase migrations 20261023162654 and 20261023162936 were already applied to the
connected database in the previous pilot; files are restored here for source parity.
Do not apply these migrations twice to the same database.

No automatic real publishing, analytics, or cross-platform posting is
enabled by this PR.
