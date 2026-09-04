import type { RiskLevel } from './aiApprovalTypes';
import type { ActionToolName } from './aiActionTypes';

export interface RiskAssessmentInput {
  actionTool: ActionToolName | string;
  parameters: Record<string, any>;
  affectedCount?: number;
  isFinancial?: boolean;
  monetaryValue?: number;
  isDelete?: boolean;
  isBulk?: boolean;
}

export function classifyRisk(input: RiskAssessmentInput): RiskLevel {
  const { actionTool, parameters, affectedCount = 1, isFinancial, monetaryValue = 0, isDelete, isBulk } = input;

  // 1. CRITICAL Risk Tier
  if (isBulk || affectedCount > 10) return 'critical';
  if (isFinancial && monetaryValue > 500000) return 'critical';
  if (isDelete && affectedCount > 5) return 'critical';

  // 2. HIGH Risk Tier
  if (actionTool === 'create_project' || actionTool === 'update_project') return 'high';
  if (actionTool === 'update_calendar') return 'high';
  if (isFinancial || monetaryValue > 0) return 'high';
  if (isDelete) return 'high';
  if (parameters.recipient_id || parameters.send_message || actionTool === 'send_message') return 'high';
  if (parameters.employee_role || parameters.salary || parameters.role_change) return 'high';

  // 3. MEDIUM Risk Tier
  if (actionTool === 'create_task' || actionTool === 'update_task' || actionTool === 'assign_task' || actionTool === 'add_note') {
    return 'medium';
  }

  // 4. LOW Risk Tier
  if (actionTool === 'create_reminder') return 'low';

  return 'medium';
}

export function requiresExplicitUserApproval(riskLevel: RiskLevel): boolean {
  if (riskLevel === 'low') return false; // Configurable optional approval
  return true; // MEDIUM, HIGH, CRITICAL strictly require explicit approval
}
