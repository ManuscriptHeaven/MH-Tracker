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

export class AIUnderstandingEngine {
  private static instance: AIUnderstandingEngine;
  private memoryManager = ConversationMemoryManager.getInstance();

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

    // 12. Recommend tool & payload mapping
    let recommendedTool: AIToolName | undefined = undefined;
    const toolPayload: Record<string, any> = {};

    if (intent.name === 'view_tasks') {
      recommendedTool = 'get_tasks_summary';
    } else if (intent.name === 'assign_task') {
      recommendedTool = 'assign_task';
    } else if (intent.name === 'complete_task') {
      recommendedTool = 'update_task_status';
      toolPayload.status = 'Completed';
    } else if (intent.name === 'create_task') {
      recommendedTool = 'create_task';
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
    };
  }

  public clearMemory(): void {
    this.memoryManager.clear();
  }
}

export const aiUnderstandingEngine = AIUnderstandingEngine.getInstance();
