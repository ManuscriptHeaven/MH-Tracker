import React from 'react';
import { X, Sparkles, AlertCircle, Clock, DollarSign, FolderOpen, Bell, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAIContext } from '../../lib/ai/aiContext';
import { Button } from '../ui';
import type { DailySummaryItem, ProactiveInsight } from '../../lib/ai/aiTypes';

export function AIDailyPopup() {
  const { showDailyPopup, dismissDailyPopup, dailySummary, openChat } = useAIContext();

  if (!showDailyPopup || !dailySummary) return null;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const handleAskAI = () => {
    dismissDailyPopup();
    openChat();
  };

  const revenueChange = dailySummary.revenueSummary.change;

  return (
    <div className="fixed inset-0 z-[70] bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 ai-backdrop-in">
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white/95 dark:bg-ink/95 border border-white/20 dark:border-white/10 shadow-2xl backdrop-blur-xl ai-popup-in">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gold to-[#b89757] flex items-center justify-center shadow-lg shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-display font-semibold text-ink dark:text-white">
                {getGreeting()}! ✨
              </h2>
              <p className="text-sm text-muted">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <button
            onClick={dismissDailyPopup}
            title="Dismiss"
            aria-label="Dismiss"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-white text-muted transition hover:border-gold hover:text-ink dark:bg-charcoal dark:border-white/10 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* AI Greeting */}
          {dailySummary.greeting && (
            <p className="text-sm text-ink/80 dark:text-white/80 leading-relaxed">{dailySummary.greeting}</p>
          )}

          {/* Summary Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <SummaryCard icon={<FolderOpen className="w-4 h-4 text-info" />} label="Pending Projects" value={dailySummary.pendingProjects.count} />
            <SummaryCard icon={<Clock className="w-4 h-4 text-warning" />} label="Due Today" value={dailySummary.dueToday.count} />
            <SummaryCard icon={<AlertCircle className="w-4 h-4 text-danger" />} label="Overdue Tasks" value={dailySummary.overdueTasks.count} accent={dailySummary.overdueTasks.count > 0 ? 'danger' : undefined} />
            <SummaryCard icon={<Bell className="w-4 h-4 text-info" />} label="Unread Messages" value={dailySummary.unreadMessages} />
            <SummaryCard icon={<DollarSign className="w-4 h-4 text-success" />} label="Pending Invoices" value={dailySummary.pendingInvoices.count} subtitle={`$${dailySummary.pendingInvoices.totalAmount.toLocaleString()}`} />
            <div className="p-4 rounded-xl bg-ivory dark:bg-white/5 border border-border dark:border-white/5 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-muted">
                {revenueChange >= 0 ? <TrendingUp className="w-4 h-4 text-success" /> : <TrendingDown className="w-4 h-4 text-danger" />}
                <span className="text-xs font-medium uppercase tracking-wider">Revenue</span>
              </div>
              <div className="text-2xl font-semibold text-ink dark:text-white">
                ${dailySummary.revenueSummary.thisMonth.toLocaleString()}
              </div>
              <p className={cn("text-xs font-medium", revenueChange >= 0 ? "text-success" : "text-danger")}>
                {revenueChange >= 0 ? '↑' : '↓'} {Math.abs(revenueChange)}% vs last month
              </p>
            </div>
          </div>

          {/* Proactive Alerts */}
          {dailySummary.proactiveInsights && dailySummary.proactiveInsights.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-ink dark:text-white mb-3 uppercase tracking-wider">Insights & Alerts</h3>
              <div className="space-y-3">
                {dailySummary.proactiveInsights.map((insight: ProactiveInsight, idx: number) => (
                  <div key={idx} className={cn(
                    "p-4 rounded-xl border flex items-start gap-3",
                    insight.severity === 'critical' ? "bg-red-50 border-red-200 text-danger dark:bg-red-900/20 dark:border-red-800" :
                    insight.severity === 'warning' ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800" :
                    "bg-blue-50 border-blue-200 text-info dark:bg-blue-900/20 dark:border-blue-800"
                  )}>
                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold">{insight.title}</p>
                      <p className="text-xs mt-0.5 opacity-80">{insight.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommended Actions */}
          {dailySummary.recommendedActions && dailySummary.recommendedActions.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-ink dark:text-white mb-3 uppercase tracking-wider">Recommended Actions</h3>
              <ul className="space-y-2">
                {dailySummary.recommendedActions.map((action: string, idx: number) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-ink/80 dark:text-white/80">
                    <span className="w-1.5 h-1.5 rounded-full bg-gold mt-2 shrink-0" />
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-white/50 dark:bg-ink/50 backdrop-blur-md border-t border-border dark:border-white/10 flex items-center justify-end gap-3 rounded-b-2xl">
          <Button variant="ghost" onClick={dismissDailyPopup}>
            Dismiss for today
          </Button>
          <Button onClick={handleAskAI}>
            <Sparkles className="w-4 h-4" />
            Ask AI Assistant
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value, subtitle, accent }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  subtitle?: string;
  accent?: 'danger';
}) {
  return (
    <div className="p-4 rounded-xl bg-ivory dark:bg-white/5 border border-border dark:border-white/5 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn("text-2xl font-semibold", accent === 'danger' ? "text-danger" : "text-ink dark:text-white")}>
        {value}
      </div>
      {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
    </div>
  );
}
