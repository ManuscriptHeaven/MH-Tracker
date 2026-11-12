do $mh_tracker_client_revision_flow$
begin
  begin
    execute 'alter type public.project_status add value if not exists ''Archived''';
  exception
    when duplicate_object then null;
  end;

  execute 'alter table public.revision_requests
    add column if not exists instructions text not null default '''',
    add column if not exists team_response text';

  execute 'update public.revision_requests
    set instructions = coalesce(nullif(instructions, ''''), description, title)
    where instructions = ''''';

  execute $sql$
    create or replace view public.client_revision_requests as
    select
      request.id,
      request.project_id,
      request.client_id,
      request.title,
      request.description,
      request.instructions,
      request.team_response,
      request.priority,
      request.status,
      request.submitted_at,
      request.completed_at,
      request.created_at,
      request.updated_at
    from public.revision_requests request
    where request.client_id = auth.uid()
  $sql$;

  execute 'grant select on public.client_revision_requests to authenticated';
  execute 'drop policy if exists "Clients can read own revision requests" on public.revision_requests';
  execute 'create policy "Clients can read own revision requests"
    on public.revision_requests
    for select
    to authenticated
    using (client_id = auth.uid())';
end
$mh_tracker_client_revision_flow$;
