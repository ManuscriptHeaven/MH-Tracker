import type { WorkflowMutationResult } from './workflowClient';

export interface FinalDeliveryState {
  project_status: string;
  workflow_version: number;
  requires_print: boolean;
  requires_ebook: boolean;
  final_print_pdf_link: string | null;
  final_ebook_link: string | null;
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
  if (state.requires_print && !state.final_print_pdf_link?.trim()) {
    throw new Error('Add the final print-ready PDF before completing delivery.');
  }
  if (state.requires_ebook && !state.final_ebook_link?.trim()) {
    throw new Error('Add the final eBook/EPUB file before completing delivery.');
  }
  return complete(state.workflow_version);
}
