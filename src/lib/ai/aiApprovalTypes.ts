import type { ActionToolName, TargetResource, ProposedChanges } from './aiActionTypes';
import type { Profile } from './aiTypes';

export type ApprovalStatus =
  | 'draft'
  | 'proposed'
  | 'validated'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'authorizing'
  | 'executing'
  | 'completed'
  | 'failed';

export type ExecutionStatus = 'pending' | 'executing' | 'completed' | 'failed';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface FinancialApprovalDetails {
  invoiceId?: string;
  clientName: string;
  currency: 'PKR' | 'USD' | 'EUR' | 'GBP';
  beforeAmount: number;
  afterAmount: number;
  changeAmount: number;
  reason?: string;
}

export interface MessageApprovalDetails {
  recipientId: string;
  recipientName: string;
  recipientEmail?: string;
  channel: 'in_app' | 'email' | 'client_portal';
  subject?: string;
  body: string;
  attachments?: string[];
}

export interface EmployeeChangeDetails {
  employeeId: string;
  employeeName: string;
  fieldChanged: string;
  beforeValue: any;
  afterValue: any;
}

export interface DeleteApprovalDetails {
  entityType: 'project' | 'task' | 'client' | 'file';
  entityId: string;
  entityName: string;
  dependentTasksCount: number;
  dependentFilesCount: number;
  isSoftDelete: boolean;
}

export interface BulkApprovalDetails {
  affectedCount: number;
  scopeDescription: string;
  sampleItems: string[];
  requiresAdminAuth: boolean;
}

export interface AIProposal {
  proposalId: string;
  requestId: string;
  actionTool: ActionToolName;
  targetResource: TargetResource;
  proposedChanges: ProposedChanges;
  reason?: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  createdAt: string;
  expiresAt: string;
  missingRequiredParams: string[];
  financialDetails?: FinancialApprovalDetails;
  messageDetails?: MessageApprovalDetails;
  employeeDetails?: EmployeeChangeDetails;
  deleteDetails?: DeleteApprovalDetails;
  bulkDetails?: BulkApprovalDetails;
}

export interface ApprovalRecord {
  approvalId: string;
  proposalId: string;
  userId: string;
  userRole: string;
  sessionId: string;
  actionTool: ActionToolName;
  targetResourceType: string;
  targetResourceId?: string;
  normalizedParameters: Record<string, any>;
  parametersHash: string;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  approvedAt?: string;
  approvedBy?: string;
  executionStatus: ExecutionStatus;
  executionId?: string;
  rejectionReason?: string;
  idempotencyKey: string;
}

export interface AuditTrailEvent {
  eventId: string;
  proposalId?: string;
  approvalId?: string;
  userId: string;
  userRole: string;
  actionTool: ActionToolName;
  targetResource?: TargetResource;
  timestamp: string;
  eventType:
    | 'proposal_created'
    | 'validation_completed'
    | 'permission_checked'
    | 'approval_requested'
    | 'approval_granted'
    | 'approval_rejected'
    | 'approval_expired'
    | 'execution_started'
    | 'execution_completed'
    | 'execution_failed';
  resultStatus: 'SUCCESS' | 'DENIED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
  details?: Record<string, any>;
}
