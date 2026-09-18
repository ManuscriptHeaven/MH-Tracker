import React from 'react';
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  FolderKanban,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAIContext } from '../../lib/ai/aiContext';
import { Button } from '../ui';
import type { ProactiveInsight } from '../../lib/ai/aiTypes';

function insightTone(severity: ProactiveInsight['severity']) {
  if (severity === 'critical') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-blue-200 bg-blue-50 text-blue-800';
}

export function AIDailyPopup() {
  const {
    showDailyPopup,
    dismissDailyPopup,
    dailySummary,
    openChat,
    sendMessage,
  } = useAIContext();

  if (!showDailyPopup || !dailySummary) return null;

  const handleAskAI = () => {
    dismissDailyPopup();
    openChat();
  };

  const handleAction = (command: string) => {
    dismissDailyPopup();
    openChat();
    void sendMessage(command);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-3 backdrop-blur-sm sm:p-4">
      <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/40 bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-white/95 px-4 py-4 backdrop-blur sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-gold shadow-xs">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8b6f38]">
                Daily AI Briefing
              </p>
              <h2 className="mt-0.5 font-display text-xl font-bold text-ink">
                {dailySummary.greeting}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted sm:text-sm">
                {dailySummary.headline}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissDailyPopup}
            title="Dismiss for today"
            aria-label="Dismiss daily briefing"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-white text-muted transition hover:border-gold/60 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-5 p-4 sm:p-6">
          <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <BriefMetric
              icon={<FolderKanban className="h-4 w-4 text-blue-700" />}
              label="Active Projects"
              value={dailySummary.pendingProjects.count}
            />
            <BriefMetric
              icon={<AlertTriangle className="h-4 w-4 text-rose-700" />}
              label="Overdue Projects"
              value={dailySummary.overdueProjects.count}
              danger={dailySummary.overdueProjects.count > 0}
            />
            <BriefMetric
              icon={<Clock3 className="h-4 w-4 text-amber-700" />}
              label="Due Today"
              value={dailySummary.dueToday.count}
            />
            <BriefMetric
              icon={<FileText className="h-4 w-4 text-purple-700" />}
              label="Awaiting Approval"
              value={dailySummary.awaitingApprovals.count}
            />
            <BriefMetric
              icon={<Bell className="h-4 w-4 text-blue-700" />}
              label="Unread Messages"
              value={dailySummary.unreadMessages}
            />
            {dailySummary.financeVisible ? (
              <BriefMetric
                icon={<CircleDollarSign className="h-4 w-4 text-emerald-700" />}
                label="Receivables"
                value={
                  '$' +
                  dailySummary.receivables.toLocaleString('en-US', {
                    maximumFractionDigits: 0,
                  })
                }
              />
            ) : (
              <BriefMetric
                icon={<AlertTriangle className="h-4 w-4 text-amber-700" />}
                label="Overdue Tasks"
                value={dailySummary.overdueTasks.count}
              />
            )}
          </section>

          {dailySummary.proactiveInsights.length > 0 ? (
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-bold text-ink">
                    Needs Attention
                  </h3>
                  <p className="text-[11px] text-muted">
                    Detected from live project, task and finance data.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {dailySummary.proactiveInsights.slice(0, 4).map((insight) => (
                  <div
                    key={insight.type + '-' + (insight.relatedId || insight.title)}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-3.5',
                      insightTone(insight.severity),
                    )}
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold">{insight.title}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed opacity-85">
                        {insight.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-bold text-emerald-800">No urgent blockers detected.</p>
              <p className="mt-1 text-xs text-emerald-700">
                The current workspace does not show an overdue or stalled item that needs immediate attention.
              </p>
            </section>
          )}

          <section>
            <div className="mb-3">
              <h3 className="font-display text-base font-bold text-ink">
                Recommended Next Actions
              </h3>
              <p className="text-[11px] text-muted">
                Open any recommendation in AI. Write actions still require confirmation.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {dailySummary.recommendedActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => handleAction(action.command)}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-[#fcfbf8] p-3.5 text-left transition hover:border-gold/60 hover:bg-gold/[0.045]"
                >
                  <span
                    className={cn(
                      'mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full',
                      action.priority === 'high'
                        ? 'bg-rose-500'
                        : action.priority === 'medium'
                          ? 'bg-amber-500'
                          : 'bg-emerald-500',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-ink">{action.title}</span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                      {action.description}
                    </span>
                  </span>
                  <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted/50 transition group-hover:text-[#7a5518]" />
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-border bg-white/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] text-muted">
            Generated from live Tracker data · dismissal lasts until tomorrow
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={dismissDailyPopup}>
              Dismiss for today
            </Button>
            <Button onClick={handleAskAI}>
              <Sparkles className="h-4 w-4" />
              Open AI
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function BriefMetric({
  icon,
  label,
  value,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-[#faf9f6] p-3.5">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-[9px] font-bold uppercase tracking-[0.1em]">{label}</span>
      </div>
      <p
        className={cn(
          'mt-2 font-display text-xl font-bold sm:text-2xl',
          danger ? 'text-rose-700' : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  );
}
