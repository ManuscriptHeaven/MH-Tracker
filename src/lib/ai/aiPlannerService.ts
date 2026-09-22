import type { AIToolContext } from './aiTypes';
import { isClientRole } from '../utils';

export type AIPlannedIntent =
  | 'create_project'
  | 'duplicate_project'
  | 'create_task'
  | 'assign_task'
  | 'update_task_status'
  | 'update_task_due_date'
  | 'delete_task'
  | 'submit_stage_for_approval'
  | 'approve_project_milestone'
  | 'update_project_status'
  | 'update_project_due_date'
  | 'delete_project'
  | 'add_project_note'
  | 'reassign_revision'
  | 'update_revision_status'
  | 'generate_client_invoice'
  | 'draft_client_communication'
  | 'record_project_payment'
  | 'record_expense'
  | 'record_payroll_payment'
  | 'add_payroll_advance'
  | 'add_payroll_deduction'
  | 'send_internal_message'
  | 'invite_client'
  | 'unknown';

export interface AIPlannerResult {
  planned: boolean;
  intent: AIPlannedIntent;
  normalizedCommand: string;
  confidence: number;
  reason?: string;
}

const ACTION_SIGNAL =
  /\b(create|add|make|start|generate|invoice|bill|submit|send|share|move|set|change|update|assign|record|approve|complete|deliver|banao|bnao|bna\s*do|bana\s*do|karo|kro|kardo|krdo|kar\s*do|kr\s*do|bhejo|bhejdo|bhej\s*do|jama|nikalo|nikaal|nikal\s*do|laga\s*do|de\s*do)\b|(?:بناؤ|بنا\s*دو|بھیجو|جمع|انوائس|تبدیل|اسائن|مکمل)/iu;

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
    })),
    tasks: isClientRole(ctx.currentProfile.role)
      ? []
      : ctx.visibleTasks.slice(0, 80).map((task) => ({
          title: task.title,
          status: task.status,
          due_date: task.due_date,
          project_id: task.project_id,
          assigned_to: task.assigned_to,
        })),
    team: isClientRole(ctx.currentProfile.role)
      ? []
      : ctx.data.profiles
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
