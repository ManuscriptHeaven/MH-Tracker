import type {
  AIActionPreview,
  AIToolContext,
  AIToolResult,
  ProjectCreationMemoryDraft,
} from './aiTypes';
import { formatDate, parseNaturalDate, todayInput } from '../date';
import { isClientRole, isManagerRole } from '../utils';

const SERVICE_TYPES = [
  'Print Formatting',
  'eBook Formatting',
  'Cover Design',
  'Print + eBook',
  "Children's Book",
  'Workbook / Journal',
  'Magazine',
  'Revision Only',
  'Other',
] as const;

export interface ProjectCreationWizardOutput {
  result: AIToolResult;
  draft: ProjectCreationMemoryDraft;
  missing: string[];
  completed: boolean;
}

function capabilities(serviceType: string) {
  const service = serviceType.trim().toLowerCase();
  if (service.includes('print + ebook')) {
    return { requiresPrint: true, requiresEbook: true };
  }
  if (service.includes('ebook')) {
    return { requiresPrint: false, requiresEbook: true };
  }
  return { requiresPrint: true, requiresEbook: false };
}

function normalizeServiceType(query: string): string | undefined {
  const lower = query.toLowerCase();

  if (/print\s*(?:\+|and|&)?\s*e-?book|both\s+print\s+and\s+e-?book/.test(lower)) {
    return 'Print + eBook';
  }
  if (/e-?book\s+format|ebook\s+only/.test(lower)) return 'eBook Formatting';
  if (/cover\s+design/.test(lower)) return 'Cover Design';
  if (/children'?s\s+book/.test(lower)) return "Children's Book";
  if (/workbook|journal/.test(lower)) return 'Workbook / Journal';
  if (/magazine/.test(lower)) return 'Magazine';
  if (/revision\s+only/.test(lower)) return 'Revision Only';
  if (/print\s+format|book\s+format|formatting/.test(lower) && !/e-?book/.test(lower)) {
    return 'Print Formatting';
  }
  if (/service\s*[:\-]?\s*other|\bother\s+service\b/.test(lower)) return 'Other';

  return SERVICE_TYPES.find((serviceType) => lower.includes(serviceType.toLowerCase()));
}

function knownClientName(query: string, ctx: AIToolContext) {
  const lower = query.toLowerCase();
  const projectClients = Array.from(
    new Set((ctx.data.projects || ctx.visibleProjects).map((project) => project.client_name).filter(Boolean)),
  );

  for (const client of projectClients) {
    if (lower.includes(client.toLowerCase())) return client;
  }

  for (const profile of ctx.data.profiles.filter((profile) => isClientRole(profile.role))) {
    const full = profile.full_name.toLowerCase();
    const first = full.split(' ')[0];
    if (lower.includes(full) || lower.includes(first)) return profile.full_name;
  }

  return undefined;
}

function projectRoleProfile(query: string, ctx: AIToolContext, kind: 'assignee' | 'manager') {
  const lower = query.toLowerCase();
  const profiles = ctx.data.profiles.filter((profile) => !isClientRole(profile.role));

  for (const profile of profiles) {
    const full = profile.full_name.toLowerCase();
    const first = full.split(' ')[0];
    const names = [full, first];

    for (const name of names) {
      const patterns =
        kind === 'assignee'
          ? [
              'assign to ' + name,
              'assigned to ' + name,
              'assign ' + name,
              name + ' ko assign',
              name + ' as assignee',
            ]
          : [
              'project manager ' + name,
              'manager ' + name,
              name + ' as project manager',
              name + ' project manager',
            ];

      if (patterns.some((pattern) => lower.includes(pattern))) return profile;
    }
  }

  return undefined;
}

function parseDatePhrase(query: string, labelPattern: RegExp) {
  const match = query.match(labelPattern);
  if (!match?.[1]) return undefined;
  return parseNaturalDate(match[1]) || undefined;
}

function extractFields(
  query: string,
  ctx: AIToolContext,
  base: ProjectCreationMemoryDraft,
  requestedFields: string[],
) {
  const next: ProjectCreationMemoryDraft = { ...base };
  const lower = query.toLowerCase();

  const titlePatterns = [
    /(?:project\s+title|title|named\s+as|named|called|titled)\s*[:\-]?\s*([^,\n]+?)(?=\s+(?:for\s+client|client|service|due|deadline|price|total|assign|priority|manager|notes?)\b|,|$)/i,
    /^(?:add|create|start|new)\s+(?:a\s+)?(?:new\s+)?project\s+[:\-]?\s*([^,\n]+?)(?=\s+(?:for\s+client|client)\b|,|$)/i,
  ];

  for (const pattern of titlePatterns) {
    const match = query.match(pattern);
    if (match?.[1]) {
      const candidate = match[1]
        .replace(/^(?:named\s+as|named|called|title)\s+/i, '')
        .trim();
      if (candidate.length >= 2) next.projectTitle = candidate;
      break;
    }
  }

  const knownClient = knownClientName(query, ctx);
  if (knownClient) next.clientName = knownClient;

  const clientMatch = query.match(
    /(?:for\s+client|client)\s*[:\-]?\s*([^,\n]+?)(?=\s+(?:service|due|deadline|price|total|assign|priority|project\s+manager|manager|notes?|email)\b|,|$)/i,
  );
  if (!next.clientName && clientMatch?.[1]) next.clientName = clientMatch[1].trim();

  const emailMatch = query.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) next.clientEmail = emailMatch[0];

  const serviceType = normalizeServiceType(query);
  if (serviceType) {
    next.serviceType = serviceType;
    const caps = capabilities(serviceType);
    next.requiresPrint = caps.requiresPrint;
    next.requiresEbook = caps.requiresEbook;
  }

  const priceMatch = query.match(
    /(?:\$|usd\s*)\s*(\d+(?:,\d{3})*(?:\.\d+)?)|(?:price|total(?:\s+price)?|budget|amount)\s*[:\-]?\s*(?:\$|usd\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)/i,
  );
  const priceRaw = priceMatch?.[1] || priceMatch?.[2];
  if (priceRaw) next.totalPrice = Number(priceRaw.replace(/,/g, ''));
  if (/\bfree\b|\bno charge\b/i.test(query)) next.totalPrice = 0;

  const advanceMatch = query.match(
    /(?:advance|paid upfront|deposit)\s*[:\-]?\s*(?:\$|usd\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)/i,
  );
  if (advanceMatch?.[1]) next.advancePaid = Number(advanceMatch[1].replace(/,/g, ''));

  const dueDate = parseDatePhrase(
    query,
    /(?:due|deadline|deliver(?:y)?(?:\s+date)?|by)\s*[:\-]?\s*(tomorrow|today|next\s+[a-z]+|[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?|\d{1,2}\s+[a-z]+(?:\s+\d{4})?|\d{4}-\d{2}-\d{2})/i,
  );
  if (dueDate) next.dueDate = dueDate;

  const startDate = parseDatePhrase(
    query,
    /(?:start|starting|start\s+date)\s*[:\-]?\s*(today|tomorrow|next\s+[a-z]+|[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?|\d{1,2}\s+[a-z]+(?:\s+\d{4})?|\d{4}-\d{2}-\d{2})/i,
  );
  if (startDate) next.startDate = startDate;

  if (!next.dueDate && requestedFields.includes('dueDate')) {
    const genericDate = query.match(
      /(tomorrow|today|next\s+[a-z]+|[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?|\d{1,2}\s+[a-z]+(?:\s+\d{4})?|\d{4}-\d{2}-\d{2})/i,
    );
    if (genericDate?.[1]) next.dueDate = parseNaturalDate(genericDate[1]) || undefined;
  }

  const assignee = projectRoleProfile(query, ctx, 'assignee');
  if (assignee) {
    next.assignedToId = assignee.id;
    next.assignedToName = assignee.full_name;
  }

  const manager = projectRoleProfile(query, ctx, 'manager');
  if (manager) {
    next.projectManagerId = manager.id;
    next.projectManagerName = manager.full_name;
  }

  const priorityMatch = lower.match(
    /\bpriority\s*[:\-]?\s*(low|normal|high|urgent)\b|\b(low|normal|high|urgent)\s+priority\b/,
  );
  const priorityRaw = priorityMatch?.[1] || priorityMatch?.[2];
  if (priorityRaw) {
    next.priority = (priorityRaw.charAt(0).toUpperCase() + priorityRaw.slice(1)) as ProjectCreationMemoryDraft['priority'];
  }

  const notesMatch = query.match(/(?:notes?|instructions?)\s*[:\-]\s*(.+)$/i);
  if (notesMatch?.[1]) next.notes = notesMatch[1].trim();

  if (requestedFields.length === 1) {
    const field = requestedFields[0];
    const clean = query.trim();

    if (field === 'projectTitle' && !next.projectTitle && clean.length >= 2) {
      next.projectTitle = clean;
    }
    if (field === 'clientName' && !next.clientName && clean.length >= 2) {
      next.clientName = clean;
    }
    if (field === 'serviceType' && !next.serviceType) {
      const singleService = normalizeServiceType(clean);
      if (singleService) {
        next.serviceType = singleService;
        const caps = capabilities(singleService);
        next.requiresPrint = caps.requiresPrint;
        next.requiresEbook = caps.requiresEbook;
      }
    }
    if (field === 'totalPrice' && next.totalPrice === undefined) {
      const numberMatch = clean.match(/(?:\$|usd\s*)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i);
      if (numberMatch?.[1]) next.totalPrice = Number(numberMatch[1].replace(/,/g, ''));
    }
    if (field === 'dueDate' && !next.dueDate) {
      next.dueDate = parseNaturalDate(clean) || undefined;
    }
  }

  if (next.clientName && !next.clientEmail) {
    const existing = (ctx.data.projects || ctx.visibleProjects).find(
      (project) =>
        (project.client_name || '').toLowerCase() === next.clientName?.toLowerCase() &&
        Boolean(project.client_email),
    );
    if (existing?.client_email) next.clientEmail = existing.client_email;
  }

  return next;
}

function missingFields(draft: ProjectCreationMemoryDraft) {
  return [
    !draft.projectTitle ? 'projectTitle' : null,
    !draft.clientName ? 'clientName' : null,
    !draft.serviceType ? 'serviceType' : null,
    draft.totalPrice === undefined || !Number.isFinite(draft.totalPrice) ? 'totalPrice' : null,
    !draft.dueDate ? 'dueDate' : null,
  ].filter((value): value is string => Boolean(value));
}

function wizardPrompt(
  draft: ProjectCreationMemoryDraft,
  missing: string[],
  ctx: AIToolContext,
): AIToolResult {
  const labels: Record<string, string> = {
    projectTitle: 'Project title',
    clientName: 'Client',
    serviceType: 'Service type',
    totalPrice: 'Total price (USD)',
    dueDate: 'Due date',
  };

  const missingLabels = missing.map((field) => labels[field]);
  const collected = [
    draft.projectTitle ? '• **Project:** ' + draft.projectTitle : null,
    draft.clientName ? '• **Client:** ' + draft.clientName : null,
    draft.serviceType ? '• **Service:** ' + draft.serviceType : null,
    draft.totalPrice !== undefined
      ? '• **Price:** ' + ctx.formatMoney(draft.totalPrice, 'USD')
      : null,
    draft.dueDate ? '• **Due:** ' + formatDate(draft.dueDate) : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    success: true,
    toolName: 'create_project',
    spokenText:
      'I can create the project. I still need ' +
      missingLabels.join(', ') +
      '. You can provide them in one message.',
    displayText:
      '### Project Setup\n\n' +
      (collected ? '**Collected so far**\n' + collected + '\n\n' : '') +
      '**Still needed:** ' +
      missingLabels.join(', ') +
      '\n\nReply in one line, for example: **Service Print Formatting, $1200, due September 30**.\n\n' +
      'Optional fields: assignee, project manager, priority, start date, client email, advance paid, and notes.',
  };
}

function buildPreview(draft: ProjectCreationMemoryDraft, ctx: AIToolContext): AIToolResult {
  const startDate = draft.startDate || todayInput();
  const priority = draft.priority || 'Normal';
  const totalPrice = Math.max(0, Number(draft.totalPrice || 0));
  const advancePaid = Math.min(Math.max(0, Number(draft.advancePaid || 0)), totalPrice);
  const caps = capabilities(draft.serviceType!);

  const preview: AIActionPreview = {
    actionId: 'act-' + Date.now(),
    toolName: 'create_project',
    category: 'high_risk',
    title: 'Create New Project',
    description: 'Create "' + draft.projectTitle + '" for ' + draft.clientName,
    targetType: 'project',
    targetTitle: draft.projectTitle,
    clientName: draft.clientName,
    assignedToName: draft.assignedToName,
    changes: [
      { field: 'title', label: 'Project Title', newValue: draft.projectTitle! },
      { field: 'client', label: 'Client', newValue: draft.clientName! },
      { field: 'service', label: 'Service Type', newValue: draft.serviceType! },
      { field: 'price', label: 'Total Price', newValue: ctx.formatMoney(totalPrice, 'USD') },
      ...(advancePaid > 0
        ? [{ field: 'advance', label: 'Advance Paid', newValue: ctx.formatMoney(advancePaid, 'USD') }]
        : []),
      { field: 'start_date', label: 'Start Date', newValue: formatDate(startDate) },
      { field: 'due_date', label: 'Due Date', newValue: formatDate(draft.dueDate!) },
      { field: 'priority', label: 'Priority', newValue: priority },
      ...(draft.assignedToName
        ? [{ field: 'assigned_to', label: 'Assigned To', newValue: draft.assignedToName }]
        : []),
      ...(draft.projectManagerName
        ? [{ field: 'project_manager', label: 'Project Manager', newValue: draft.projectManagerName }]
        : []),
      ...(draft.notes ? [{ field: 'notes', label: 'Notes', newValue: draft.notes }] : []),
    ],
    payload: {
      projectTitle: draft.projectTitle,
      clientName: draft.clientName,
      clientEmail: draft.clientEmail || '',
      serviceType: draft.serviceType,
      requiresPrint: caps.requiresPrint,
      requiresEbook: caps.requiresEbook,
      totalPrice,
      advancePaid,
      startDate,
      dueDate: draft.dueDate,
      assignedToId: draft.assignedToId,
      projectManagerId: draft.projectManagerId,
      priority,
      notes: draft.notes || '',
    },
    confirmButtonText: 'Create Project',
    cancelButtonText: 'Cancel',
    spokenPrompt:
      'Create ' +
      draft.projectTitle +
      ' for ' +
      draft.clientName +
      ', ' +
      draft.serviceType +
      ', ' +
      ctx.formatMoney(totalPrice, 'USD') +
      ', due ' +
      formatDate(draft.dueDate!) +
      '? Confirm?',
  };

  return {
    success: true,
    toolName: 'create_project',
    spokenText: preview.spokenPrompt,
    displayText:
      '### Ready to Create Project\n\n' +
      '• **Project:** ' +
      draft.projectTitle +
      '\n' +
      '• **Client:** ' +
      draft.clientName +
      '\n' +
      '• **Service:** ' +
      draft.serviceType +
      '\n' +
      '• **Total Price:** **' +
      ctx.formatMoney(totalPrice, 'USD') +
      '**\n' +
      '• **Start:** ' +
      formatDate(startDate) +
      '\n' +
      '• **Due:** **' +
      formatDate(draft.dueDate!) +
      '**\n' +
      '• **Priority:** ' +
      priority +
      '\n' +
      '• **Assigned To:** ' +
      (draft.assignedToName || 'Unassigned') +
      '\n' +
      '• **Project Manager:** ' +
      (draft.projectManagerName || 'Not assigned') +
      '\n' +
      (draft.notes ? '• **Notes:** ' + draft.notes + '\n' : '') +
      '\nConfirm to create this project.',
    pendingAction: preview,
  };
}

export function runProjectCreationWizard(
  query: string,
  ctx: AIToolContext,
  base: ProjectCreationMemoryDraft = {},
  requestedFields: string[] = [],
): ProjectCreationWizardOutput {
  if (!isManagerRole(ctx.currentProfile.role)) {
    return {
      draft: base,
      missing: [],
      completed: false,
      result: {
        success: false,
        toolName: 'create_project',
        error: 'permission_denied',
        spokenText: "I can't create projects with your current permissions.",
        displayText: '🔒 Project creation is restricted to Admin and Project Manager roles.',
      },
    };
  }

  const draft = extractFields(query, ctx, base, requestedFields);
  const missing = missingFields(draft);

  if (missing.length > 0) {
    return {
      draft,
      missing,
      completed: false,
      result: wizardPrompt(draft, missing, ctx),
    };
  }

  return {
    draft,
    missing: [],
    completed: true,
    result: buildPreview(draft, ctx),
  };
}
