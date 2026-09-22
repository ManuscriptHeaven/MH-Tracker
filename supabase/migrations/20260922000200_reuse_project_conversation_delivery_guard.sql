-- Reuse the existing hardened project-conversation RPC for send-time
-- validation. This removes the temporary public SECURITY DEFINER recipient
-- helper added by the previous migration while preserving the delivery guard.

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
  v_project_id uuid;
  v_validated_conversation_id uuid;
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

  select c.project_id
    into v_project_id
    from public.conversations c
   where c.id = p_conversation_id
     and c.type = 'project_client';

  if v_project_id is not null then
    -- This server RPC validates that the actor may access the project-client
    -- discussion, repairs a uniquely matching client link for authorized
    -- managers when possible, and rejects the conversation when there is no
    -- active client portal recipient.
    v_validated_conversation_id :=
      public.phase6_get_or_create_project_conversation(v_project_id, false);

    if v_validated_conversation_id is distinct from p_conversation_id then
      raise exception 'This is not the canonical client conversation for the project. Reopen the project conversation before sending.'
        using errcode = 'P0001';
    end if;
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

revoke all on function public.phase6_project_client_has_active_recipient(uuid) from public;
revoke all on function public.phase6_project_client_has_active_recipient(uuid) from anon;
revoke all on function public.phase6_project_client_has_active_recipient(uuid) from authenticated;
drop function if exists public.phase6_project_client_has_active_recipient(uuid);
