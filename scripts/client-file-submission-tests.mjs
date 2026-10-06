import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canSubmitClientFiles, validateClientFileSubmission } from '../src/lib/clientFileSubmission.ts';

const project = { project_status: 'active', workflow_stage_key: 'files_received', workflow_stage_status_key: 'pending' };
assert.equal(canSubmitClientFiles(project), true);
assert.equal(canSubmitClientFiles({ ...project, workflow_stage_status_key: 'active' }), true);
for (const project_status of ['on_hold', 'completed', 'cancelled', 'archived', null, undefined]) {
  assert.equal(canSubmitClientFiles({ ...project, project_status }), false);
}
for (const workflow_stage_status_key of ['completed', 'awaiting_client', 'revision_active', null, undefined]) {
  assert.equal(canSubmitClientFiles({ ...project, workflow_stage_status_key }), false);
}
assert.equal(canSubmitClientFiles({ ...project, workflow_stage_key: 'design_concept' }), false);
assert.equal(validateClientFileSubmission([], 'Already emailed the manuscript'), null);
assert.equal(validateClientFileSubmission([], 'Sent to the team on WhatsApp'), null);
for (const note of ['', '  ', '\t\n', undefined]) assert.ok(validateClientFileSubmission([], note));
const file = { name: 'manuscript.pdf', size: 20 };
assert.equal(validateClientFileSubmission([file]), null);
assert.ok(validateClientFileSubmission([{ ...file, size: 0 }]));
assert.ok(validateClientFileSubmission([{ ...file, size: 104857601 }]));
assert.ok(validateClientFileSubmission(Array(11).fill(file)));
assert.equal(validateClientFileSubmission(Array(10).fill({ ...file, size: 104857600 })), null);

const read = path => fs.readFileSync(path, 'utf8');
const app = read('src/App.tsx');
const portal = read('src/pages/ClientPortalPage.tsx');
const projects = read('src/pages/ClientProjectsPage.tsx');
const modal = read('src/components/ClientProjectDetailModal.tsx');
const tracker = read('src/lib/useTracker.ts');
assert.equal((app.match(/onSubmitFiles=\{\(project\) => openClientProject\(project, 'files'\)\}/g) || []).length, 2);
assert.ok(app.includes('initialTab={clientProjectTab}') && app.includes('key={selectedProjectFresh.id}'));
assert.ok(modal.includes("initialTab = 'overview'") && modal.includes('>(initialTab)'));
for (const source of [portal, projects]) {
  assert.ok(source.includes('canSubmitClientFiles(project) && onSubmitFiles'));
  assert.ok(source.includes('onClick={() => onSubmitFiles(project)}'));
}
assert.ok(portal.includes('onSubmitFiles={onSubmitFiles} compact') || portal.includes('onSubmitFiles={onSubmitFiles}\n                compact'));
assert.ok(modal.includes('initialSubmissionBusy.current') && modal.includes('initialUploadNote.trim()'));
assert.ok(modal.includes('required without attachments') && modal.includes('Choose project files (optional)'));
assert.ok(modal.includes('Boolean(validateClientFileSubmission(initialUploadFiles, initialUploadNote))'));
assert.ok(tracker.includes('workflowClient.submitInitialFiles(') && tracker.includes('validateClientFileSubmission(files, note)'));
assert.ok(!tracker.includes("if (!files.length) throw new Error('Choose at least one file to submit.')"));

const migrationName = fs.readdirSync('supabase/migrations').find(name => name.endsWith('_optional_client_source_files.sql'));
const migration = read(`supabase/migrations/${migrationName}`);
const original = read('supabase/migrations/20260921000100_client_files_stage_clocks.sql');
let patched = original.slice(original.indexOf('create or replace function public.workflow_client_submit_files('), original.indexOf('\nreset role;', original.indexOf('create or replace function public.workflow_client_submit_files(')));
for (const match of migration.matchAll(/\$old\$([\s\S]*?)\$old\$, \$new\$([\s\S]*?)\$new\$/g)) {
  assert.equal(patched.split(match[1]).length - 1, 1, 'every migration replacement is unique');
  patched = patched.replace(match[1], match[2]);
}
for (const preserved of ['_workflow_can_client_access', '_workflow_check_version', '_workflow_validate_tuple', '_workflow_receipt_lookup', '_workflow_receipt_store', '_workflow_emit_events', '_workflow_notify', '_workflow_enter_production']) {
  assert.equal(patched.split(preserved).length, original.slice(original.indexOf('create or replace function public.workflow_client_submit_files(')).split(preserved).length);
}
assert.ok(patched.includes("raise exception 'workflow_file_note_required'"));
assert.ok(patched.includes("then 'off_platform_file_confirmation'"));
assert.ok(patched.includes('insert into public.project_notes'));
assert.ok(patched.indexOf('_workflow_receipt_lookup') < patched.indexOf('insert into public.project_notes'));
assert.ok(migration.includes('proacl is distinct from v_acl') && migration.includes('proowner is distinct from v_owner'));
assert.ok(!migration.includes('grant execute') && !migration.includes('to authenticated') && !migration.includes('to anon'));
console.log('Client card navigation, optional attachments and migration safety checks passed.');
