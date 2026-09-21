import { useEffect, useState } from 'react';
import { Clock3, PauseCircle, UploadCloud } from 'lucide-react';
import { formatDate } from '../lib/date';
import { formatClockDuration, getProjectClockSnapshot } from '../lib/timeline';
import type { Project } from '../lib/types';
import { cn } from '../lib/utils';

export function StageClock({
  project,
  compact = false,
  showFinalDue = true,
}: {
  project: Project;
  compact?: boolean;
  showFinalDue?: boolean;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const clock = getProjectClockSnapshot(project, now);

  const tone =
    clock.mode === 'waiting_files'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : clock.mode === 'client_wait'
        ? 'border-violet-200 bg-violet-50 text-violet-900'
        : clock.riskLevel === 'overdue' || clock.riskLevel === 'red'
          ? 'border-red-200 bg-red-50 text-red-800'
          : clock.riskLevel === 'amber'
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : clock.mode === 'production'
              ? 'border-blue-200 bg-blue-50 text-blue-800'
              : 'border-border bg-ivory text-muted';

  const Icon =
    clock.mode === 'waiting_files'
      ? UploadCloud
      : clock.mode === 'client_wait'
        ? PauseCircle
        : Clock3;

  const primary =
    clock.mode === 'waiting_files'
      ? `Waiting for client files · ${formatClockDuration(clock.seconds)}`
      : clock.mode === 'client_wait'
        ? `Client wait · ${formatClockDuration(clock.seconds)}`
        : clock.mode === 'production'
          ? clock.isOverdue
            ? `Overdue · ${formatClockDuration(clock.seconds)}`
            : `Remaining · ${formatClockDuration(clock.seconds)}`
          : 'No active timer';

  if (compact) {
    return (
      <div className={cn('rounded-lg border px-2.5 py-2 text-[11px] font-semibold', tone)}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{primary}</span>
          </span>
          {clock.mode === 'client_wait' || clock.mode === 'waiting_files' ? (
            <span className="shrink-0 text-[9px] uppercase tracking-wide opacity-70">Production paused</span>
          ) : null}
        </div>
        {clock.riskLabel ? (
          <p className="mt-1 text-[10px] font-bold uppercase tracking-wide">{clock.riskLabel}</p>
        ) : null}
        {showFinalDue && clock.projectedFinalDueDate ? (
          <p className="mt-1 text-[10px] font-medium opacity-75">
            {clock.originalDueDate && clock.originalDueDate !== clock.projectedFinalDueDate
              ? `Original ${formatDate(clock.originalDueDate)} → Current ${formatDate(clock.projectedFinalDueDate)}`
              : `Project due ${formatDate(clock.projectedFinalDueDate)}`}
            {clock.dueShiftDays && clock.dueShiftDays > 0 ? ` · +${clock.dueShiftDays}d` : ''}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border p-3', tone)}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/70">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-70">
            {clock.mode === 'client_wait'
              ? 'Client Wait Clock'
              : clock.mode === 'waiting_files'
                ? 'Client Action'
                : 'Production Countdown'}
          </p>
          <p className="mt-0.5 text-sm font-bold">{primary}</p>
          {clock.mode === 'client_wait' || clock.mode === 'waiting_files' ? (
            <p className="mt-1 text-[11px] opacity-75">
              Manuscript Heaven production time is paused.
            </p>
          ) : null}
          {clock.riskLabel ? (
            <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.08em]">{clock.riskLabel}</p>
          ) : null}
          {showFinalDue && clock.projectedFinalDueDate ? (
            <div className="mt-1 space-y-0.5 text-[11px] font-medium opacity-80">
              {clock.originalDueDate ? (
                <p>Original due: {formatDate(clock.originalDueDate)}</p>
              ) : null}
              <p>
                Current due: {formatDate(clock.projectedFinalDueDate)}
                {clock.dueShiftDays && clock.dueShiftDays > 0 ? ` · +${clock.dueShiftDays}d schedule shift` : ''}
              </p>
              {clock.mode === 'client_wait' || clock.mode === 'waiting_files' ? (
                <p>Current due is moving with client wait.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
