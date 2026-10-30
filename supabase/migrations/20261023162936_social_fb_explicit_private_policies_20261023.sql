-- Explicitly document denial of browser access to confidential OAuth state and
-- Vault token references. Service role bypasses RLS for server-only functions.
create policy social_fb_oauth_browser_denied
on public.social_facebook_oauth_states for select to authenticated using(false);
create policy social_fb_token_refs_browser_denied
on public.social_facebook_token_refs for select to authenticated using(false);
