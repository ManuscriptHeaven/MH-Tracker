-- Trigger helpers should never be directly callable from the API.
revoke all on function public.phase6_sync_team_channel_membership() from public;
revoke all on function public.phase6_sync_team_channel_membership() from anon;
revoke all on function public.phase6_sync_team_channel_membership() from authenticated;
