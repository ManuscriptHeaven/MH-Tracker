-- Disposable PostgreSQL 17 integration fixture: NO production data.
create schema if not exists auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.profiles(id uuid primary key,role text not null,status text not null);
insert into public.profiles values
 ('00000000-0000-4000-8000-000000000001','admin','active'),
 ('00000000-0000-4000-8000-000000000002','project_manager','active'),
 ('00000000-0000-4000-8000-000000000003','employee','active'),
 ('00000000-0000-4000-8000-000000000004','client','active'),
 ('00000000-0000-4000-8000-000000000005','admin','inactive');
create function public.phase6_auth_uid() returns uuid language sql stable as $$ select auth.uid() $$;
-- Same role mapping and active-status check as the deployed MH function.
create function public.phase6_app_actor_class() returns text language sql stable security definer
 set search_path to 'pg_catalog','pg_temp' as $$
  select case p.role::text
    when 'admin' then 'admin' when 'project_manager' then 'project_manager'
    when 'manager' then 'project_manager' when 'employee' then 'employee'
    when 'junior_assistant' then 'employee' when 'client' then 'client'
    else null end
  from public.profiles p where p.id=public.phase6_auth_uid() and p.status='active' limit 1
$$;
create table public.knowledge_base_documents(id uuid primary key, title text not null, contents text not null);
create table public.knowledge_base_chunks(id uuid primary key, document_id uuid not null, contents text not null);
alter table public.knowledge_base_documents enable row level security;
alter table public.knowledge_base_chunks enable row level security;
insert into public.knowledge_base_documents values('10000000-0000-4000-8000-000000000001','Pricing SOP','CONFIDENTIAL');
insert into public.knowledge_base_chunks values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','CONFIDENTIAL VECTOR CHUNK');
-- Deliberately reproduce the insecure production policy names, then apply
-- the exact migration to prove it replaces them rather than layering over.
create policy "All authenticated users can read knowledge_base_documents"
 on public.knowledge_base_documents for select to authenticated using (true);
create policy "Admin can insert/update/delete knowledge_base_documents"
 on public.knowledge_base_documents for all to authenticated
 using ((auth.uid())::text='never_matches') with check ((auth.uid())::text='never_matches');
create policy "All authenticated users can read knowledge_base_chunks"
 on public.knowledge_base_chunks for select to authenticated using (true);
create policy "Admin or service role can insert chunks"
 on public.knowledge_base_chunks for insert to authenticated
 with check (false);
grant usage on schema public,auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
grant execute on function public.phase6_auth_uid() to authenticated,anon;
grant execute on function public.phase6_app_actor_class() to authenticated,anon;
grant select on public.profiles to authenticated;
grant select,insert,update,delete on public.knowledge_base_documents,public.knowledge_base_chunks to authenticated;
revoke all on public.knowledge_base_documents,public.knowledge_base_chunks from anon;
