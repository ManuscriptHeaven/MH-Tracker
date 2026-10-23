import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync('src/components/ProjectFormModal.tsx', 'utf8');
const create = source.split('{!isEditing ? (')[1]?.split(') : (')[0];
assert.ok(create, 'New project has a concise, separately rendered form');
for (const name of ['Project Details','Project Title','Client Name','Service Type','Assigned To','Priority','Start Date','Project Price (USD)','Attachments']) {
  assert.ok(create.includes(name), 'Creation form retains essential field: ' + name);
}
for (const name of ['Files and Delivery Links','Source File Link','Final Print PDF Link','Project Timeline','QA Notes','Internal Notes','Payment Notes']) {
  assert.ok(!create.includes(name), 'Creation form omits long legacy section: ' + name);
}
assert.ok(create.includes('after saving'), 'Attachment handoff explicitly states when secure uploads become available');
assert.ok(source.includes('validateTimelineDates(draft)'), 'Legacy/demo timeline validation stays intact');
assert.ok(source.includes('canonical ?'), 'Canonical workflow preview is preserved');
assert.ok(source.includes('await onSubmit(draft)'), 'Existing create/edit mutation is reused');
console.log('Concise new-project modal static contract checks passed.');
