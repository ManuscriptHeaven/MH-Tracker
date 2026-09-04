import type {
  AIProposal,
  ApprovalRecord,
  ApprovalStatus,
  AuditTrailEvent,
} from './aiApprovalTypes';
import type { ActionToolName, ProposedChanges, TargetResource } from './aiActionTypes';
import type { AIToolContext } from './aiTypes';
import { checkActionPermission } from './aiPermissionEngine';
import { classifyRisk, requiresExplicitUserApproval } from './aiRiskEngine';
import {
  validateFinancialAction,
  validateMessageAction,
  validateEmployeeChange,
  validateDeleteAction,
  validateBulkOperation,
} from './aiProtectionModules';

export interface ApprovalExecutionResult {
  success: boolean;
  status: ApprovalStatus;
  approvalRecord?: ApprovalRecord;
  errorCode?: string;
  reason?: string;
  spokenText?: string;
  displayText?: string;
}

export class ApprovalEngine {
  private static instance: ApprovalEngine;
  private proposals: Map<string, AIProposal> = new Map();
  private approvalRecords: Map<string, ApprovalRecord> = new Map();
  private pendingApprovalByUser: Map<string, ApprovalRecord> = new Map();
  private consumedIdempotencyKeys: Set<string> = new Set();
  private auditTrail: AuditTrailEvent[] = [];

  public static getInstance(): ApprovalEngine {
    if (!ApprovalEngine.instance) {
      ApprovalEngine.instance = new ApprovalEngine();
    }
    return ApprovalEngine.instance;
  }

  public hashParameters(actionTool: string, params: Record<string, any>): string {
    const keys = Object.keys(params).sort();
    const sortedObj: Record<string, any> = {};
    keys.forEach((k) => {
      sortedObj[k] = params[k];
    });
    return `${actionTool}:${JSON.stringify(sortedObj)}`;
  }

  public createProposal(
    actionTool: ActionToolName,
    targetResource: TargetResource,
    proposedChanges: ProposedChanges,
    parameters: Record<string, any>,
    ctx: AIToolContext,
    reason?: string,
  ): { proposal: AIProposal; approvalRecord: ApprovalRecord } {
    const proposalId = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const approvalId = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5-minute TTL

    const paramStr = JSON.stringify(parameters) + JSON.stringify(proposedChanges) + (reason || '');
    const amountMatch = paramStr.match(/([\d,]+)\s*(PKR|USD|EUR|GBP)?/i);
    const extractedAmount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 0;
    const monetaryValue = Number(parameters.amount || parameters.monetary_value || extractedAmount || 0);
    const isFinancial = !!parameters.is_financial || (actionTool as string) === 'create_invoice' || /pkr|usd|eur|gbp|financial|balance|amount/i.test(paramStr);

    const riskLevel = classifyRisk({
      actionTool,
      parameters,
      isFinancial,
      monetaryValue,
      isDelete: !!parameters.is_delete || actionTool.includes('delete'),
      isBulk: Number(parameters.affected_count || 1) > 1,
      affectedCount: Number(parameters.affected_count || 1),
    });

    const proposal: AIProposal = {
      proposalId,
      requestId: `req-${Date.now()}`,
      actionTool,
      targetResource,
      proposedChanges,
      reason,
      riskLevel,
      requiresApproval: requiresExplicitUserApproval(riskLevel),
      createdAt,
      expiresAt,
      missingRequiredParams: [],
    };

    // Attach specialized protection details
    if (parameters.is_financial) {
      const finRes = validateFinancialAction(parameters, ctx);
      if (finRes.financialDetails) proposal.financialDetails = finRes.financialDetails;
    }
    if (parameters.recipient_id || parameters.send_message) {
      const msgRes = validateMessageAction(parameters, ctx);
      if (msgRes.messageDetails) proposal.messageDetails = msgRes.messageDetails;
    }
    if (parameters.employee_id) {
      const empRes = validateEmployeeChange(parameters, ctx);
      if (empRes.employeeDetails) proposal.employeeDetails = empRes.employeeDetails;
    }
    if (parameters.is_delete) {
      const delRes = validateDeleteAction(parameters, ctx);
      if (delRes.deleteDetails) proposal.deleteDetails = delRes.deleteDetails;
    }
    if (Number(parameters.affected_count || 1) > 1) {
      const bulkRes = validateBulkOperation(parameters, ctx);
      if (bulkRes.bulkDetails) proposal.bulkDetails = bulkRes.bulkDetails;
    }

    const parametersHash = this.hashParameters(actionTool, parameters);
    const idempotencyKey = `idemp-${proposalId}-v1`;

    const record: ApprovalRecord = {
      approvalId,
      proposalId,
      userId: ctx.currentProfile.id,
      userRole: ctx.currentProfile.role,
      sessionId: `sess-${ctx.currentProfile.id}`,
      actionTool,
      targetResourceType: targetResource.type,
      targetResourceId: targetResource.id,
      normalizedParameters: parameters,
      parametersHash,
      riskLevel,
      status: 'pending_approval',
      createdAt,
      expiresAt,
      executionStatus: 'pending',
      idempotencyKey,
    };

    this.proposals.set(proposalId, proposal);
    this.approvalRecords.set(approvalId, record);
    this.pendingApprovalByUser.set(ctx.currentProfile.id, record);

    this.logAuditEvent({
      eventId: `evt-${Date.now()}`,
      proposalId,
      approvalId,
      userId: ctx.currentProfile.id,
      userRole: ctx.currentProfile.role,
      actionTool,
      targetResource,
      timestamp: createdAt,
      eventType: 'proposal_created',
      resultStatus: 'SUCCESS',
      details: { riskLevel, parameters },
    });

    return { proposal, approvalRecord: record };
  }

  public getPendingApprovalForUser(userId: string): ApprovalRecord | undefined {
    const record = this.pendingApprovalByUser.get(userId);
    if (!record) return undefined;

    // Check expiration
    if (new Date().getTime() > new Date(record.expiresAt).getTime()) {
      record.status = 'expired';
      this.pendingApprovalByUser.delete(userId);
      this.logAuditEvent({
        eventId: `evt-${Date.now()}`,
        approvalId: record.approvalId,
        userId,
        userRole: record.userRole,
        actionTool: record.actionTool,
        timestamp: new Date().toISOString(),
        eventType: 'approval_expired',
        resultStatus: 'EXPIRED',
      });
      return undefined;
    }

    return record;
  }

  public approveProposal(
    approvalId: string,
    userId: string,
    ctx: AIToolContext,
  ): ApprovalExecutionResult {
    const record = this.approvalRecords.get(approvalId);

    if (!record) {
      return {
        success: false,
        status: 'failed',
        errorCode: 'APPROVAL_NOT_FOUND',
        reason: 'Approval record not found.',
        spokenText: 'Could not find the approval record to execute.',
        displayText: '⚠️ Approval record not found.',
      };
    }

    // 1. Session / User Binding Check
    if (record.userId !== userId) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'USER_MISMATCH',
        reason: 'Approval record user mismatch.',
        spokenText: 'You are not authorized to approve this pending action.',
        displayText: '🔒 Permission Denied: User mismatch.',
      };
    }

    // 2. Expiration Check
    if (new Date().getTime() > new Date(record.expiresAt).getTime()) {
      record.status = 'expired';
      this.pendingApprovalByUser.delete(userId);
      return {
        success: false,
        status: 'expired',
        errorCode: 'CONFIRMATION_EXPIRED',
        reason: 'The approval proposal has expired. Please request the action again.',
        spokenText: 'That approval has expired. Please request the change again.',
        displayText: '⏰ Approval Expired.',
      };
    }

    // 3. Replay Protection & Idempotency Check
    if (this.consumedIdempotencyKeys.has(record.idempotencyKey)) {
      return {
        success: false,
        status: 'completed',
        approvalRecord: record,
        spokenText: 'This approval has already been executed.',
        displayText: 'ℹ️ Action already executed (idempotency key consumed).',
      };
    }

    // 4. Pre-Execution Permission Re-Check
    const perm = checkActionPermission(ctx.currentProfile, record.actionTool);
    if (!perm.allowed) {
      record.status = 'rejected';
      this.pendingApprovalByUser.delete(userId);
      return {
        success: false,
        status: 'rejected',
        errorCode: 'PERMISSION_DENIED',
        reason: perm.reason,
        spokenText: `Permission check failed: ${perm.reason}`,
        displayText: `🔒 Permission Denied: ${perm.reason}`,
      };
    }

    // Mark Approved & Executing
    record.status = 'approved';
    record.approvedAt = new Date().toISOString();
    record.approvedBy = userId;
    record.executionStatus = 'executing';
    this.consumedIdempotencyKeys.add(record.idempotencyKey);
    this.pendingApprovalByUser.delete(userId);

    this.logAuditEvent({
      eventId: `evt-${Date.now()}`,
      approvalId: record.approvalId,
      userId,
      userRole: ctx.currentProfile.role,
      actionTool: record.actionTool,
      timestamp: new Date().toISOString(),
      eventType: 'approval_granted',
      resultStatus: 'SUCCESS',
    });

    record.executionStatus = 'completed';
    record.status = 'completed';

    return {
      success: true,
      status: 'completed',
      approvalRecord: record,
      spokenText: `Approval granted. ${record.actionTool.replace('_', ' ')} executed successfully.`,
      displayText: `### ✅ Approved & Executed\n\n• **Action:** ${record.actionTool}\n• **Status:** Completed`,
    };
  }

  public rejectProposal(approvalId: string, userId: string, reason?: string): ApprovalExecutionResult {
    const record = this.approvalRecords.get(approvalId);
    if (record) {
      record.status = 'rejected';
      record.rejectionReason = reason || 'User rejected action proposal';
      this.pendingApprovalByUser.delete(userId);

      this.logAuditEvent({
        eventId: `evt-${Date.now()}`,
        approvalId,
        userId,
        userRole: record.userRole,
        actionTool: record.actionTool,
        timestamp: new Date().toISOString(),
        eventType: 'approval_rejected',
        resultStatus: 'CANCELLED',
        details: { reason },
      });

      return {
        success: true,
        status: 'rejected',
        approvalRecord: record,
        spokenText: 'Action proposal rejected. No changes were made.',
        displayText: '🛑 Action Rejected. No changes were made.',
      };
    }
    return { success: false, status: 'failed', errorCode: 'APPROVAL_NOT_FOUND' };
  }

  public isApprovalRequest(userMessage: string): boolean {
    const text = (userMessage || '').trim().toLowerCase().replace(/[.!?,\u061B\u061F]+$/, '');
    const approveKeywords = [
      'yes',
      'confirm',
      'approve',
      'approved',
      'do it',
      'go ahead',
      'haan',
      'han',
      'haan kar do',
      'theek hai',
      'kar do',
      'منظور ہے',
      'ہاں',
      'ٹھیک ہے',
    ];
    return approveKeywords.some((kw) => text === kw || text.startsWith(`${kw} `));
  }

  public isRejectionRequest(userMessage: string): boolean {
    const text = (userMessage || '').trim().toLowerCase().replace(/[.!?,\u061B\u061F]+$/, '');
    const rejectKeywords = [
      'no',
      'cancel',
      "don't do it",
      'dont do it',
      'stop',
      'nahi',
      'nahin',
      'rehne do',
      'cancel kar do',
      'منسوخ',
      'نہیں',
    ];
    return rejectKeywords.some((kw) => text === kw || text.startsWith(`${kw} `));
  }

  public logAuditEvent(event: AuditTrailEvent): void {
    this.auditTrail.unshift(event);
  }

  public getAuditTrail(userId?: string): AuditTrailEvent[] {
    if (userId) return this.auditTrail.filter((e) => e.userId === userId);
    return this.auditTrail;
  }

  public clear(): void {
    this.proposals.clear();
    this.approvalRecords.clear();
    this.pendingApprovalByUser.clear();
    this.consumedIdempotencyKeys.clear();
    this.auditTrail = [];
  }
}
