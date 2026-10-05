-- Final delivery may be recorded without URLs. Earlier client-approval proof
-- requirements and the canonical completion RPC's authorization stay unchanged.
create or replace function public.workflow_submission_gate()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.workflow_stage_status_key = 'awaiting_client'
     and old.workflow_stage_status_key is distinct from 'awaiting_client' then
    if new.workflow_stage_key = 'concept_approval'
       and nullif(btrim(coalesce(new.cover_file_link,'')), '') is null
       and nullif(btrim(coalesce(new.proof_pdf_link,'')), '') is null then
      raise exception 'workflow_missing_concept_deliverable';
    end if;

    if new.workflow_stage_key = 'print_approval'
       and nullif(btrim(coalesce(new.proof_pdf_link,'')), '') is null
       and nullif(btrim(coalesce(new.final_print_pdf_link,'')), '') is null then
      raise exception 'workflow_missing_print_proof';
    end if;

    if new.workflow_stage_key = 'ebook_approval'
       and nullif(btrim(coalesce(new.final_ebook_link,'')), '') is null then
      raise exception 'workflow_missing_ebook_proof';
    end if;
  end if;

  return new;
end
$function$;
