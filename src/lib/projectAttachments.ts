/** Limits shared by the project-creation picker and staff upload mutation.
 * This only validates metadata. Storage RLS and project permission checks
 * remain the source of truth for authorization.
 */
export const PROJECT_ATTACHMENTS_MAX_FILES = 10;
export const PROJECT_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

export function validateProjectAttachments(files: readonly Pick<File, 'name' | 'size'>[]): string | null {
  if (files.length > PROJECT_ATTACHMENTS_MAX_FILES) return 'Please attach at most 10 files at a time.';
  for (const file of files) {
    if (!file.name.trim()) return 'Every attachment needs a filename.';
    if (file.size <= 0) return `${file.name} is empty.`;
    if (file.size > PROJECT_ATTACHMENT_MAX_BYTES) return `${file.name} exceeds the 100 MB per-file limit.`;
  }
  return null;
}
