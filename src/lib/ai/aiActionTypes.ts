import type { Profile } from './aiTypes';

/**
 * PHASE 3 ALLOWLIST: Exactly 8 allowed action tools.
 * Un-allowlisted write tools or arbitrary SQL/API access are strictly prohibited.
 */
export type ActionToolName =
  | 'create_task'
  | 'update_task'
  | 'assign_task'
  | 'create_project'
  | 'update_project'
  | 'create_reminder'
  | 'update_calendar'
  | 'add_note';

export type ActionRiskLevel = 'low' | 'medium' | 'high';

export type ConfirmationStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export interface TargetResource {
  type: 'task' | 'project' | 'client' | 'reminder' | 'calendar_event' | 'note';
  id?: string;
  name?: string;
  projectId?: string;
}

export interface ProposedChanges {
  [field: string]: {
    from?: any;
    to: any;
  };
}

export interface AIActionPlan {
  actionId: string;
  requestId: string;
  timestamp: string;
  actionTool: ActionToolName;
  targetResource: TargetResource;
  parameters: Record<string, any>;
  reason?: string;
  riskLevel: ActionRiskLevel;
  requiresConfirmation: boolean;
  missingRequiredParams: string[];
  proposedChanges: ProposedChanges;
}

export interface ConfirmationToken {
  tokenId: string;
  actionPlan: AIActionPlan;
  parametersHash: string;
  actorId: string;
  createdAt: string;
  expiresAt: string;
  status: ConfirmationStatus;
  userMessageContext?: string;
}

export interface ActionAuditLogEntry {
  actionId: string;
  requestId: string;
  userId: string;
  userRole: string;
  timestamp: string;
  actionTool: ActionToolName;
  targetResourceType: string;
  targetResourceId?: string;
  parameters: Record<string, any>;
  beforeAfter: ProposedChanges;
  authorized: boolean;
  confirmed: boolean;
  executed: boolean;
  resultStatus: 'SUCCESS' | 'DENIED' | 'CANCELLED' | 'EXPIRED' | 'VALIDATION_ERROR' | 'EXECUTION_FAILED';
  failureReason?: string;
  idempotencyKey?: string;
}

export type ActionErrorCode =
  | 'ACTION_NOT_ALLOWED'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_NOT_FOUND'
  | 'AMBIGUOUS_RESOURCE'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'DUPLICATE_ACTION'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_EXPIRED'
  | 'CONFIRMATION_INVALID'
  | 'EXECUTION_FAILED'
  | 'TIMEOUT'
  | 'RATE_LIMITED';

export interface ActionResult {
  success: boolean;
  actionId: string;
  actionTool: ActionToolName;
  spokenText: string;
  displayText: string;
  resource?: TargetResource;
  changes?: ProposedChanges;
  errorCode?: ActionErrorCode;
  failureReason?: string;
  undoAvailable?: boolean;
  auditEntry?: ActionAuditLogEntry;
}

export interface ReminderItem {
  id: string;
  title: string;
  reminder_date: string;
  reminder_time?: string;
  user_id: string;
  related_entity_type?: string;
  related_entity_id?: string;
  created_at: string;
  completed?: boolean;
}

export interface CalendarEventItem {
  id: string;
  title: string;
  event_date: string;
  start_time?: string;
  end_time?: string;
  description?: string;
  project_id?: string;
  user_id: string;
  created_at: string;
}

export interface ApplicationNoteItem {
  id: string;
  target_type: 'task' | 'project' | 'client';
  target_id: string;
  content: string;
  author_id: string;
  created_at: string;
}
