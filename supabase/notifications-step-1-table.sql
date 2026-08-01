create extension if not exists pgcrypto;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  type text not null default 'general',
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications
add column if not exists recipient_id uuid references public.profiles(id) on delete cascade,
add column if not exists project_id uuid references public.projects(id) on delete cascade,
add column if not exists type text not null default 'general',
add column if not exists title text not null default 'Notification',
add column if not exists message text not null default '',
add column if not exists is_read boolean not null default false,
add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'user_id'
  ) then
    update public.notifications
    set recipient_id = user_id
    where recipient_id is null;
  end if;
end $$;

delete from public.notifications
where recipient_id is null;

alter table public.notifications
alter column recipient_id set not null;

drop index if exists public.notifications_user_id_idx;
create index if not exists notifications_recipient_id_idx on public.notifications(recipient_id);
create index if not exists notifications_project_id_idx on public.notifications(project_id);

alter table public.notifications enable row level security;

grant select, insert, update, delete on public.notifications to authenticated;
revoke all on public.notifications from anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception
  when insufficient_privilege then null;
end $$;
