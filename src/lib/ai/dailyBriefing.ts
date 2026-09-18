import { daysUntil, formatDate, isDueToday, isOverdue, todayInput } from '../date';
import { firstName, isClientRole } from '../utils';
import type { Profile, Project, Task, TrackerData } from '../types';
import type {
  DailyRecommendedAction,
  DailySummary,
  DailySummaryItem,
  ProactiveInsight,
} from './aiTypes';

function isClosedProject(project: Project) {
  const status = String(project.status || '').toLowerCase();
  const lifecycle = String(project.project_status || '').toLowerCase();
  return (
    ['completed', 'delivered', 'cancelled', 'archived'].includes(status) ||
    ['completed', 'cancelled', 'archived'].includes(lifecycle)
  );
}

function isAwaitingApproval(project: Project) {
  const status = String(project.status || '').toLowerCase();
  const stageStatus = String(project.stage_status || '').toLowerCase();
  const stage = String(project.current_stage || '').toLowerCase();
  return (
    status.includes('awaiting client approval') ||
    stageStatus === 'paused_client_review' ||
    (stage.includes('approval') && project.waiting_on === 'Client')
  );
}

function ageInDays(value?: string | null) {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

function projectItem(project: Project, urgency: DailySummaryItem['urgency']): DailySummaryItem {
  return {
    id: project.id,
    title: project.project_title,
    subtitle: [project.client_name, project.due_date ? formatDate(project.due_date) : null]
      .filter(Boolean)
      .join(' · '),
    urgency,
  };
}

function taskItem(task: Task): DailySummaryItem {
  return {
    id: task.id,
    title: task.title,
    subtitle: task.due_date ? 'Due ' + formatDate(task.due_date) : undefined,
    urgency: task.priority === 'Urgent' ? 'critical' : 'high',
  };
}

function latestInvoices(data: TrackerData) {
  const latest = new Map<string, (NonNullable<TrackerData['invoices']>[number])>();

  for (const invoice of data.invoices || []) {
    const logicalId = invoice.logical_invoice_id || invoice.id;
    const current = latest.get(logicalId);
    const version = Number(invoice.version_number || 1);
    const currentVersion = Number(current?.version_number || 0);
    if (!current || version >= currentVersion) {
      latest.set(logicalId, invoice);
    }
  }

  return Array.from(latest.values());
}

function unreadMessageCount(data: TrackerData, currentProfileId: string) {
  const memberships = (data.conversationMembers || []).filter(
    (member) => member.user_id === currentProfileId,
  );
  if (memberships.length === 0) return 0;

  const membershipByConversation = new Map(
    memberships.map((member) => [member.conversation_id, member]),
  );

  return (data.messages || []).filter((message) => {
    if (message.sender_id === currentProfileId) return false;
    const membership = membershipByConversation.get(message.conversation_id);
    if (!membership) return false;

    const lastRead = membership.last_read_at
      ? new Date(membership.last_read_at).getTime()
      : 0;
    const created = new Date(message.created_at).getTime();
    return Number.isFinite(created) && created > lastRead;
  }).length;
}

function monthlyOrderRevenue(projects: Project[], monthKey: string) {
  return projects
    .filter((project) => {
      if (isClosedProject(project)) return false;
      if (Number(project.total_price || 0) <= 0) return false;
      return String(project.created_at || '').slice(0, 7) === monthKey;
    })
    .reduce((sum, project) => sum + Number(project.total_price || 0), 0);
}

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function previousMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
}

function severityRank(severity: ProactiveInsight['severity']) {
  return severity === 'critical' ? 0 : severity === 'warning' ? 1 : 2;
}

export function buildDailyBriefing({
  data,
  visibleProjects,
  visibleTasks,
  currentProfile,
}: {
  data: TrackerData;
  visibleProjects: Project[];
  visibleTasks: Task[];
  currentProfile: Profile;
}): DailySummary {
  const activeProjects = visibleProjects.filter((project) => !isClosedProject(project));
  const overdueProjects = activeProjects
    .filter(isOverdue)
    .sort((a, b) => daysUntil(a.due_date) - daysUntil(b.due_date));
  const dueTodayProjects = activeProjects.filter(isDueToday);
  const awaitingApprovals = activeProjects
    .filter(isAwaitingApproval)
    .sort((a, b) => ageInDays(b.updated_at) - ageInDays(a.updated_at));

  const overdueTasks = visibleTasks
    .filter(
      (task) =>
        !task.archived_at &&
        task.status !== 'Done' &&
        Boolean(task.due_date) &&
        daysUntil(task.due_date) < 0,
    )
    .sort((a, b) => daysUntil(a.due_date) - daysUntil(b.due_date));

  const financeVisible = currentProfile.role === 'admin';
  const activeReceivables = financeVisible
    ? activeProjects.reduce(
        (sum, project) =>
          sum +
          Math.max(
            Number(project.remaining_balance || 0),
            Number(project.total_price || 0) - Number(project.advance_paid || 0),
            0,
          ),
        0,
      )
    : 0;

  const invoiceRows = financeVisible ? latestInvoices(data) : [];
  const pendingInvoiceRows = invoiceRows.filter(
    (invoice) => invoice.status !== 'Paid' && Number(invoice.total_due || 0) > 0,
  );
  const pendingInvoices = {
    count: pendingInvoiceRows.length,
    totalAmount: pendingInvoiceRows.reduce(
      (sum, invoice) => sum + Number(invoice.total_due || 0),
      0,
    ),
  };

  const now = new Date();
  const currentMonthKey = monthKey(now);
  const previousMonthKey = monthKey(previousMonth(now));
  const thisMonthRevenue = financeVisible
    ? monthlyOrderRevenue(visibleProjects, currentMonthKey)
    : 0;
  const lastMonthRevenue = financeVisible
    ? monthlyOrderRevenue(visibleProjects, previousMonthKey)
    : 0;
  const revenueChange =
    financeVisible && lastMonthRevenue > 0
      ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : financeVisible && thisMonthRevenue > 0
        ? 100
        : 0;

  const insights: ProactiveInsight[] = [];

  for (const project of overdueProjects.slice(0, 3)) {
    const overdueDays = Math.abs(daysUntil(project.due_date));
    insights.push({
      type: 'late_project',
      title: project.project_title + ' is overdue',
      description:
        project.client_name +
        ' · ' +
        overdueDays +
        ' day' +
        (overdueDays === 1 ? '' : 's') +
        ' overdue' +
        (project.assigned_to ? ' · action needed from the team' : ' · currently unassigned'),
      severity: overdueDays >= 4 ? 'critical' : 'warning',
      relatedId: project.id,
    });
  }

  for (const project of awaitingApprovals.slice(0, 2)) {
    const waitingDays = ageInDays(project.updated_at);
    if (waitingDays >= 3) {
      insights.push({
        type: 'approval_stall',
        title: 'Client approval is waiting',
        description:
          project.project_title +
          ' for ' +
          project.client_name +
          ' has been waiting around ' +
          waitingDays +
          ' days.',
        severity: waitingDays >= 7 ? 'critical' : 'warning',
        relatedId: project.id,
      });
    }
  }

  const missingFiles = activeProjects
    .filter(
      (project) =>
        (project.status === 'Files Required' || project.waiting_on === 'Client') &&
        ageInDays(project.updated_at) >= 3,
    )
    .slice(0, 2);

  for (const project of missingFiles) {
    insights.push({
      type: 'missing_files',
      title: 'Client input may be blocking progress',
      description:
        project.project_title +
        ' for ' +
        project.client_name +
        ' is still waiting on client-side files or input.',
      severity: 'warning',
      relatedId: project.id,
    });
  }

  const upcoming = activeProjects
    .filter((project) => {
      const days = daysUntil(project.due_date);
      return Number.isFinite(days) && days > 0 && days <= 3;
    })
    .sort((a, b) => daysUntil(a.due_date) - daysUntil(b.due_date))
    .slice(0, 2);

  for (const project of upcoming) {
    const days = daysUntil(project.due_date);
    insights.push({
      type: 'upcoming_deadline',
      title: 'Deadline approaching',
      description:
        project.project_title +
        ' is due in ' +
        days +
        ' day' +
        (days === 1 ? '' : 's') +
        ' for ' +
        project.client_name +
        '.',
      severity: days === 1 ? 'warning' : 'info',
      relatedId: project.id,
    });
  }

  for (const task of overdueTasks.slice(0, 2)) {
    insights.push({
      type: 'overdue_task',
      title: 'Task is overdue',
      description:
        task.title +
        (task.due_date ? ' · due ' + formatDate(task.due_date) : ''),
      severity: task.priority === 'Urgent' ? 'critical' : 'warning',
      relatedId: task.id,
    });
  }

  if (!isClientRole(currentProfile.role)) {
    const workload = data.profiles
      .filter((profile) => !isClientRole(profile.role))
      .map((profile) => ({
        profile,
        count: activeProjects.filter((project) => project.assigned_to === profile.id).length,
      }))
      .sort((a, b) => b.count - a.count)[0];

    if (workload && workload.count >= 6) {
      insights.push({
        type: 'workload_risk',
        title: 'Heavy team workload',
        description:
          workload.profile.full_name +
          ' currently has ' +
          workload.count +
          ' active projects assigned.',
        severity: workload.count >= 8 ? 'critical' : 'warning',
        relatedId: workload.profile.id,
      });
    }
  }

  if (financeVisible) {
    const topUninvoiced = activeProjects
      .filter((project) => {
        const outstanding = Math.max(
          Number(project.total_price || 0) - Number(project.advance_paid || 0),
          0,
        );
        return outstanding > 0 && !project.invoiced;
      })
      .sort(
        (a, b) =>
          Number(b.total_price || 0) -
          Number(b.advance_paid || 0) -
          (Number(a.total_price || 0) - Number(a.advance_paid || 0)),
      )[0];

    if (topUninvoiced) {
      insights.push({
        type: 'missing_invoice',
        title: 'Uninvoiced outstanding balance',
        description:
          topUninvoiced.project_title +
          ' has ' +
          new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 0,
          }).format(
            Math.max(
              Number(topUninvoiced.total_price || 0) -
                Number(topUninvoiced.advance_paid || 0),
              0,
            ),
          ) +
          ' outstanding with no generated invoice.',
        severity: 'warning',
        relatedId: topUninvoiced.id,
      });
    }
  }

  insights.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const recommendedActions: DailyRecommendedAction[] = [];

  if (overdueProjects.length > 0) {
    recommendedActions.push({
      id: 'prioritize-overdue',
      title: 'Prioritize overdue projects',
      description:
        overdueProjects.length +
        ' active project' +
        (overdueProjects.length === 1 ? ' is' : 's are') +
        ' past deadline.',
      command: 'Show overdue projects and tell me which ones need attention first',
      priority: 'high',
    });
  }

  if (awaitingApprovals.length > 0) {
    recommendedActions.push({
      id: 'review-approvals',
      title: 'Follow up on client approvals',
      description:
        awaitingApprovals.length +
        ' project' +
        (awaitingApprovals.length === 1 ? ' is' : 's are') +
        ' waiting for client review.',
      command: 'Show projects waiting for client approval',
      priority: overdueProjects.length > 0 ? 'medium' : 'high',
    });
  }

  if (overdueTasks.length > 0) {
    recommendedActions.push({
      id: 'review-overdue-tasks',
      title: 'Clear overdue tasks',
      description:
        overdueTasks.length +
        ' task' +
        (overdueTasks.length === 1 ? ' is' : 's are') +
        ' overdue in your visible workload.',
      command: 'Show my overdue tasks',
      priority: 'medium',
    });
  }

  if (financeVisible && activeReceivables > 0) {
    recommendedActions.push({
      id: 'review-receivables',
      title: 'Review client receivables',
      description: 'Outstanding client balances need follow-up.',
      command: 'Who owes us money and what are the receivables?',
      priority: overdueProjects.length > 0 ? 'medium' : 'high',
    });
  }

  if (recommendedActions.length === 0) {
    recommendedActions.push({
      id: 'review-active-work',
      title: 'Review today’s active work',
      description: 'No urgent blockers detected. Review the active portfolio for the next priority.',
      command: 'Show active projects summary',
      priority: 'low',
    });
  }

  const attentionCount =
    overdueProjects.length +
    dueTodayProjects.length +
    awaitingApprovals.length +
    overdueTasks.length;

  const hour = new Date().getHours();
  const greetingWord = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = firstName(currentProfile.full_name);

  const headline =
    attentionCount > 0
      ? attentionCount +
        ' item' +
        (attentionCount === 1 ? '' : 's') +
        ' need attention across projects and tasks.'
      : 'No urgent blockers detected in your current workspace.';

  return {
    greeting: greetingWord + ', ' + name + '.',
    headline,
    generatedAt: new Date().toISOString(),
    financeVisible,
    pendingProjects: {
      count: activeProjects.length,
      items: activeProjects.slice(0, 5).map((project) => projectItem(project, 'low')),
    },
    dueToday: {
      count: dueTodayProjects.length,
      items: dueTodayProjects.slice(0, 5).map((project) => projectItem(project, 'high')),
    },
    overdueProjects: {
      count: overdueProjects.length,
      items: overdueProjects
        .slice(0, 5)
        .map((project) => projectItem(project, Math.abs(daysUntil(project.due_date)) >= 4 ? 'critical' : 'high')),
    },
    overdueTasks: {
      count: overdueTasks.length,
      items: overdueTasks.slice(0, 5).map(taskItem),
    },
    awaitingApprovals: {
      count: awaitingApprovals.length,
      items: awaitingApprovals.slice(0, 5).map((project) => projectItem(project, 'medium')),
    },
    unreadMessages: unreadMessageCount(data, currentProfile.id),
    pendingInvoices,
    receivables: activeReceivables,
    revenueSummary: {
      thisMonth: thisMonthRevenue,
      lastMonth: lastMonthRevenue,
      change: revenueChange,
    },
    recommendedActions: recommendedActions.slice(0, 4),
    proactiveInsights: insights.slice(0, 6),
  };
}
