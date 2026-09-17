export type ProjectLifecycle = 'active' | 'on_hold' | 'cancelled' | 'completed' | 'archived';

type WorkflowResult = { workflow_version: number | string };

export function isArchivedProject(project: { project_status?: string | null; status?: string | null }) {
  return project.project_status === 'archived' || (!project.project_status && project.status?.toLowerCase() === 'archived');
}

export async function archiveProjectLifecycle({
  lifecycle,
  workflowVersion,
  reason,
  transition,
  reload,
}: {
  lifecycle: ProjectLifecycle;
  workflowVersion: number;
  reason: string;
  transition: (target: 'cancelled' | 'archived', expectedVersion: number, reason: string) => Promise<WorkflowResult>;
  reload: () => Promise<void>;
}) {
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error('An Admin reason is required to archive a project.');
  if (lifecycle === 'archived') throw new Error('This project is already archived.');
  if (!['active', 'on_hold', 'cancelled', 'completed'].includes(lifecycle)) {
    throw new Error('Project lifecycle is unavailable. Refresh before archiving.');
  }

  let version = workflowVersion;
  let cancelled = false;
  if (lifecycle === 'active' || lifecycle === 'on_hold') {
    const result = await transition('cancelled', version, cleanReason);
    version = Number(result.workflow_version);
    if (!Number.isInteger(version) || version <= workflowVersion) {
      try { await reload(); } catch { /* Keep the partial-success message. */ }
      throw new Error('Project was cancelled but not archived. The cancellation response had no valid workflow version; refresh and retry archiving.');
    }
    cancelled = true;
  }

  try {
    await transition('archived', version, cleanReason);
  } catch (error) {
    if (!cancelled) throw error;
    try {
      await reload();
    } catch {
      // Preserve the actionable partial-success message even if refresh also fails.
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Project was cancelled but not archived. ${detail} Refresh and retry archiving.`);
  }
  try {
    await reload();
  } catch {
    throw new Error('Project was archived, but the view could not refresh. Reload the page before taking another action.');
  }
}
