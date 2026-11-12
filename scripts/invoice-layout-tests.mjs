import assert from 'node:assert/strict';
import { chunkInvoiceItems } from '../src/lib/invoiceUtils.ts';

for (const count of [1, 5, 9, 12, 25]) {
  const items = Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
  const pages = chunkInvoiceItems(items);
  assert.equal(pages.flat().length, count, `${count} items are retained`);
  assert.ok(pages.every((page) => page.length <= 12), `${count} items never exceed 12 on a page`);
  assert.equal(pages[0].length, Math.min(count, 12), `${count} items fill page 1 to capacity`);
}

console.log('Invoice page splitting passed for 1, 5, 9, 12, and 25 items.');
