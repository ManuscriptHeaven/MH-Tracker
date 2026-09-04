import type {
  AIToolResult,
  Profile,
  ReadResource,
  Phase2AuditLogEntry,
} from './aiTypes';

const WRITE_INTENT_NAMES = new Set([
  'create_task',
  'assign_task',
  'complete_task',
  'delete_task',
  'create_project',
  'duplicate_project',
  'update_task_status',
  'update_task_due_date',
  'update_project_status',
  'update_project_due_date',
  'assign_project',
  'delete_project',
  'create_revision_request',
  'reassign_revision',
  'update_revision_status',
  'add_revision_note',
  'add_project_note',
  'invite_client',
  'approve_project_milestone',
  'record_project_payment',
  'record_income',
  'record_expense',
  'record_payroll_payment',
  'add_payroll_advance',
  'add_payroll_deduction',
  'send_internal_message',
  'send_client_message',
  'send_whatsapp_message',
  'create_invoice',
  'generate_client_invoice',
]);

const WRITE_ACTION_KEYWORDS = [
  'create',
  'add',
  'banao',
  'bnao',
  'make',
  'delete',
  'remove',
  'hatao',
  'edit',
  'update',
  'change',
  'assign',
  'de do',
  'complete',
  'finish',
  'send',
  'bhejo',
  'bhejdo',
  'record',
  'daldo',
  'khatam',
];

/**
 * Checks whether an intent or user request is attempting a data mutation (Write operation).
 */
export function isWriteOperation(intentName: string, text: string): boolean {
  if (WRITE_INTENT_NAMES.has(intentName)) return true;

  const lower = (text || '').toLowerCase();

  // Exclude informational status inquiries ("ye project complete hogya?", "what tasks are completed?")
  if (/\?$/i.test(lower.trim()) || /\b(status|hogya\?|kya\s+hai)\b/i.test(lower)) {
    if (!/\b(assign|delete|change|send|remove|create|drop\s+table)\b/i.test(lower)) {
      return false;
    }
  }

  // Explicit write imperative phrases and mutation verbs
  if (
    /\b(assign|delete|remove|change\s+.*?salary|send\s+.*?\s*message|mark\s+this\s+invoice\s+paid|create|update|drop\s+table)\b/i.test(lower) ||
    /\b(task|project|invoice|salary)\s+(assign|delete|remove|change|paid|banao)\b/i.test(lower) ||
    /\b(banao|bnao|kardo|krdo|de\s+do|bhejdo)\s+ye\b/i.test(lower)
  ) {
    return true;
  }

  return false;
}

/**
 * Returns a friendly, informative response explaining the Phase 2 Read-Only boundary policy.
 */
export function getReadOnlyBlockedResponse(
  language: 'english' | 'roman_urdu' | 'urdu',
  requestedAction?: string,
): AIToolResult {
  let text = '';
  if (language === 'urdu') {
    text = `🛡️ **Phase 2 Read-Only Mode Active**\n\nمیں اس وقت Phase 2 Read-Only Intelligence موڈ میں ہوں۔ میں آپ کا ڈیٹا دیکھ، سرچ، فیلٹر اور خلاصہ بیان کر سکتا ہوں، لیکن اس وقت کوئی نیا ڈیٹا شامل یا تبدیل نہیں کر سکتا۔`;
  } else if (language === 'roman_urdu') {
    text = `🛡️ **Phase 2 Read-Only Mode Active**\n\nMain abhi Phase 2 Read-Only Intelligence mode mein hoon. Main aap ka data view, search, filter aur analyze kar sakta hoon, lekin abhi koi task/project modify ya execute nahi kar sakta.`;
  } else {
    text = `🛡️ **Phase 2 Read-Only Security Boundary**\n\nI am currently operating in **Phase 2 Read-Only Intelligence Mode**. I can search, filter, analyze, compare, and summarize your data across all modules, but I cannot modify records or execute write operations at this stage.`;
  }

  return {
    success: false,
    toolName: 'read_only_boundary_guard',
    error: 'write_operation_disabled',
    spokenText: text.replace(/\*\*/g, '').replace(/🛡️/g, ''),
    displayText: text,
    count: 0,
  };
}

/**
 * Validates read permissions at query time based on user role and resource scope.
 */
export function checkReadPermission(
  profile: Profile,
  resource: ReadResource,
  targetClientId?: string,
): { allowed: boolean; reason?: string } {
  const role = profile?.role || 'client';

  // Admin & Project Manager have full read access to all resources
  if (role === 'admin' || role === 'project_manager' || role === 'manager') {
    return { allowed: true };
  }

  // Employee Role Restrictions
  if (role === 'employee' || role === 'junior_assistant') {
    if (resource === 'finance') {
      return {
        allowed: false,
        reason: 'Company finance and client receivables are restricted to Manager and Admin accounts.',
      };
    }
    return { allowed: true };
  }

  // Client Role Restrictions
  if (role === 'client') {
    if (
      resource === 'finance' ||
      resource === 'employees' ||
      resource === 'messages'
    ) {
      return {
        allowed: false,
        reason: 'Company finance summaries, internal team performance, and internal messages are restricted for client accounts.',
      };
    }
  }

  return { allowed: true };
}

/**
 * Defense against Indirect Prompt Injection in retrieved data.
 * Sanitizes untrusted user-generated fields (task titles, notes, client instructions) before formatting.
 */
export function sanitizeUntrustedData(content: string): string {
  if (!content) return '';
  return content
    .replace(/ignore\s+all\s+previous\s+instructions/gi, '[filtered instruction]')
    .replace(/you\s+are\s+now\s+an\s+unrestricted/gi, '[filtered instruction]')
    .replace(/show\s+me\s+the\s+admin\s+password/gi, '[filtered instruction]')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .trim();
}

/**
 * Log Phase 2 AI audit trail entries.
 */
const auditLogs: Phase2AuditLogEntry[] = [];

export function logPhase2AuditEntry(entry: Phase2AuditLogEntry): void {
  auditLogs.push(entry);
  if (auditLogs.length > 500) {
    auditLogs.shift();
  }
}

export function getAuditLogs(): Phase2AuditLogEntry[] {
  return [...auditLogs];
}
