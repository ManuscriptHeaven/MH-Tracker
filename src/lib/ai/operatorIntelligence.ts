import { daysUntil } from '../date';
import { isClientRole } from '../utils';
import type { Profile, Project, Task, TrackerData } from '../types';
import type {
  AIOperatorIntelligence,
  AIOperatorPriority,
  AIOperatorTelemetrySummary,
  DailySummary,
} from './aiTypes';

type OperatorEventRow = {
  event_type?: string | null;
  tool_name?: string | null;
  success?: boolean | null;
  error_code?: string | null;
  requires_confirmation?: boolean | null;
  was_clarification?: boolean | null;
  had_disambiguation?: boolean | null;
  verification_status?: string | null;
  plan_step_count?: number | null;
  latency_ms?: number | null;
  created_at?: string | null;
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function emptyOperatorTelemetry(
  scope: AIOperatorTelemetrySummary['scope'] = 'personal',
  periodDays = 30,
): AIOperatorTelemetrySummary {
  return {
    scope,
    periodDays,
    totalQueries: 0,
    successfulQueries: 0,
    failedQueries: 0,
    actionConfirmations: 0,
    actionCancellations: 0,
    clarificationCount: 0,
    disambiguationCount: 0,
    verifiedActions: 0,
    failedVerifications: 0,
    unverifiedActions: 0,
    multiStepPlans: 0,
    averageLatencyMs: 0,
    successRate: 100,
    clarificationRate: 0,
    verificationRate: 100,
    topTools: [],
    recentFailures: [],
  };
}

export function summarizeOperatorEvents(
  rows: OperatorEventRow[],
  scope: AIOperatorTelemetrySummary['scope'],
  periodDays = 30,
): AIOperatorTelemetrySummary {
  const queryRows = rows.filter((row) => row.event_type === 'query_result');
  const confirmedRows = rows.filter((row) => row.event_type === 'action_confirmed');
  const cancelledRows = rows.filter((row) => row.event_type === 'action_cancelled');
  const failedActionRows = rows.filter((row) => row.event_type === 'action_failed');

  const successfulQueries = queryRows.filter((row) => row.success !== false).length;
  const failedQueries = queryRows.length - successfulQueries;
  const clarificationCount = queryRows.filter((row) => row.was_clarification).length;
  const disambiguationCount = queryRows.filter((row) => row.had_disambiguation).length;
  const multiStepPlans = queryRows.filter((row) => Number(row.plan_step_count || 0) > 1).length;

  const verifiedActions = confirmedRows.filter((row) => row.verification_status === 'verified').length;
  const failedVerifications = confirmedRows.filter((row) => row.verification_status === 'failed').length;
  const unverifiedActions = confirmedRows.filter(
    (row) => !row.verification_status || row.verification_status === 'unverified',
  ).length;

  const latencyRows = queryRows.filter(
    (row) => Number.isFinite(Number(row.latency_ms)) && Number(row.latency_ms) >= 0,
  );
  const averageLatencyMs = latencyRows.length
    ? Math.round(
        latencyRows.reduce((sum, row) => sum + Number(row.latency_ms || 0), 0) /
          latencyRows.length,
      )
    : 0;

  const toolCounts = new Map<string, number>();
  for (const row of queryRows) {
    const toolName = String(row.tool_name || '').trim();
    if (!toolName) continue;
    toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1);
  }

  const recentFailures = [...queryRows, ...failedActionRows]
    .filter((row) => row.success === false)
    .sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
    )
    .slice(0, 5)
    .map((row) => ({
      toolName: String(row.tool_name || 'unknown'),
      errorCode: row.error_code || undefined,
      createdAt: row.created_at || new Date(0).toISOString(),
    }));

  return {
    scope,
    periodDays,
    totalQueries: queryRows.length,
    successfulQueries,
    failedQueries,
    actionConfirmations: confirmedRows.length,
    actionCancellations: cancelledRows.length,
    clarificationCount,
    disambiguationCount,
    verifiedActions,
    failedVerifications,
    unverifiedActions,
    multiStepPlans,
    averageLatencyMs,
    successRate:
      queryRows.length > 0 ? clampPercent((successfulQueries / queryRows.length) * 100) : 100,
    clarificationRate:
      queryRows.length > 0 ? clampPercent((clarificationCount / queryRows.length) * 100) : 0,
    verificationRate:
      confirmedRows.length > 0
        ? clampPercent((verifiedActions / confirmedRows.length) * 100)
        : 100,
    topTools: Array.from(toolCounts.entries())
      .map(([toolName, count]) => ({ toolName, count }))
      .sort((a, b) => b.count - a.count || a.toolName.localeCompare(b.toolName))
      .slice(0, 5),
    recentFailures,
  };
}

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
  const waitingOn = String(project.waiting_on || '').toLowerCase();
  const canonicalWaitingOn = String((project as any).workflow_waiting_on_key || '').toLowerCase();
  const canonicalStage = String((project as any).workflow_stage_key || '').toLowerCase();

  return (
    status.includes('awaiting client approval') ||
    stageStatus === 'paused_client_review' ||
    waitingOn === 'client' ||
    canonicalWaitingOn === 'client' ||
    stage.includes('approval') ||
    canonicalStage.includes('approval')
  );
}

function ageInDays(value?: string | null) {
  if (!value) return 0;
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - stamp) / 86_400_000));
}

function outstanding(project: Project) {
  return Math.max(
    Number(project.remaining_balance || 0),
    Number(project.total_price || 0) - Number(project.advance_paid || 0),
    0,
  );
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function severityRank(value: AIOperatorPriority['severity']) {
  if (value === 'critical') return 0;
  if (value === 'warning') return 1;
  if (value === 'opportunity') return 2;
  return 3;
}

export function buildOperatorIntelligence({
  data,
  visibleProjects,
  visibleTasks,
  currentProfile,
  dailySummary,
  telemetry,
}: {
  data: TrackerData;
  visibleProjects: Project[];
  visibleTasks: Task[];
  currentProfile: Profile;
  dailySummary: DailySummary | null;
  telemetry: AIOperatorTelemetrySummary;
}): AIOperatorIntelligence {
  const priorities: AIOperatorPriority[] = [];
  const activeProjects = visibleProjects.filter((project) => !isClosedProject(project));
  const overdueProjects = activeProjects.filter(
    (project) => Boolean(project.due_date) && daysUntil(project.due_date) < 0,
  );
  const awaitingApprovals = activeProjects
    .filter(isAwaitingApproval)
    .sort((a, b) => ageInDays(b.updated_at) - ageInDays(a.updated_at));
  const overdueTasks = visibleTasks.filter(
    (task) =>
      !task.archived_at &&
      task.status !== 'Done' &&
      Boolean(task.due_date) &&
      daysUntil(task.due_date) < 0,
  );

  if (currentProfile.role === 'admin') {
    const clientBuckets = new Map<
      string,
      {
        balance: number;
        overdue: Project[];
        approvals: Project[];
        uninvoiced: Project[];
        projects: Project[];
      }
    >();

    for (const project of activeProjects) {
      const clientName = String(project.client_name || '').trim();
      if (!clientName) continue;
      const bucket = clientBuckets.get(clientName) || {
        balance: 0,
        overdue: [],
        approvals: [],
        uninvoiced: [],
        projects: [],
      };
      const due = outstanding(project);
      bucket.balance += due;
      bucket.projects.push(project);
      if (project.due_date && daysUntil(project.due_date) < 0) bucket.overdue.push(project);
      if (isAwaitingApproval(project)) bucket.approvals.push(project);
      if (due > 0.005 && !project.invoiced && !project.invoice_id) bucket.uninvoiced.push(project);
      clientBuckets.set(clientName, bucket);
    }

    const cashflowRisk = Array.from(clientBuckets.entries())
      .filter(([, bucket]) => bucket.balance > 0.005 && (bucket.overdue.length > 0 || bucket.approvals.length > 0))
      .sort((a, b) => b[1].balance - a[1].balance)[0];

    if (cashflowRisk) {
      const [clientName, bucket] = cashflowRisk;
      const topProject = [...bucket.projects].sort((a, b) => outstanding(b) - outstanding(a))[0];
      priorities.push({
        id: 'cashflow-' + clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        type: 'cashflow_risk',
        title: clientName + ' combines delivery friction with unpaid balance',
        summary:
          formatUsd(bucket.balance) +
          ' is outstanding while ' +
          (bucket.overdue.length > 0
            ? bucket.overdue.length + ' project' + (bucket.overdue.length === 1 ? ' is' : 's are') + ' overdue'
            : bucket.approvals.length + ' project' + (bucket.approvals.length === 1 ? ' is' : 's are') + ' waiting on approval') +
          '.',
        severity: bucket.balance >= 2000 && (bucket.overdue.length > 0 || bucket.approvals.length >= 2)
          ? 'critical'
          : 'warning',
        evidence: [
          formatUsd(bucket.balance) + ' outstanding',
          bucket.overdue.length + ' overdue project' + (bucket.overdue.length === 1 ? '' : 's'),
          bucket.approvals.length + ' waiting for client approval',
        ],
        commands: [
          ...(bucket.uninvoiced.length > 0
            ? [
                {
                  label: 'Prepare pending invoice',
                  command: 'Generate invoice for ' + clientName + ' for all pending payments',
                },
              ]
            : []),
          ...(topProject
            ? [
                {
                  label: 'Draft payment follow-up',
                  command:
                    'Draft a firm payment reminder message for ' +
                    (topProject.project_number || topProject.project_title),
                },
              ]
            : []),
        ],
        relatedId: topProject?.id,
      });
    }

    const invoiceOpportunity = Array.from(clientBuckets.entries())
      .map(([clientName, bucket]) => ({
        clientName,
        amount: bucket.uninvoiced.reduce((sum, project) => sum + outstanding(project), 0),
        count: bucket.uninvoiced.length,
      }))
      .filter((item) => item.amount > 0.005)
      .sort((a, b) => b.amount - a.amount)[0];

    if (invoiceOpportunity) {
      priorities.push({
        id: 'invoice-' + invoiceOpportunity.clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        type: 'invoice_opportunity',
        title: 'Invoice opportunity for ' + invoiceOpportunity.clientName,
        summary:
          formatUsd(invoiceOpportunity.amount) +
          ' remains uninvoiced across ' +
          invoiceOpportunity.count +
          ' project' +
          (invoiceOpportunity.count === 1 ? '' : 's') +
          '.',
        severity: 'opportunity',
        evidence: [
          invoiceOpportunity.count + ' uninvoiced project' + (invoiceOpportunity.count === 1 ? '' : 's'),
          formatUsd(invoiceOpportunity.amount) + ' available to invoice',
        ],
        commands: [
          {
            label: 'Prepare invoice',
            command:
              'Generate invoice for ' +
              invoiceOpportunity.clientName +
              ' for all pending payments',
          },
        ],
      });
    }
  }

  const oldestApproval = awaitingApprovals.find((project) => ageInDays(project.updated_at) >= 3);
  if (oldestApproval) {
    const waitingDays = ageInDays(oldestApproval.updated_at);
    priorities.push({
      id: 'approval-' + oldestApproval.id,
      type: 'approval_bottleneck',
      title: 'Client approval is slowing the workflow',
      summary:
        oldestApproval.project_title +
        ' has been waiting around ' +
        waitingDays +
        ' day' +
        (waitingDays === 1 ? '' : 's') +
        '.',
      severity: waitingDays >= 7 ? 'critical' : 'warning',
      evidence: [
        oldestApproval.client_name + ' is the client',
        'Current stage: ' +
          String(
            (oldestApproval as any).workflow_stage_key ||
              oldestApproval.current_stage ||
              oldestApproval.status,
          ),
        waitingDays + ' days since the last project update',
      ],
      commands: [
        {
          label: 'Draft approval reminder',
          command:
            'Draft a professional approval reminder message for ' +
            (oldestApproval.project_number || oldestApproval.project_title),
        },
      ],
      relatedId: oldestApproval.id,
    });
  }

  if (!isClientRole(currentProfile.role)) {
    const teamProfiles = (data.profiles || []).filter((profile) => !isClientRole(profile.role));
    const capacity = teamProfiles
      .map((profile) => ({
        profile,
        projects: activeProjects.filter((project) => project.assigned_to === profile.id),
        overdueTasks: overdueTasks.filter((task) => task.assigned_to === profile.id),
      }))
      .sort(
        (a, b) =>
          b.projects.length + b.overdueTasks.length * 1.5 -
          (a.projects.length + a.overdueTasks.length * 1.5),
      )[0];

    if (capacity && (capacity.projects.length >= 6 || capacity.overdueTasks.length >= 3)) {
      priorities.push({
        id: 'capacity-' + capacity.profile.id,
        type: 'team_capacity',
        title: capacity.profile.full_name + ' may be overloaded',
        summary:
          capacity.projects.length +
          ' active projects and ' +
          capacity.overdueTasks.length +
          ' overdue task' +
          (capacity.overdueTasks.length === 1 ? '' : 's') +
          ' are assigned.',
        severity:
          capacity.projects.length >= 8 || capacity.overdueTasks.length >= 5
            ? 'critical'
            : 'warning',
        evidence: [
          capacity.projects.length + ' active projects',
          capacity.overdueTasks.length + ' overdue tasks',
        ],
        commands: [
          {
            label: 'Review workload',
            command: 'What is ' + capacity.profile.full_name + ' working on?',
          },
          ...(capacity.overdueTasks.length
            ? [
                {
                  label: 'Show overdue tasks',
                  command: 'Show overdue tasks for ' + capacity.profile.full_name,
                },
              ]
            : []),
        ],
        relatedId: capacity.profile.id,
      });
    }
  }

  if (overdueProjects.length >= 2) {
    const mostLate = [...overdueProjects].sort(
      (a, b) => daysUntil(a.due_date) - daysUntil(b.due_date),
    )[0];
    priorities.push({
      id: 'delivery-' + mostLate.id,
      type: 'delivery_risk',
      title: 'Delivery risk is accumulating',
      summary:
        overdueProjects.length +
        ' active projects are now past their project deadline.',
      severity: overdueProjects.length >= 4 ? 'critical' : 'warning',
      evidence: [
        overdueProjects.length + ' overdue active projects',
        mostLate.project_title +
          ' is ' +
          Math.abs(daysUntil(mostLate.due_date)) +
          ' days overdue',
      ],
      commands: [
        {
          label: 'Review overdue projects',
          command: 'Show overdue projects and tell me which ones need attention first',
        },
      ],
      relatedId: mostLate.id,
    });
  }

  if (overdueTasks.length >= 3) {
    priorities.push({
      id: 'task-backlog',
      type: 'task_backlog',
      title: 'Task backlog needs attention',
      summary:
        overdueTasks.length +
        ' visible tasks are overdue and still open.',
      severity: overdueTasks.length >= 6 ? 'critical' : 'warning',
      evidence: [
        overdueTasks.length + ' overdue open tasks',
        overdueTasks.filter((task) => task.priority === 'Urgent').length + ' urgent overdue tasks',
      ],
      commands: [
        {
          label: 'Review overdue tasks',
          command: isClientRole(currentProfile.role)
            ? 'Show my tasks'
            : 'Show overdue tasks',
        },
      ],
    });
  }

  if (currentProfile.role === 'admin') {
    if (telemetry.failedVerifications > 0) {
      priorities.push({
        id: 'ai-verification-risk',
        type: 'ai_reliability',
        title: 'AI action verification needs review',
        summary:
          telemetry.failedVerifications +
          ' confirmed action' +
          (telemetry.failedVerifications === 1 ? ' did' : 's did') +
          ' not reach the expected Tracker state.',
        severity: 'critical',
        evidence: [
          telemetry.verifiedActions + ' verified actions',
          telemetry.failedVerifications + ' failed post-action verifications',
          telemetry.verificationRate + '% verification success rate',
        ],
        commands: [],
      });
    } else if (
      telemetry.totalQueries >= 5 &&
      telemetry.failedQueries >= 3 &&
      telemetry.successRate < 85
    ) {
      priorities.push({
        id: 'ai-query-reliability',
        type: 'ai_reliability',
        title: 'AI command reliability is below target',
        summary:
          telemetry.successRate +
          '% of recent queries completed without an execution error.',
        severity: 'warning',
        evidence: [
          telemetry.failedQueries + ' failed queries in the last ' + telemetry.periodDays + ' days',
          telemetry.successRate + '% query success rate',
        ],
        commands: [],
      });
    }

    if (telemetry.totalQueries >= 10 && telemetry.clarificationRate >= 20) {
      priorities.push({
        id: 'ai-friction',
        type: 'assistant_friction',
        title: 'The assistant is asking for clarification too often',
        summary:
          telemetry.clarificationRate +
          '% of recent commands required clarification.',
        severity: 'warning',
        evidence: [
          telemetry.clarificationCount + ' clarification turns',
          telemetry.disambiguationCount + ' entity disambiguations',
          telemetry.totalQueries + ' total recent queries',
        ],
        commands: [],
      });
    }
  }

  priorities.sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      a.title.localeCompare(b.title),
  );

  if (priorities.length === 0) {
    priorities.push({
      id: 'workspace-stable',
      type: 'workspace_stable',
      title: 'No major operator-level blocker detected',
      summary:
        dailySummary?.headline ||
        'Current project, task and AI telemetry signals are within normal ranges.',
      severity: 'info',
      evidence: [
        activeProjects.length + ' active projects',
        overdueProjects.length + ' overdue projects',
        overdueTasks.length + ' overdue tasks',
      ],
      commands: [
        {
          label: 'Review active work',
          command: 'Show active projects summary',
        },
      ],
    });
  }

  const criticalCount = priorities.filter((item) => item.severity === 'critical').length;
  const warningCount = priorities.filter((item) => item.severity === 'warning').length;
  const opportunityCount = priorities.filter((item) => item.severity === 'opportunity').length;

  const headline =
    criticalCount > 0
      ? criticalCount +
        ' critical operator signal' +
        (criticalCount === 1 ? '' : 's') +
        ' need attention.'
      : warningCount > 0
        ? warningCount +
          ' workflow risk' +
          (warningCount === 1 ? '' : 's') +
          ' should be reviewed.'
        : opportunityCount > 0
          ? opportunityCount +
            ' operational opportunit' +
            (opportunityCount === 1 ? 'y is' : 'ies are') +
            ' available.'
          : 'Workspace signals are stable.';

  return {
    generatedAt: new Date().toISOString(),
    scopeLabel: telemetry.scope === 'workspace' ? 'Workspace AI telemetry' : 'Your AI telemetry',
    headline,
    criticalCount,
    warningCount,
    opportunityCount,
    telemetry,
    priorities: priorities.slice(0, 6),
  };
}
