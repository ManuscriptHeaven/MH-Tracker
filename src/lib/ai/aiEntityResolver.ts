import type {
  ExtractedEntity,
  ResolvedEntity,
  PageContext,
  StructuredConversationState,
  AIToolContext,
  DisambiguationOption,
} from './aiTypes';

export interface EntityResolutionResult {
  resolvedEntities: ResolvedEntity[];
  references: Array<{ raw: string; resolvedTo: { type: string; id: string; name: string } }>;
  ambiguities: Array<{ field: string; options: DisambiguationOption[]; description: string }>;
}

export function resolveEntities(
  extracted: ExtractedEntity[],
  rawText: string,
  ctx: AIToolContext,
  pageCtx?: PageContext,
  conversationState?: StructuredConversationState,
): EntityResolutionResult {
  const resolvedEntities: ResolvedEntity[] = [];
  const references: Array<{ raw: string; resolvedTo: { type: string; id: string; name: string } }> = [];
  const ambiguities: Array<{ field: string; options: DisambiguationOption[]; description: string }> = [];

  const lower = rawText.toLowerCase();

  // 1. Resolve Person / Employee / Client
  const profiles = ctx.data.profiles || [];
  const projects = ctx.visibleProjects || [];
  const tasks = ctx.visibleTasks || [];

  // Find mentions of names in extracted entities or raw text
  const nameCandidates = extracted
    .filter((e) => e.type === 'person')
    .map((e) => e.normalizedText);

  // If no person entity was extracted, extract single tokens that match profile names
  if (nameCandidates.length === 0) {
    profiles.forEach((p) => {
      const fn = (p.full_name || '').split(' ')[0].toLowerCase();
      if (fn && fn.length > 2 && lower.includes(fn)) {
        nameCandidates.push(fn);
      }
    });
  }

  nameCandidates.forEach((candidate) => {
    const matchedProfiles = profiles.filter((p) => {
      const fullName = (p.full_name || '').toLowerCase();
      const fn = fullName.split(' ')[0];
      return (
        fullName === candidate.toLowerCase() ||
        fn === candidate.toLowerCase() ||
        fullName.includes(candidate.toLowerCase())
      );
    });

    if (matchedProfiles.length === 1) {
      const p = matchedProfiles[0];
      resolvedEntities.push({
        type: p.role === 'client' ? 'client' : 'employee',
        id: p.id,
        name: p.full_name,
        matchScore: 0.95,
        matchedField: 'full_name',
        originalValue: candidate,
        objectData: p,
      });
    } else if (matchedProfiles.length > 1) {
      ambiguities.push({
        field: 'employee',
        description: `Multiple team members found matching "${candidate}".`,
        options: matchedProfiles.map((p) => ({
          id: p.id,
          title: p.full_name,
          subtitle: p.email || p.role,
          type: p.role === 'client' ? 'client' : 'employee',
          data: p,
        })),
      });
    }
  });

  // 2. Resolve Project Mentions
  projects.forEach((proj) => {
    const titleLower = proj.project_title.toLowerCase();
    const projNumLower = proj.project_number.toLowerCase();

    if (lower.includes(titleLower) || lower.includes(projNumLower)) {
      resolvedEntities.push({
        type: 'project',
        id: proj.id,
        name: proj.project_title,
        matchScore: 0.98,
        matchedField: lower.includes(projNumLower) ? 'project_number' : 'project_title',
        originalValue: proj.project_title,
        objectData: proj,
      });
    }
  });

  // 3. Resolve Task Mentions
  tasks.forEach((t) => {
    const titleLower = (t.title || '').toLowerCase();
    if (titleLower.length > 3 && lower.includes(titleLower)) {
      resolvedEntities.push({
        type: 'task',
        id: t.id,
        name: t.title,
        matchScore: 0.95,
        matchedField: 'title',
        originalValue: t.title,
        objectData: t,
      });
    }
  });

  // 4. Anaphora & Reference Resolution (ye, isko, isay, this task, current project)
  const isAnaphoric = /\b(ye|yeh|yh|is|isko|isay|ise|us|usko|usay|this|that|it|selected)\b/i.test(lower);

  if (isAnaphoric) {
    // Priority 1: Current Page Selected Entity
    if (pageCtx?.selectedEntity) {
      references.push({
        raw: 'this',
        resolvedTo: {
          type: pageCtx.selectedEntity.type,
          id: pageCtx.selectedEntity.id,
          name: pageCtx.selectedEntity.name,
        },
      });

      resolvedEntities.push({
        type: pageCtx.selectedEntity.type as any,
        id: pageCtx.selectedEntity.id,
        name: pageCtx.selectedEntity.name,
        matchScore: 0.99,
        matchedField: 'page_context_selected',
        originalValue: 'this',
        objectData: pageCtx.selectedEntity.data,
      });
    }
    // Priority 2: Active Conversation State
    else if (conversationState?.activeTask) {
      references.push({
        raw: 'this',
        resolvedTo: {
          type: 'task',
          id: conversationState.activeTask.id,
          name: conversationState.activeTask.name,
        },
      });
    } else if (conversationState?.activeProject) {
      references.push({
        raw: 'this',
        resolvedTo: {
          type: 'project',
          id: conversationState.activeProject.id,
          name: conversationState.activeProject.name,
        },
      });
    }
  }

  // 5. My / Mera pronoun resolution
  const isSelf = /\b(mera|meri|mere|mery|my|mine|me|assigned to me)\b/i.test(lower);
  if (isSelf && ctx.currentProfile) {
    resolvedEntities.push({
      type: 'employee',
      id: ctx.currentProfile.id,
      name: ctx.currentProfile.full_name,
      matchScore: 1.0,
      matchedField: 'self_profile',
      originalValue: 'my',
      objectData: ctx.currentProfile,
    });
  }

  return {
    resolvedEntities,
    references,
    ambiguities,
  };
}
