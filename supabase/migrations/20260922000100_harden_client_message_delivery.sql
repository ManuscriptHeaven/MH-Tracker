-- Harden client-facing message delivery so an existing/cached project-client
-- conversation cannot accept outbound messages when there is no active linked
-- client portal recipient.

create or replace function public.phase6_project_client_has_active_recipient(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select public.phase6_auth_uid() is not null
    and public.phase6_can_access_conversation(p_conversation_id)
    and exists (
      select 1
      from public.conversations c
      join public.conversation_members cm
        on cm.conversation_id = c.id
      join public.profiles p
        on p.id = cm.user_id
       and p.role::text = 'client'
       and p.status = 'active'
      join public.projects project
        on project.id = c.project_id
      where c.id = p_conversation_id
        and c.type = 'project_client'
        and (
          project.client_profile_id = p.id
          or exists (
            select 1
            from public.client_project_access a
            where a.project_id = project.id
              and a.client_id = p.id
          )
        )
    )
$function$;

revoke all on function public.phase6_project_client_has_active_recipient(uuid) from public;
revoke all on function public.phase6_project_client_has_active_recipient(uuid) from anon;
grant execute on function public.phase6_project_client_has_active_recipient(uuid) to authenticated;

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

  if exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.type = 'project_client'
  )
  and not public.phase6_project_client_has_active_recipient(p_conversation_id) then
    raise exception 'No active client portal recipient is linked to this project conversation. Link the client before sending.'
      using errcode = 'P0001';
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
