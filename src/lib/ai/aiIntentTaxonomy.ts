import type { BroadIntentCategory, DomainIntent } from './aiTypes';

export interface IntentDefinition {
  name: DomainIntent;
  category: BroadIntentCategory;
  description: string;
  keywords: {
    english: string[];
    romanUrdu: string[];
    urdu: string[];
  };
  patterns: RegExp[];
  recommendedTool?: string;
}

export const INTENT_TAXONOMY: IntentDefinition[] = [
  // --- TASKS ---
  {
    name: 'create_task',
    category: 'create',
    description: 'Create a new task in MH Tracker',
    keywords: {
      english: ['create task', 'new task', 'add task', 'make task'],
      romanUrdu: ['task banao', 'task add karo', 'nayi task', 'task create kro', 'banao'],
      urdu: ['ٹاسک بناؤ', 'نیا ٹاسک', 'ٹاسک شامل کریں'],
    },
    patterns: [
      /\b(create|add|new|make)\s+.*?\s*task\b/i,
      /\btask\s+(banao|add|create|kro|kar do|bnao)\b/i,
      /\b(nayi|naya)\s+task\b/i,
      /ٹاسک\s+(بناؤ|شامل|کریٹ)/u,
      /نیا\s+ٹاسک/u,
    ],
    recommendedTool: 'create_task',
  },
  {
    name: 'assign_task',
    category: 'assign',
    description: 'Assign a task to an employee',
    keywords: {
      english: ['assign task', 'give task', 'assign to', 'put on list', 'assign'],
      romanUrdu: ['assign krdo', 'assign karo', 'de do', 'do', 'assign kr do', 'kro', 'asgn', 'krdo'],
      urdu: ['تفویض', 'دے دو', 'ٹاسک دو'],
    },
    patterns: [
      /\b(actually\s+)?assign\s+.*?\s*(to|instead)?\b/i,
      /\b(give|put)\s+.*?\s*(task|to|list|on)\b/i,
      /\bput\s+this\s+on\s+.*?'s\s+list\b/i,
      /\b(ko|to)\s+.*?\s*(assign|de do|den|do|krdo|kardo)\b/i,
      /\b.*?ko\s+ye\s+task\s*(assign|krdo|de do)?\b/i,
      /\b(deadline|date)\s+.*?\s*(krdo|kardo|change|کر\s+دو)\b/i,
      /کو\s+یہ\s+ٹاسک/u,
      /احمد\s+کو\s+یہ\s+task\s+assign/iu,
      /کو\s+.*?\s*(دے\s+دو|تفویض|assign\s+کر\s+دو)/iu,
    ],
    recommendedTool: 'assign_task',
  },
  {
    name: 'complete_task',
    category: 'complete',
    description: 'Mark a task or project as completed or done',
    keywords: {
      english: ['complete task', 'mark done', 'finish task', 'move to completed', 'done', 'completed'],
      romanUrdu: ['complete krdo', 'done krdo', 'khatam krdo', 'mukammal krdo', 'finish krdo'],
      urdu: ['مکمل', 'ڈن', 'ختم کر دو'],
    },
    patterns: [
      /\b(move|mark|change|set)\s+.*?\s*(to|as)\s*(completed|done|finished)\b/i,
      /\b(complete|finish|mark\s+done|close)\s+.*?\s*(task|project|this)?\b/i,
      /\b(complete|done|khatam|mukammal)\s+(krdo|kardo|kro)\b/i,
      /\b(isay|is|ye|kaam)\s+(finish|complete)\s*(krdo|kardo|kro)?\b/i,
      /\b(kar do|kro)\s+is\s+task\s+ko\s+(finish|complete)\b/i,
      /\b(kro|kardo)\s+ye\s+kaam\s+complete\b/i,
      /یہ\s+(مکمل|ڈن)\s+کر\s+دو/u,
      /ٹاسک\s+مکمل\s+کر\s+دو/u,
      /مکمل\s+کر\s+دو/u,
    ],
    recommendedTool: 'update_task_status',
  },
  {
    name: 'view_tasks',
    category: 'view_data',
    description: 'View tasks list or tasks summary',
    keywords: {
      english: ['view tasks', 'show tasks', 'list tasks', 'my tasks', 'pending tasks', 'overdue tasks', 'what is pending', 'whats left'],
      romanUrdu: ['tasks dikhao', 'tasks batao', 'meri tasks', 'pending tasks', 'aaj ki tasks', 'chahiye'],
      urdu: ['ٹاسکس دکھاؤ', 'میری ٹاسکس', 'بقایا ٹاسکس'],
    },
    patterns: [
      /\b(show|view|list|get)\s+.*?\s*(tasks|task)\b/i,
      /\bshow\s+me\s+what\s+is\s+pending\b/i,
      /\bwhat's\s+left\s+for\s+today\b/i,
      /\b(tasks|task)\s+.*?\s*(dikhao|batao|dkhao|list)\b/i,
      /\b(meri|mujhe|aaj ki|pending|overdue)\s+tasks\b/i,
      /\bmjhe\s+.*?\s+ki\s+tasks\b/i,
      /\bbtao\s+mujhe\s+kitni\s+tasks\b/i,
      /\boverdue\s+tasks\s+konsi\b/i,
      /آج\s+کی\s+pending\s+tasks/iu,
      /ٹاسکس\s+دکھاؤ/u,
    ],
    recommendedTool: 'get_tasks_summary',
  },
  {
    name: 'delete_task',
    category: 'delete',
    description: 'Delete or remove a task',
    keywords: {
      english: ['delete task', 'remove task', 'cancel task', 'take off'],
      romanUrdu: ['task delete krdo', 'task hatao', 'task remove karo'],
      urdu: ['ٹاسک ختم کریں', 'ٹاسک ڈیلیٹ کریں'],
    },
    patterns: [
      /\b(delete|remove|cancel)\s+.*?\s*task\b/i,
      /\b(take|remove)\s+.*?\s*(off|from)\s+(my\s+)?tasks\b/i,
      /\btask\s+(delete|remove|hatao)\b/i,
    ],
    recommendedTool: 'delete_task',
  },

  // --- PROJECTS ---
  {
    name: 'create_project',
    category: 'create',
    description: 'Create a new client project',
    keywords: {
      english: ['create project', 'new project', 'add project'],
      romanUrdu: ['naya project', 'project add karo', 'project banao'],
      urdu: ['نیا پروجیکٹ', 'پروجیکٹ بناؤ'],
    },
    patterns: [
      /\b(create|add|new)\s+project\b/i,
      /\b(nayi|naya)\s+project\b/i,
      /\bproject\s+(banao|create|add)\b/i,
    ],
    recommendedTool: 'create_project',
  },
  {
    name: 'view_project',
    category: 'view_data',
    description: 'View project details or search projects',
    keywords: {
      english: ['show project', 'view project', 'find project', 'project status', 'overdue projects', 'working on'],
      romanUrdu: ['project dikhao', 'project status', 'overdue projects', 'pending projects', 'active projects'],
      urdu: ['پروجیکٹ دکھاؤ', 'پروجیکٹ اسٹیٹس'],
    },
    patterns: [
      /\bwhat\s+is\s+the\s+status\s+of\s+.*?\s*project\b/i,
      /\bwho\s+is\s+working\s+on\b/i,
      /\bshow\s+me\s+missing\s+files\b/i,
      /\b(show|view|find|get)\s+.*?\s*(project|projects)\b/i,
      /\bproject\s+.*?\s*(status|details|dikhao|batao)\b/i,
      /\b(pending|overdue|active)\s+projects\b/i,
      /\b(dkhao|dikhao)\s+aaj\s+ke\s+projects\b/i,
      /\bye\s+project\s+complete\s+hogya\b/i,
      /\bproject\s+complete\s+hogya\b/i,
      /پروجیکٹ\s+دکھاؤ/u,
      /پروجیکٹ\s+کی\s+ڈیڈ\s+لائن/u,
      /اس\s+پروجیکٹ\s+کی\s+ڈیڈ\s+لائن/u,
      /یہ\s+project\s+ابھی\s+pending/iu,
      /اس\s+پروجیکٹ/u,
    ],
    recommendedTool: 'get_project_summary',
  },

  // --- EMPLOYEES & TEAM ---
  {
    name: 'employee_performance',
    category: 'report',
    description: 'View employee workload or performance report',
    keywords: {
      english: ['employee performance', 'workload', 'who is working on what', 'team performance', 'overloaded'],
      romanUrdu: ['performance report', 'workload dikhao', 'kis ke paas kitni tasks hain'],
      urdu: ['کارکردگی', 'ورک لوڈ'],
    },
    patterns: [
      /\bwho\s+is\s+(overloaded|underloaded)\b/i,
      /\bcheck\s+employee\s+workload\b/i,
      /\b(employee|team)\s+(performance|workload|report)\b/i,
      /\b(performance|workload)\s+(report|dikhao|batao)\b/i,
      /\bkis\s+ki\s+performance\b/i,
    ],
    recommendedTool: 'get_employee_workload',
  },
  {
    name: 'employee_dues',
    category: 'view_data',
    description: 'Check employee salary dues or payroll balance',
    keywords: {
      english: ['employee dues', 'how much does employee owe', 'payroll dues', 'salary dues', 'payroll summary'],
      romanUrdu: ['ke dues', 'kitne dues hain', 'kitna Dena hai', 'salary kitni baki hai'],
      urdu: ['بقایا جات', 'سیلری'],
    },
    patterns: [
      /\bhow\s+much\s+does\s+.*?\s*owe\b/i,
      /\b(show\s+)?payroll\s+summary\b/i,
      /\b.*?\s+(dues|owe|balance|salary)\b/i,
      /\b(ke|ki)\s+dues\b/i,
      /\bkitne\s+dues\b/i,
      /کے\s+کتنے\s+بقایا\s+جات/u,
    ],
    recommendedTool: 'get_payroll_summary',
  },

  // --- INVOICES & FINANCE ---
  {
    name: 'create_invoice',
    category: 'create',
    description: 'Generate client invoice',
    keywords: {
      english: ['create invoice', 'generate invoice', 'make invoice'],
      romanUrdu: ['invoice banao', 'invoice generate karo', 'invoice nikal do'],
      urdu: ['انوائس بناؤ', 'انوائس تیار کریں'],
    },
    patterns: [
      /\b(create|generate|make|issue)\s+.*?\s*invoice\b/i,
      /\binvoice\s+(banao|generate|nikal|add|krdo)\b/i,
    ],
    recommendedTool: 'generate_client_invoice',
  },
  {
    name: 'invoice_summary',
    category: 'view_data',
    description: 'View pending invoices or client receivables',
    keywords: {
      english: ['pending invoices', 'client receivables', 'unpaid invoices', 'how much client owes'],
      romanUrdu: ['pending invoices', 'invoices dikhao', 'kitne paise baki hain'],
      urdu: ['پینڈنگ انوائسز', 'بقایا جات'],
    },
    patterns: [
      /\b(pending|unpaid|total|pendng)\s+.*?\s*(invoices|invoics|invoice)\b/i,
      /\b(client|receivables)\s+summary\b/i,
      /\binvoices\s+dikhao\b/i,
      /\bkitne\s+paise\s+baki\s+hain\b/i,
      /\bpendng\s+invoics\b/i,
      /پینڈنگ\s+انوائسز/u,
      /میری\s+پینڈنگ\s+انوائسز/u,
    ],
    recommendedTool: 'get_client_receivables',
  },
  {
    name: 'finance_summary',
    category: 'summarize',
    description: 'View overall finance, revenue, or expense summary',
    keywords: {
      english: ['finance summary', 'revenue summary', 'income', 'expenses'],
      romanUrdu: ['finance summary', 'kitna revenue hua', 'income kitni hui'],
      urdu: ['مالیاتی خلاصہ', 'آمدنی'],
    },
    patterns: [
      /\bwhat\s+is\s+our\s+income\b/i,
      /\bincome\s+this\s+month\b/i,
      /\b(finance|revenue|income|expense)\s+summary\b/i,
      /\b(revenue|income)\s+kitni\b/i,
    ],
    recommendedTool: 'get_finance_summary',
  },

  // --- GENERAL CONVERSATIONAL ---
  {
    name: 'greeting',
    category: 'explain',
    description: 'User greetings or friendly introductions',
    keywords: {
      english: ['hello', 'hi', 'hey', 'greetings', 'good morning'],
      romanUrdu: ['salam', 'assalam o alaikum', 'aoa', 'kia hal hai'],
      urdu: ['سلام', 'السلام علیکم', 'ہیلو'],
    },
    patterns: [
      /\b(hi|hello|hey|greetings|good\s+(morning|afternoon|evening))\b/i,
      /\b(salam|assalam|aoa|kia\s+hal)\b/i,
      /\b(سلام|السلام\s+علیکم)\b/u,
    ],
  },
  {
    name: 'help',
    category: 'explain',
    description: 'Help or capabilities inquiry',
    keywords: {
      english: ['help', 'what can you do', 'options', 'commands'],
      romanUrdu: ['madad', 'kya kar sakte ho', 'help chahiye'],
      urdu: ['مدد', 'آپ کیا کر سکتے ہیں'],
    },
    patterns: [
      /\b(help|what\s+can\s+you\s+do|capabilities)\b/i,
      /\b(kya\s+kar\s+sakte\s+ho|help\s+chahiye)\b/i,
    ],
  },
  {
    name: 'general_query',
    category: 'unknown',
    description: 'General informational or fallback query',
    keywords: { english: [], romanUrdu: [], urdu: [] },
    patterns: [],
  },
];
