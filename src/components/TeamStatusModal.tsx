import React, { useState } from 'react';
import { CalendarDays, ShieldAlert, X } from 'lucide-react';
import type { EmploymentCondition, Profile } from '../lib/types';

export const employmentConditionLabels: Record<EmploymentCondition, string> = {
  active: 'Active',
  holiday: 'On Holiday',
  leave: 'On Leave',
  resigned: 'Resigned / Left',
  retired: 'Retired',
  terminated: 'Terminated / Fired',
};

const archivedConditions: EmploymentCondition[] = ['resigned', 'retired', 'terminated'];
const temporaryConditions: EmploymentCondition[] = ['holiday', 'leave'];

export function effectiveEmploymentCondition(profile: Profile): string {
  if (profile.status === 'inactive' && !archivedConditions.includes(profile.employment_condition || 'active')) {
    return 'Inactive';
  }
  const condition = profile.employment_condition || 'active';
  if (temporaryConditions.includes(condition)) {
    const now = new Date();
    const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    if (profile.condition_start_date && today < profile.condition_start_date) {
      return condition === 'holiday' ? 'Holiday Scheduled' : 'Leave Scheduled';
    }
    if (profile.condition_end_date && today > profile.condition_end_date) return 'Active';
  }
  return employmentConditionLabels[condition];
}

export function TeamStatusModal({
  profile,
  pendingTasks,
  openProjects,
  onClose,
  onSave,
}: {
  profile: Profile;
  pendingTasks: number;
  openProjects: number;
  onClose: () => void;
  onSave: (condition: EmploymentCondition, startDate?: string | null, endDate?: string | null, reason?: string) => Promise<void>;
}) {
  const [condition, setCondition] = useState<EmploymentCondition>(profile.employment_condition || 'active');
  const [startDate, setStartDate] = useState(profile.condition_start_date || '');
  const [endDate, setEndDate] = useState(profile.condition_end_date || '');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archiving = archivedConditions.includes(condition);
  const temporary = temporaryConditions.includes(condition);
  const blocked = archiving && (pendingTasks > 0 || openProjects > 0);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setError(null);
    if (temporary && (!startDate || !endDate || endDate < startDate)) {
      setError('Please enter a valid start and end date.');
      return;
    }
    if (archiving && (blocked || !confirmed)) {
      setError('Reassign any unfinished work, then confirm the access change.');
      return;
    }
    if (archiving && reason.trim().length < 3) {
      setError('Please add a short reason for the employment change.');
      return;
    }
    setWorking(true);
    try {
      await onSave(condition, temporary ? startDate : null, temporary ? endDate : null, reason.trim());
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update team member status.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/55 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="team-status-dialog-title"
        className="my-auto w-full max-w-lg rounded-2xl border border-border bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="team-status-dialog-title" className="font-display text-xl font-bold text-ink">
              Manage Employee Status
            </h2>
            <p className="mt-1 text-sm text-muted">{profile.full_name} · {profile.email}</p>
          </div>
          <button type="button" onClick={onClose} disabled={working}
            aria-label="Close employee status dialog"
            className="rounded-lg p-2 text-muted hover:bg-ivory"><X className="h-5 w-5" /></button>
        </div>
        <form className="mt-5 space-y-4" onSubmit={handleSave}>
          <label className="block text-sm font-semibold text-ink">
            Employment Status
            <select value={condition} onChange={(event) => {
              setCondition(event.target.value as EmploymentCondition);
              setConfirmed(false);
              setError(null);
            }} className="mt-1.5 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-ink">
              {Object.entries(employmentConditionLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          {temporary && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-ink">
                <CalendarDays className="mr-1 inline h-3.5 w-3.5 text-gold" /> Start Date
                <input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)}
                  className="mt-1.5 block w-full rounded-xl border border-border px-3 py-2.5 text-sm" />
              </label>
              <label className="block text-xs font-semibold text-ink">
                <CalendarDays className="mr-1 inline h-3.5 w-3.5 text-gold" /> End Date
                <input type="date" required value={endDate} min={startDate || undefined}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="mt-1.5 block w-full rounded-xl border border-border px-3 py-2.5 text-sm" />
              </label>
            </div>
          )}
          {archiving && (
            <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5">
              <div className="flex items-start gap-2 text-sm text-rose-800">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p>This archives the employee and disables their MH Tracker work access. Payroll, attendance, completed projects and audit history are preserved.</p>
              </div>
              {blocked && (
                <p className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-800">
                  Before proceeding, reassign {pendingTasks} unfinished task(s) and {openProjects} active project(s).
                </p>
              )}
              <label className="block text-xs font-semibold text-ink">
                Internal reason (admin audit only)
                <textarea required rows={2} value={reason} onChange={(event) => setReason(event.target.value)}
                  className="mt-1 w-full resize-y rounded-lg border border-border bg-white px-3 py-2 text-sm"
                  placeholder="Record the employment change reason" />
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-xs font-medium text-ink">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5" />
                I confirm the employee should be archived and their access disabled.
              </label>
            </div>
          )}
          {temporary && (
            <p className="rounded-xl border border-border bg-ivory/50 p-3 text-xs text-muted">
              Holiday or leave keeps the account and existing work history. The status displays as active again after the end date.
            </p>
          )}
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} disabled={working}
              className="min-h-10 rounded-xl border border-border px-4 text-sm font-semibold text-ink">Cancel</button>
            <button type="submit" disabled={working || blocked || (archiving && !confirmed)}
              className="min-h-10 rounded-xl bg-[#cbaa67] px-4 text-sm font-bold text-[#1c1c1c] disabled:cursor-not-allowed disabled:opacity-50">
              {working ? 'Saving...' : archiving ? 'Confirm & Archive' : 'Save Status'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
