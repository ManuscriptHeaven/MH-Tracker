import type { WorkflowMutationResult } from './workflowClient';
import type { ProjectMetadataUpdate } from './types';

export interface FinalDeliveryFiles {
  requires_print?: boolean | null;
  requires_ebook?: boolean | null;
  final_print_pdf_link?: string | null;
  final_ebook_link?: string | null;
}

export class FinalDeliveryFilesSavedError extends Error {
  readonly completionError: unknown;

  constructor(completionError: unknown) {
    super('The final file links were saved.');
    this.name = 'FinalDeliveryFilesSavedError';
    this.completionError = completionError;
  }
}

/** Save supplied final links before canonical completion; blanks preserve saved links. */
export async function submitFinalDeliveryWithFiles(
  current: FinalDeliveryFiles,
  draft: Pick<FinalDeliveryFiles, 'final_print_pdf_link' | 'final_ebook_link'>,
  saveFiles: ((updates: ProjectMetadataUpdate) => Promise<void>) | undefined,
  complete: () => Promise<void>,
): Promise<void> {
  const updates: ProjectMetadataUpdate = {};
  const serviceFiles = [
    { applicable: current.requires_print, field: 'final_print_pdf_link', label: 'final print-ready PDF' },
    { applicable: current.requires_ebook, field: 'final_ebook_link', label: 'final eBook/EPUB file' },
  ] as const;

  for (const file of serviceFiles) {
    if (!file.applicable) continue;
    const value = draft[file.field]?.trim() || '';
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Enter a valid http or https URL for the ${file.label}.`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`Enter a valid http or https URL for the ${file.label}.`);
    }
    if (value !== (current[file.field]?.trim() || '')) updates[file.field] = value;
  }

  const hasUpdates = Object.keys(updates).length > 0;
  if (hasUpdates) {
    if (!saveFiles) throw new Error('Ask a manager to update final file links, or leave them unchanged to complete delivery.');
    await saveFiles(updates);
  }
  try {
    await complete();
  } catch (error) {
    if (hasUpdates) throw new FinalDeliveryFilesSavedError(error);
    throw error;
  }
}

export interface FinalDeliveryState {
  project_status: string;
  workflow_version: number;
}

export async function performFinalDelivery(
  readCurrentState: () => Promise<FinalDeliveryState>,
  complete: (version: number) => Promise<WorkflowMutationResult>,
): Promise<WorkflowMutationResult | null> {
  const state = await readCurrentState();
  if (state.project_status === 'completed') return null;
  if (!Number.isSafeInteger(state.workflow_version) || state.workflow_version < 0) {
    throw new Error('The current workflow version is unavailable. Reload the project and try again.');
  }
  return complete(state.workflow_version);
}
