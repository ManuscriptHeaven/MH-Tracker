import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const portal = fs.readFileSync('src/pages/ClientPortalPage.tsx', 'utf8');
const detail = fs.readFileSync('src/components/ClientProjectDetailModal.tsx', 'utf8');
const dialog = fs.readFileSync('src/components/ClientApprovalConfirmDialog.tsx', 'utf8');

console.log('--- Client Approval Confirmation UI Regression Tests ---');

assert(
  !portal.includes('window.confirm') && !detail.includes('window.confirm'),
  'client approval flows no longer use browser-native confirmation prompts',
);

assert(
  portal.includes('ClientApprovalConfirmDialog') &&
    detail.includes('ClientApprovalConfirmDialog'),
  'dashboard and project-detail approval flows use the branded confirmation dialog',
);

assert(
  dialog.includes('role="dialog"') &&
    dialog.includes('aria-modal="true"') &&
    dialog.includes('Client Approval') &&
    dialog.includes('Once confirmed, your approval is recorded'),
  'approval dialog is accessible and explains the workflow impact',
);

assert(
  portal.includes('isConfirmingApproval') &&
    portal.includes('approvalError') &&
    detail.includes('isApproving') &&
    detail.includes('approvalError'),
  'approval confirmation shows progress and recoverable errors',
);

assert(
  portal.includes("await onRespondToRevision(pendingApproval.requestId, 'Approved')") &&
    portal.includes('await onApproveMilestone(pendingApproval.project.id, pendingApproval.milestone)') &&
    detail.includes('await onApproveMilestone(project.id, milestoneToApprove)'),
  'confirmed approvals still invoke the original canonical workflow actions',
);

if (process.exitCode) {
  console.error('Client approval confirmation UI regression checks failed.');
} else {
  console.log('ALL CLIENT APPROVAL CONFIRMATION UI CHECKS PASSED.');
}
