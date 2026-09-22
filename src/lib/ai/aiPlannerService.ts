import type { AIToolContext } from './aiTypes';
import { isClientRole } from '../utils';

export type AIPlannedIntent =
  | 'create_project'
  | 'create_task'
  | 'submit_stage_for_approval'
  | 'generate_client_invoice'
  | 'draft_client_communication'
  | 'update_project_status'
  | 'record_project_payment'
  | 'assign_task'
  | 'unknown';

export interface AIPlannerResult {
  planned: boolean;
  intent: AIPlannedIntent;
  normalizedCommand: string;
  confidence: number;
  reason?: string;
}

const ACTION_SIGNAL =
  /\b(create|add|make|start|generate|invoice|bill|submit|send|share|move|set|change|update|assign|record|approve|complete|deliver|banao|bnao|bana\s*do|karo|kro|kar\s*do|kr\s*do|bhejo|bhej\s*do|jama|nikalo|nikal\s*do|laga\s*do|de\s*do)\b|(?:بناؤ|بنا\s*دو|بھیجو|جمع|انوائس|تبدیل|اسائن|مکمل)/iu;

export function shouldUseAIPlanner(message: string): boolean {
  const text = message.trim();
  return text.length >= 4 && text.length <= 1200 && ACTION_SIGNAL.test(text);
}

function safePlannerContext(ctx: AIToolContext) {
  const selectedProject = (ctx as any).selectedProject;
  return {
    role: ctx.currentProfile.role,
    activeView: (ctx as any).activeView || null,
    selectedProject: selectedProject
      ? {
          project_number: selectedProject.project_number,
          project_title: selectedProject.project_title,
          client_name: selectedProject.client_name,
          workflow_stage_key: selectedProject.workflow_stage_key,
          current_stage: selectedProject.current_stage,
        }
      : null,
    projects: ctx.visibleProjects.slice(0, 80).map((project) => ({
      project_number: project.project_number,
      project_title: project.project_title,
      client_name: project.client_name,
      workflow_stage_key: project.workflow_stage_key,
      current_stage: project.current_stage,
      status: project.status,
      remaining_balance: Number(project.remaining_balance || 0),
      invoiced: Boolean(project.invoiced || project.invoice_id),
    })),
    team: ctx.data.profiles
      .filter((profile) => !isClientRole(profile.role))
      .slice(0, 40)
      .map((profile) => ({
        full_name: profile.full_name,
        role: profile.role,
      })),
  };
}

function isPlannerResult(value: unknown): value is AIPlannerResult {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.planned === 'boolean' &&
    typeof data.intent === 'string' &&
    typeof data.normalizedCommand === 'string' &&
    typeof data.confidence === 'number'
  );
}

export async function planNaturalLanguageAction(
  message: string,
  ctx: AIToolContext,
): Promise<AIPlannerResult | null> {
  if (!shouldUseAIPlanner(message) || typeof window === 'undefined') {
    return null;
  }

  try {
    const { isSupabaseConfigured, supabase } = await import('../supabase');
    if (!isSupabaseConfigured || !supabase) return null;

    const invocation = supabase.functions.invoke('ai-planner', {
      body: {
        message: message.trim(),
        context: safePlannerContext(ctx),
      },
    });

    const timeout = new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('AI planner timeout')), 3500);
    });

    const { data, error } = await Promise.race([invocation, timeout]);
    if (error || !isPlannerResult(data)) return null;
    if (!data.planned || data.confidence < 0.72) return null;

    const normalized = data.normalizedCommand.trim().slice(0, 600);
    if (!normalized || normalized.toLowerCase() === message.trim().toLowerCase()) {
      return null;
    }

    return {
      planned: true,
      intent: data.intent,
      normalizedCommand: normalized,
      confidence: Math.min(1, Math.max(0, data.confidence)),
      reason: data.reason?.slice(0, 240),
    };
  } catch {
    // Planner is an enhancement, never a dependency for core Tracker actions.
    return null;
  }
}
