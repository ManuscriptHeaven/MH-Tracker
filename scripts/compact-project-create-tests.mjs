import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProjectAttachments } from '../src/lib/projectAttachments.ts';

const read = (path) => readFileSync(path, 'utf8');
const compact = read('src/components/CompactProjectCreateForm.tsx');
const modal = read('src/components/ProjectFormModal.tsx');
const app = read('src/App.tsx');
const tracker = read('src/lib/useTracker.ts');
const details = read('src/components/ProjectDetail.tsx');
const migration = read('supabase/migrations/20261023220000_staff_project_initial_attachments.sql');

for (const required of ['Client Name','Project Title','Service Type','Assigned To','Deliverables','Total Price','Advance Paid','Attachments','Notes (optional)']) {
  assert(compact.includes(required), `Required concise input missing: ${required}`);
}
for (const excluded of ['Files and Delivery Links','Google Drive Folder Link','Proof PDF Link','Final eBook Link','QA Notes','Payment Notes','Design Concept Due Date']) {
  assert(!compact.includes(excluded), `Unnecessary creation input exposed: ${excluded}`);
}
assert.match(modal, /if \(!isEditing\)\s*\{\s*return\s*\(\s*<CompactProjectCreateForm/, 'creation routes through concise modal');
assert.match(modal, /<Modal title=\{project \? 'Edit Project'/, 'legacy editing remains available');
assert.match(compact, /multiple className="sr-only"/, 'attachments accept multiple files');
assert.match(compact, /disabled=\{isSaving \|\| !canonical\}/, 'file input is disabled in demo mode');
assert.match(app, /await tracker\.createProject\(draft\)/, 'project is created before files are linked');
assert.match(app, /await tracker\.uploadProjectAttachments\(created\.id, attachments\)/, 'attachments are linked to created project');
assert.match(app, /Project created, but its attachments were not saved/, 'partial upload failure cannot cause duplicate create');
assert.match(tracker, /from\('project-source-files'\)/, 'files use private project-source-files bucket');
assert.match(tracker, /from\('project_initial_files'\)\.insert\(metadata\)/, 'metadata is persisted in existing project file table');
assert.match(details, /onUploadProjectAttachments/, 'attachment upload retry is available from project details');
assert.match(migration, /uploaded_by = \(select auth\.uid\(\)\)/, 'insert policy enforces true uploader');
assert.match(migration, /phase6_app_actor_class\(\) in \('admin', 'project_manager'\)/, 'only management may insert staff attachments');
assert.match(migration, /phase6_team_can_access_project\(project_id\)/, 'file metadata insert is project scoped');

const file = (name, size) => ({ name, size });
assert.equal(validateProjectAttachments([]), null, 'attachments are optional');
assert.equal(validateProjectAttachments([file('manuscript.docx', 122)]), null);
assert.match(validateProjectAttachments([file('empty.docx', 0)]), /empty/);
assert.match(validateProjectAttachments([file('huge.pdf', 101 * 1024 * 1024)]), /100 MB/);
assert.match(validateProjectAttachments(Array.from({ length: 11 }, (_, i) => file(`file-${i}`, 1))), /10 files/);
console.log('Compact project creation and attachment guards passed (static/unit).');
