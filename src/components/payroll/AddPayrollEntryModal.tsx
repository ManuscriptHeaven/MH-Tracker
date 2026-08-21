import React, { useState } from 'react';
import { Button, Field, Modal, SelectField, TextareaField } from '../ui';
import type { CurrencyCode, EmployeeLedgerEntry, Profile, Project } from '../../lib/types';

export function AddPayrollEntryModal({
  profiles,
  projects,
  initialMonth,
  initialEmployeeId,
  initialType = 'Project Payment',
  onClose,
  onSave,
}: {
  profiles: Profile[];
  projects: Project[];
  initialMonth: string;
  initialEmployeeId?: string;
  initialType?: EmployeeLedgerEntry['entry_type'];
  onClose: () => void;
  onSave: (entry: Omit<EmployeeLedgerEntry, 'id' | 'created_at'>) => Promise<void>;
}) {
  const [employeeId, setEmployeeId] = useState(initialEmployeeId || profiles[0]?.id || '');
  const [entryType, setEntryType] = useState<EmployeeLedgerEntry['entry_type']>(initialType);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [payrollMonth, setPayrollMonth] = useState(initialMonth.slice(0, 7));
  const [paymentMethod, setPaymentMethod] = useState<string>('Bank Transfer');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState<'Pending' | 'Partially Paid' | 'Paid'>('Pending');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) {
      setError('Please select an employee.');
      return;
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Please enter a valid amount greater than 0.');
      return;
    }
    if (!date) {
      setError('Please choose a date.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      await onSave({
        employee_id: employeeId,
        entry_type: entryType,
        amount: numAmount,
        currency,
        salary_month: `${payrollMonth}-01`,
        payment_method: entryType === 'Payment' || entryType === 'Advance' ? paymentMethod : null,
        project_id: projectId || null,
        description: description.trim() || undefined,
        reference: reference.trim() || null,
        status,
        notes: notes.trim() || description.trim() || '',
        paid_at: date,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save payroll entry.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Add Payroll Entry" onClose={onClose} width="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <div className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-danger">{error}</div> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Employee *"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            required
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} ({p.role})
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Entry Type *"
            value={entryType}
            onChange={(e) => setEntryType(e.target.value as EmployeeLedgerEntry['entry_type'])}
            required
          >
            <option value="Salary">Salary (Base / Adjustment)</option>
            <option value="Project Payment">Project Earning</option>
            <option value="Bonus">Bonus</option>
            <option value="Advance">Advance</option>
            <option value="Deduction">Deduction</option>
            <option value="Payment">Payment</option>
            <option value="Other">Other</option>
          </SelectField>

          <div className="grid grid-cols-[1fr_100px] gap-2">
            <Field
              label="Amount *"
              type="number"
              min="0.01"
              step="any"
              required
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <SelectField label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
              <option value="USD">USD ($)</option>
              <option value="PKR">PKR (Rs)</option>
            </SelectField>
          </div>

          <Field
            label="Payroll Month *"
            type="month"
            required
            value={payrollMonth}
            onChange={(e) => setPayrollMonth(e.target.value)}
          />

          <Field
            label="Entry Date *"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />

          <SelectField
            label="Linked Project (Optional)"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">None / General</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} - {p.project_title}
              </option>
            ))}
          </SelectField>

          {entryType === 'Payment' || entryType === 'Advance' ? (
            <SelectField
              label="Payment Method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Cash">Cash</option>
              <option value="Wise">Wise</option>
              <option value="PayPal">PayPal</option>
              <option value="Other">Other</option>
            </SelectField>
          ) : null}

          {entryType === 'Payment' ? (
            <Field
              label="Transaction Reference"
              placeholder="e.g. Bank Ref # or Receipt ID"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          ) : null}
        </div>

        <Field
          label="Short Description / Reason"
          placeholder="e.g. Book formatting milestone bonus, Advance for travel, etc."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <TextareaField
          label="Internal Notes"
          placeholder="Optional notes or details..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Payroll Entry'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
