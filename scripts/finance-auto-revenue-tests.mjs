import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ FAIL: ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ PASS: ${message}`);
}

const financePage = read('src/pages/FinancePage.tsx');
const currencySelector = read('src/components/CurrencySelector.tsx');
const currencyContext = read('src/lib/currency.tsx');
const tracker = read('src/lib/useTracker.ts');

console.log('--- Finance Auto Revenue / USD Static Tests ---');

assert(
  financePage.includes("project.project_status !== 'cancelled'") &&
    financePage.includes("project.project_status !== 'archived'"),
  'automatic order revenue excludes cancelled and archived projects',
);

assert(
  financePage.includes('periodOrderRevenue') &&
    financePage.includes('Number(project.total_price || 0)'),
  'order revenue is derived from project order values',
);

assert(
  financePage.includes('orderDate(project)') &&
    financePage.includes('monthOrders.reduce'),
  'monthly revenue is grouped from project order dates rather than manual income rows',
);

assert(
  financePage.includes("t.type === 'expense'") &&
    !financePage.includes('setShowAddIncomeModal') &&
    !financePage.includes('Add Income'),
  'manual income entry is removed while expense tracking remains',
);

assert(
  financePage.includes('Orders & Revenue') &&
    financePage.includes('Order Revenue') &&
    financePage.includes('Revenue Less Expenses'),
  'finance terminology clearly separates orders, revenue and expenses',
);

assert(
  !financePage.includes('PKR') &&
    financePage.includes('Amount (USD)') &&
    financePage.includes('Payment Amount (USD)'),
  'finance page exposes USD-only amounts with no PKR controls',
);

assert(
  !currencySelector.includes('<option') &&
    currencySelector.includes('USD ($)') &&
    !currencySelector.includes('PKR'),
  'global currency selector is a fixed USD indicator',
);

assert(
  currencyContext.includes("const displayCurrency: CurrencyCode = 'USD'") &&
    currencyContext.includes("localStorage.setItem('mh_display_currency', 'USD')"),
  'currency context is locked to USD',
);

assert(
  tracker.includes("const currencyCode = 'USD' as const") &&
    tracker.includes('const rate = 1.0'),
  'new finance transactions persist as USD without FX conversion',
);

if (process.exitCode) {
  console.error('Finance auto-revenue regression checks failed.');
} else {
  console.log('ALL FINANCE AUTO-REVENUE CHECKS PASSED.');
}
