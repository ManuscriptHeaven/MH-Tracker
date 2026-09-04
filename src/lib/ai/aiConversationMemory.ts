import type { StructuredConversationState, IntentResult, ResolvedEntity } from './aiTypes';

export class ConversationMemoryManager {
  private static instance: ConversationMemoryManager;
  private state: StructuredConversationState = {
    recentEntities: {},
    conversationHistory: [],
  };

  public static getInstance(): ConversationMemoryManager {
    if (!ConversationMemoryManager.instance) {
      ConversationMemoryManager.instance = new ConversationMemoryManager();
    }
    return ConversationMemoryManager.instance;
  }

  public getState(): StructuredConversationState {
    return this.state;
  }

  public clear(): void {
    this.state = {
      recentEntities: {},
      conversationHistory: [],
    };
  }

  public updateState(
    intent: IntentResult,
    resolvedEntities: ResolvedEntity[],
    userText: string,
  ): void {
    // Update active intent
    if (intent.name !== 'general_query') {
      this.state.lastIntent = intent.name;
    }

    // Update active entities from resolved entities
    resolvedEntities.forEach((entity) => {
      if (entity.type === 'employee' || entity.type === 'person') {
        this.state.activeEmployee = { id: entity.id, name: entity.name };
        this.state.recentEntities['employee'] = entity;
      }
      if (entity.type === 'project') {
        this.state.activeProject = { id: entity.id, name: entity.name };
        this.state.recentEntities['project'] = entity;
      }
      if (entity.type === 'task') {
        this.state.activeTask = { id: entity.id, name: entity.name };
        this.state.recentEntities['task'] = entity;
      }
    });

    // Append to conversation history
    if (!this.state.conversationHistory) {
      this.state.conversationHistory = [];
    }

    this.state.conversationHistory.push({
      role: 'user',
      text: userText,
      intent: intent.name,
      timestamp: new Date().toISOString(),
    });

    // Maintain max 20 history turns
    if (this.state.conversationHistory.length > 20) {
      this.state.conversationHistory.shift();
    }
  }

  public inheritContextForFollowUp(
    intent: IntentResult,
    resolvedEntities: ResolvedEntity[],
  ): ResolvedEntity[] {
    const inherited = [...resolvedEntities];

    // If intent is view/filter tasks and no employee is explicitly specified in this turn,
    // inherit active employee from conversation memory
    const hasEmployee = inherited.some((e) => e.type === 'employee' || e.type === 'person');
    if (!hasEmployee && this.state.activeEmployee && intent.name.includes('task')) {
      inherited.push({
        type: 'employee',
        id: this.state.activeEmployee.id,
        name: this.state.activeEmployee.name,
        matchScore: 0.9,
        matchedField: 'conversation_memory',
        originalValue: 'inherited',
      });
    }

    // If intent relates to project and no project is explicitly specified, inherit active project
    const hasProject = inherited.some((e) => e.type === 'project');
    if (!hasProject && this.state.activeProject && intent.name.includes('project')) {
      inherited.push({
        type: 'project',
        id: this.state.activeProject.id,
        name: this.state.activeProject.name,
        matchScore: 0.9,
        matchedField: 'conversation_memory',
        originalValue: 'inherited',
      });
    }

    return inherited;
  }
}
