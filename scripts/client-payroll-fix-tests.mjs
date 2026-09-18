import fs from 'node:fs';

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const migration = read('supabase/phase6/migrations/00670_employee_compensation_update_grants.sql');
const clientPage = read('src/pages/ClientAccessPage.tsx');
const tracker = read('src/lib/useTracker.ts');
const app = read('src/App.tsx');
const functionSource = read('supabase/functions/provision-client/index.ts');
const salaryModal = read('src/components/payroll/EditEmployeeSalaryModal.tsx');

console.log('--- Quick Client + Payroll Permission Tests ---');

assert(
  migration.includes('grant update (salary_type, default_currency)') &&
    migration.includes("has_column_privilege('authenticated', 'public.employee_compensation', 'salary_type', 'UPDATE')") &&
    migration.includes("has_column_privilege('authenticated', 'public.employee_compensation', 'default_currency', 'UPDATE')"),
  'payroll migration restores the exact missing update grants and verifies them',
);

assert(
  salaryModal.includes('salary_type: salaryType') &&
    salaryModal.includes('default_currency: defaultCurrency'),
  'salary modal still sends the columns covered by the repaired grants',
);

assert(
  clientPage.includes('Quick Add Client') &&
    clientPage.includes('Client Name *') &&
    clientPage.includes('Client Email *') &&
    clientPage.includes('Assign Projects Now') &&
    clientPage.includes('(optional)') &&
    clientPage.includes('Add Client & Send Invite'),
  'client UI uses name/email quick add with optional project assignment',
);

assert(
  !clientPage.includes('Initial Password') &&
    !clientPage.includes('generatePassword') &&
    !clientPage.includes('onAddClient'),
  'quick client UI no longer asks admins to manage a temporary password',
);

assert(
  tracker.includes("'provision-client'") &&
    tracker.includes('const provisionClient = useCallback') &&
    tracker.includes('await loadSupabaseData(currentProfile)'),
  'tracker provisions clients through the secure server function and refreshes canonical data',
);

assert(
  app.includes('onSaveClient={tracker.provisionClient}') &&
    !app.includes('onAddClient={async (data)'),
  'client creation no longer calls browser signUp from the admin session',
);

assert(
  functionSource.includes("caller.role !== 'admin'") &&
    functionSource.includes("admin.auth.admin.inviteUserByEmail") &&
    functionSource.includes(".from('team_members')") &&
    functionSource.includes(".from('client_project_access')"),
  'provision-client verifies admin access, provisions identity, and manages optional project access',
);

assert(
  functionSource.includes("role: 'client'") &&
    functionSource.includes("status: 'active'") &&
    functionSource.includes('projectIds.length > 0'),
  'server provisioning enforces client role and supports clients with no initial project access',
);

if (process.exitCode) {
  console.error('Quick Client + Payroll Permission checks failed.');
} else {
  console.log('ALL QUICK CLIENT + PAYROLL PERMISSION CHECKS PASSED.');
}
