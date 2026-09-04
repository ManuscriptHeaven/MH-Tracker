import type { ActionToolName, ProposedChanges, TargetResource } from './aiActionTypes';
import type { RiskLevel } from './aiApprovalTypes';
import type { BroadIntentCategory } from './aiTypes';

export type CrossModuleDomain = 'projects' | 'tasks' | 'employees' | 'clients' | 'finance' | 'messages' | 'calendar';

export interface JoinStep {
  stepId: string;
  tool: string;
  module: CrossModuleDomain;
  params: Record<string, any>;
  dependsOn?: string[]; // IDs of previous steps required before this step
  joinKey?: string;     // e.g. 'client_id', 'project_id', 'assigned_to'
}

export interface CrossModuleQueryPlan {
  planId: string;
  requestId: string;
  timestamp: string;
  intentCategory: BroadIntentCategory;
  description: string;
  steps: JoinStep[];
  primaryModule: CrossModuleDomain;
  secondaryModules: CrossModuleDomain[];
  isWritePlan: boolean;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

export interface JoinedRecord {
  primaryId: string;
  primaryModule: CrossModuleDomain;
  title: string;
  subtitle?: string;
  status?: string;
  date?: string;
  amount?: number;
  currency?: string;
  relatedModuleData: Record<string, any[]>; // e.g. { invoices: [...], tasks: [...] }
  deepLink: string;
}

export interface FederatedResult {
  planId: string;
  executedAt: string;
  totalRecordsFound: number;
  records: JoinedRecord[];
  moduleCounts: Record<CrossModuleDomain, number>;
  permissionMaskedCount: number;
  latencyMs: number;
  fromCache: boolean;
}

export interface CrossModuleWriteStep {
  actionTool: ActionToolName;
  module: CrossModuleDomain;
  targetResource: TargetResource;
  parameters: Record<string, any>;
  proposedChanges: ProposedChanges;
  riskLevel: RiskLevel;
}

export interface CrossModuleWriteProposal {
  proposalId: string;
  requestId: string;
  createdAt: string;
  expiresAt: string;
  overallRiskLevel: RiskLevel;
  steps: CrossModuleWriteStep[];
  affectedModules: CrossModuleDomain[];
  summaryMessage: string;
  requiresApproval: boolean;
}

export interface TelemetryEvent {
  eventId: string;
  timestamp: string;
  userId: string;
  userRole: string;
  intentName: string;
  planId?: string;
  executedTools: string[];
  latencyMs: number;
  permissionChecksPassed: boolean;
  blockedWriteAttempt: boolean;
  promptInjectionDetected: boolean;
  cacheHit: boolean;
}
