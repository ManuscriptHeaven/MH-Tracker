import type {
  AIUnderstandingOutput,
  AIToolContext,
  PageContext,
  AIToolName,
} from './aiTypes';
import { normalizeInput } from './aiNormalizer';
import { detectLanguage } from './aiLanguageDetector';
import { detectIntent } from './aiIntentDetector';
import { extractEntities, extractAndResolveDates } from './aiEntityExtractor';
import { resolveEntities } from './aiEntityResolver';
import { ConversationMemoryManager } from './aiConversationMemory';
import { buildPageContext, applyContextHierarchy } from './aiPageContext';
import { evaluateClarification } from './aiClarificationEngine';
import { buildReadQueryPlan } from './aiQueryPlanner';
import { isWriteOperation } from './aiSecurityBoundary';
import { buildActionPlan } from './aiActionPlanner';
import { ApprovalEngine } from './aiApprovalEngine';

export class AIUnderstandingEngine {
  private static instance: AIUnderstandingEngine;
  private memoryManager = ConversationMemoryManager.getInstance();
  private approvalEngine = ApprovalEngine.getInstance();

  public static getInstance(): AIUnderstandingEngine {
    if (!AIUnderstandingEngine.instance) {
      AIUnderstandingEngine.instance = new AIUnderstandingEngine();
    }
    return AIUnderstandingEngine.instance;
  }

  public processMessage(
    userMessage: string,
    toolCtx: AIToolContext,
    pageCtx?: PageContext,
  ): AIUnderstandingOutput {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const timestamp = new Date().toISOString();

    // 1. Input Normalization
    const normalizedInput = normalizeInput(userMessage);

    // 2. Language Detection
    const language = detectLanguage(userMessage);

    // 3. Conversation State
    const convoState = this.memoryManager.getState();

    // 4. Intent Detection
    const intent = detectIntent(normalizedInput, language, convoState.lastIntent);

    // 5. Entity Extraction & Dates
    const extractedEntities = extractEntities(normalizedInput);
    const resolvedDates = extractAndResolveDates(userMessage);

    // 6. Entity & Reference Resolution
    const entityRes = resolveEntities(
      extractedEntities,
      userMessage,
      toolCtx,
      pageCtx,
      convoState,
    );

    // 7. Context Hierarchy Application
    const hierarchyEntities = pageCtx
      ? applyContextHierarchy(entityRes.resolvedEntities, pageCtx)
      : entityRes.resolvedEntities;

    // 8. Follow-up Context Inheritance
    const finalResolvedEntities = this.memoryManager.inheritContextForFollowUp(
      intent,
      hierarchyEntities,
    );

    // 9. Update Conversation Memory
    this.memoryManager.updateState(intent, finalResolvedEntities, userMessage);

    // 10. Ambiguity & Smart Clarification Check
    const clarification = evaluateClarification(
      intent,
      finalResolvedEntities,
      entityRes.ambiguities,
      language.primary,
    );

    // 11. Context Used tracking
    const contextUsed: Array<'explicit' | 'page_context' | 'selected_entity' | 'conversation_history' | 'app_data'> = ['explicit'];
    if (pageCtx?.selectedEntity) contextUsed.push('selected_entity');
    if (pageCtx) contextUsed.push('page_context');
    if (convoState.lastIntent) contextUsed.push('conversation_history');
    if (finalResolvedEntities.length > 0) contextUsed.push('app_data');

    // 12. Phase 4 Server-Side Approval Request & Rejection Interception
    const pendingApproval = this.approvalEngine.getPendingApprovalForUser(toolCtx.currentProfile.id);
    if (pendingApproval) {
      if (this.approvalEngine.isApprovalRequest(userMessage)) {
        const execRes = this.approvalEngine.approveProposal(pendingApproval.approvalId, toolCtx.currentProfile.id, toolCtx);
        return {
          requestId,
          timestamp,
          originalInput: userMessage,
          normalizedInput,
          language,
          intent,
          extractedEntities,
          resolvedEntities: finalResolvedEntities,
          resolvedDates,
          references: entityRes.references,
          contextUsed,
          ambiguities: [],
          needsClarification: false,
          clarificationQuestion: null,
          confidence: 1.0,
          responseLanguage: language.primary === 'roman_urdu' ? 'roman_urdu' : language.primary === 'urdu' ? 'urdu' : 'english',
          actionResult: execRes,
          approvalRecord: pendingApproval,
        };
      }

      if (this.approvalEngine.isRejectionRequest(userMessage)) {
        const rejRes = this.approvalEngine.rejectProposal(pendingApproval.approvalId, toolCtx.currentProfile.id, 'User rejected in chat');
        return {
          requestId,
          timestamp,
          originalInput: userMessage,
          normalizedInput,
          language,
          intent,
          extractedEntities,
          resolvedEntities: finalResolvedEntities,
          resolvedDates,
          references: entityRes.references,
          contextUsed,
          ambiguities: [],
          needsClarification: false,
          clarificationQuestion: null,
          confidence: 1.0,
          responseLanguage: language.primary === 'roman_urdu' ? 'roman_urdu' : language.primary === 'urdu' ? 'urdu' : 'english',
          actionResult: rejRes,
          approvalRecord: pendingApproval,
        };
      }
    }

    // 13. Phase 3 & Phase 4 Action & Proposal Planning
    const actionPlanRes = buildActionPlan(
      userMessage,
      intent,
      finalResolvedEntities,
      resolvedDates,
      toolCtx,
      pageCtx,
    );

    let proposalObj: any = undefined;
    let approvalRecObj: any = undefined;

    if (actionPlanRes.isAction && actionPlanRes.actionPlan) {
      const propResult = this.approvalEngine.createProposal(
        actionPlanRes.actionPlan.actionTool,
        actionPlanRes.actionPlan.targetResource,
        actionPlanRes.actionPlan.proposedChanges,
        actionPlanRes.actionPlan.parameters,
        toolCtx,
        actionPlanRes.actionPlan.reason,
      );
      proposalObj = propResult.proposal;
      approvalRecObj = propResult.approvalRecord;
    }

    // 14. Phase 2 Read Query Planning & Security Boundary Guard
    const isWrite = actionPlanRes.isAction || isWriteOperation(intent.name, userMessage);
    const queryPlan = buildReadQueryPlan(
      {
        requestId,
        timestamp,
        originalInput: userMessage,
        normalizedInput,
        language,
        intent,
        extractedEntities,
        resolvedEntities: finalResolvedEntities,
        resolvedDates,
        references: entityRes.references,
        contextUsed,
        ambiguities: entityRes.ambiguities,
        needsClarification: clarification.needsClarification,
        clarificationQuestion: clarification.question,
        confidence: clarification.confidence,
        responseLanguage:
          language.primary === 'roman_urdu'
            ? 'roman_urdu'
            : language.primary === 'urdu'
            ? 'urdu'
            : 'english',
      },
      pageCtx,
    );

    let recommendedTool: AIToolName | undefined = queryPlan.targetTool;
    const toolPayload: Record<string, any> = {};

    if (!recommendedTool) {
      if (intent.name === 'view_tasks') {
        recommendedTool = 'get_tasks_summary';
      } else if (intent.name === 'view_project' || intent.name === 'project_summary') {
        recommendedTool = 'get_project_summary';
      } else if (intent.name === 'employee_performance') {
        recommendedTool = 'get_employee_workload';
      } else if (intent.name === 'employee_dues') {
        recommendedTool = 'get_payroll_summary';
      } else if (intent.name === 'invoice_summary') {
        recommendedTool = 'get_client_receivables';
      } else if (intent.name === 'finance_summary') {
        recommendedTool = 'get_finance_summary';
      } else if (intent.name === 'search_messages') {
        recommendedTool = 'get_messages';
      } else if (intent.name === 'view_calendar') {
        recommendedTool = 'get_calendar_events';
      } else if (intent.name === 'compare_employees') {
        recommendedTool = 'compare_employees';
      } else if (intent.name === 'cross_module_query') {
        recommendedTool = 'run_cross_module_query';
      }
    }

    // Populate payload from resolved entities
    finalResolvedEntities.forEach((ent) => {
      if (ent.type === 'employee' || ent.type === 'person') {
        toolPayload.assignedTo = ent.id;
        toolPayload.employeeName = ent.name;
      }
      if (ent.type === 'project') {
        toolPayload.projectId = ent.id;
        toolPayload.projectTitle = ent.name;
      }
      if (ent.type === 'task') {
        toolPayload.taskId = ent.id;
        toolPayload.taskTitle = ent.name;
      }
    });

    if (resolvedDates.length > 0) {
      toolPayload.dueDate = resolvedDates[0].resolvedDate;
    }

    // 15. Phase 5 Cross-Module Intelligence & Multi-Write Proposals
    let crossModulePlan: any = undefined;
    let crossModuleResult: any = undefined;
    let multiWriteProposal: any = undefined;

    const crossPlanner = CrossModulePlanner.getInstance();
    const aggregator = CrossModuleAggregator.getInstance();
    const cache = CrossModuleCache.getInstance();
    const telemetry = CrossModuleTelemetry.getInstance();

    if (crossPlanner.isCrossModuleQuery(userMessage, intent)) {
      crossModulePlan = crossPlanner.buildQueryPlan(userMessage, intent);
      const cacheKey = JSON.stringify(crossModulePlan.steps);
      const cachedRes = cache.get(toolCtx.currentProfile.id, crossModulePlan.planId, cacheKey);

      if (cachedRes) {
        crossModuleResult = cachedRes;
      } else {
        crossModuleResult = aggregator.executePlan(crossModulePlan, toolCtx);
        cache.set(toolCtx.currentProfile.id, crossModulePlan.planId, cacheKey, crossModuleResult);
      }

      telemetry.recordEvent({
        userId: toolCtx.currentProfile.id,
        userRole: toolCtx.currentProfile.role || 'employee',
        intentName: intent.name,
        planId: crossModulePlan.planId,
        executedTools: crossModulePlan.steps.map((s: any) => s.tool),
        latencyMs: crossModuleResult.latencyMs,
        permissionChecksPassed: crossModuleResult.permissionMaskedCount === 0,
        blockedWriteAttempt: false,
        promptInjectionDetected: false,
        cacheHit: !!cachedRes,
      });
    }

    const multiWriteProp = crossPlanner.buildMultiStepWriteProposal(userMessage, toolCtx);
    if (multiWriteProp) {
      multiWriteProposal = multiWriteProp;
    }

    return {
      requestId,
      timestamp,
      originalInput: userMessage,
      normalizedInput,
      language,
      intent,
      extractedEntities,
      resolvedEntities: finalResolvedEntities,
      resolvedDates,
      references: entityRes.references,
      contextUsed,
      ambiguities: entityRes.ambiguities,
      needsClarification: clarification.needsClarification,
      clarificationQuestion: clarification.question,
      confidence: clarification.confidence,
      responseLanguage:
        language.primary === 'roman_urdu'
          ? 'roman_urdu'
          : language.primary === 'urdu'
          ? 'urdu'
          : 'english',
      recommendedTool,
      toolPayload,
      queryPlan,
      writeBlocked: isWrite,
      actionPlan: actionPlanRes.actionPlan,
      confirmationToken: actionPlanRes.confirmationToken,
      proposal: proposalObj,
      approvalRecord: approvalRecObj,
      crossModulePlan,
      crossModuleResult,
      multiWriteProposal,
    };
  }

  public clearMemory(): void {
    this.memoryManager.clear();
  }
}

// Add imports for Phase 5 at the top of file
import { CrossModulePlanner } from './aiCrossModulePlanner';
import { CrossModuleAggregator } from './aiCrossModuleAggregator';
import { CrossModuleCache } from './aiCrossModuleCache';
import { CrossModuleTelemetry } from './aiCrossModuleTelemetry';

export const aiUnderstandingEngine = AIUnderstandingEngine.getInstance();
