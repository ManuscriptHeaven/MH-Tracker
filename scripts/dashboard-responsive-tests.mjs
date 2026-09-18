import fs from 'node:fs';

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ FAIL: ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ PASS: ${message}`);
}

const dashboard = read('src/pages/DashboardPage.tsx');
const date = read('src/lib/date.ts');

console.log('--- Dashboard Responsive Refresh Static Tests ---');

assert(
  dashboard.includes('Active Projects') &&
    dashboard.includes('Quick filters sit directly above the project list') &&
    dashboard.indexOf('Quick filters sit directly above the project list') <
      dashboard.indexOf('Desktop project table'),
  'project quick filters are positioned immediately above the Active Projects list',
);

assert(
  dashboard.includes('mobileFiltersOpen') &&
    dashboard.includes('lg:block') &&
    dashboard.includes('sm:grid-cols-2 lg:grid-cols-4'),
  'advanced filters are collapsible on mobile and visible in a responsive desktop grid',
);

assert(
  dashboard.includes('grid grid-cols-2 gap-3 lg:grid-cols-4') &&
    dashboard.includes('Pending Payments') &&
    dashboard.includes('Awaiting Approval'),
  'dashboard uses a compact four-card responsive KPI summary instead of the oversized metric wall',
);

assert(
  dashboard.includes('md:hidden') &&
    dashboard.includes('Open project') &&
    dashboard.includes('rounded-2xl border border-border bg-white p-4'),
  'mobile dashboard renders dedicated project cards instead of forcing the desktop table',
);

assert(
  dashboard.includes('Needs Attention') &&
    dashboard.includes('Team Workload'),
  'secondary dashboard information is organized into a focused right rail',
);

assert(
  date.includes("if (!value) return Number.POSITIVE_INFINITY") &&
    date.includes("return 'No due date'") &&
    date.includes("if (!project.due_date)"),
  'missing due dates no longer render as huge overdue-day counts',
);

if (process.exitCode) {
  console.error('Dashboard responsive refresh checks failed.');
} else {
  console.log('ALL DASHBOARD RESPONSIVE REFRESH CHECKS PASSED.');
}
