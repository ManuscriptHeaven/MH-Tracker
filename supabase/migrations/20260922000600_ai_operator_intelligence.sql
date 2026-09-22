-- AI Operator Intelligence telemetry
-- Privacy-minimized operational events only: no raw prompts or assistant message bodies.

create table if not exists public.ai_operator_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid null references public.ai_conversations(id) on delete set null,
  event_type text not null check (
    event_type in ('query_result', 'action_confirmed', 'action_cancelled', 'action_failed')
  ),
  tool_name text null,
  success boolean not null default true,
  error_code text null,
  requires_confirmation boolean not null default false,
  was_clarification boolean not null default false,
  had_disambiguation boolean not null default false,
  verification_status text null check (
    verification_status is null or verification_status in ('verified', 'unverified', 'failed')
  ),
  plan_step_count integer not null default 0 check (plan_step_count between 0 and 4),
  latency_ms integer not null default 0 check (latency_ms between 0 and 120000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ai_operator_events enable row level security;

revoke all on table public.ai_operator_events from anon;
revoke all on table public.ai_operator_events from authenticated;
grant select, insert on table public.ai_operator_events to authenticated;
grant all on table public.ai_operator_events to service_role;

drop policy if exists "ai_operator_events_insert_own" on public.ai_operator_events;
create policy "ai_operator_events_insert_own"
on public.ai_operator_events
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "ai_operator_events_select_own_or_admin" on public.ai_operator_events;
create policy "ai_operator_events_select_own_or_admin"
on public.ai_operator_events
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or (select public.phase6_app_actor_class()) = 'admin'
);

create index if not exists idx_ai_operator_events_created_at
  on public.ai_operator_events (created_at desc);

create index if not exists idx_ai_operator_events_user_created
  on public.ai_operator_events (user_id, created_at desc);

create index if not exists idx_ai_operator_events_tool_created
  on public.ai_operator_events (tool_name, created_at desc)
  where tool_name is not null;
