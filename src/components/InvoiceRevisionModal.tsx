import { useMemo, useState } from 'react';
import { FilePenLine } from 'lucide-react';
import { Button, Field, Modal, TextareaField } from './ui';
import type { Invoice, InvoiceItem } from '../lib/types';
import { useCurrency } from '../lib/currency';
import { errorMessage } from '../lib/utils';

function recalculateItem(item: InvoiceItem): InvoiceItem {
  const total = Math.max(0, Number(item.total_price || 0));
  const paid = Math.max(0, Math.min(total, Number(item.advance_paid || 0)));
  return {
    ...item,
    total_price: total,
    advance_paid: paid,
    due_amount: Math.max(total - paid, 0),
  };
}

export function InvoiceRevisionModal({
  invoice,
  onClose,
  onSave,
}: {
  invoice: Invoice;
  onClose: () => void;
  onSave: (draft: Invoice, changeNote: string) => Promise<void>;
}) {
  const { formatMoney } = useCurrency();
  const [dueDate, setDueDate] = useState(invoice.due_date);
  const [notes, setNotes] = useState(invoice.notes || '');
  const [changeNote, setChangeNote] = useState('');
  const [items, setItems] = useState<InvoiceItem[]>(invoice.items.map(recalculateItem));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => {
    const normalized = items.map(recalculateItem);
    const subtotal = normalized.reduce((sum, item) => sum + item.total_price, 0);
    const totalPaid = normalized.reduce((sum, item) => sum + item.advance_paid, 0);
    const totalDue = normalized.reduce((sum, item) => sum + item.due_amount, 0);
    return { normalized, subtotal, totalPaid, totalDue };
  }, [items]);

  function updateItem(index: number, patch: Partial<InvoiceItem>) {
    setItems((previous) =>
      previous.map((item, itemIndex) =>
        itemIndex === index ? recalculateItem({ ...item, ...patch }) : item,
      ),
    );
  }

  async function handleSave() {
    if (!changeNote.trim()) {
      setError('Please add a revision reason so the invoice history stays auditable.');
      return;
    }
    if (!dueDate) {
      setError('Due date is required.');
      return;
    }
    if (totals.normalized.length === 0) {
      setError('Invoice must contain at least one project.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      await onSave(
        {
          ...invoice,
          id: `revision-${Date.now()}`,
          due_date: dueDate,
          items: totals.normalized,
          subtotal: totals.subtotal,
          total_paid: totals.totalPaid,
          total_due: totals.totalDue,
          notes: notes.trim(),
          status: totals.totalDue === 0 ? 'Paid' : 'Sent',
          created_at: new Date().toISOString(),
        },
        changeNote.trim(),
      );
    } catch (err) {
      setError(errorMessage(err, 'Failed to create invoice revision.'));
      setSaving(false);
    }
  }

  const nextVersion = Number(invoice.version_number || 1) + 1;

  return (
    <Modal
      title={`Revise ${invoice.invoice_number} · Version ${nextVersion}`}
      onClose={onClose}
      width="max-w-4xl"
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-gold/30 bg-gold/10 p-4 text-sm text-ink">
          <div className="flex items-start gap-2">
            <FilePenLine className="mt-0.5 h-4 w-4 text-gold" />
            <div>
              <p className="font-semibold">A new immutable invoice version will be created.</p>
              <p className="mt-1 text-xs text-muted">
                Previous versions remain available in Invoice History. These adjustments change
                the invoice snapshot only; they do not rewrite the project contract or payment ledger.
              </p>
            </div>
          </div>
        </div>

        {error ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Due Date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
          <Field
            label="Revision Reason *"
            placeholder="e.g. Corrected project amount / client requested adjustment"
            value={changeNote}
            onChange={(event) => setChangeNote(event.target.value)}
          />
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-ivory text-xs font-semibold uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3 text-right">Invoice Amount</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item, index) => (
                <tr key={`${item.project_id}-${index}`}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink">{item.project_title}</p>
                    <p className="text-xs text-muted">{item.project_number}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">{item.service_type}</td>
                  <td className="px-4 py-3 text-right">
                    <input
                      aria-label={`Invoice amount for ${item.project_title}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.total_price}
                      onChange={(event) =>
                        updateItem(index, { total_price: Number(event.target.value || 0) })
                      }
                      className="w-28 rounded-md border border-border bg-white px-2 py-1.5 text-right"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      aria-label={`Paid amount for ${item.project_title}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.advance_paid}
                      onChange={(event) =>
                        updateItem(index, { advance_paid: Number(event.target.value || 0) })
                      }
                      className="w-28 rounded-md border border-border bg-white px-2 py-1.5 text-right"
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-warning">
                    {formatMoney(Math.max(Number(item.total_price || 0) - Number(item.advance_paid || 0), 0), 'USD')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-ivory p-3">
            <p className="text-xs uppercase text-muted">Subtotal</p>
            <p className="mt-1 font-display text-xl font-bold">{formatMoney(totals.subtotal, 'USD')}</p>
          </div>
          <div className="rounded-lg border border-border bg-ivory p-3">
            <p className="text-xs uppercase text-muted">Paid</p>
            <p className="mt-1 font-display text-xl font-bold text-emerald-700">{formatMoney(totals.totalPaid, 'USD')}</p>
          </div>
          <div className="rounded-lg border border-gold/40 bg-gold/10 p-3">
            <p className="text-xs uppercase text-muted">Balance Due</p>
            <p className="mt-1 font-display text-xl font-bold text-warning">{formatMoney(totals.totalDue, 'USD')}</p>
          </div>
        </div>

        <TextareaField
          label="Client-facing Notes (Optional)"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional notes that should appear on this invoice version..."
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Creating Revision...' : `Create Version ${nextVersion}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
