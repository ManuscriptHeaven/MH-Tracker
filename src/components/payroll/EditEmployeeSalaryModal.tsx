import React, { useState } from 'react';
import { Button, Field, Modal, SelectField, TextareaField } from '../ui';
import type { CurrencyCode, EmployeeCompensation, Profile, SalaryType } from '../../lib/types';

export function EditEmployeeSalaryModal({
  profile,
  compensation,
  onClose,
  onSave,
}: {
  profile: Profile;
  compensation?: EmployeeCompensation;
  onClose: () => void;
  onSave: (employeeId: string, updates: Partial<EmployeeCompensation>) => Promise<void>;
}) {
  const [monthlySalary, setMonthlySalary] = useState(String(compensation?.monthly_salary || ''));
  const [perProjectRate, setPerProjectRate] = useState(String(compensation?.per_project_rate || ''));
  const [salaryType, setSalaryType] = useState<SalaryType>(compensation?.salary_type || 'Monthly');
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>(compensation?.default_currency || 'USD');
  const [joiningDate, setJoiningDate] = useState(compensation?.joining_date || '');
  const [responsibilities, setResponsibilities] = useState(compensation?.responsibilities || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numSalary = Number(monthlySalary);
    const numRate = Number(perProjectRate);
    if (isNaN(numSalary) || numSalary < 0) {
      setError('Please enter a valid monthly salary.');
      return;
    }
    if (isNaN(numRate) || numRate < 0) {
      setError('Please enter a valid per-project rate.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      await onSave(profile.id, {
        monthly_salary: numSalary,
        per_project_rate: numRate,
        salary_type: salaryType,
        default_currency: defaultCurrency,
        joining_date: joiningDate || null,
        responsibilities: responsibilities.trim(),
      });
      onClose();
    } catch (err: unknown) {
      console.error('Error saving compensation:', err);
      let msg = 'Failed to update employee compensation.';
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
    <Modal title={`Compensation & Salary — ${profile.full_name}`} onClose={onClose} width="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <div className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-danger">{error}</div> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Salary Type *"
            value={salaryType}
            onChange={(e) => setSalaryType(e.target.value as SalaryType)}
            required
          >
            <option value="Monthly">Monthly Fixed</option>
            <option value="Per Project">Per Project Commission</option>
            <option value="Per Task">Per Task / Hourly</option>
          </SelectField>

          <SelectField
            label="Base Currency *"
            value={defaultCurrency}
            onChange={(e) => setDefaultCurrency(e.target.value as CurrencyCode)}
            required
          >
            <option value="USD">USD ($)</option>
            <option value="PKR">PKR (Rs)</option>
          </SelectField>

          <Field
            label="Monthly Salary Amount *"
            type="number"
            min="0"
            step="any"
            required
            placeholder="0.00"
            value={monthlySalary}
            onChange={(e) => setMonthlySalary(e.target.value)}
          />

          <Field
            label="Per Project Rate"
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={perProjectRate}
            onChange={(e) => setPerProjectRate(e.target.value)}
          />

          <Field
            label="Joining Date"
            type="date"
            value={joiningDate}
            onChange={(e) => setJoiningDate(e.target.value)}
            className="sm:col-span-2"
          />
        </div>

        <TextareaField
          label="Responsibilities & Notes"
          placeholder="Primary role responsibilities or compensation notes..."
          value={responsibilities}
          onChange={(e) => setResponsibilities(e.target.value)}
          rows={3}
        />

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Compensation'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
