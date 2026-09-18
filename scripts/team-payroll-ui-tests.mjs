import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const source = fs.readFileSync('src/pages/TeamPage.tsx', 'utf8');

console.log('--- Team Payroll UI Regression Tests ---');

assert(
  source.includes('Payroll Command Center') &&
    source.includes('Payroll Period') &&
    source.includes('Jump to current month'),
  'payroll period and primary controls are unified in the command bar',
);

assert(
  source.includes('Total Payroll') &&
    source.includes('Paid This Month') &&
    source.includes('Outstanding') &&
    source.includes('Advances') &&
    source.includes('payrollCompletion'),
  'summary cards expose the four key payroll metrics with payment progress',
);

assert(
  source.includes('Employee Payroll') &&
    source.includes('grid-cols-[minmax(240px,1.5fr)') &&
    source.includes('hidden lg:block'),
  'desktop payroll uses a spacious aligned employee register',
);

assert(
  source.includes('Tablet / mobile payroll cards') &&
    source.includes('lg:hidden') &&
    source.includes('grid grid-cols-2 gap-2 sm:grid-cols-4'),
  'tablet and mobile payroll switches to responsive employee cards',
);

assert(
  source.includes('Pay {formatMoney(row.outstanding') &&
    source.includes('title="Open payroll ledger"') &&
    source.includes('title="Edit compensation"'),
  'pay, ledger and compensation actions remain available with cleaner controls',
);

assert(
  source.includes("openAddEntry(undefined, 'Advance')") &&
    source.includes('Bonus / Deduction / Advance'),
  'quick payroll-entry actions remain accessible after the redesign',
);

assert(
  source.includes('max-w-[1480px]') &&
    source.includes('sm:grid-cols-[minmax(220px,1fr)_150px]'),
  'workspace uses a wider desktop canvas while controls remain responsive',
);

if (process.exitCode) {
  console.error('Team Payroll UI regression checks failed.');
} else {
  console.log('ALL TEAM PAYROLL UI CHECKS PASSED.');
}
