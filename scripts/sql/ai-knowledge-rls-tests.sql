-- SQL integration: use the real migration against disposable PostgreSQL,
-- exercising PostgREST's authenticated and anon SQL roles (no live accounts).
create function public.try_insert_knowledge() returns boolean language plpgsql security invoker
set search_path=public,pg_temp as $$
begin
 insert into public.knowledge_base_documents(id,title,contents)
 values('10000000-0000-4000-8000-000000000002','Test','Restricted');
 return true;
exception when insufficient_privilege then return false;
end $$;
grant execute on function public.try_insert_knowledge() to authenticated,anon;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
do $$
declare documents integer; chunks integer; updated integer;
begin
 select count(*) into documents from public.knowledge_base_documents;
 select count(*) into chunks from public.knowledge_base_chunks;
 if documents<>1 or chunks<>1 then raise exception 'Active admin must read both knowledge resources'; end if;
 if not public.try_insert_knowledge() then raise exception 'Active admin must be allowed to insert'; end if;
 update public.knowledge_base_documents set title='Updated' where contents='Restricted';
 get diagnostics updated=row_count;
 if updated<>1 then raise exception 'Active admin must be allowed to update'; end if;
end $$;
reset role;

-- Manager, employee, client, suspended admin may not read or modify ANY
-- rows, even though they are all authenticated users.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
do $$
declare n integer; changed integer;
begin
 select count(*) into n from public.knowledge_base_documents;
 if n<>0 then raise exception 'Manager can read documents'; end if;
 select count(*) into n from public.knowledge_base_chunks;
 if n<>0 then raise exception 'Manager can read chunks'; end if;
 if public.try_insert_knowledge() then raise exception 'Manager inserted a document'; end if;
 update public.knowledge_base_documents set title='leak';
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Manager changed a document'; end if;
 delete from public.knowledge_base_chunks;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Manager deleted a chunk'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
do $$
declare n integer;
begin
 select count(*) into n from public.knowledge_base_documents;
 if n<>0 then raise exception 'Employee can read documents'; end if;
 select count(*) into n from public.knowledge_base_chunks;
 if n<>0 then raise exception 'Employee can read chunks'; end if;
 if public.try_insert_knowledge() then raise exception 'Employee inserted'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
do $$
declare n integer;
begin
 select count(*) into n from public.knowledge_base_documents;
 if n<>0 then raise exception 'Client can read documents'; end if;
 select count(*) into n from public.knowledge_base_chunks;
 if n<>0 then raise exception 'Client can read chunks'; end if;
 if public.try_insert_knowledge() then raise exception 'Client inserted'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',false);
do $$
declare n integer;
begin
 select count(*) into n from public.knowledge_base_documents;
 if n<>0 then raise exception 'Suspended admin can read documents'; end if;
 select count(*) into n from public.knowledge_base_chunks;
 if n<>0 then raise exception 'Suspended admin can read chunks'; end if;
 if public.try_insert_knowledge() then raise exception 'Suspended admin inserted'; end if;
end $$;
reset role;

set role anon;
select set_config('request.jwt.claim.sub','',false);
do $$
begin
 if has_table_privilege('anon','public.knowledge_base_documents','SELECT')
    or has_table_privilege('anon','public.knowledge_base_chunks','SELECT') then
   raise exception 'Anonymous access to knowledge tables must be revoked';
 end if;
end $$;
reset role;

do $$
declare t text; n integer; p text;
begin
 foreach t in array array['knowledge_base_documents','knowledge_base_chunks'] loop
  select count(*), string_agg(coalesce(qual,''),'|') into n,p
  from pg_policies where schemaname='public' and tablename=t;
  if n<>1 or p not like '%phase6_app_actor_class%' then
    raise exception 'Knowledge table % has unexpected or permissive policies: % / %',t,n,p;
  end if;
 end loop;
end $$;
select 'Knowledge RLS passed for admin, manager, employee, client, suspended, anon' as result;
