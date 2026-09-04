import type {
  AIUnderstandingOutput,
  PageContext,
  ReadQueryPlan,
  ReadResource,
  DateRangeBoundary,
  AIToolName,
} from './aiTypes';

/**
  Natural relative date resolution into explicit ISO timestamp boundaries.
 */
export function resolveDateRangeBoundary(text: string, referenceDateStr?: string): DateRangeBoundary | undefined {
  const ref = referenceDateStr ? new Date(referenceDateStr) : new Date();
  const lower = (text || '').toLowerCase();

  // Helper to set time to start of day 00:00:00.000
  const startOfDay = (d: Date) => {
    const res = new Date(d);
    res.setHours(0, 0, 0, 0);
    return res.toISOString();
  };

  // Helper to set time to end of day 23:59:59.999
  const endOfDay = (d: Date) => {
    const res = new Date(d);
    res.setHours(23, 59, 59, 999);
    return res.toISOString();
  };

  if (/\b(today|aaj|aj|آج)\b/i.test(lower)) {
    return {
      start: startOfDay(ref),
      end: endOfDay(ref),
      label: 'today',
    };
  }

  if (/\b(tomorrow|kal|kl|پریسوں|کل)\b/i.test(lower) && !/\b(yesterday|kal\s+wala)\b/i.test(lower)) {
    const tom = new Date(ref);
    tom.setDate(tom.getDate() + 1);
    return {
      start: startOfDay(tom),
      end: endOfDay(tom),
      label: 'tomorrow',
    };
  }

  if (/\b(yesterday|kal\s+wala|گزشتہ)\b/i.test(lower)) {
    const yest = new Date(ref);
    yest.setDate(yest.getDate() - 1);
    return {
      start: startOfDay(yest),
      end: endOfDay(yest),
      label: 'yesterday',
    };
  }

  if (/\b(this\s+week|is\s+hafte|is\b.*?haftay|اس\s+ہفتے)\b/i.test(lower)) {
    const day = ref.getDay();
    const diffToMonday = ref.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(ref.setDate(diffToMonday));
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    return {
      start: startOfDay(startOfWeek),
      end: endOfDay(endOfWeek),
      label: 'this_week',
    };
  }

  if (/\b(next\s+week|aglay\s+hafte|اگلے\s+ہفتے)\b/i.test(lower)) {
    const day = ref.getDay();
    const diffToNextMonday = ref.getDate() - day + (day === 0 ? 1 : 8);
    const startOfNextWeek = new Date(ref.setDate(diffToNextMonday));
    const endOfNextWeek = new Date(startOfNextWeek);
    endOfNextWeek.setDate(endOfNextWeek.getDate() + 6);
    return {
      start: startOfDay(startOfNextWeek),
      end: endOfDay(endOfNextWeek),
      label: 'next_week',
    };
  }

  if (/\b(this\s+month|is\s+mahine|اس\s+مہینے)\b/i.test(lower)) {
    const startOfMonth = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const endOfMonth = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    return {
      start: startOfDay(startOfMonth),
      end: endOfDay(endOfMonth),
      label: 'this_month',
    };
  }

  return undefined;
}

/**
  Construct a safe, validated ReadQueryPlan from AI understanding output.
 */
export function buildReadQueryPlan(
  understanding: AIUnderstandingOutput,
  pageCtx?: PageContext,
): ReadQueryPlan {
  const intentName = understanding.intent.name;
  const rawInput = understanding.originalInput;
  const lower = rawInput.toLowerCase();

  let primaryResource: ReadResource = 'projects';
  const secondaryResources: ReadResource[] = [];
  let operation: 'list' | 'search' | 'details' | 'count' | 'aggregate' | 'compare' = 'list';
  let targetTool: AIToolName | undefined = understanding.recommendedTool;

  // Extract resolved entities
  const resolvedPerson = understanding.resolvedEntities.find((e) => e.type === 'employee' || e.type === 'client');
  const resolvedProject = understanding.resolvedEntities.find((e) => e.type === 'project');
  const resolvedTask = understanding.resolvedEntities.find((e) => e.type === 'task');

  // Resource & Operation resolution in order of explicit target noun
  if (/\b(message|messages|chat|said|text|پیغام|پیغامات)\b/i.test(lower)) {
    primaryResource = 'messages';
  } else if (/\b(calendar|meeting|meetings|event|events|appointment|میٹنگ|کیلنڈر)\b/i.test(lower)) {
    primaryResource = 'calendar';
  } else if (/\b(clients\s+have\s+overdue|employees\s+have\s+overdue|meetings\s+and|invoices\s+for\s+active|projects\s+have\s+no\s+completed)\b/i.test(lower)) {
    primaryResource = 'cross_module';
    targetTool = 'run_cross_module_query';
  } else if (/\b(who\s+has|which\s+employees|who\s+completed|kis\s+employee|compare|employee\s+workload|team\s+workload)\b/i.test(lower)) {
    primaryResource = 'employees';
  } else if (/\b(payroll|invoice|invoices|financial|finance|revenue|income|expense|expenses|receivables|outstanding|owe|balance|انواِئس|آمدنی)\b/i.test(lower)) {
    primaryResource = 'finance';
  } else if (/\b(what\s+is\s+still\s+pending|project\s+tasks|pending\s+for|overdue\s+tasks)\b/i.test(lower)) {
    primaryResource = 'tasks';
  } else if (/\b(projects|project|پروجیکٹ)\b/i.test(lower)) {
    primaryResource = 'projects';
  } else if (/\b(tasks|task|overdue|pending|kaam|ٹاسک|ٹاسکس)\b/i.test(lower)) {
    primaryResource = 'tasks';
  } else if (intentName.includes('payroll') || /\b(salary|workload|performance|employee|employees|staff)\b/i.test(lower)) {
    primaryResource = 'employees';
  } else if (intentName.includes('client') || /\b(client|clients|abc\s+publishing|bch|کلائنٹ)\b/i.test(lower)) {
    primaryResource = 'clients';
  }

  // Cross-module query detection: ONLY when query explicitly requests multi-module synthesis with "and", "across", or combined clauses
  const hasAndOrAcross = /\b(and|across|along\s+with|combining)\b/i.test(lower);
  const mentionsInvoice = /\b(invoice|invoices|receivable|receivables|outstanding)\b/i.test(lower);
  const mentionsProject = /\b(project|projects)\b/i.test(lower);
  const mentionsTask = /\b(task|tasks)\b/i.test(lower);
  const mentionsMeeting = /\b(meeting|meetings|calendar)\b/i.test(lower);
  const mentionsClient = /\b(client|clients)\b/i.test(lower);

  if (hasAndOrAcross && [mentionsInvoice, mentionsProject, mentionsTask, mentionsMeeting, mentionsClient].filter(Boolean).length >= 2) {
    primaryResource = 'cross_module';
    if (mentionsClient) secondaryResources.push('clients');
    if (mentionsInvoice) secondaryResources.push('finance');
    if (mentionsProject) secondaryResources.push('projects');
    if (mentionsTask) secondaryResources.push('tasks');
    if (mentionsMeeting) secondaryResources.push('calendar');
    targetTool = 'run_cross_module_query';
  }

  // Operation mode
  if (intentName === 'compare_employees' || /\b(compare|versus|vs|more\s+tasks|who\s+completed\s+more)\b/i.test(lower)) {
    operation = 'compare';
    targetTool = 'compare_employees';
  } else if (/\b(how\s+many|count|total|percentage|kitne|kitni)\b/i.test(lower)) {
    operation = 'count';
  } else if (/\b(summary|overview|breakdown|report)\b/i.test(lower)) {
    operation = 'aggregate';
  } else if (resolvedProject || resolvedTask) {
    operation = 'details';
  }

  // Page Context Scope Override
  if (primaryResource !== 'cross_module' && pageCtx && pageCtx.module !== 'dashboard' && pageCtx.module !== 'general') {
    // If query is ambiguous (e.g. "What's overdue?"), use page module as context default
    if (!/\b(task|project|invoice|meeting|client|employee)\b/i.test(lower)) {
      if (pageCtx.module === 'tasks') primaryResource = 'tasks';
      else if (pageCtx.module === 'projects') primaryResource = 'projects';
      else if (pageCtx.module === 'finance' || pageCtx.module === 'payments') primaryResource = 'finance';
      else if (pageCtx.module === 'clients') primaryResource = 'clients';
      else if (pageCtx.module === 'calendar') primaryResource = 'calendar';
      else if (pageCtx.module === 'team') primaryResource = 'employees';
    }
  }

  const dateRange = resolveDateRangeBoundary(rawInput);

  const filters = {
    status: lower.includes('pending') ? 'Pending' : lower.includes('overdue') ? 'Overdue' : lower.includes('completed') ? 'Completed' : undefined,
    employeeName: resolvedPerson?.type === 'employee' ? resolvedPerson.name : undefined,
    clientName: resolvedPerson?.type === 'client' ? resolvedPerson.name : undefined,
    projectName: resolvedProject?.name,
    dateRange,
    isOverdue: lower.includes('overdue'),
    isPending: lower.includes('pending'),
    isCompleted: lower.includes('completed'),
    keyword: rawInput,
  };

  return {
    planId: `plan-${Date.now()}`,
    intent: intentName,
    primaryResource,
    secondaryResources,
    filters,
    limit: 20,
    operation,
    requiresPermissionCheck: true,
    requiresClarification: understanding.needsClarification,
    targetTool,
  };
}
