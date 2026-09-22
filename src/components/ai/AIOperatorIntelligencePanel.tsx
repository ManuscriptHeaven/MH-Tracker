import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useAIContext } from '../../lib/ai/aiContext';
import { cn } from '../../lib/utils';
import type { AIOperatorPriority } from '../../lib/ai/aiTypes';

function priorityTone(severity: AIOperatorPriority['severity']) {
  if (severity === 'critical') {
    return {
      shell: 'border-rose-200 bg-rose-50',
      icon: 'text-rose-700',
      badge: 'bg-rose-100 text-rose-700',
    };
  }
  if (severity === 'warning') {
    return {
      shell: 'border-amber-200 bg-amber-50',
      icon: 'text-amber-700',
      badge: 'bg-amber-100 text-amber-700',
    };
  }
  if (severity === 'opportunity') {
    return {
      shell: 'border-emerald-200 bg-emerald-50',
      icon: 'text-emerald-700',
      badge: 'bg-emerald-100 text-emerald-700',
    };
  }
  return {
    shell: 'border-blue-200 bg-blue-50',
    icon: 'text-blue-700',
    badge: 'bg-blue-100 text-blue-700',
  };
}

export function AIOperatorIntelligencePanel() {
  const {
    operatorIntelligence,
    refreshOperatorIntelligence,
    sendMessage,
    setActiveTab,
  } = useAIContext();

  if (!operatorIntelligence) return null;

  const { telemetry, priorities } = operatorIntelligence;

  const handleCommand = (command: string) => {
    setActiveTab('chat');
    void sendMessage(command);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-ink/10 bg-[#111827] text-white shadow-sm">
      <div className="border-b border-white/10 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#f3d48c]">
                <Target className="h-3.5 w-3.5" />
                AI Operator Intelligence
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/70">
                {operatorIntelligence.scopeLabel}
              </span>
            </div>
            <h2 className="mt-3 font-display text-lg font-bold sm:text-xl">
              {operatorIntelligence.headline}
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-white/60">
              Cross-checks project, task, finance and AI outcome signals. Recommendations open in AI;
              write actions still use the normal preview and confirmation flow.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void refreshOperatorIntelligence()}
            className="inline-flex min-h-9 items-center gap-2 self-start rounded-xl border border-white/15 bg-white/5 px-3 text-[11px] font-semibold text-white/75 transition hover:bg-white/10 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh signals
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <OperatorMetric
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Query Success"
            value={telemetry.totalQueries > 0 ? telemetry.successRate + '%' : '—'}
            helper={telemetry.totalQueries > 0 ? telemetry.totalQueries + ' recent queries' : 'Starts with next command'}
          />
          <OperatorMetric
            icon={<Sparkles className="h-4 w-4" />}
            label="Clarification"
            value={telemetry.totalQueries > 0 ? telemetry.clarificationRate + '%' : '—'}
            helper={telemetry.clarificationCount + ' clarification turns'}
          />
          <OperatorMetric
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Action Verification"
            value={telemetry.actionConfirmations > 0 ? telemetry.verificationRate + '%' : '—'}
            helper={telemetry.verifiedActions + ' verified actions'}
          />
          <OperatorMetric
            icon={<TrendingUp className="h-4 w-4" />}
            label="Multi-step Plans"
            value={telemetry.multiStepPlans}
            helper={
              telemetry.averageLatencyMs > 0
                ? Math.round(telemetry.averageLatencyMs / 100) / 10 + 's avg response'
                : 'No latency sample yet'
            }
          />
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:p-5 xl:grid-cols-2">
        {priorities.slice(0, 4).map((priority) => {
          const tone = priorityTone(priority.severity);
          const noCommand =
            priority.commands.length === 0 &&
            (priority.type === 'ai_reliability' || priority.type === 'assistant_friction');

          return (
            <article
              key={priority.id}
              className={cn('rounded-xl border p-3.5 text-ink', tone.shell)}
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', tone.icon)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xs font-bold">{priority.title}</h3>
                    <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]', tone.badge)}>
                      {priority.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink/70">
                    {priority.summary}
                  </p>

                  {priority.evidence.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {priority.evidence.slice(0, 3).map((item) => (
                        <span
                          key={item}
                          className="rounded-md border border-black/5 bg-white/60 px-2 py-1 text-[9px] font-semibold text-ink/65"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {priority.commands.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {priority.commands.slice(0, 2).map((action) => (
                        <button
                          key={action.label + action.command}
                          type="button"
                          onClick={() => handleCommand(action.command)}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white/75 px-2.5 text-[10px] font-bold text-ink transition hover:bg-white"
                        >
                          <Sparkles className="h-3 w-3 text-[#8b6f38]" />
                          {action.label}
                          <ChevronRight className="h-3 w-3 text-muted" />
                        </button>
                      ))}
                    </div>
                  ) : noCommand ? (
                    <button
                      type="button"
                      onClick={() => setActiveTab('activity')}
                      className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white/75 px-2.5 text-[10px] font-bold text-ink transition hover:bg-white"
                    >
                      <Activity className="h-3 w-3 text-[#8b6f38]" />
                      Review AI activity
                      <ChevronRight className="h-3 w-3 text-muted" />
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function OperatorMetric({
  icon,
  label,
  value,
  helper,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.055] p-3">
      <div className="flex items-center gap-2 text-[#f3d48c]">
        {icon}
        <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/55">
          {label}
        </span>
      </div>
      <p className="mt-2 font-display text-xl font-bold text-white">{value}</p>
      <p className="mt-0.5 text-[9px] leading-relaxed text-white/45">{helper}</p>
    </div>
  );
}
