import type { Project, ProjectMetadataUpdate } from './types';
import type { WorkflowMutationResult } from './workflowClient';

export const PROJECT_FILE_BUCKET = 'project-source-files';
export const MAX_PROOF_BYTES = 100 * 1024 * 1024;
export type StageProofProject = Pick<Project, 'id' | 'project_status' | 'workflow_stage_key' | 'workflow_stage_status_key' | 'workflow_version' | 'cover_file_link' | 'proof_pdf_link' | 'final_print_pdf_link' | 'final_ebook_link' | 'other_links'>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function projectFileLocation(value: string, projectId?: string) {
  const input = value.trim();
  if (input.startsWith(`storage://${PROJECT_FILE_BUCKET}/`)) {
    const path = input.slice(`storage://${PROJECT_FILE_BUCKET}/`.length);
    const parts = path.split('/');
    if (parts.length !== 3 || !uuid.test(parts[0]) || !uuid.test(parts[1]) ||
        !/^[a-zA-Z0-9_.-]+$/.test(parts[2]) || parts[2] === '.' || parts[2] === '..' ||
        (projectId && parts[0] !== projectId)) return null;
    return { kind: 'private' as const, path, projectId: parts[0] };
  }
  try {
    const url = new URL(input);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) {
      return { kind: 'external' as const, url: input };
    }
  } catch { /* Invalid or unsafe links are never opened. */ }
  return null;
}

export function privateProjectFileName(value: string) {
  const location = projectFileLocation(value);
  if (location?.kind !== 'private') return null;
  const name = location.path.split('/')[2];
  return uuid.test(name.slice(0, 36)) ? name.slice(37) : name;
}

export function validateProofFile(file: { size: number; name: string }) {
  if (!Number.isFinite(file.size) || file.size <= 0) return 'The selected file is empty.';
  if (file.size > MAX_PROOF_BYTES) return 'The selected file exceeds the 100 MB limit.';
  return null;
}

export function stageProofField(stage: Project['workflow_stage_key']): keyof ProjectMetadataUpdate {
  if (stage === 'ebook_version' || stage === 'ebook_approval') return 'final_ebook_link';
  if (stage === 'final_delivery') return 'final_print_pdf_link';
  if (stage === 'design_concept' || stage === 'concept_approval') return 'cover_file_link';
  return 'proof_pdf_link';
}

export function currentStageProof(project: StageProofProject) {
  const stage = project.workflow_stage_key;
  if (stage === 'design_concept' || stage === 'concept_approval') return project.cover_file_link || project.proof_pdf_link || '';
  if (stage === 'print_version' || stage === 'print_approval') return project.proof_pdf_link || project.final_print_pdf_link || '';
  if (stage === 'ebook_version' || stage === 'ebook_approval') return project.final_ebook_link || '';
  return project.final_print_pdf_link || project.other_links || '';
}

/** Reuse an uploaded object on same-file retry, without deleting possibly saved proofs. */
export class ProofUploadCache {
  private files = new WeakMap<object, Map<string, Promise<string>>>();
  get(file: File, scope: string, upload: () => Promise<string>) {
    let entries = this.files.get(file);
    if (!entries) { entries = new Map(); this.files.set(file, entries); }
    const previous = entries.get(scope);
    if (previous) return previous;
    const pending = upload().catch(error => { entries!.delete(scope); throw error; });
    entries.set(scope, pending);
    return pending;
  }
}

function assertReady(project: StageProofProject, expectedStage: Project['workflow_stage_key']) {
  if (project.workflow_stage_status_key === 'revision_active') throw new Error('Use the Revisions tab to send the updated revision proof.');
  if (project.project_status !== 'active' || project.workflow_stage_status_key !== 'active' ||
      !['design_concept', 'print_version', 'ebook_version', 'final_delivery'].includes(project.workflow_stage_key || '')) {
    throw new Error('This project is no longer ready for stage submission. Reload its details.');
  }
  if (project.workflow_stage_key !== expectedStage) throw new Error('The project stage changed. Reload its details before submitting.');
  if (!Number.isSafeInteger(project.workflow_version) || project.workflow_version! < 0) throw new Error('The canonical workflow version is unavailable. Reload the project.');
}

export async function performStageSubmission(
  expectedStage: Project['workflow_stage_key'], note: string, link: string, file: File | undefined,
  dependencies: {
    readProject: () => Promise<StageProofProject>;
    upload: (file: File, project: StageProofProject) => Promise<string>;
    saveMetadata: (patch: ProjectMetadataUpdate, project: StageProofProject) => Promise<void>;
    submit: (project: StageProofProject, note: string | null) => Promise<WorkflowMutationResult>;
  },
) {
  const project = await dependencies.readProject();
  assertReady(project, expectedStage);
  if (file && link.trim()) throw new Error('Choose an attached file or a file link, not both.');
  let proof = link.trim();
  if (proof && !projectFileLocation(proof, project.id)) throw new Error('Use a valid HTTP or HTTPS file link.');
  if (file) {
    const error = validateProofFile(file);
    if (error) throw new Error(error);
    proof = await dependencies.upload(file, project);
    if (projectFileLocation(proof, project.id)?.kind !== 'private') throw new Error('The uploaded file reference is invalid.');
  }
  if (!proof && !currentStageProof(project) && project.workflow_stage_key !== 'final_delivery') {
    throw new Error('Attach a file or add a file link before submitting.');
  }
  const patch: ProjectMetadataUpdate = {
    ...(proof ? { [stageProofField(project.workflow_stage_key)]: proof } : {}),
    ...(note.trim() ? { delivery_notes: note.trim() } : {}),
  };
  if (Object.keys(patch).length) await dependencies.saveMetadata(patch, project);
  // Metadata saving/uploading may take time. Never submit using stale React state.
  const latest = await dependencies.readProject();
  assertReady(latest, expectedStage);
  if (latest.workflow_version !== project.workflow_version) throw new Error('The workflow changed while preparing the file. Reload before submitting.');
  return dependencies.submit(latest, note.trim() || null);
}
