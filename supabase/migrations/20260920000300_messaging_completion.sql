-- Messaging completion: private file storage + atomic message send metadata.

alter table public.message_attachments
  add column if not exists storage_path text;

insert into storage.buckets (id, name, public, file_size_limit)
values ('message-files', 'message-files', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "Message members can read message files" on storage.objects;
create policy "Message members can read message files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'message-files'
  and public.phase6_can_access_conversation(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
);

drop policy if exists "Message members can upload own message files" on storage.objects;
create policy "Message members can upload own message files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'message-files'
  and (storage.foldername(name))[2] = auth.uid()::text
  and public.phase6_can_access_conversation(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
);

drop policy if exists "Message senders can delete own message files" on storage.objects;
create policy "Message senders can delete own message files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'message-files'
  and (storage.foldername(name))[2] = auth.uid()::text
  and public.phase6_can_access_conversation(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
);

create or replace function public.phase6_send_message(
  p_message_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_parent_message_id uuid default null,
  p_attachments jsonb default '[]'::jsonb,
  p_mentioned_user_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_attachment jsonb;
  v_mention_id uuid;
  v_storage_path text;
  v_body text := coalesce(p_body, '');
begin
  if v_actor_id is null then
    raise exception 'phase6_not_authenticated' using errcode = '42501';
  end if;

  if p_message_id is null or p_conversation_id is null then
    raise exception 'phase6_invalid_message_identity' using errcode = '22023';
  end if;

  if not public.phase6_can_access_conversation(p_conversation_id) then
    raise exception 'phase6_conversation_access_denied' using errcode = '42501';
  end if;

  if p_parent_message_id is not null
     and not public.phase6_parent_message_matches(p_parent_message_id, p_conversation_id) then
    raise exception 'phase6_invalid_parent_message' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'phase6_invalid_attachments' using errcode = '22023';
  end if;

  if btrim(v_body) = ''
     and jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) = 0 then
    raise exception 'phase6_empty_message' using errcode = '22023';
  end if;

  insert into public.messages(
    id,
    conversation_id,
    sender_id,
    body,
    parent_message_id
  )
  values (
    p_message_id,
    p_conversation_id,
    v_actor_id,
    btrim(v_body),
    p_parent_message_id
  );

  for v_attachment in
    select value
    from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb))
  loop
    v_storage_path := nullif(v_attachment->>'storage_path', '');

    if nullif(v_attachment->>'id', '') is null
       or nullif(v_attachment->>'file_name', '') is null
       or nullif(v_attachment->>'file_type', '') is null
       or v_storage_path is null then
      raise exception 'phase6_invalid_attachment_metadata' using errcode = '22023';
    end if;

    if v_storage_path not like p_conversation_id::text || '/' || v_actor_id::text || '/%' then
      raise exception 'phase6_invalid_attachment_path' using errcode = '42501';
    end if;

    insert into public.message_attachments(
      id,
      message_id,
      file_name,
      file_url,
      file_type,
      file_size,
      storage_path
    )
    values (
      (v_attachment->>'id')::uuid,
      p_message_id,
      v_attachment->>'file_name',
      coalesce(v_attachment->>'file_url', ''),
      v_attachment->>'file_type',
      greatest(coalesce((v_attachment->>'file_size')::bigint, 0), 0),
      v_storage_path
    );
  end loop;

  foreach v_mention_id in array coalesce(p_mentioned_user_ids, '{}'::uuid[])
  loop
    if v_mention_id is distinct from v_actor_id
       and public.phase6_conversation_target_eligible(p_conversation_id, v_mention_id) then
      insert into public.message_mentions(message_id, user_id)
      values (p_message_id, v_mention_id)
      on conflict do nothing;
    end if;
  end loop;

  return p_message_id;
end
$function$;

revoke all on function public.phase6_send_message(uuid, uuid, text, uuid, jsonb, uuid[]) from public;
revoke all on function public.phase6_send_message(uuid, uuid, text, uuid, jsonb, uuid[]) from anon;
grant execute on function public.phase6_send_message(uuid, uuid, text, uuid, jsonb, uuid[]) to authenticated;
