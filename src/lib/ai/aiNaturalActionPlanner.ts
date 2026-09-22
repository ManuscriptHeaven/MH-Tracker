import { supabase, isSupabaseConfigured } from '../supabase';
import type { AIToolContext } from './aiTypes';

export type NaturalActionName =
  | 'create_project'
  | 'create_task'
  | 'generate_client_invoice'
  | 'submit_stage_for_approval'
  | 'draft_client_communication'
  | 'update_project_status';

export interface NaturalActionPlan {
  action: NaturalActionName;
  normalizedCommand: string;
  confidence: number;
  source: 'local' | 'server';
}

const ALLOWED_ACTIONS = new Set<NaturalActionName>([
  'create_project',
  'create_task',
  'generate_client_invoice',
  'submit_stage_for_approval',
  'draft_client_communication',
  'update_project_status',
]);

function findProject(input: string, ctx: AIToolContext) {
  const lower = input.toLowerCase();
  return [...ctx.visibleProjects]
    .sort((a, b) => Math.max(b.project_title.length, b.project_number.length) - Math.max(a.project_title.length, a.project_number.length))
    .find((project) => {
      const title = (project.project_title || '').toLowerCase();
      const number = (project.project_number || '').toLowerCase();
      return (title && lower.includes(title)) || (number && lower.includes(number));
    });
}

function findClient(input: string, ctx: AIToolContext) {
  const lower = input.toLowerCase();
  const clients = Array.from(new Set(ctx.visibleProjects.map((project) => project.client_name).filter(Boolean)));
  return clients
    .sort((a, b) => b.length - a.length)
    .find((client) => lower.includes(client.toLowerCase()));
}

function localPlan(input: string, ctx: AIToolContext): NaturalActionPlan | null {
  const lower = input.toLowerCase();

  const project = findProject(input, ctx);
  const client = findClient(input, ctx);

  const invoiceIntent =
    /\b(invoice|bill)\b/i.test(input) &&
    /\b(generate|create|make|banao|bnao|nikal|pending|outstanding|due|remaining|baki|baqi)\b/i.test(input);
  if (invoiceIntent && client) {
    return {
      action: 'generate_client_invoice',
      normalizedCommand: `Generate invoice for ${client} for all pending payments`,
      confidence: 0.96,
      source: 'local',
    };
  }

  const stageIntent =
    /\b(submit|send|share|present|bhejo|bhej|jama|forward)\b/i.test(input) &&
    /\b(concept|design concept|print version|print proof|ebook|e-book)\b/i.test(input) &&
    /\b(client|approval|approve|review|client ko|for review)\b/i.test(input);
  if (stageIntent && project) {
    const stage = /ebook|e-book/i.test(input)
      ? 'eBook version'
      : /print/i.test(input)
        ? 'print version'
        : 'design concept';
    return {
      action: 'submit_stage_for_approval',
      normalizedCommand: `Submit the ${stage} for ${project.project_number || project.project_title} for client approval`,
      confidence: 0.97,
      source: 'local',
    };
  }

  if (/\b(project)\b/i.test(input) && /\b(create|add|start|new|naya|banao|bnao|bana|bnado|bana do)\b/i.test(input)) {
    return {
      action: 'create_project',
      normalizedCommand: `Create project ${input}`,
      confidence: 0.88,
      source: 'local',
    };
  }

  if (/\b(task)\b/i.test(input) && /\b(create|add|assign|laga|lagao|banao|bnao|de do|dedo)\b/i.test(input)) {
    return {
      action: 'create_task',
      normalizedCommand: `Create task ${input}`,
      confidence: 0.86,
      source: 'local',
    };
  }

  return null;
}

function isActionish(input: string) {
  return /\b(create|add|make|generate|submit|send|share|assign|update|change|move|mark|banao|bnao|bhejo|lagao|invoice|bill|project|task|concept|approval)\b/i.test(input);
}

export async function planNaturalAction(input: string, ctx: AIToolContext): Promise<NaturalActionPlan | null> {
  const local = localPlan(input, ctx);
  if (local) return local;

  if (!isActionish(input) || !isSupabaseConfigured || !supabase) return null;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const url = import.meta.env.VITE_SUPABASE_URL;
    if (!url) return null;

    const context = {
      projects: ctx.visibleProjects.slice(0, 80).map((project) => ({
        id: project.id,
        number: project.project_number,
        title: project.project_title,
        client: project.client_name,
        stage: project.workflow_stage_key || project.current_stage,
        stageStatus: project.workflow_stage_status_key || project.stage_status,
      })),
      team: ctx.data.profiles
        .filter((profile) => profile.role !== 'client')
        .slice(0, 40)
        .map((profile) => ({ id: profile.id, name: profile.full_name, role: profile.role })),
    };

    const response = await fetch(`${url}/functions/v1/ai-action-planner`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: input, context }),
    });

    if (!response.ok) return null;
    const data = await response.json();

    if (
      !data ||
      !ALLOWED_ACTIONS.has(data.action) ||
      typeof data.normalizedCommand !== 'string' ||
      !data.normalizedCommand.trim() ||
      data.normalizedCommand.length > 500
    ) {
      return null;
    }

    return {
      action: data.action,
      normalizedCommand: data.normalizedCommand.trim(),
      confidence: Math.max(0, Math.min(1, Number(data.confidence || 0))),
      source: 'server',
    };
  } catch {
    return null;
  }
}
