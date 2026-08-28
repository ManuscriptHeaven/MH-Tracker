import { AlertTriangle, Ban, Check, Circle, Pause } from 'lucide-react';
import { formatDate } from '../lib/date';
import { cn } from '../lib/utils';
import { getTimelineMilestones, getTimelineSummary } from '../lib/timeline';
import type { Project } from '../lib/types';

function healthClass(health: string) {
  switch (health) {
    case 'Overdue':
      return 'border-red-200 bg-red-50 text-danger';
    case 'Waiting for Client':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'Completed':
      return 'border-green-200 bg-green-50 text-success';
    case 'Due Today':
    case 'Due Tomorrow':
      return 'border-yellow-200 bg-yellow-50 text-yellow-800';
    default:
      return 'border-blue-100 bg-blue-50 text-blue-700';
  }
}

function MilestoneIcon({ state }: { state: string }) {
  if (state === 'completed') {
    return <Check className="h-3.5 w-3.5" />;
  }

  if (state === 'paused') {
    return <Pause className="h-3.5 w-3.5" />;
  }

  if (state === 'revision') {
    return <AlertTriangle className="h-3.5 w-3.5 text-orange-600" />;
  }

  if (state === 'overdue') {
    return <AlertTriangle className="h-3.5 w-3.5" />;
  }

  if (state === 'skipped') {
    return <Ban className="h-3.5 w-3.5 text-slate-400" />;
  }

  return <Circle className="h-3.5 w-3.5" />;
}

export function TimelineBadge({ project }: { project: Project }) {
  const summary = getTimelineSummary(project);

  return (
    <span className={cn('inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold', healthClass(summary.health))}>
      {summary.health}
    </span>
  );
}

export function ProjectTimelineCompact({ project }: { project: Project }) {
  const summary = getTimelineSummary(project);

  return (
    <div className="min-w-56 space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-ink">{summary.stage}</span>
        <TimelineBadge project={project} />
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ivory">
        <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${summary.progress}%` }} />
      </div>
      <p className="text-xs text-muted">
        {summary.nextMilestone}
        {summary.dueDate ? ` | Due ${formatDate(summary.dueDate)}` : summary.waitingOn === 'Client' ? ' | Paused' : ''}
        {summary.finalDueDate && summary.finalDueDate !== summary.dueDate ? ` | Final ${formatDate(summary.finalDueDate)}` : ''}
      </p>
    </div>
  );
}

export function ProjectTimelinePanel({ project, clientView = false }: { project: Project; clientView?: boolean }) {
  const summary = getTimelineSummary(project);
  const milestones = getTimelineMilestones(project);

  const daysRemainingText =
    summary.waitingOn === 'Client' || summary.timelineStatus === 'Paused'
      ? 'Paused'
      : summary.daysRemaining === null
        ? 'Not active'
        : summary.daysRemaining < 0
          ? `${Math.abs(summary.daysRemaining)} day${Math.abs(summary.daysRemaining) === 1 ? '' : 's'} overdue`
          : `${summary.daysRemaining} production day${summary.daysRemaining === 1 ? '' : 's'}`;

  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Official Production Timeline</p>
          <h3 className="mt-1 font-display text-xl font-semibold text-ink">{summary.stage}</h3>
          <p className="mt-1 text-sm text-muted">{summary.nextMilestone}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TimelineBadge project={project} />
          <span className="inline-flex min-h-7 items-center rounded-full border border-border bg-ivory px-2.5 text-xs font-semibold text-muted">
            {summary.progress}% complete
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-5">
        <Info label="Timeline Status" value={summary.timelineStatus} />
        <Info label="Waiting On" value={summary.waitingOn} />
        <Info label="Current Due Date" value={summary.waitingOn === 'Client' ? 'Paused' : summary.dueDate ? formatDate(summary.dueDate) : 'Paused'} />
        <Info label="Final Due Date" value={summary.finalDueDate ? formatDate(summary.finalDueDate) : 'Not set'} />
        <Info
          label="Days Remaining"
          value={daysRemainingText}
          valueClass={summary.isOverdue ? 'text-danger' : summary.waitingOn === 'Client' ? 'text-amber-800' : undefined}
        />
      </div>

      {summary.clientActionRequired ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          {clientView ? 'Your action: ' : 'Client Action Required: '}
          {summary.clientActionRequired}
        </div>
      ) : null}

      {/* Desktop Horizontal Timeline (md and above) */}
      <div className="mt-5 hidden md:block overflow-x-auto">
        <div className="grid min-w-[900px] gap-2" style={{ gridTemplateColumns: `repeat(${milestones.length}, minmax(0, 1fr))` }}>
          {milestones.map((milestone, index) => (
            <div key={milestone.key} className="relative">
              {index > 0 ? <div className="absolute -left-2 top-4 h-px w-2 bg-border" /> : null}
              <div
                className={cn(
                  'grid gap-1.5 rounded-md border px-2 py-3 text-center text-xs min-h-[110px] flex flex-col justify-between',
                  milestone.state === 'completed' && 'border-green-200 bg-green-50 text-success',
                  milestone.state === 'current' && 'border-blue-200 bg-blue-50 text-blue-800 ring-2 ring-blue-400/40',
                  milestone.state === 'paused' && 'border-amber-200 bg-amber-50 text-amber-800',
                  milestone.state === 'revision' && 'border-orange-200 bg-orange-50 text-orange-900 ring-2 ring-orange-400/40',
                  milestone.state === 'overdue' && 'border-red-200 bg-red-50 text-danger ring-2 ring-red-400/40',
                  milestone.state === 'skipped' && 'border-slate-300 bg-slate-100 text-slate-500 opacity-75',
                  milestone.state === 'future' && 'border-border bg-ivory text-muted',
                )}
              >
                <div>
                  <span className="mx-auto mb-1 grid h-7 w-7 place-items-center rounded-full border bg-white shadow-xs">
                    <MilestoneIcon state={milestone.state} />
                  </span>
                  <span className="font-semibold block leading-tight">{milestone.label}</span>
                </div>
                <div>
                  <span className="text-[10px] font-medium block opacity-80">
                    {milestone.state === 'skipped'
                      ? (milestone.skipLabel || 'Skipped')
                      : milestone.state === 'completed'
                        ? 'Completed'
                        : milestone.state === 'paused'
                          ? 'Waiting for Client'
                          : milestone.state === 'revision'
                            ? 'Revision Required'
                            : milestone.state === 'current'
                              ? 'In Progress'
                              : milestone.isApproval
                                ? 'Approval Stage'
                                : `${milestone.durationDays} days`}
                  </span>
                  <span className="text-[11px] block mt-0.5">{milestone.state === 'skipped' ? '⊘ Skipped' : milestone.date ? formatDate(milestone.date) : 'Pending'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile Vertical Timeline (< md) */}
      <div className="mt-5 block md:hidden space-y-1">
        {milestones.map((milestone, index) => {
          const isLast = index === milestones.length - 1;

          return (
            <div key={milestone.key} className="flex flex-col items-stretch">
              <div
                className={cn(
                  'flex items-center justify-between rounded-xl border p-3 text-xs transition shadow-xs',
                  milestone.state === 'completed' && 'border-green-200 bg-green-50/70 text-success',
                  milestone.state === 'current' && 'border-blue-300 bg-blue-50 text-blue-900 ring-2 ring-blue-400/40 font-semibold',
                  milestone.state === 'paused' && 'border-amber-300 bg-amber-50 text-amber-900 ring-2 ring-amber-400/40 font-semibold',
                  milestone.state === 'revision' && 'border-orange-300 bg-orange-50 text-orange-950 ring-2 ring-orange-400/40 font-semibold',
                  milestone.state === 'overdue' && 'border-red-300 bg-red-50 text-danger ring-2 ring-red-400/40 font-semibold',
                  milestone.state === 'future' && 'border-border bg-white text-muted',
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={cn(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold shadow-xs',
                      milestone.state === 'completed' && 'bg-green-600 text-white border-green-600',
                      milestone.state === 'current' && 'bg-blue-600 text-white border-blue-600 animate-pulse',
                      milestone.state === 'paused' && 'bg-amber-500 text-white border-amber-500',
                      milestone.state === 'revision' && 'bg-orange-500 text-white border-orange-500',
                      milestone.state === 'overdue' && 'bg-red-600 text-white border-red-600',
                      milestone.state === 'future' && 'bg-ivory text-muted border-border',
                    )}
                  >
                    {milestone.state === 'completed' ? (
                      '✓'
                    ) : milestone.state === 'current' ? (
                      '●'
                    ) : milestone.state === 'paused' ? (
                      '⏸'
                    ) : milestone.state === 'revision' ? (
                      '⚠'
                    ) : (
                      '○'
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold truncate text-ink">{milestone.label}</p>
                    <p className="text-[10px] opacity-75 font-normal">
                      {milestone.state === 'completed'
                        ? 'Completed'
                        : milestone.state === 'paused'
                          ? 'Waiting for Client'
                          : milestone.state === 'revision'
                            ? 'Revision Required'
                            : milestone.state === 'current'
                              ? 'Currently in progress'
                              : milestone.isApproval
                                ? 'Client Approval Stage'
                                : `${milestone.durationDays} production days`}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0 pl-2">
                  <span className="text-[11px] font-semibold text-charcoal block">
                    {milestone.date ? formatDate(milestone.date) : milestone.state === 'completed' ? 'Done' : 'Pending'}
                  </span>
                </div>
              </div>

              {!isLast ? (
                <div className="flex items-center justify-center py-1 text-muted text-xs font-bold select-none opacity-60">
                  ↓
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Info({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-md bg-ivory px-3 py-2">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn('mt-1 font-semibold text-ink', valueClass)}>{value}</p>
    </div>
  );
}

