import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const allowedIntents = new Set([
  'create_project',
  'duplicate_project',
  'create_task',
  'assign_task',
  'update_task_status',
  'update_task_due_date',
  'delete_task',
  'submit_stage_for_approval',
  'approve_project_milestone',
  'update_project_status',
  'update_project_due_date',
  'delete_project',
  'add_project_note',
  'reassign_revision',
  'update_revision_status',
  'generate_client_invoice',
  'draft_client_communication',
  'record_project_payment',
  'record_expense',
  'record_payroll_payment',
  'add_payroll_advance',
  'add_payroll_deduction',
  'send_internal_message',
  'invite_client',
  'unknown',
]);

type PlannerContext = {
  role?: string;
  activeView?: string | null;
  selectedProject?: Record<string, unknown> | null;
  projects?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
  team?: Array<Record<string, unknown>>;
};

type PlannerStep = {
  intent: string;
  normalizedCommand: string;
  confidence: number;
  reason?: string;
};

type PlannerResult = {
  planned: boolean;
  intent: string;
  normalizedCommand: string;
  confidence: number;
  reason?: string;
  steps?: PlannerStep[];
};

const rateLimits = new Map<string, { count: number; resetAt: number }>();

const ACTION_SIGNAL =
  /\b(create|add|make|start|generate|invoice|bill|submit|send|share|move|set|change|update|assign|record|approve|complete|deliver|put|draft|write|prepare|banao|bnao|karo|kro|krdo|bhejo|jama|nikalo|lagao|lgao|laga\s*do|de\s*do)\b|(?:بناؤ|بنا\s*دو|بھیجو|جمع|انوائس|تبدیل|اسائن|مکمل)/iu;

function splitCompoundActionMessage(message: string): string[] {
  if (/\b(?:create|add)\b[\s\S]*\b(?:task|project)\b[\s\S]*\band\b[\s\S]*\bassign\b/i.test(message)) {
    return [message];
  }

  const parts = message
    .split(/\b(?:and then|then|and|phir|aur phir|aur|also)\b|(?:پھر|اور پھر|اور)/iu)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) return [message];
  return parts.filter((part) => ACTION_SIGNAL.test(part)).length >= 2 ? parts.slice(0, 4) : [message];
}

function normalizeText(value: unknown, max = 1200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function knownClient(message: string, context: PlannerContext) {
  const lower = message.toLowerCase();
  const clients = Array.from(
    new Set(
      (context.projects || [])
        .map((project) => normalizeText(project.client_name, 120))
        .filter(Boolean),
    ),
  );
  return clients.find((client) => lower.includes(client.toLowerCase()));
}

function knownProject(message: string, context: PlannerContext) {
  const lower = message.toLowerCase();
  return (context.projects || []).find((project) => {
    const title = normalizeText(project.project_title, 180).toLowerCase();
    const number = normalizeText(project.project_number, 80).toLowerCase();
    return (title && lower.includes(title)) || (number && lower.includes(number));
  });
}

function looseProjectTitle(message: string, client?: string) {
  const quoted = message.match(/["“”']([^"“”']{2,180})["“”']/);
  if (quoted?.[1]) return quoted[1].trim();

  const stripClient = (value: string) => {
    let result = value;
    if (client) {
      const clientIndex = result.toLowerCase().indexOf(client.toLowerCase());
      if (clientIndex >= 0) {
        result =
          result.slice(0, clientIndex) +
          ' ' +
          result.slice(clientIndex + client.length);
      }
    }
    return result
      .replace(/\b(?:k|ke|ki)?\s*(?:liye|lie)\b/gi, ' ')
      .replace(/\bfor\s+(?:the\s+)?client\b/gi, ' ')
      .replace(/\bclient\b/gi, ' ')
      .replace(/\b(?:ka|ki|ke)\b\s*$/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const prefix = message.match(/(.+?)\s+(?:ka|ki|ke)?\s*(?:naya|nayi|new)\s+project\b/i);
  if (prefix?.[1]) {
    const candidate = stripClient(prefix[1]);
    if (candidate.length >= 2 && candidate.length <= 180) return candidate;
  }

  const after = message.match(
    /(?:naya|nayi|new)\s+project(?:\s+(?:called|named))?\s+(.+?)(?=\s+(?:banao|bnao|bna\s*do|bana\s*do|create\s*karo|for\s+client|service|price|total|due|deadline|budget)\b|$)/i,
  );
  if (after?.[1]) {
    const candidate = stripClient(after[1]);
    if (candidate.length >= 2 && candidate.length <= 180) return candidate;
  }

  return '';
}

function deterministicFallback(message: string, context: PlannerContext, allowMulti = true): PlannerResult {
  const lower = message.toLowerCase();
  const client = knownClient(message, context);
  const project = knownProject(message, context);

  if (allowMulti) {
    const parts = splitCompoundActionMessage(message);
    if (parts.length > 1) {
      const sharedClient = client;
      const sharedProject = project
        ? normalizeText(project.project_title, 180) || normalizeText(project.project_number, 80)
        : '';
      const stepResults = parts.map((part) => {
        let scoped = part;
        if (sharedClient && !knownClient(scoped, context)) scoped += ` for ${sharedClient}`;
        if (sharedProject && !knownProject(scoped, context) && /\b(project|concept|print|ebook|delivery|deadline|payment)\b/i.test(scoped)) {
          scoped += ` for ${sharedProject}`;
        }
        return deterministicFallback(scoped, context, false);
      });

      if (stepResults.every((step) => step.planned && step.confidence >= 0.72 && step.normalizedCommand)) {
        const steps = stepResults.map((step) => ({
          intent: step.intent,
          normalizedCommand: step.normalizedCommand,
          confidence: step.confidence,
          reason: step.reason,
        }));
        return {
          planned: true,
          intent: steps[0].intent,
          normalizedCommand: steps[0].normalizedCommand,
          confidence: Math.min(...steps.map((step) => step.confidence)),
          reason: `Detected ${steps.length} distinct actions. Each step must pass normal Tracker confirmation and permissions.`,
          steps,
        };
      }
    }
  }
  const projectLabel = project
    ? normalizeText(project.project_title, 180) || normalizeText(project.project_number, 80)
    : '';

  if (
    /\b(invoice|bill|انوائس)\b/i.test(message) &&
    /\b(pending|outstanding|due|baki|baqi|بقایا|payment|payments|ادا)/i.test(message)
  ) {
    return client
      ? {
          planned: true,
          intent: 'generate_client_invoice',
          normalizedCommand: `Generate invoice for ${client} for all pending payments`,
          confidence: 0.91,
          reason: 'Invoice request with a known client and pending-payment language.',
        }
      : {
          planned: false,
          intent: 'generate_client_invoice',
          normalizedCommand: '',
          confidence: 0.45,
          reason: 'Client could not be resolved safely.',
        };
  }

  if (
    /\b(concept|design concept|print version|ebook|e-book|final delivery)\b/i.test(message) &&
    /\b(submit|send|share|bhejo|bhej|client|approval|review|بھیجو|جمع)/iu.test(message)
  ) {
    const stagePhrase = /print version/i.test(message)
      ? 'print version'
      : /e-?book/i.test(message)
        ? 'eBook version'
        : /final delivery/i.test(message)
          ? 'final delivery'
          : 'design concept';

    return projectLabel
      ? {
          planned: true,
          intent: 'submit_stage_for_approval',
          normalizedCommand: `Submit the ${stagePhrase} for ${projectLabel} for client approval`,
          confidence: 0.94,
          reason: 'Stage-submission language with a known project.',
        }
      : {
          planned: false,
          intent: 'submit_stage_for_approval',
          normalizedCommand: '',
          confidence: 0.5,
          reason: 'Project could not be resolved safely.',
        };
  }

  if (
    /\b(project|پروجیکٹ)\b/i.test(message) &&
    /\b(create|new|add|start|banao|bnao|bna\s*do|bana\s*do|بناؤ)/iu.test(message)
  ) {
    const title = looseProjectTitle(message, client);
    const normalizedCommand =
      'Create a new project' +
      (title ? ' called "' + title + '"' : '') +
      (client ? ' for client ' + client : '');

    return {
      planned: true,
      intent: 'create_project',
      normalizedCommand,
      confidence: title || client ? 0.86 : 0.74,
      reason: 'Project creation request normalized for the guided project wizard.',
    };
  }

  if (
    /\b(task|ٹاسک)\b/i.test(message) &&
    /\b(create|new|add|assign|banao|bnao|bna\s*do|bana\s*do|بناؤ)/iu.test(message)
  ) {
    return {
      planned: true,
      intent: 'create_task',
      normalizedCommand: 'Create a task: ' + message,
      confidence: 0.78,
      reason: 'Task creation or assignment request.',
    };
  }

  if (
    /\b(draft|write|prepare|message|email|reminder|likho|draft\s*kro|draft\s*karo)\b/i.test(message) &&
    /\b(payment|approval|files|required|revision|complete|delivery|reminder)\b/i.test(message)
  ) {
    const tone = /\b(friendly|warm)\b/i.test(message)
      ? 'friendly'
      : /\b(firm|direct)\b/i.test(message)
        ? 'firm'
        : 'professional';
    const kind = /\bpayment\b/i.test(message)
      ? 'payment reminder'
      : /\bapproval\b/i.test(message)
        ? 'approval reminder'
        : /\bfiles|required\b/i.test(message)
          ? 'files required'
          : /\brevision\b/i.test(message)
            ? 'revision received'
            : 'final delivery';

    return client
      ? {
          planned: true,
          intent: 'draft_client_communication',
          normalizedCommand: `Draft a ${tone} ${kind} message for ${client}`,
          confidence: 0.9,
          reason: 'Draft-only client communication request.',
        }
      : {
          planned: false,
          intent: 'draft_client_communication',
          normalizedCommand: '',
          confidence: 0.45,
          reason: 'Client could not be resolved safely.',
        };
  }

  const amountMatch = message.match(/(?:\$|usd|dollar|dollars)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 0;
  if (
    amount > 0 &&
    /\b(record|add|jama|payment|paid|received)\b/i.test(message) &&
    /\b(payment|paid|received)\b/i.test(message)
  ) {
    return projectLabel
      ? {
          planned: true,
          intent: 'record_project_payment',
          normalizedCommand: `Record ${amount} payment for ${projectLabel}`,
          confidence: 0.91,
          reason: 'Project payment with a known project and amount.',
        }
      : {
          planned: false,
          intent: 'record_project_payment',
          normalizedCommand: '',
          confidence: 0.5,
          reason: 'Project could not be resolved safely.',
        };
  }

  return {
    planned: false,
    intent: 'unknown',
    normalizedCommand: '',
    confidence: 0,
    reason: 'No safe deterministic action normalization matched.',
  };
}

function sanitizeContext(raw: unknown): PlannerContext {
  const input = raw && typeof raw === 'object' ? (raw as PlannerContext) : {};
  return {
    role: normalizeText(input.role, 50),
    activeView: normalizeText(input.activeView, 80) || null,
    selectedProject:
      input.selectedProject && typeof input.selectedProject === 'object'
        ? input.selectedProject
        : null,
    projects: Array.isArray(input.projects) ? input.projects.slice(0, 80) : [],
    tasks: Array.isArray(input.tasks) ? input.tasks.slice(0, 80) : [],
    team: Array.isArray(input.team) ? input.team.slice(0, 40) : [],
  };
}

function parsePlannerJson(raw: string): PlannerResult | null {
  const cleaned = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) return null;

  try {
    const parsed = JSON.parse(cleaned.slice(first, last + 1));
    const intent = normalizeText(parsed.intent, 80);
    const normalizedCommand = normalizeText(parsed.normalizedCommand, 600);
    const confidence = Number(parsed.confidence);
    const planned = Boolean(parsed.planned);
    const steps = Array.isArray(parsed.steps)
      ? parsed.steps
          .map((step: any) => ({
            intent: normalizeText(step?.intent, 80),
            normalizedCommand: normalizeText(step?.normalizedCommand, 600),
            confidence: Number(step?.confidence),
            reason: normalizeText(step?.reason, 240),
          }))
          .filter(
            (step: PlannerStep) =>
              allowedIntents.has(step.intent) &&
              Boolean(step.normalizedCommand) &&
              Number.isFinite(step.confidence),
          )
          .slice(0, 4)
      : undefined;

    if (!allowedIntents.has(intent) || !Number.isFinite(confidence)) return null;
    if (planned && !normalizedCommand && (!steps || steps.length < 2)) return null;

    return {
      planned,
      intent,
      normalizedCommand: normalizedCommand || steps?.[0]?.normalizedCommand || '',
      confidence: Math.min(1, Math.max(0, confidence)),
      reason: normalizeText(parsed.reason, 240),
      steps: steps && steps.length >= 2 ? steps : undefined,
    };
  } catch {
    return null;
  }
}

async function llmPlan(message: string, context: PlannerContext): Promise<PlannerResult | null> {
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) return null;

  const model = Deno.env.get('GEMINI_PLANNER_MODEL') || 'gemini-2.5-flash';
  const systemPrompt = `You are a command normalizer for MH Tracker, a project-management application.
You NEVER execute actions, never write SQL, never invent IDs, and never answer the user conversationally.
Your only job is to translate natural English, Roman Urdu, Urdu, shorthand, typos, and indirect action phrasing into either ONE normalized English command or a SMALL ORDERED PLAN of distinct actions that the application's deterministic safety engine can understand.

Allowed intents:
- create_project
- duplicate_project
- create_task
- assign_task
- update_task_status
- update_task_due_date
- delete_task
- submit_stage_for_approval
- approve_project_milestone
- update_project_status
- update_project_due_date
- delete_project
- add_project_note
- reassign_revision
- update_revision_status
- generate_client_invoice
- draft_client_communication
- record_project_payment
- record_expense
- record_payroll_payment
- add_payroll_advance
- add_payroll_deduction
- send_internal_message
- invite_client
- unknown

Important safety rules:
1. Resolve a project/client/team member only when the supplied context clearly supports it.
2. Do not invent project titles, clients, money amounts, dates, links, or people.
3. If the request is ambiguous, set planned=false.
4. Preserve user amounts, dates, tone, and constraints exactly.
5. A request to send/submit a design concept, print version, eBook version, or final delivery to a client should normalize to "Submit the <stage> for <project> for client approval".
6. An invoice request for pending/outstanding client payments should normalize to "Generate invoice for <client> for all pending payments".
7. Never convert a read-only question into a write action.
8. Never weaken confirmation language or turn "draft", "preview", "show me", or "what if" into execution.
9. If the user clearly asks for 2-4 distinct operations, return a "steps" array. Each step needs intent, normalizedCommand, confidence and reason. Keep top-level intent/normalizedCommand equal to the first step.
10. Do not split one operation just because it contains "and". Example: "create a task and assign it to Zain" is normally one create/assign task operation. Split only when the user asks for separate business effects.
11. Later steps do not inherit permission. Every normalized step will independently pass entity resolution, permissions, preview and confirmation.
12. Output JSON only, with keys: planned, intent, normalizedCommand, confidence, reason, and optional steps.

Examples:
"Magazine 2 ka concept client ko review k lye bhej do" -> {"planned":true,"intent":"submit_stage_for_approval","normalizedCommand":"Submit the design concept for Magazine 2 for client approval","confidence":0.96,"reason":"Known project and clear stage submission request."}
"BCH k sari pending payment ki invoice nikalo" -> {"planned":true,"intent":"generate_client_invoice","normalizedCommand":"Generate invoice for BCH for all pending payments","confidence":0.96,"reason":"Known client and invoice request."}
"Zain ko cover wali task de do" -> {"planned":true,"intent":"assign_task","normalizedCommand":"Assign task cover to Zain","confidence":0.9,"reason":"Clear task assignment request."}
"Magazine 2 ko kal tak extend kr do" -> {"planned":true,"intent":"update_project_due_date","normalizedCommand":"Change project deadline for Magazine 2 to tomorrow","confidence":0.9,"reason":"Clear project deadline update."}
"Book 3 ka payment 250 dollar record kr do" -> {"planned":true,"intent":"record_project_payment","normalizedCommand":"Record $250 payment for Book 3","confidence":0.93,"reason":"Clear project payment request."}
"BCH ko friendly payment reminder draft kro" -> {"planned":true,"intent":"draft_client_communication","normalizedCommand":"Draft a friendly payment reminder message for BCH","confidence":0.9,"reason":"Draft-only client communication request."}
"BCH ki pending invoice banao aur friendly payment reminder draft kro" -> {"planned":true,"intent":"generate_client_invoice","normalizedCommand":"Generate invoice for BCH for all pending payments","confidence":0.94,"reason":"Two distinct requested operations.","steps":[{"intent":"generate_client_invoice","normalizedCommand":"Generate invoice for BCH for all pending payments","confidence":0.96,"reason":"Invoice request."},{"intent":"draft_client_communication","normalizedCommand":"Draft a friendly payment reminder message for BCH","confidence":0.94,"reason":"Separate draft request."}]}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: JSON.stringify({
                  message,
                  context,
                }),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
    },
  );

  if (!response.ok) return null;
  const body = await response.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? parsePlannerJson(text) : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

    if (!authHeader || !supabaseUrl || !anonKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = Date.now();
    const state = rateLimits.get(user.id);
    const next = !state || state.resetAt <= now
      ? { count: 1, resetAt: now + 60_000 }
      : { count: state.count + 1, resetAt: state.resetAt };
    rateLimits.set(user.id, next);

    if (next.count > 30) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const message = normalizeText(body?.message, 1200);
    const context = sanitizeContext(body?.context);

    if (!message) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fallback = deterministicFallback(message, context);
    let result: PlannerResult | null = null;

    try {
      result = await llmPlan(message, context);
    } catch (error) {
      console.error('Planner model error:', error);
    }

    const finalResult =
      result && result.planned && result.confidence >= 0.72
        ? result
        : fallback;

    return new Response(JSON.stringify(finalResult), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('ai-planner error:', error);
    return new Response(JSON.stringify({
      planned: false,
      intent: 'unknown',
      normalizedCommand: '',
      confidence: 0,
      reason: 'Planner failed safely.',
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }
});
