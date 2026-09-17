import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAdminOverride } from '../src/lib/projectCriticalActions.ts';
import { archiveProjectLifecycle, isArchivedProject } from '../src/lib/projectArchive.ts';

assert.equal(validateAdminOverride('cancel', 'cancel'), 'Reason summary must be at least 10 characters.');
assert.equal(validateAdminOverride('Valid reason', '   '), 'A detailed explanation is required.');
assert.equal(validateAdminOverride('Valid reason', 'Detailed explanation'), null);
assert.equal(validateAdminOverride('  1234567890  ', ' explanation '), null);

assert.equal(isArchivedProject({ project_status: 'archived', status: 'Cancelled' }), true);
assert.equal(isArchivedProject({ project_status: 'cancelled', status: 'Archived' }), false);
assert.equal(isArchivedProject({ status: 'Archived' }), true);

const transitions = [];
let reloads = 0;
const transition = async (target, version, reason) => {
  transitions.push([target, version, reason]);
  return { workflow_version: version + 1 };
};
const reload = async () => { reloads += 1; };
await archiveProjectLifecycle({ lifecycle: 'active', workflowVersion: 4, reason: '  Admin closure  ', transition, reload });
assert.deepEqual(transitions, [['cancelled', 4, 'Admin closure'], ['archived', 5, 'Admin closure']]);
assert.equal(reloads, 1);

transitions.length = 0;
await archiveProjectLifecycle({ lifecycle: 'completed', workflowVersion: 8, reason: 'Final filing', transition, reload });
assert.deepEqual(transitions, [['archived', 8, 'Final filing']]);
transitions.length = 0;
await archiveProjectLifecycle({ lifecycle: 'cancelled', workflowVersion: 9, reason: 'Final filing', transition, reload });
assert.deepEqual(transitions, [['archived', 9, 'Final filing']]);
await assert.rejects(archiveProjectLifecycle({ lifecycle: 'archived', workflowVersion: 9, reason: 'Again', transition, reload }), /already archived/);
await assert.rejects(archiveProjectLifecycle({ lifecycle: 'cancelled', workflowVersion: 9, reason: ' ', transition, reload }), /Admin reason is required/);

transitions.length = 0;
const priorReloads = reloads;
await assert.rejects(archiveProjectLifecycle({
  lifecycle: 'on_hold', workflowVersion: 10, reason: 'Client closure', reload,
  transition: async (target, version, reason) => {
    transitions.push([target, version, reason]);
    if (target === 'archived') throw new Error('workflow_version_conflict');
    return { workflow_version: 11 };
  },
}), /cancelled but not archived.*workflow_version_conflict/);
assert.deepEqual(transitions, [['cancelled', 10, 'Client closure'], ['archived', 11, 'Client closure']]);
assert.equal(reloads, priorReloads + 1);

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../src/components/ProjectDetail.tsx', import.meta.url), 'utf8');
const tracker = readFileSync(new URL('../src/lib/useTracker.ts', import.meta.url), 'utf8');
const legacy = readFileSync(new URL('../src/lib/useTrackerLegacy.ts', import.meta.url), 'utf8');
const projectsPage = readFileSync(new URL('../src/pages/ProjectsPage.tsx', import.meta.url), 'utf8');
const voice = readFileSync(new URL('../src/lib/ai/voiceQueryEngine.ts', import.meta.url), 'utf8');
assert.match(app, /Admin override failed\.'\), tone: 'error' \}\);\s*throw err;/);
assert.match(detail, /role="alert"[\s\S]*\{overrideError\}/);
assert.match(tracker, /workflow_set_project_lifecycle/);
assert.match(projectsPage, /<option value="archived">Archived<\/option>/);
assert.doesNotMatch(legacy, /from\('projects'\)\.delete\(/);
assert.doesNotMatch(voice, /Permanently delete/);

console.log('Critical project action tests passed.');
