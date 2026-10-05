// Emit a rollback-only database regression query. It tests the exact migration
// function in pg_temp, never installs it on public.projects or changes real rows.
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20261005075450_optional_final_delivery_links.sql', import.meta.url), 'utf8');
if (!migration.includes('public.workflow_submission_gate()')) throw new Error('Submission gate not found');
const temporaryGate = migration.replace('public.workflow_submission_gate()', 'pg_temp.optional_final_gate()');

console.log(`
begin;
create temporary table optional_final_gate_test (
  id integer primary key,
  project_status text default 'active',
  workflow_stage_key text default 'final_delivery',
  workflow_stage_status_key text default 'active',
  requires_print boolean, requires_ebook boolean,
  cover_file_link text, proof_pdf_link text,
  final_print_pdf_link text, final_ebook_link text
);
${temporaryGate}
create trigger optional_final_gate_test_trigger
before update on optional_final_gate_test
for each row execute function pg_temp.optional_final_gate();

insert into optional_final_gate_test (id, requires_print, requires_ebook, final_print_pdf_link, final_ebook_link)
values (1, true, false, null, null), (2, false, true, '', ''), (3, true, true, '  ', '  ');
update optional_final_gate_test set project_status = 'completed';
do $test$
declare stage text; expected_error text; actual_error text;
begin
  if (select count(*) from optional_final_gate_test where project_status = 'completed') <> 3 then
    raise exception 'Blank final links must allow all three service combinations';
  end if;
  for stage, expected_error in
    select * from (values
      ('concept_approval', 'workflow_missing_concept_deliverable'),
      ('print_approval', 'workflow_missing_print_proof'),
      ('ebook_approval', 'workflow_missing_ebook_proof')
    ) as cases(stage, expected_error)
  loop
    insert into optional_final_gate_test (id, workflow_stage_key, project_status)
    values (4, stage, 'active');
    actual_error := null;
    begin
      update optional_final_gate_test set workflow_stage_status_key = 'awaiting_client' where id = 4;
    exception when others then
      actual_error := sqlerrm;
    end;
    if actual_error is distinct from expected_error then
      raise exception 'Expected %, got %', expected_error, actual_error;
    end if;
    update optional_final_gate_test
      set proof_pdf_link = 'https://example.test/proof.pdf',
          final_ebook_link = 'https://example.test/final.epub',
          workflow_stage_status_key = 'awaiting_client' where id = 4;
    if not exists (select 1 from optional_final_gate_test where id = 4 and workflow_stage_status_key = 'awaiting_client') then
      raise exception 'Valid proof must permit %', stage;
    end if;
    delete from optional_final_gate_test where id = 4;
  end loop;
end
$test$;
rollback;
select 'Optional final URLs and all three earlier proof gates passed (temporary objects rolled back)' as result;
`);
