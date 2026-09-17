export const ADMIN_OVERRIDE_REASON_MIN_LENGTH = 10;

export function validateAdminOverride(reason: string, explanation: string): string | null {
  if (reason.trim().length < ADMIN_OVERRIDE_REASON_MIN_LENGTH) {
    return `Reason summary must be at least ${ADMIN_OVERRIDE_REASON_MIN_LENGTH} characters.`;
  }
  if (!explanation.trim()) {
    return 'A detailed explanation is required.';
  }
  return null;
}
