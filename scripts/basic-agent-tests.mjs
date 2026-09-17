import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBasicAgent } from '../src/lib/ai/basicAgent.ts';

const today = '2026-09-17';
const snapshot = {
  projects: [
    { id: 'p1', project_title: 'Late book <img src=x onerror=alert(1)>', status: 'Active', due_date: '2026-09-16' },
    { id: 'p2', project_title: 'Today book', status: 'Active', due_date: today },
    { id: 'p3', project_title: 'Closed book', status: 'Completed', due_date: '2026-09-01' },
  ],
  tasks: [
    { id: 't1', title: 'Late task', status: 'To Do', due_date: '2026-09-16' },
    { id: 't2', title: 'Today task', status: 'In Progress', due_date: today },
    { id: 't3', title: 'Done task', status: 'Done', due_date: '2026-09-01' },
  ],
};

assert.match(runBasicAgent('Summarize projects', snapshot, today).text, /3 projects: 2 active and 1 closed/);
assert.match(runBasicAgent('Summarize tasks', snapshot, today).text, /3 tasks: 2 open and 1 done/);
assert.match(runBasicAgent('Which projects are overdue?', snapshot, today).text, /1 overdue projects:[\s\S]*Late book/);
assert.doesNotMatch(runBasicAgent('Which projects are overdue?', snapshot, today).text, /Closed book/);
assert.match(runBasicAgent('Which projects are due today?', snapshot, today).text, /Today book/);
assert.match(runBasicAgent('Which tasks are overdue?', snapshot, today).text, /Late task/);
assert.doesNotMatch(runBasicAgent('Which tasks are overdue?', snapshot, today).text, /Done task/);
assert.match(runBasicAgent('Which tasks are due today?', snapshot, today).text, /Today task/);
assert.equal(runBasicAgent('Create a task due today', snapshot, today).intent, 'read_only');
assert.equal(runBasicAgent('Delete overdue projects', snapshot, today).intent, 'read_only');
assert.equal(runBasicAgent('How much money came in?', snapshot, today).intent, 'unsupported');
assert.equal(runBasicAgent('Which projects are overdue?', { projects: [], tasks: [] }, today).text, 'No overdue projects.');
assert.match(runBasicAgent('Which projects are overdue?', snapshot, today).text, /<img src=x onerror=alert\(1\)>/);

const context = readFileSync(new URL('../src/lib/ai/aiContext.tsx', import.meta.url), 'utf8');
const message = readFileSync(new URL('../src/components/ai/AIChatMessage.tsx', import.meta.url), 'utf8');
assert.match(context, /runBasicAgent\(text, getVisibleSnapshot\(\)\)/);
assert.doesNotMatch(context, /voiceQueryEngine\.executeAction|trackerMutations:/);
assert.doesNotMatch(message, /dangerouslySetInnerHTML/);

console.log('Basic Agent v1 tests passed.');
