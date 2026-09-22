import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const allowedActions = [
  'create_project',
  'create_task',
  'generate_client_invoice',
  'submit_stage_for_approval',
  'draft_client_communication',
  'update_project_status',
] as const;

type ActionName = typeof allowedActions[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  const first = fenced.indexOf('{');
  const last = fenced.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(fenced.slice(first, last + 1));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const authHeader = req.headers.get('Authorization') || '';

  if (!supabaseUrl || !serviceKey || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const token = authHeader.slice('Bearer '.length);
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const { message, context } = await req.json();
  if (typeof message !== 'string' || !message.trim()) {
    return json({ error: 'Message is required' }, 400);
  }

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) {
    return json({ action: null, normalizedCommand: null, confidence: 0 });
  }

  const system = `You are a strict natural-language command planner for MH Tracker.
You NEVER execute actions. You only normalize a user's business instruction into one safe command.
Allowed actions: ${allowedActions.join(', ')}.
Return JSON only with keys: action, normalizedCommand, confidence.
If the request is not clearly one allowed write action, return {"action":null,"normalizedCommand":null,"confidence":0}.
Never invent project titles, client names, employee names, money amounts, dates, URLs or IDs.
Use only entities in the supplied context or explicitly present in the user message.
Canonical command examples:
- create_project: "Create project <preserve user's details>"
- create_task: "Create task <preserve user's details>"
- generate_client_invoice: "Generate invoice for <client> for all pending payments"
- submit_stage_for_approval: "Submit the design concept for <project> for client approval" (or print/eBook version)
- draft_client_communication: "Draft a professional approval reminder message for <project>"
- update_project_status: "Put <project> on hold"
The application will independently re-resolve entities, validate permissions, show confirmations and execute canonical mutations.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{
          role: 'user',
          parts: [{ text: JSON.stringify({ message: message.trim(), context: context || {} }) }],
        }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
    },
  );

  if (!response.ok) return json({ action: null, normalizedCommand: null, confidence: 0 });

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = extractJson(text);
  const action = parsed?.action as ActionName | null;

  if (!action || !allowedActions.includes(action)) {
    return json({ action: null, normalizedCommand: null, confidence: 0 });
  }

  const normalizedCommand = typeof parsed?.normalizedCommand === 'string'
    ? parsed.normalizedCommand.trim().slice(0, 500)
    : '';

  if (!normalizedCommand) {
    return json({ action: null, normalizedCommand: null, confidence: 0 });
  }

  return json({
    action,
    normalizedCommand,
    confidence: Math.max(0, Math.min(1, Number(parsed?.confidence || 0))),
  });
});
