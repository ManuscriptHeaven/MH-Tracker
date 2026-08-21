import React, { useState } from 'react';
import { Button, Field, Modal, SelectField, TextareaField } from '../ui';
import type { CurrencyCode, EmployeeLedgerEntry, Profile, Project } from '../../lib/types';
import { formatMonthLabel } from '../../lib/payrollUtils';

const ENTRY_TYPES: Array<{
  type: EmployeeLedgerEntry['entry_type'];
  label: string;
  emoji: string;
  hint: string;
}> = [
  {
    type: 'Project Payment',
    label: 'Project Earning',
    emoji: '💼',
    hint: 'Add commission or earnings for a specific project milestone.',
  },
  {
    type: 'Bonus',
    label: 'Bonus / Reward',
    emoji: '🎁',
    hint: 'Reward for good performance or milestone delivery.',
  },
  {
    type: 'Advance',
    label: 'Cash Advance',
    emoji: '💸',
    hint: 'Mid-month loan or advance payment given to the employee.',
  },
  {
    type: 'Deduction',
    label: 'Deduction',
    emoji: '✂️',
    hint: 'Advance repayment or expense adjustment (reduces payable).',
  },
  {
    type: 'Salary',
    label: 'Salary Adjustment',
    emoji: '💵',
    hint: 'Base pay adjustment or stipend for this month.',
  },
  {
    type: 'Other',
    label: 'Other',
    emoji: '📌',
    hint: 'Custom addition or adjustment.',
  },
];

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
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedTypeInfo = ENTRY_TYPES.find((t) => t.type === entryType) || ENTRY_TYPES[0];

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
        payment_method: entryType === 'Advance' || entryType === 'Payment' ? paymentMethod : null,
        project_id: projectId || null,
        description: description.trim() || undefined,
        status: entryType === 'Payment' ? 'Paid' : 'Pending',
        notes: description.trim() || `${selectedTypeInfo.label} recorded for ${formatMonthLabel(payrollMonth)}`,
        paid_at: date,
      });
      onClose();
    } catch (err: unknown) {
      console.error('Error saving payroll entry:', err);
      let msg = 'Failed to save payroll entry.';
      if (err instanceof Error) {
        msg = err.message;
      } else if (err && typeof err === 'object') {
        const anyErr = err as Record<string, unknown>;
        msg = String(anyErr.message || anyErr.details || anyErr.error_description || msg);
      }
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Add Team Entry" onClose={onClose} width="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-danger">{error}</div>
        ) : null}

        {/* 1. Select Entry Type visual pills */}
        <div>
          <label className="block text-xs font-bold text-ink mb-2">What kind of entry do you want to add?</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ENTRY_TYPES.map((t) => {
              const isSelected = entryType === t.type;
              return (
                <button
                  key={t.type}
                  type="button"
                  onClick={() => setEntryType(t.type)}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-xs transition ${
                    isSelected
                      ? 'border-gold bg-gold/15 font-bold text-ink shadow-sm ring-1 ring-gold'
                      : 'border-border bg-white text-charcoal hover:bg-ivory'
                  }`}
                >
                  <span className="text-base">{t.emoji}</span>
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted mt-1.5 bg-ivory p-2 rounded border border-border/50">
            ℹ️ {selectedTypeInfo.hint}
          </p>
        </div>

        {/* 2. Employee & Month */}
        <div className="grid gap-3 sm:grid-cols-2">
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

          <Field
            label="Payroll Month *"
            type="month"
            required
            value={payrollMonth}
            onChange={(e) => setPayrollMonth(e.target.value)}
          />
        </div>

        {/* 3. Amount & Currency */}
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

        {/* 4. Project (if project earning) or Payment method (if advance) */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Date *"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />

          {entryType === 'Project Payment' ? (
            <SelectField
              label="Linked Project (Optional)"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">No specific project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_number} - {p.project_title}
                </option>
              ))}
            </SelectField>
          ) : entryType === 'Advance' ? (
            <SelectField
              label="Disbursement Method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="Cash">Cash</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Wise">Wise</option>
              <option value="PayPal">PayPal</option>
            </SelectField>
          ) : null}
        </div>

        {/* 5. Description / Note */}
        <Field
          label="Reason / Description (Optional)"
          placeholder="e.g. Formatting completed for Atlas project, Travel advance, etc."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : `Add ${selectedTypeInfo.label}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
