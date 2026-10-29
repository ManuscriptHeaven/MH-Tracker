import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createBulkInvoice, getAllClientsWithEligibleProjects,
  getEligibleProjectsForClient, isProjectArchived,
} from '../src/lib/invoiceUtils.ts';

function project(id, overrides = {}) {
  return {
    id, project_number: id, project_title: id,
    client_name: 'BCH', client_email: 'bch@example.invalid',
    status: 'Active', project_status: 'active',
    due_date: '2026-10-25', delivery_date: null,
    total_price: 100, advance_paid: 0,
    payment_status: 'Pending', invoiced: false, invoice_id: null,
    ...overrides,
  };
}
const active = project('active');
const archived = project('archived', { status: 'Archived', project_status: 'archived', invoiced: true });
const archivedLegacy = project('legacy-archived', { status: 'Active', project_status: 'ARCHIVED' });
const delivered = project('delivered', { status: 'Delivered', project_status: 'completed' });
const finished = project('finished', { status: 'Completed', project_status: 'completed' });
const alreadyInvoiced = project('previous', { invoiced: true });
const all = [active, archived, archivedLegacy, delivered, finished, alreadyInvoiced];

assert.ok(isProjectArchived(archived));
assert.ok(isProjectArchived(archivedLegacy), 'canonical lifecycle archived excludes even when display status is stale');
assert.ok(!isProjectArchived(delivered), 'delivered remains billable');

assert.deepEqual(
  getEligibleProjectsForClient(all, 'BCH', 'all', 'all', 'pending', false).map((p) => p.id),
  ['active','delivered','finished'], 'archived and previously invoiced projects excluded by default',
);
assert.deepEqual(
  getEligibleProjectsForClient(all, 'BCH', 'all', 'all', 'pending', true).map((p) => p.id),
  ['active','delivered','finished','previous'],
  'include previously invoiced never overrides archived exclusion',
);
assert.deepEqual(
  getEligibleProjectsForClient(all, 'BCH', 10, 2026, 'pending', true).map((p) => p.id),
  ['active','delivered','finished','previous'], 'date filtering does not reintroduce archived projects',
);
assert.deepEqual(getAllClientsWithEligibleProjects(all, 'all', 'all').get('BCH').projects.map((p) => p.id),
  ['active','delivered','finished'], 'batch grouping also excludes archived projects');

assert.throws(() => createBulkInvoice('BCH','', [active, archived], 10, 2026), /Archived projects/, 'core invoice generation fails closed');
assert.throws(() => createBulkInvoice('BCH','', [archivedLegacy], 10, 2026), /Archived projects/);
assert.throws(() => createBulkInvoice('BCH','', [], 10, 2026), /Archived projects/);
assert.equal(createBulkInvoice('BCH','', [active, delivered], 10, 2026).items.length, 2, 'nonarchived invoicing still works');

const payments = fs.readFileSync('src/pages/PaymentsPage.tsx', 'utf8');
assert.match(payments,/if \(isProjectArchived\(project\)\)/, 'single-project invoicing prevents archived projects');
assert.match(payments,/!projectInvoice && isProjectArchived\(project\)/, 'desktop and mobile buttons disable new archived invoices');

console.log('PASS: archived projects cannot enter any new invoice; history and delivered billing preserved');
