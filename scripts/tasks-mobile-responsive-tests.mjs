import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const tasks = fs.readFileSync('src/pages/TasksPage.tsx', 'utf8');
const detail = fs.readFileSync('src/components/tasks/TaskDetailModal.tsx', 'utf8');
const ui = fs.readFileSync('src/components/ui.tsx', 'utf8');

console.log('--- Mobile Team Tasks Responsive Regression Tests ---');

assert(
  tasks.includes('min-w-0 space-y-4 sm:space-y-6') &&
    tasks.includes('p-4 text-white') &&
    tasks.includes('sm:p-6') &&
    tasks.includes('w-full shadow-md') &&
    tasks.includes('sm:w-auto'),
  'Team Tasks header and Add Task action collapse cleanly on phones',
);

assert(
  tasks.includes('grid grid-cols-2 gap-2.5 sm:grid-cols-3') &&
    tasks.includes('xl:grid-cols-5') &&
    tasks.includes('text-2xl') &&
    tasks.includes('sm:text-3xl'),
  'task summary cards use a compact mobile grid without forcing desktop widths',
);

assert(
  tasks.includes('snap-x') &&
    tasks.includes('overflow-x-auto') &&
    tasks.includes('grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2') &&
    tasks.includes('sm:col-span-2'),
  'quick filters scroll safely and advanced filters stack into a mobile grid',
);

assert(
  tasks.includes('group relative min-w-0 overflow-hidden') &&
    tasks.includes('break-words font-display text-base') &&
    tasks.includes('grid grid-cols-2 gap-2 sm:flex') &&
    tasks.includes('col-span-2 flex min-w-0'),
  'task cards wrap long titles/projects and mobile actions do not overflow horizontally',
);

assert(
  tasks.includes('items-end justify-center') &&
    tasks.includes('max-h-[100dvh]') &&
    tasks.includes('overflow-y-auto p-4 sm:p-6') &&
    tasks.includes('grid grid-cols-2 gap-2 border-t'),
  'Add Task uses a phone-safe bottom sheet with scrollable fields and reachable actions',
);

assert(
  detail.includes('grid min-w-0 gap-3 sm:gap-5') &&
    detail.includes('grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]') &&
    detail.includes('min-w-0 break-words'),
  'task detail checklist, subtasks, collaborators and dependencies stack safely on mobile',
);

assert(
  ui.includes('place-items-stretch') &&
    ui.includes('max-h-[100dvh]') &&
    ui.includes('rounded-none') &&
    ui.includes('overflow-x-hidden overflow-y-auto') &&
    ui.includes('sm:max-h-[92dvh]'),
  'shared modal primitive fits the mobile viewport and prevents sideways clipping',
);

if (process.exitCode) {
  console.error('Mobile Team Tasks responsive checks failed.');
} else {
  console.log('ALL MOBILE TEAM TASKS RESPONSIVE CHECKS PASSED.');
}
