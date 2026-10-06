import type { Project } from './types';

export const CLIENT_FILE_ACTION = 'Submit project files or confirm they were already sent';

/** Match the canonical source-file RPC, not a stale display status. */
export function canSubmitClientFiles(project: Pick<Project, 'project_status' | 'workflow_stage_key' | 'workflow_stage_status_key'>) {
  return project.project_status === 'active' && project.workflow_stage_key === 'files_received' &&
    (project.workflow_stage_status_key === 'pending' || project.workflow_stage_status_key === 'active');
}

export function validateClientFileSubmission(files: readonly { name: string; size: number }[], note?: string) {
  if (!files.length && !note?.trim()) return 'Add files, or tell us where you already sent them (email or WhatsApp).';
  if (files.length > 10) return 'You can submit up to 10 files at once.';
  for (const file of files) {
    if (file.size <= 0) return `${file.name} is empty.`;
    if (file.size > 100 * 1024 * 1024) return `${file.name} is larger than the 100 MB per-file limit.`;
  }
  return null;
}
