import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const dashboard = fs.readFileSync('src/pages/DashboardPage.tsx', 'utf8');
const timeline = fs.readFileSync('src/components/ProjectTimeline.tsx', 'utf8');
const clientPortal = fs.readFileSync('src/pages/ClientPortalPage.tsx', 'utf8');
const clientModal = fs.readFileSync('src/components/ClientProjectDetailModal.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

console.log('--- Dashboard Timeline + Client Revisions Regression Tests ---');

assert(
  dashboard.includes('w-[13%]') &&
  dashboard.includes('w-[42%]') &&
  dashboard.includes('w-[31%]') &&
  dashboard.includes('w-[14%]'),
  'desktop project table uses balanced Project / Status / Timeline / Due widths',
);

assert(
  timeline.includes('min-w-0 space-y-2') &&
  timeline.includes('showFinalDue={false}') &&
  timeline.includes('truncate text-[11px]') &&
  !timeline.includes('<div className="min-w-56 space-y-2">'),
  'compact timeline no longer forces excess width or repeats final due information',
);

assert(
  clientPortal.includes('Revision history is now kept inside each project.') &&
  clientPortal.includes('choose the Revisions tab') &&
  !clientPortal.includes('font-display text-2xl font-semibold">Revision History</h2>'),
  'client dashboard removes the long global revision history and directs revisions into project windows',
);

assert(
  clientModal.includes("activeTab === 'revisions'") &&
  clientModal.includes('Approve Revised Proof') &&
  clientModal.includes('onRespondToRevision') &&
  app.includes("onRespondToRevision={async (requestId) =>"),
  'project Revisions tab keeps full history plus revised-proof approval',
);

if (process.exitCode) {
  console.error('Dashboard timeline / client revision checks failed.');
} else {
  console.log('ALL DASHBOARD TIMELINE / CLIENT REVISION CHECKS PASSED.');
}
