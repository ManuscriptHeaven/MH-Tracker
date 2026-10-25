import { useEffect, useState } from 'react';
import type { Task, TaskIncentive } from '../../lib/types';
import { Button, Card, Field } from '../ui';

type Props = {
  task: Task;
  incentive: TaskIncentive | null;
  onSave: (taskId: string, employeeId: string, amount: number) => Promise<void>;
  onApprove: (taskId: string) => Promise<void>;
};

/** Render only in Admin workspace; server-side RLS also protects these records. */
export function TaskIncentiveCard({ task, incentive, onSave, onApprove }: Props) {
  const [amount, setAmount] = useState(String(incentive?.amount ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setAmount(String(incentive?.amount ?? '')), [incentive]);

  async function perform(action: () => Promise<void>) {
    setError('');
    setBusy(true);
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Bonus could not be updated.'); }
    finally { setBusy(false); }
  }

  const proposed = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(proposed) && proposed > 0 &&
    Math.abs(proposed * 100 - Math.round(proposed * 100)) <= 0.000001;
  const unchanged = incentive?.status === 'draft' && valid && Math.abs(Number(incentive.amount) - proposed) < 0.000001;

  return (
    <Card className="border border-amber-200 bg-amber-50/40">
      <h3 className="font-display text-lg font-semibold text-ink">Private Task Bonus</h3>
      <p className="mt-1 text-xs text-muted">Admin only · USD · Not included in shared task data</p>
      {incentive?.status === 'approved' ? (
        <div className="mt-3 space-y-1">
          <p className="text-sm font-semibold text-emerald-800">
            Approved: {'$'}{Number(incentive.amount).toFixed(2)} · Included in payroll
          </p>
          <p className="text-xs text-muted">Locked after approval. Use an audited payroll adjustment for corrections.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <Field label="Bonus (USD)" type="number" min="0.01" step="0.01"
            value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 15.00" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary"
              disabled={busy || !task.assigned_to || !task.project_id || !valid}
              onClick={() => void perform(() => onSave(task.id, task.assigned_to!, proposed))}>
              {incentive ? 'Update proposed bonus' : 'Save proposed bonus'}
            </Button>
            {incentive?.status === 'draft' && (
              <Button type="button" disabled={busy || !unchanged || task.status !== 'Done'}
                onClick={() => {
                  if (window.confirm('Approve completed work and credit this bonus to payroll?')) {
                    void perform(() => onApprove(task.id));
                  }
                }}>Approve &amp; credit payroll</Button>
            )}
          </div>
          {incentive?.status === 'draft' && task.status !== 'Done' &&
            <p className="text-xs text-amber-800">Save the task as Done, review its work, then approve the bonus.</p>}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    </Card>
  );
}
