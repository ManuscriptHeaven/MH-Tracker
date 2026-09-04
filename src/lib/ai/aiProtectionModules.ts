import type {
  FinancialApprovalDetails,
  MessageApprovalDetails,
  EmployeeChangeDetails,
  DeleteApprovalDetails,
  BulkApprovalDetails,
} from './aiApprovalTypes';
import type { AIToolContext } from './aiTypes';

export interface ProtectionCheckResult {
  valid: boolean;
  reason?: string;
  financialDetails?: FinancialApprovalDetails;
  messageDetails?: MessageApprovalDetails;
  employeeDetails?: EmployeeChangeDetails;
  deleteDetails?: DeleteApprovalDetails;
  bulkDetails?: BulkApprovalDetails;
}

// ---------------------------------------------------------------------------
// 1. FINANCIAL ACTION PROTECTION
// ---------------------------------------------------------------------------
export function validateFinancialAction(
  params: Record<string, any>,
  ctx: AIToolContext,
): ProtectionCheckResult {
  const role = ctx.currentProfile.role || 'employee';
  if (role === 'client') {
    return {
      valid: false,
      reason: 'Clients are not authorized to modify financial records or record payments directly.',
    };
  }

  const beforeAmount = Number(params.before_amount || params.beforeAmount || 0);
  const afterAmount = Number(params.after_amount || params.afterAmount || 0);
  const changeAmount = afterAmount - beforeAmount;
  const currency = (params.currency || 'PKR') as 'PKR' | 'USD' | 'EUR' | 'GBP';

  return {
    valid: true,
    financialDetails: {
      invoiceId: params.invoice_id || params.invoiceId || 'INV-1001',
      clientName: params.client_name || params.clientName || 'Client Account',
      currency,
      beforeAmount,
      afterAmount,
      changeAmount,
      reason: params.reason || 'Financial balance adjustment',
    },
  };
}

// ---------------------------------------------------------------------------
// 2. MESSAGE RECIPIENT PROTECTION
// ---------------------------------------------------------------------------
export function validateMessageAction(
  params: Record<string, any>,
  ctx: AIToolContext,
): ProtectionCheckResult {
  const recipientInput = params.recipient_id || params.recipientId || params.recipient;
  const body = params.body || params.message || '';

  if (!body || typeof body !== 'string' || !body.trim()) {
    return { valid: false, reason: 'Message body cannot be empty.' };
  }

  // Canonical Recipient ID Re-validation
  const targetUser = ctx.data.profiles.find(
    (p) =>
      p.id === recipientInput ||
      p.full_name.toLowerCase().includes(String(recipientInput).toLowerCase()) ||
      p.email.toLowerCase().includes(String(recipientInput).toLowerCase()),
  );

  if (!targetUser) {
    return {
      valid: false,
      reason: `Could not resolve canonical recipient for "${recipientInput}". Unrecognized recipients are blocked.`,
    };
  }

  return {
    valid: true,
    messageDetails: {
      recipientId: targetUser.id,
      recipientName: targetUser.full_name,
      recipientEmail: targetUser.email,
      channel: (params.channel || 'in_app') as 'in_app' | 'email' | 'client_portal',
      subject: params.subject || 'Message Notification',
      body,
      attachments: params.attachments || [],
    },
  };
}

// ---------------------------------------------------------------------------
// 3. EMPLOYEE CHANGE PROTECTION
// ---------------------------------------------------------------------------
export function validateEmployeeChange(
  params: Record<string, any>,
  ctx: AIToolContext,
): ProtectionCheckResult {
  const role = ctx.currentProfile.role || 'employee';
  if (role !== 'admin' && role !== 'manager') {
    return {
      valid: false,
      reason: 'Only Managers and Admins can modify employee roles, dues, or status.',
    };
  }

  const empId = params.employee_id || params.employeeId;
  const targetEmp = ctx.data.profiles.find((p) => p.id === empId);

  return {
    valid: true,
    employeeDetails: {
      employeeId: empId || 'emp-1',
      employeeName: targetEmp?.full_name || 'Team Member',
      fieldChanged: params.field_changed || 'role',
      beforeValue: params.before_value || targetEmp?.role,
      afterValue: params.after_value || params.new_role || 'Senior Member',
    },
  };
}

// ---------------------------------------------------------------------------
// 4. DELETE PROTECTION (SOFT DELETE PREFERENCE)
// ---------------------------------------------------------------------------
export function validateDeleteAction(
  params: Record<string, any>,
  ctx: AIToolContext,
): ProtectionCheckResult {
  const entityType = (params.entity_type || params.type || 'project') as 'project' | 'task' | 'client' | 'file';
  const entityId = params.entity_id || params.id || 'res-1';

  let entityName = params.name || 'Resource';
  let dependentTasksCount = 0;
  let dependentFilesCount = 0;

  if (entityType === 'project') {
    const proj = ctx.visibleProjects.find((p) => p.id === entityId);
    if (proj) {
      entityName = proj.project_title;
      dependentTasksCount = (ctx.data.tasks || []).filter((t) => t.project_id === proj.id).length;
    }
  }

  return {
    valid: true,
    deleteDetails: {
      entityType,
      entityId,
      entityName,
      dependentTasksCount,
      dependentFilesCount,
      isSoftDelete: true,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. BULK OPERATION PROTECTION (LIMIT CAP = 20)
// ---------------------------------------------------------------------------
export function validateBulkOperation(
  params: Record<string, any>,
  ctx: AIToolContext,
): ProtectionCheckResult {
  const affectedCount = Number(params.affected_count || params.count || 1);
  const MAX_BULK_CAP = 20;

  if (affectedCount > MAX_BULK_CAP && ctx.currentProfile.role !== 'admin') {
    return {
      valid: false,
      reason: `Bulk operations affecting over ${MAX_BULK_CAP} records require Administrator authorization. Requested: ${affectedCount} records.`,
    };
  }

  return {
    valid: true,
    bulkDetails: {
      affectedCount,
      scopeDescription: params.scope_description || `${affectedCount} items selected`,
      sampleItems: params.sample_items || ['Item #1', 'Item #2', 'Item #3'],
      requiresAdminAuth: affectedCount > MAX_BULK_CAP,
    },
  };
}
