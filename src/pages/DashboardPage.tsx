import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FolderOpen,
  Plus,
  Sparkles,
} from 'lucide-react';
import { ProjectTimelineCompact } from '../components/ProjectTimeline';
import { Button, Card } from '../components/ui';
import { UserAvatar } from '../components/UserAvatar';
import { closedStatuses } from '../lib/constants';
import { formatDate } from '../lib/date';
import { getTimelineSummary } from '../lib/timeline';
import { firstName, isClientRole } from '../lib/utils';
import { useCurrency } from '../lib/currency';
import type { Profile, Project } from '../lib/types';

type QuickFilter =
  | 'all'
  | 'mine'
  | 'in_progress'
  | 'awaiting_approval'
  | 'revision'
  | 'today'
  | 'at_risk'
  | 'overdue'
  | 'completed';

function profileName(profiles: Profile[], id?: string | null) {
  const profile = profiles.find((item) => item.id === id);
  return profile ? firstName(profile.full_name) : 'Unassigned';
}

function isStageOverdue(project: Project) {
  return getTimelineSummary(project).isOverdue;
}

function isStageDueToday(project: Project) {
  const summary = getTimelineSummary(project);
  return summary.waitingOn === 'Manuscript Heaven' && summary.daysRemaining === 0 && !summary.isOverdue;
}

function isStageAtRisk(project: Project) {
  const risk = getTimelineSummary(project).riskLevel;
  return risk === 'amber' || risk === 'red';
}

function finalDueText(project: Project) {
  const summary = getTimelineSummary(project);
  if (!summary.finalDueDate) return 'Not set';
  return formatDate(summary.finalDueDate);
}

function finalDueClass(project: Project) {
  const summary = getTimelineSummary(project);
  if (summary.waitingOn === 'Client') return 'text-violet-700';
  if (summary.isOverdue) return 'text-red-700';
  return 'text-ink';
}

function CompactProjectStatus({ project }: { project: Project }) {
  const summary = getTimelineSummary(project);
  const isRevision =
    project.status === 'In Revision' || project.stage_status === 'REVISION_ACTIVE';
  const isDone = project.status === 'Completed' || project.status === 'Delivered';
  const isOnHold = project.status === 'On Hold';

  const label = isDone
    ? 'Done'
    : isOnHold
      ? 'On Hold'
      : isRevision
        ? 'Revision'
        : summary.waitingOn === 'Client'
          ? summary.officialStage === 'Files Received'
            ? 'Client Files'
            : 'Client Wait'
          : project.status === 'Final Delivery'
            ? 'Final'
            : 'Active';

  const tone = isDone
    ? 'border-green-200 bg-green-50 text-green-700'
    : isOnHold
      ? 'border-slate-200 bg-slate-50 text-slate-600'
      : isRevision
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : summary.waitingOn === 'Client'
          ? 'border-violet-200 bg-violet-50 text-violet-700'
          : project.status === 'Final Delivery'
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : 'border-blue-200 bg-blue-50 text-blue-700';

  return (
    <span
      title={project.status}
      aria-label={`Project status: ${project.status}`}
      className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-bold leading-none ${tone}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
      <span>{label}</span>
    </span>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: string | number;
  helper: string;
  icon: typeof FolderOpen;
  tone: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-ink sm:text-3xl">{value}</p>
        </div>
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
        <p className="truncate text-[11px] text-muted">{helper}</p>
        {onClick ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" /> : null}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-2xl border border-border bg-white p-4 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-soft active:translate-y-0"
      >
        {body}
      </button>
    );
  }

  return <div className="rounded-2xl border border-border bg-white p-4 shadow-xs">{body}</div>;
}

export function DashboardPage({
  projects,
  profiles,
  canViewPayments,
  canManageProjects,
  currentProfileId,
  onAddProject,
  onSelectProject,
}: {
  projects: Project[];
  profiles: Profile[];
  canViewPayments: boolean;
  canManageProjects: boolean;
  currentProfileId: string;
  onAddProject: () => void;
  onSelectProject: (project: Project) => void;
}) {
  const { formatMoney } = useCurrency();
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');

  const isRevision = (project: Project) =>
    project.status === 'In Revision' || project.stage_status === 'REVISION_ACTIVE';

  const isAwaitingApproval = (project: Project) =>
    (project.status === 'Awaiting Client Approval' ||
      project.stage_status === 'PAUSED_CLIENT_REVIEW') &&
    project.stage_status !== 'REVISION_ACTIVE';

  const isInProgress = (project: Project) =>
    project.status === 'In Progress' ||
    project.status === 'Active' ||
    project.status === 'Final Delivery';

  const isCompleted = (project: Project) =>
    project.status === 'Completed' || project.status === 'Delivered';

  const activeBase = useMemo(
    () =>
      projects
        .filter((project) => !closedStatuses.includes(project.status))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [projects],
  );

  const filteredAllProjects = projects;
  const filteredActiveProjects = activeBase;

  const inProgressProjects = filteredActiveProjects.filter(isInProgress);
  const awaitingApprovalProjects = filteredActiveProjects.filter(isAwaitingApproval);
  const inRevisionProjects = filteredActiveProjects.filter(isRevision);
  const overdueProjects = filteredActiveProjects.filter(isStageOverdue);
  const atRiskProjects = filteredActiveProjects.filter(isStageAtRisk);
  const dueTodayProjects = filteredActiveProjects.filter(isStageDueToday);
  const completedProjects = filteredAllProjects.filter(isCompleted);
  const myProjects = filteredActiveProjects.filter(
    (project) => project.assigned_to === currentProfileId,
  );

  const visibleProjects = filteredAllProjects.filter((project) => {
    if (quickFilter === 'completed') return isCompleted(project);
    if (closedStatuses.includes(project.status)) return false;
    if (quickFilter === 'mine') return project.assigned_to === currentProfileId;
    if (quickFilter === 'in_progress') return isInProgress(project);
    if (quickFilter === 'awaiting_approval') return isAwaitingApproval(project);
    if (quickFilter === 'revision') return isRevision(project);
    if (quickFilter === 'today') return isStageDueToday(project);
    if (quickFilter === 'at_risk') return isStageAtRisk(project);
    if (quickFilter === 'overdue') return isStageOverdue(project);
    return true;
  });

  const pendingPayments = filteredActiveProjects.reduce(
    (total, project) => total + Number(project.remaining_balance || 0),
    0,
  );

  const urgentProjects = filteredActiveProjects
    .filter(
      (project) =>
        project.priority === 'Urgent' ||
        isStageOverdue(project) ||
        isStageAtRisk(project) ||
        isStageDueToday(project),
    )
    .sort((a, b) => {
      const aOverdue = isStageOverdue(a) ? 1 : 0;
      const bOverdue = isStageOverdue(b) ? 1 : 0;
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;
      const riskRank = (project: Project) => {
        const risk = getTimelineSummary(project).riskLevel;
        if (risk === 'red') return 2;
        if (risk === 'amber') return 1;
        return 0;
      };
      const aRisk = riskRank(a);
      const bRisk = riskRank(b);
      if (aRisk !== bRisk) return bRisk - aRisk;
      const aDue = getTimelineSummary(a).dueDate || getTimelineSummary(a).finalDueDate || '9999-12-31';
      const bDue = getTimelineSummary(b).dueDate || getTimelineSummary(b).finalDueDate || '9999-12-31';
      return new Date(aDue).getTime() - new Date(bDue).getTime();
    })
    .slice(0, 5);

  const workload = profiles
    .filter((profile) => !isClientRole(profile.role))
    .map((profile) => {
      const assigned = filteredActiveProjects.filter(
        (project) => project.assigned_to === profile.id,
      );
      return {
        profile,
        active: assigned.length,
        overdue: assigned.filter(isStageOverdue).length,
      };
    })
    .filter(({ active, overdue }) => active > 0 || overdue > 0)
    .sort((a, b) => b.active - a.active);

  const quickFilters: Array<{ id: QuickFilter; label: string; count: number }> = [
    { id: 'all', label: 'Active', count: filteredActiveProjects.length },
    { id: 'in_progress', label: 'In Progress', count: inProgressProjects.length },
    { id: 'awaiting_approval', label: 'Awaiting Approval', count: awaitingApprovalProjects.length },
    { id: 'revision', label: 'In Revision', count: inRevisionProjects.length },
    { id: 'today', label: 'Due Today', count: dueTodayProjects.length },
    { id: 'at_risk', label: 'At Risk', count: atRiskProjects.length },
    { id: 'overdue', label: 'Overdue', count: overdueProjects.length },
    { id: 'completed', label: 'Completed', count: completedProjects.length },
    { id: 'mine', label: 'My Projects', count: myProjects.length },
  ];

  function clearQuickFilter() {
    setQuickFilter('all');
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Compact dashboard summary */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Active Projects"
          value={filteredActiveProjects.length}
          helper="Current open workload"
          icon={FolderOpen}
          tone="bg-blue-50 text-blue-700"
          onClick={() => setQuickFilter('all')}
        />
        <SummaryCard
          label="Awaiting Approval"
          value={awaitingApprovalProjects.length}
          helper="Waiting on client review"
          icon={Clock3}
          tone="bg-purple-50 text-purple-700"
          onClick={() => setQuickFilter('awaiting_approval')}
        />
        <SummaryCard
          label="Overdue"
          value={overdueProjects.length}
          helper={dueTodayProjects.length ? `${dueTodayProjects.length} also due today` : 'Needs attention'}
          icon={AlertTriangle}
          tone="bg-rose-50 text-rose-700"
          onClick={() => setQuickFilter('overdue')}
        />
        {canViewPayments ? (
          <SummaryCard
            label="Pending Payments"
            value={formatMoney(pendingPayments, 'USD')}
            helper="Outstanding on active work"
            icon={CircleDollarSign}
            tone="bg-gold/15 text-[#7a5518]"
          />
        ) : (
          <SummaryCard
            label="Completed"
            value={completedProjects.length}
            helper="Delivered projects"
            icon={CheckCircle2}
            tone="bg-emerald-50 text-emerald-700"
            onClick={() => setQuickFilter('completed')}
          />
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.7fr)]">
        {/* Active Projects */}
        <Card className="overflow-hidden rounded-2xl p-0">
          <div className="border-b border-border px-4 py-4 sm:px-5 lg:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-xl font-semibold text-ink sm:text-2xl">
                    Active Projects
                  </h2>
                </div>
                <p className="mt-0.5 text-xs text-muted sm:text-sm">
                  {visibleProjects.length} project{visibleProjects.length === 1 ? '' : 's'} match the current view.
                </p>
              </div>

              {canManageProjects ? (
                <Button onClick={onAddProject} className="px-3">
                  <Plus className="h-4 w-4" />
                  <span className="hidden xs:inline">Add Project</span>
                </Button>
              ) : null}
            </div>

            {/* Quick filters sit directly above the project list */}
            <div className="mt-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin">
              {quickFilters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setQuickFilter(item.id)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition sm:text-[13px] ${
                    quickFilter === item.id
                      ? 'border-ink bg-ink text-white shadow-xs'
                      : 'border-border bg-white text-muted hover:border-gold/60 hover:text-ink'
                  }`}
                >
                  {item.label}
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                      quickFilter === item.id ? 'bg-white/15 text-white' : 'bg-linen text-muted'
                    }`}
                  >
                    {item.count}
                  </span>
                </button>
              ))}
            </div>

          </div>

          {/* Desktop project table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] table-fixed border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-[#fcfbf8]">
                <tr className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                  <th className="w-[31%] border-b border-border px-5 py-3">Project</th>
                  <th className="w-[13%] border-b border-border px-3 py-3">Status</th>
                  <th className="w-[42%] border-b border-border px-4 py-3">Timeline</th>
                  <th className="w-[14%] border-b border-border px-3 py-3">Due</th>
                </tr>
              </thead>
              <tbody>
                {visibleProjects.length ? (
                  visibleProjects.map((project) => (
                    <tr
                      key={project.id}
                      className="group cursor-pointer transition hover:bg-gold/[0.045]"
                      onClick={() => onSelectProject(project)}
                    >
                      <td className="border-b border-border/60 px-5 py-4 align-top">
                        <p className="text-[15px] font-bold leading-5 text-ink transition group-hover:text-[#7a5518]">
                          {project.project_title}
                        </p>
                        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted/80">
                          {project.project_number}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                          <span className="font-medium text-charcoal">{project.client_name}</span>
                          <span className="text-border">•</span>
                          <span className="text-muted">
                            Assigned to <span className="font-semibold text-charcoal">{profileName(profiles, project.assigned_to)}</span>
                          </span>
                        </div>
                      </td>
                      <td className="border-b border-border/60 px-3 py-4 align-top">
                        <CompactProjectStatus project={project} />
                      </td>
                      <td className="border-b border-border/60 px-4 py-3.5">
                        <ProjectTimelineCompact project={project} />
                      </td>
                      <td className="border-b border-border/60 px-3 py-4 align-top">
                        <p className={`text-xs font-semibold ${finalDueClass(project)}`}>
                          {finalDueText(project)}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted">
                          {getTimelineSummary(project).waitingOn === 'Client'
                            ? 'Auto-shifts with client wait'
                            : 'Projected final due'}
                        </p>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-5 py-12 text-center">
                      <div className="mx-auto max-w-xs">
                        <FolderOpen className="mx-auto h-8 w-8 text-muted/30" />
                        <p className="mt-2 text-sm font-semibold text-ink">No matching projects</p>
                        <p className="mt-1 text-xs text-muted">
                          Choose a different project view above.
                        </p>
                        {quickFilter !== 'all' ? (
                          <button
                            type="button"
                            onClick={clearQuickFilter}
                            className="mt-3 text-xs font-semibold text-[#7a5518] hover:underline"
                          >
                            Show all active projects
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile project cards */}
          <div className="space-y-3 bg-[#faf9f6]/60 p-3 md:hidden">
            {visibleProjects.length ? (
              visibleProjects.map((project) => (
                <button
                  type="button"
                  key={project.id}
                  onClick={() => onSelectProject(project)}
                  className="w-full rounded-2xl border border-border bg-white p-4 text-left shadow-xs transition active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-bold text-ink">{project.project_title}</h3>
                      <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-muted/80">
                        {project.project_number}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted">
                        <span className="font-medium text-charcoal">{project.client_name}</span>
                        {' · '}Assigned to <span className="font-semibold text-charcoal">{profileName(profiles, project.assigned_to)}</span>
                      </p>
                    </div>
                    <CompactProjectStatus project={project} />
                  </div>

                  <div className="mt-3">
                    <ProjectTimelineCompact project={project} />
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted">Projected final due</p>
                    <p className={`text-xs font-semibold ${finalDueClass(project)}`}>
                      {finalDueText(project)}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5 text-[11px] font-semibold text-[#7a5518]">
                    <span>Open project</span>
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center">
                <FolderOpen className="mx-auto h-8 w-8 text-muted/30" />
                <p className="mt-2 text-sm font-semibold text-ink">No matching projects</p>
                <p className="mt-1 text-xs text-muted">Try a different filter.</p>
              </div>
            )}
          </div>
        </Card>

        {/* Secondary dashboard rail */}
        <div className="space-y-5">
          <Card className="rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink sm:text-xl">Needs Attention</h2>
                <p className="mt-0.5 text-xs text-muted">Overdue, at risk, due today, or urgent work.</p>
              </div>
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 text-rose-700">
                <AlertTriangle className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-4 space-y-2.5">
              {urgentProjects.length ? (
                urgentProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onSelectProject(project)}
                    className="w-full rounded-xl border border-border bg-white p-3.5 text-left transition hover:border-gold/60 hover:shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{project.project_title}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted">{project.client_name}</p>
                      </div>
                      <span className={`shrink-0 text-[11px] font-semibold ${finalDueClass(project)}`}>
                        {getTimelineSummary(project).isOverdue
                          ? 'Stage overdue'
                          : getTimelineSummary(project).riskLevel === 'red'
                            ? 'Critical < 8h'
                            : getTimelineSummary(project).riskLevel === 'amber'
                              ? 'At risk < 24h'
                              : getTimelineSummary(project).waitingOn === 'Client'
                                ? 'Client wait'
                                : finalDueText(project)}
                      </span>
                    </div>
                    <div className="mt-3">
                      <ProjectTimelineCompact project={project} />
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-[#faf9f6] p-5 text-center">
                  <Sparkles className="mx-auto h-5 w-5 text-gold" />
                  <p className="mt-2 text-sm font-semibold text-ink">Nothing urgent</p>
                  <p className="mt-1 text-xs text-muted">No projects need immediate attention.</p>
                </div>
              )}
            </div>
          </Card>

          {canManageProjects ? (
            <Card className="rounded-2xl p-4 sm:p-5">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink sm:text-xl">Team Workload</h2>
                <p className="mt-0.5 text-xs text-muted">Active projects currently assigned.</p>
              </div>

              <div className="mt-4 space-y-3.5">
                {workload.length ? (
                  workload.slice(0, 6).map(({ profile, active, overdue }) => (
                    <div key={profile.id} className="flex items-center gap-3">
                      <UserAvatar profile={profile} size="sm" showRoleRing />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-xs font-semibold text-ink">{profile.full_name}</p>
                          <span className="shrink-0 text-[10px] font-semibold text-muted">{active} active</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-linen">
                          <div
                            className="h-full rounded-full bg-gold"
                            style={{ width: `${Math.min(Math.max(active, 1) * 16, 100)}%` }}
                          />
                        </div>
                        {overdue > 0 ? (
                          <p className="mt-1 text-[10px] font-semibold text-rose-600">
                            {overdue} overdue
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted">
                    No active assignments right now.
                  </p>
                )}
              </div>
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}
