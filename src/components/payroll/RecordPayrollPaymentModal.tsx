import React, { useState } from 'react';
import { Button, Field, Modal, SelectField, TextareaField } from '../ui';
import { useCurrency } from '../../lib/currency';
import type { CurrencyCode, EmployeeLedgerEntry, Profile } from '../../lib/types';
import { formatMonthLabel } from '../../lib/payrollUtils';

export function RecordPayrollPaymentModal({
  profile,
  payrollMonth,
  suggestedAmount,
  onClose,
  onRecordPayment,
}: {
  profile: Profile;
  payrollMonth: string;
  suggestedAmount?: number;
  onClose: () => void;
  onRecordPayment: (entry: Omit<EmployeeLedgerEntry, 'id' | 'created_at'>) => Promise<void>;
}) {
  const { displayCurrency, formatMoney } = useCurrency();
  const [amount, setAmount] = useState(suggestedAmount && suggestedAmount > 0 ? String(suggestedAmount) : '');
  const [currency, setCurrency] = useState<CurrencyCode>(displayCurrency || 'USD');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<string>('Bank Transfer');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Please enter a valid payment amount greater than 0.');
      return;
    }
    if (!paymentDate) {
      setError('Please select a payment date.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      await onRecordPayment({
        employee_id: profile.id,
        entry_type: 'Payment',
        amount: numAmount,
        currency,
        salary_month: `${payrollMonth.slice(0, 7)}-01`,
        payment_method: paymentMethod,
        project_id: null,
        description: `Salary Payment (${formatMonthLabel(payrollMonth)})`,
        reference: reference.trim() || null,
        status: 'Paid',
        notes: notes.trim() || `Payroll payment recorded for ${formatMonthLabel(payrollMonth)}`,
        paid_at: paymentDate,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Record Payment — ${profile.full_name}`} onClose={onClose} width="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <div className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-danger">{error}</div> : null}

        <div className="rounded-lg border border-border bg-ivory p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted">Employee:</span>
            <strong className="text-ink">{profile.full_name} ({profile.role})</strong>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Payroll Period:</span>
            <strong className="text-ink">{formatMonthLabel(payrollMonth)}</strong>
          </div>
          {suggestedAmount !== undefined ? (
            <div className="flex justify-between pt-1 border-t border-border/60">
              <span className="text-muted">Current Outstanding:</span>
              <strong className="text-amber-900 font-bold">{formatMoney(suggestedAmount, 'USD')}</strong>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid grid-cols-[1fr_90px] gap-2 sm:col-span-2">
            <Field
              label="Payment Amount *"
              type="number"
              min="0.01"
              step="any"
              required
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
            <SelectField
              label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
            >
              <option value="USD">USD ($)</option>
              <option value="PKR">PKR (Rs)</option>
            </SelectField>
          </div>

          <Field
            label="Payment Date *"
            type="date"
            required
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />

          <SelectField
            label="Payment Method *"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            required
          >
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Cash">Cash</option>
            <option value="Wise">Wise</option>
            <option value="PayPal">PayPal</option>
            <option value="Other">Other</option>
          </SelectField>
        </div>

        <Field
          label="Transaction Reference / Receipt ID"
          placeholder="e.g. TRX-98231 or Bank Confirmation #"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />

        <TextareaField
          label="Payment Notes"
          placeholder="Optional notes or remarks..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Recording...' : 'Record Payment'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
