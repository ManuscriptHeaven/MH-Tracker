import type { AIToolContext, DisambiguationOption } from './aiTypes';
import type { Profile, Project } from '../types';
import { normalizeEntityText, resolveUniqueEntityMatch } from './aiEntityMatcher';
import { parseNaturalDate } from '../date';

export interface TaskCreationOverrides {
  employeeId?: string;
  /** A project id, or NO_PROJECT when the user explicitly chose "No project". */
  projectId?: string;
  /** YYYY-MM-DD, or NO_DUE_DATE when the user explicitly chose "No due date". */
  dueDate?: string;
}

export const NO_PROJECT = '__no_project__';
export const NO_DUE_DATE = '__no_due_date__';

export type TaskPriority = 'Low' | 'Normal' | 'High' | 'Urgent';
export type TaskDueDateSource = 'command' | 'project' | 'selected';

export type TaskCreationResolution =
  | {
    kind: 'ready';
    title: string;
    assignee: Profile;
    project?: Project;
    dueDate?: string;
    dueDateSource?: TaskDueDateSource;
    priority: TaskPriority;
    projectSource?: 'command' | 'page' | 'selected';
  }
  | { kind: 'clarify'; field: 'employee' | 'project' | 'due_date'; message: string; options: DisambiguationOption[] }
  | { kind: 'error'; code: string; message: string };

// ------------------------------------------------------------------
// Dates: strict, locally computed (Asia/Karachi users type DD/MM).
// parseNaturalDate() is too permissive for free text ("end of week"
// parses as 1 January), so task commands use this extractor instead.
// ------------------------------------------------------------------
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const WEEKDAY_RE = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat';

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function noonOf(now: Date): Date {
  const d = new Date(now.getTime());
  d.setHours(12, 0, 0, 0);
  return d;
}
function plusDays(now: Date, days: number): string {
  const d = noonOf(now);
  d.setDate(d.getDate() + days);
  return ymd(d);
}
function weekdayIndex(word: string): number {
  const w = word.toLowerCase();
  return WEEKDAYS.findIndex((day) => day.startsWith(w.slice(0, 3)));
}
function nextWeekday(now: Date, index: number, forceNextWeek = false): string {
  let diff = index - now.getDay();
  if (diff <= 0) diff += 7;
  if (forceNextWeek && diff < 7 && index > now.getDay()) diff += 7;
  return plusDays(now, diff);
}
function calendarDate(now: Date, day: number, month: number, year?: number): string | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  let y = year ?? now.getFullYear();
  if (y < 100) y += 2000;
  const d = new Date(y, month, day, 12, 0, 0, 0);
  if (d.getMonth() !== month) return null; // 31 February etc.
  // "20 November" said in December means next year's 20 November.
  if (year === undefined && ymd(d) < ymd(now)) d.setFullYear(y + 1);
  return ymd(d);
}

/** Resolve a bare date phrase ("tomorrow", "kal", "20 Nov", "in 3 days"). */
export function parseTaskDate(phrase: string, now: Date = new Date()): string | null {
  const p = phrase.toLowerCase().replace(/[.,!?]+$/g, '').replace(/\s+/g, ' ').trim()
    .replace(/\s+(?:tak|tk)$/, '');
  if (!p) return null;
  if (/^(?:today|tonight|aaj|aj|end of (?:the )?day|eod)$/.test(p)) return plusDays(now, 0);
  if (/^(?:tomorrow|tmrw|tmr|kal|kl)$/.test(p)) return plusDays(now, 1);
  if (/^(?:day after tomorrow|parson|parso|parsoon)$/.test(p)) return plusDays(now, 2);
  let m = p.match(/^(?:in|within|after)?\s*(\d{1,3}|a|one|two|three|four|five|six|seven|ten)\s+(day|days|din|week|weeks|hafte|hafton)(?:\s+(?:mein|me|main|from now|later))?$/);
  if (m) {
    const words: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : words[m[1]];
    return plusDays(now, /^(?:week|weeks|hafte|hafton)$/.test(m[2]) ? n * 7 : n);
  }
  if (/^(?:this week|end of (?:the |this )?week|eow|weekend)$/.test(p)) {
    return now.getDay() === 5 ? plusDays(now, 0) : nextWeekday(now, 5);
  }
  if (/^(?:next week|agle hafte|agla hafta)$/.test(p)) return nextWeekday(now, 1, true);
  if (/^(?:end of (?:the |this )?month|eom|month end)$/.test(p)) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12);
    return ymd(d);
  }
  m = p.match(new RegExp(`^(next|this|coming)?\\s*(${WEEKDAY_RE})$`));
  if (m) {
    const idx = weekdayIndex(m[2]);
    if (idx >= 0) return nextWeekday(now, idx, m[1] === 'next');
  }
  m = p.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return calendarDate(now, +m[3], +m[2] - 1, +m[1]);
  // Pakistan convention: DD/MM or DD/MM/YYYY.
  m = p.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (m) return calendarDate(now, +m[1], +m[2] - 1, m[3] ? +m[3] : undefined);
  m = p.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})(?:,?\\s+(\\d{4}))?$`));
  if (m) return calendarDate(now, +m[1], MONTHS[m[2]], m[3] ? +m[3] : undefined);
  m = p.match(new RegExp(`^(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$`));
  if (m) return calendarDate(now, +m[2], MONTHS[m[1]], m[3] ? +m[3] : undefined);
  return null;
}

const DATE_PHRASE =
  `day after tomorrow|tomorrow|tmrw|today|tonight|end of (?:the )?day|eod|kal|aaj|parson|parso` +
  `|(?:in|within|after)\\s+(?:\\d{1,3}|a|one|two|three|four|five|six|seven|ten)\\s+(?:days?|weeks?)` +
  `|\\d{1,3}\\s+(?:din|days?)\\s+(?:mein|me|main)` +
  `|this week|next week|end of (?:the |this )?(?:week|month)|eow|eom` +
  `|(?:next|this|coming)\\s+(?:${WEEKDAY_RE})|(?:${WEEKDAY_RE})` +
  `|\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[\\/.]\\d{1,2}(?:[\\/.]\\d{2,4})?` +
  `|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH_RE})(?:,?\\s+\\d{4})?` +
  `|(?:${MONTH_RE})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`;

/**
 * Find and remove a deadline anywhere in a task instruction.
 * "create print version by 20 November for Snowman Patch" ->
 *   { dueDate: 'YYYY-11-20', rest: 'create print version for Snowman Patch' }.
 * Bare dates are only taken at the end (or with "tak"), so a title such as
 * "Monday newsletter" is not mistaken for a deadline.
 */
export function extractTaskDueDate(text: string, now: Date = new Date()): { dueDate?: string; rest: string } {
  const prefixed = new RegExp(
    `(?:^|[\\s,])(?:(?:with\\s+(?:a\\s+)?)?(?:due(?:\\s+date)?|deadline)(?:\\s+(?:is|of|on|by|for|:))?|by|before|till|until|no later than)\\s+(?:the\\s+)?(${DATE_PHRASE})(?:\\s+(?:tak|tk))?(?=$|[\\s,.!?])`,
    'i',
  );
  const urduTak = new RegExp(`(?:^|[\\s,])(${DATE_PHRASE})\\s+(?:tak|tk)(?=$|[\\s,.!?])`, 'i');
  const trailing = new RegExp(`(?:^|[\\s,])(?:on\\s+|for\\s+)?(${DATE_PHRASE})\\s*[.!?]*$`, 'i');
  for (const re of [prefixed, urduTak, trailing]) {
    const m = text.match(re);
    if (!m || m.index === undefined) continue;
    const dueDate = parseTaskDate(m[1], now);
    if (!dueDate) continue;
    const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length))
      .replace(/\s+,/g, ',').replace(/\s+/g, ' ').replace(/[\s,]+$/, '').trim();
    return { dueDate, rest };
  }
  return { rest: text };
}

/** Pull priority words out of the instruction ("urgent", "high priority", "jaldi"). */
export function extractTaskPriority(text: string): { priority?: TaskPriority; asap: boolean; rest: string } {
  const rules: Array<[RegExp, TaskPriority, boolean]> = [
    [/(?:^|[\s,])(?:as soon as possible|asap|right away|immediately|fori(?:\s+tor\s+par)?|foran)(?=$|[\s,.!?])/i, 'Urgent', true],
    [/(?:^|[\s,])(?:(?:it(?:'s| is)\s+|mark\s+(?:it\s+)?(?:as\s+)?|make\s+it\s+|with\s+)?(?:urgent(?:ly)?|top\s+priority|critical))(?=$|[\s,.!?])/i, 'Urgent', false],
    [/(?:^|[\s,])(?:(?:with\s+|as\s+|make\s+it\s+)?(?:a\s+)?high[\s-]+priority|important|jaldi)(?=$|[\s,.!?])/i, 'High', false],
    [/(?:^|[\s,])(?:(?:with\s+|as\s+)?(?:a\s+)?low[\s-]+priority|no\s+rush|whenever possible)(?=$|[\s,.!?])/i, 'Low', false],
    [/(?:^|[\s,])(?:(?:with\s+|as\s+)?(?:a\s+)?(?:normal|medium)[\s-]+priority)(?=$|[\s,.!?])/i, 'Normal', false],
  ];
  for (const [re, priority, asap] of rules) {
    const m = text.match(re);
    if (m && m.index !== undefined) {
      const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length))
        .replace(/\s+,/g, ',').replace(/\s+/g, ' ').replace(/(?:^|\s)(?:and|,)\s*$/i, '').replace(/[\s,]+$/, '').trim();
      return { priority, asap, rest };
    }
  }
  return { asap: false, rest: text };
}

// Roman Urdu task phrasing -> an English imperative title.
function englishTitleFromUrdu(phrase: string): string {
  let t = phrase.trim().replace(/^(?:ye|yeh|is|iss|ek|aik)\s+/i, '');
  const verbs: Array<[RegExp, string]> = [
    [/^(.+?)\s+(?:banana|banane|banao|bnana|bnane|bana|tayyar\s+karna|tayyar\s+karne|tyar\s+karna|ready\s+karna|ready\s+karne)$/i, 'Create'],
    [/^(.+?)\s+(?:theek|thik|fix)\s+(?:karna|karne|karo|krna|krne|kar)$/i, 'Fix'],
    [/^(.+?)\s+(?:bhejna|bhejne|send\s+karna|send\s+karne)$/i, 'Send'],
    [/^(.+?)\s+(?:dekhna|dekhne)$/i, 'Review'],
    [/^(.+?)\s+(check|update|review|edit|format|upload|proofread|design|deliver|revise|convert|export|finalize|submit)\s+(?:karna|karne|karo|krna|krne|kar)$/i, ''],
  ];
  for (const [re, verb] of verbs) {
    const m = t.match(re);
    if (m) {
      t = verb ? `${verb} ${m[1]}` : `${m[2]} ${m[1]}`;
      break;
    }
  }
  return t;
}

const ACTION_VERBS =
  'create|make|update|prepare|check|review|edit|fix|format|convert|design|recreate|upload|deliver|proofread|revise|generate|produce|send|finish|complete|finalize|typeset|layout|export|submit|redo|correct|draft|write|build|add|set\\s+up|setup|work\\s+on|do';

// Speech recognition often transcribes "task for Zen" as "task force Zen".
// Only reinterpret "force" when the sentence includes a named recipient followed
// by an action verb; genuine references to a task force remain read-only.
export function normalizeTaskCreationQuery(text: string): string {
  let query = text.trim().replace(/\s+/g, ' ');

  // Strip only common polite or speech-to-text introductions. This is
  // normalization for task intent, not permission to execute a write.
  query = query
    .replace(/^(?:hey(?:\s+there)?[,!]?\s+)?(?:can|could|would)\s+you\s+(?:please\s+)?/i, '')
    .replace(/^(?:(?:i\s+want\s+you\s+to|i\s+would\s+like\s+you\s+to|we\s+are\s+going\s+to|go\s+ahead\s+and)\s+)/i, '')
    .replace(/^(?:please|kindly)\s+/i, '');

  // Named-field dictation: "create a task for employee named Zen for the
  // project named The End of Smart and title of the task is Create ebook".
  // Produce the same canonical form as a simple imperative.
  const structured = query.match(
    /^(?:(?:create|add|make)\s+(?:(?:a|new)\s+)?)?task\s+for\s+(?:employee\s+(?:named|called)\s+)?(.+?)\s+(?:for|under)\s+(?:the\s+)?project(?:\s+(?:named|called|titled))?\s+(.+?)\s+(?:and\s+)?(?:the\s+)?title\s+(?:of\s+(?:the\s+)?task\s+)?(?:is|as|:)\s+(.+?)[.!?]?$/i,
  );
  if (structured) {
    query = `create a task for ${structured[1]} to ${structured[3]} for the project named ${structured[2]}`;
  }

  // Roman Urdu: "Zen ko Snowman Patch ka print version banane ka task do",
  // "Zen ko task do ke print version banao".
  const urduTitleFirst = query.match(
    /^(.+?)\s+(?:ko|kou)\s+(.+?)\s+(?:ka|ki|ke)\s+(?:task|kaam|kam)\s+(?:de\s*do|dedo|do|dein|den|de\s+dein|assign\s+(?:kar\s*do|krdo|karo|kardo|kar\s+dein)|bana\s*do|banao|create\s+(?:kar\s*do|krdo|karo))(?:\s+(.+?))?[.!?]?$/i,
  );
  const urduTaskFirst = query.match(
    /^(.+?)\s+(?:ko|kou)\s+(?:ye\s+|yeh\s+|ek\s+|aik\s+)?(?:task|kaam|kam)\s+(?:de\s*do|dedo|do|dein|assign\s+(?:kar\s*do|krdo|karo|kardo))\s*(?:ke|ki|keh|k|:|,|-)\s+(.+?)[.!?]?$/i,
  );
  if (urduTitleFirst) {
    const extra = urduTitleFirst[3] ? ` ${urduTitleFirst[3]}` : '';
    query = `create a task for ${urduTitleFirst[1]} to ${englishTitleFromUrdu(urduTitleFirst[2])}${extra}`;
  } else if (urduTaskFirst) {
    query = `create a task for ${urduTaskFirst[1]} to ${englishTitleFromUrdu(urduTaskFirst[2])}`;
  }

  const name = '([A-Za-z\u0600-\u06ff][\\w\u0600-\u06ff\'.-]*(?:\\s+[A-Z][\\w\'.-]*)?)';
  const verbs = `(?:${ACTION_VERBS})`;
  // "assign the print version task to Zen" / "assign a task of print version to Zen"
  const reversedTask = query.match(new RegExp(
    `^assign\\s+(?:a\\s+|the\\s+|new\\s+)?task\\s+(?:of|for|called|named|titled|to)\\s+["“']?(.+?)["”']?\\s+to\\s+${name}((?:\\s+(?:for|in|under|of|by|due|on|before|with|,|and)\\b.*)?)$`,
    'i',
  )) || query.match(new RegExp(
    `^assign\\s+(?:a\\s+|the\\s+)?["“']?(.+?)["”']?\\s+task\\s+to\\s+${name}((?:\\s+(?:for|in|under|of|by|due|on|before|with|,|and)\\b.*)?)$`,
    'i',
  ));
  if (reversedTask) {
    query = `create a task for ${reversedTask[2]} to ${reversedTask[1]}${reversedTask[3] || ''}`;
  }
  // "create a print version task for Zen ..." -> canonical "for Zen to ..."
  const typedTask = query.match(new RegExp(
    `^(create|add|make)\\s+(?:a\\s+|an\\s+|new\\s+)?(?!task\\b|new\\b)(.{3,}?)\\s+task\\s+(?:for|to)\\s+([A-Za-z][\\w'.-]*)((?:\\s+(?:for|in|under|of|by|due|on|before|with|,|and)\\b.*)?)$`,
    'i',
  ));
  if (typedTask && !/^(?:a|new)$/i.test(typedTask[2])) {
    // "create a print version task" -> "Create print version"; "add a QC task" -> "QC".
    const verb = /^create|make$/i.test(typedTask[1]) ? 'create ' : '';
    query = `create a task for ${typedTask[3]} to ${verb}${typedTask[2]}${typedTask[4] || ''}`;
  }
  // "assign Zen to create the print version", "ask Zen to create ...",
  // "give Zen a task to ...", "give a task to Zen to ...", "have Zen create ...".
  query = query
    .replace(new RegExp(`^assign\\s+(?!a\\s+task|the\\s+task|new\\s+task|task\\b)${name}\\s+(?:a\\s+task\\s+)?to\\s+(?=${verbs}\\b)`, 'i'), 'create a task for $1 to ')
    .replace(new RegExp(`^(?:ask|get)\\s+${name}\\s+to\\s+(?=${verbs}\\b)`, 'i'), 'create a task for $1 to ')
    .replace(new RegExp(`^have\\s+${name}\\s+(?=${verbs}\\b)`, 'i'), 'create a task for $1 to ')
    .replace(/^give\s+(?:a\s+|new\s+)?task\s+to\s+(.+?)\s+(?:to|:|-)\s+/i, 'create a task for $1 to ')
    .replace(/^give\s+(.+?)\s+(?:a|new|the)\s+task\s+(?:to|:|-|of|for)\s+/i, 'create a task for $1 to ')
    .replace(/^assign\s+(?:a\s+|new\s+)?task\s+for\s+(.+?)\s+to\s+/i, 'create a task for $1 to ');

  // Common commands that should use the same confirm-first task flow.
  query = query
    .replace(/^assign\s+(?:a|new)\s+task\s+to\s+(.+?)\s+to\s+/i, 'create a task for $1 to ')
    .replace(/^assign\s+(.+?)\s+a\s+task\s+to\s+/i, 'create a task for $1 to ')
    .replace(/^create\s+(?:a\s+)?task\s+for\s+(?:employee|team\s+member)\s+(?:named|called)\s+/i, 'create a task for ')
    .replace(/^task\s+for\s+(?:employee|team\s+member)\s+(?:named|called)\s+/i, 'task for ');

  // "Task Force Zen" is a common microphone mistranscription of "Task for
  // Zen". Do not reinterpret a real team/task-force query as a write.
  if (/^(?:new\s+)?task\s+force\s+.+?\s+to\s+(?:create|make|update|prepare|check|review|edit|fix|format|convert|design|recreate|upload|deliver|proofread|revise|generate|produce)\b/i.test(query)) {
    query = query.replace(/^((?:new\s+)?task)\s+force\b/i, '$1 for');
  }
  return query;
}

// A task request is a write only with an explicit creation verb or with
// enough "task for employee to do X" structure to avoid read-query confusion.
export function isCreateTaskRequest(text: string): boolean {
  const query = normalizeTaskCreationQuery(text);
  return /^(?:please\s+)?(?:create|add|make)\s+(?:(?:a|new)\s+)?task\b/i.test(query) ||
    /^(?:please\s+)?(?:new\s+)?task\s+(?:for|assigned\s+to)\s+.+?\s+to\s+\S+/i.test(query);
}

export function isActiveTaskProject(project: Project): boolean {
  const lifecycle = String(project.project_status || '').toLowerCase();
  const status = String(project.status || '').toLowerCase();
  return (!lifecycle || lifecycle === 'active') &&
    !['completed', 'delivered', 'cancelled', 'archived', 'on hold'].includes(status);
}

export function isAssignableTeamMember(profile: Profile): boolean {
  return profile.role !== 'client' &&
    profile.status !== 'inactive' &&
    !['resigned', 'retired', 'terminated'].includes(String(profile.employment_condition || 'active'));
}

function consonantKey(input: string): string {
  return normalizeEntityText(input).replace(/[aeiou\s]/g, '');
}

function resolveAssignee(name: string, people: Profile[]) {
  const normalized = normalizeEntityText(name);
  const exact = people.filter((person) => {
    const fullName = normalizeEntityText(person.full_name);
    return normalized === fullName || normalized === fullName.split(' ')[0];
  });
  if (exact.length) return exact;

  // Common short speech transcription differences (Zen/Zain) may share
  // consonants. Only trust a unique result; never silently choose among people.
  if (normalized.length >= 3 && !normalized.includes(' ')) {
    const phonetic = people.filter((person) => {
      const first = normalizeEntityText(person.full_name).split(' ')[0];
      return first.length >= 3 &&
        consonantKey(first) === consonantKey(normalized) &&
        Math.abs(first.length - normalized.length) <= 2;
    });
    if (phonetic.length) return phonetic;
  }

  const fuzzy = resolveUniqueEntityMatch(
    name,
    people.map((person) => ({
      id: person.id,
      label: person.full_name,
      aliases: [person.full_name.split(' ')[0]],
      item: person,
    })),
    { minScore: 0.83, minGap: 0.12, ambiguityWindow: 0.08 },
  );
  return fuzzy.match ? [fuzzy.match.item] : fuzzy.ambiguous.map((item) => item.item);
}

function resolveProject(name: string, projects: Project[]) {
  const normalized = normalizeEntityText(name);
  // A real project title can itself contain commas. Exact full-title matches
  // take precedence over interpreting fragments as speech corrections.
  const fullExact = projects.filter((project) =>
    normalizeEntityText(project.project_title) === normalized ||
    normalizeEntityText(project.project_number) === normalized);
  if (fullExact.length) return fullExact;

  // A comma after a partial title may be a speech correction:
  // "The Smart, The End of Smart" -> use the last exact, complete title.
  const fragments = name.split(/[,;]\s*/).map(normalizeEntityText).filter(Boolean);
  for (const fragment of [...fragments].reverse()) {
    const exact = projects.filter((project) =>
      normalizeEntityText(project.project_title) === fragment ||
      normalizeEntityText(project.project_number) === fragment);
    if (exact.length) return exact;
  }

  const contained = projects.filter((project) => {
    const title = normalizeEntityText(project.project_title);
    const number = normalizeEntityText(project.project_number);
    return (title.length >= 4 && normalized.includes(title)) ||
      (number.length >= 3 && normalized.includes(number));
  });
  if (contained.length) {
    const longest = Math.max(...contained.map((project) => normalizeEntityText(project.project_title).length));
    return contained.filter((project) => normalizeEntityText(project.project_title).length === longest);
  }

  const ranked = resolveUniqueEntityMatch(
    name,
    projects.map((project) => ({
      id: project.id,
      label: project.project_title,
      aliases: [project.project_number],
      item: project,
    })),
    { minScore: 0.83, minGap: 0.12, ambiguityWindow: 0.08 },
  );
  return ranked.match ? [ranked.match.item] : ranked.ambiguous.map((item) => item.item);
}

const SELF_WORDS = /^(?:me|myself|my self|mujhe|mujh|mera|mere|mere\s+liye|khud|self|i)$/i;

function wordPattern(normalized: string): string {
  return normalized.split(' ').filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(`[\\s\\W_]+`);
}

/**
 * Find an active project named anywhere in the instruction, even without the
 * word "project": "create print version for A Snowman Patch". Returns the
 * instruction with that mention (and its preposition) removed.
 */
export function findProjectMention(instruction: string, projects: Project[]): { projects: Project[]; rest: string } | null {
  const text = ` ${normalizeEntityText(instruction)} `;
  type Hit = { project: Project; variant: string };
  const hits: Hit[] = [];
  for (const project of projects) {
    const title = normalizeEntityText(project.project_title);
    const variants = new Set<string>([title, title.replace(/^(?:the|a|an)\s+/, '')]);
    const number = normalizeEntityText(project.project_number);
    if (number.length >= 3) variants.add(number);
    for (const variant of variants) {
      if (variant.length < 4) continue;
      if (text.includes(` ${variant} `)) hits.push({ project, variant });
    }
  }
  if (!hits.length) return null;
  const longest = Math.max(...hits.map((h) => h.variant.length));
  const best = hits.filter((h) => h.variant.length === longest);
  const unique = [...new Map(best.map((h) => [h.project.id, h.project])).values()];
  const re = new RegExp(
    `(?:\\s*,?\\s*\\b(?:for|in|of|under|on|from|inside|within|regarding|about)\\s+)?(?:\\bthe\\s+)?(?:\\b(?:project|book|title)\\s+(?:named|called|titled)?\\s*)?\\b(?:(?:the|a|an)[\\s\\W_]+)?${wordPattern(best[0].variant)}\\b(?:'s)?(?:\\s+(?:project|book))?(?:\\s+(?:ka|ki|ke)\\b)?`,
    'i',
  );
  const rest = instruction.replace(re, ' ').replace(/\s+/g, ' ').replace(/[\s,]+$/, '').trim();
  return { projects: unique, rest };
}

function cleanTitle(raw: string): string {
  let t = raw
    .replace(/^(?:to\s+|[:,-]\s*)/i, '')
    .replace(/^["“']+|["”']+$/g, '')
    .replace(/\s+(?:for|in|of|under|on|and|with|the|ka|ki|ke|,)\s*$/i, '')
    .replace(/^(?:ka|ki|ke)\s+/i, '')
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A second pass catches "... for the" left after removing a project.
  t = t.replace(/\s+(?:for|in|of|under|on|and|with)(?:\s+the)?\s*$/i, '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function projectOptionSubtitle(p: Project): string {
  const due = p.internal_deadline || p.due_date;
  return [p.project_number, p.client_name, due ? `due ${due}` : ''].filter(Boolean).join(' · ');
}

function rankProjectsForAssignee(projects: Project[], assignee: Profile, tasks: any[]): Project[] {
  const score = (p: Project) => {
    let s = 0;
    if (p.assigned_to === assignee.id) s += 4;
    if ((tasks || []).some((t) => t.project_id === p.id && t.assigned_to === assignee.id && t.status !== 'Done')) s += 2;
    return s;
  };
  return [...projects].sort((a, b) =>
    score(b) - score(a) ||
    String(a.internal_deadline || a.due_date || '9999').localeCompare(String(b.internal_deadline || b.due_date || '9999')));
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function dueDateOptions(now: Date = new Date()): DisambiguationOption[] {
  const choices: Array<[string, string]> = [
    ['Today', plusDays(now, 0)],
    ['Tomorrow', plusDays(now, 1)],
    ['In 3 days', plusDays(now, 3)],
    ['End of this week', parseTaskDate('end of week', now)!],
    ['Next week', parseTaskDate('next week', now)!],
  ];
  return [
    ...choices.map(([label, date]) => ({
      id: `due:${date}`, title: label, subtitle: shortDate(date), type: 'date' as const, data: { dueDate: date },
    })),
    { id: `due:${NO_DUE_DATE}`, title: 'No due date', type: 'date' as const, data: { dueDate: NO_DUE_DATE } },
  ];
}

/** Interpret a free-text answer to "which project?" or "when is it due?". */
export function answerTaskClarification(
  field: 'employee' | 'project' | 'due_date',
  answer: string,
  ctx: Pick<AIToolContext, 'data' | 'visibleProjects'>,
  now: Date = new Date(),
): Partial<TaskCreationOverrides> | null {
  const a = answer.trim().replace(/[.!?]+$/, '');
  if (field === 'due_date') {
    if (/^(?:no|none|skip|no due date|no deadline|without (?:a )?(?:due date|deadline)|koi nahi|nahi)$/i.test(a)) return { dueDate: NO_DUE_DATE };
    const direct = parseTaskDate(a.replace(/^(?:due|by|on|before|till|until)\s+/i, ''), now);
    if (direct) return { dueDate: direct };
    const found = extractTaskDueDate(a, now).dueDate;
    return found ? { dueDate: found } : null;
  }
  if (field === 'project') {
    if (/^(?:no|none|skip|no project|without (?:a )?project|koi nahi|nahi)$/i.test(a)) return { projectId: NO_PROJECT };
    const active = ctx.visibleProjects.filter(isActiveTaskProject);
    const matches = resolveProject(a.replace(/^(?:the\s+)?project\s+(?:named|called)?\s*/i, ''), active);
    return matches.length === 1 ? { projectId: matches[0].id } : null;
  }
  if (field === 'employee') {
    const people = ctx.data.profiles.filter(isAssignableTeamMember);
    const matches = resolveAssignee(a, people);
    return matches.length === 1 ? { employeeId: matches[0].id } : null;
  }
  return null;
}

export function resolveTaskCreation(
  rawQuery: string,
  ctx: Pick<AIToolContext, 'currentProfile' | 'data' | 'visibleProjects'> & { selectedProject?: Project | null },
  overrides: TaskCreationOverrides = {},
  now: Date = new Date(),
): TaskCreationResolution {
  let instruction = normalizeTaskCreationQuery(rawQuery).replace(
    /^(?:please\s+)?(?:(?:(?:create|add|make)\s+(?:(?:a|new)\s+)?)|(?:new\s+))?task\b\s*[:,-]?\s*/i,
    '',
  );

  let requestedAssignee: string | undefined;
  const forTo = instruction.match(/^(?:for|assigned\s+to)\s+(.+?)\s+to\s+(.+)$/i);
  const forColon = instruction.match(/^(?:for|assigned\s+to)\s+(.+?)\s*[:,-]\s*(.+)$/i);
  const assigneeClause = forTo || forColon;
  if (assigneeClause) {
    requestedAssignee = assigneeClause[1].trim();
    instruction = assigneeClause[2].trim();
  } else if (/^(?:for|assigned\s+to)\s+/i.test(instruction)) {
    return {
      kind: 'error',
      code: 'task_details_required',
      message: 'Please say the employee name followed by the task, for example: "assign a task to Zain to create the print version for Snowman Patch".',
    };
  }
  // "Create 'Review KDP PDF' ... and assign it to Sarah"
  const assignIt = instruction.match(/\s*,?\s*(?:and\s+)?assign\s+(?:it|this)\s+to\s+(.+?)\s*(?=$|,|\s+(?:by|due|before|for|in|under)\b)/i);
  if (!requestedAssignee && assignIt && assignIt.index !== undefined) {
    requestedAssignee = assignIt[1].trim();
    instruction = (instruction.slice(0, assignIt.index) + ' ' + instruction.slice(assignIt.index + assignIt[0].length)).trim();
  }

  // "... no project" / "without a project" / "standalone task" -> unlinked.
  const noProjectRe = /\s*,?\s*(?:(?:with\s+)?no\s+project|without\s+(?:a\s+|any\s+)?project|not\s+linked\s+to\s+(?:a|any)\s+project|(?:as\s+a\s+)?standalone(?:\s+task)?)(?=$|[\s,.!?])/i;
  if (noProjectRe.test(instruction) && !overrides.projectId) {
    instruction = instruction.replace(noProjectRe, ' ').replace(/\s+/g, ' ').trim();
    overrides = { ...overrides, projectId: NO_PROJECT };
  }

  // Priority and "asap"/"urgent" are metadata, never part of the title.
  const prio = extractTaskPriority(instruction);
  instruction = prio.rest;
  const priority: TaskPriority = prio.priority || 'Normal';

  // 1) Explicit deadlines anywhere: "by Friday", "due 20 Nov", "kal tak".
  let dueDate: string | undefined;
  const firstDate = extractTaskDueDate(instruction, now);
  if (firstDate.dueDate) {
    dueDate = firstDate.dueDate;
    instruction = firstDate.rest;
  }

  // 2) Explicit project clause: "for the project named X".
  let requestedProject: string | undefined;
  const projectMatch = instruction.match(
    /\s+(?:for|under|in|of|linked\s+to|associated\s+with)\s+(?:the\s+)?project(?:\s+(?:named|called|titled))?\s*[:\-]?\s+(.+)$/i,
  );
  if (projectMatch) {
    requestedProject = projectMatch[1].replace(/[.!?]+$/, '').trim();
    instruction = instruction.slice(0, projectMatch.index).trim();
    if (!dueDate) {
      const projectDate = extractTaskDueDate(requestedProject, now);
      if (projectDate.dueDate) { dueDate = projectDate.dueDate; requestedProject = projectDate.rest; }
    }
  } else if (/\b(?:for|under|in|of)\s+(?:the\s+)?project\s*$/i.test(instruction)) {
    instruction = instruction.replace(/\s+(?:for|under|in|of)\s+(?:the\s+)?project\s*$/i, '').trim();
  }

  const activeProjects = ctx.visibleProjects.filter(isActiveTaskProject);

  // 3) Project mentioned by name without the word "project".
  let mentionedProjects: Project[] | undefined;
  if (!requestedProject && !overrides.projectId) {
    const mention = findProjectMention(instruction, activeProjects);
    if (mention) {
      mentionedProjects = mention.projects;
      instruction = mention.rest;
    } else {
      // Slightly misheard title at the end: "... for snowmen patch".
      const tail = instruction.match(/\s+(?:for|in|of|under)\s+(?:the\s+)?(?:book\s+)?([^,]{4,})$/i);
      if (tail && tail.index !== undefined) {
        const ranked = resolveUniqueEntityMatch(
          tail[1],
          activeProjects.map((p) => ({ id: p.id, label: p.project_title, aliases: [p.project_number], item: p })),
          { minScore: 0.8, minGap: 0.12, ambiguityWindow: 0.08 },
        );
        if (ranked.match) {
          mentionedProjects = [ranked.match.item];
          instruction = instruction.slice(0, tail.index).trim();
        }
      }
    }
  }

  // 4) A trailing date that sat before the project name: "... on Friday for X".
  if (!dueDate) {
    const late = extractTaskDueDate(instruction, now);
    if (late.dueDate) { dueDate = late.dueDate; instruction = late.rest; }
  }
  let dueDateSource: TaskDueDateSource | undefined = dueDate ? 'command' : undefined;
  if (overrides.dueDate) {
    dueDate = overrides.dueDate === NO_DUE_DATE ? undefined : overrides.dueDate;
    dueDateSource = overrides.dueDate === NO_DUE_DATE ? undefined : 'selected';
  }
  if (!dueDate && prio.asap && !overrides.dueDate) { dueDate = plusDays(now, 0); dueDateSource = 'command'; }

  // A quoted title is authoritative: Create "Review KDP PDF" for Money Tribe.
  const quoted = instruction.match(/["“]([^"”]{3,})["”]/);
  const title = cleanTitle(quoted ? quoted[1] : instruction);
  if (title.length < 3) {
    return { kind: 'error', code: 'task_details_required', message: 'What work should be done? Please tell me the task, e.g. "create the print version".' };
  }

  const people = ctx.data.profiles.filter(isAssignableTeamMember);
  let assignee: Profile | undefined;
  if (overrides.employeeId) {
    assignee = people.find((person) => person.id === overrides.employeeId);
    if (!assignee) return { kind: 'error', code: 'employee_not_found', message: 'The selected team member is not available for task assignments.' };
  } else if (requestedAssignee && SELF_WORDS.test(requestedAssignee)) {
    assignee = people.find((person) => person.id === ctx.currentProfile.id);
  } else if (requestedAssignee) {
    const matches = resolveAssignee(requestedAssignee, people);
    if (matches.length > 1) {
      return {
        kind: 'clarify',
        field: 'employee',
        message: `I found multiple team members matching "${requestedAssignee}". Who should get "${title}"?`,
        options: matches.slice(0, 6).map((person) => ({ id: person.id, title: person.full_name, subtitle: person.role, type: 'employee' as const })),
      };
    }
    if (!matches.length) {
      return {
        kind: 'clarify',
        field: 'employee',
        message: `I couldn't find "${requestedAssignee}" in the active team. Who should get "${title}"?`,
        options: people.slice(0, 8).map((person) => ({ id: person.id, title: person.full_name, subtitle: person.role, type: 'employee' as const })),
      };
    }
    assignee = matches[0];
  } else {
    assignee = people.find((person) => person.id === ctx.currentProfile.id);
  }

  if (!assignee) {
    return { kind: 'error', code: 'employee_not_found', message: 'I could not identify a valid team member for this task.' };
  }

  let project: Project | undefined;
  let projectSource: 'command' | 'page' | 'selected' | undefined;
  if (overrides.projectId === NO_PROJECT) {
    project = undefined;
  } else if (overrides.projectId) {
    project = activeProjects.find((p) => p.id === overrides.projectId);
    if (!project) return { kind: 'error', code: 'project_not_found', message: 'The selected project is no longer active or visible.' };
    projectSource = 'selected';
  } else if (requestedProject || mentionedProjects) {
    const matches = mentionedProjects || resolveProject(requestedProject!, activeProjects);
    if (matches.length > 1) {
      return {
        kind: 'clarify',
        field: 'project',
        message: `Multiple active projects match "${requestedProject || matches[0].project_title}". Which one is "${title}" for?`,
        options: matches.slice(0, 6).map((p) => ({ id: p.id, title: p.project_title, subtitle: projectOptionSubtitle(p), type: 'project' as const })),
      };
    }
    if (!matches.length) {
      const options = rankProjectsForAssignee(activeProjects, assignee, ctx.data.tasks).slice(0, 5);
      return {
        kind: 'clarify',
        field: 'project',
        message: `I couldn't find an active project matching "${requestedProject}". Which project is "${title}" for?`,
        options: [
          ...options.map((p) => ({ id: p.id, title: p.project_title, subtitle: projectOptionSubtitle(p), type: 'project' as const })),
          { id: NO_PROJECT, title: 'No project', subtitle: 'Create a standalone task', type: 'project' as const },
        ],
      };
    }
    project = matches[0];
    projectSource = 'command';
  } else if (ctx.selectedProject && activeProjects.some((p) => p.id === ctx.selectedProject!.id)) {
    // The user is looking at a project page: "assign Zen to create the print version".
    project = activeProjects.find((p) => p.id === ctx.selectedProject!.id);
    projectSource = 'page';
  } else if (activeProjects.length) {
    const options = rankProjectsForAssignee(activeProjects, assignee, ctx.data.tasks).slice(0, 5);
    return {
      kind: 'clarify',
      field: 'project',
      message: `Which project is "${title}" for (assigned to ${assignee.full_name})?`,
      options: [
        ...options.map((p) => ({ id: p.id, title: p.project_title, subtitle: projectOptionSubtitle(p), type: 'project' as const })),
        { id: NO_PROJECT, title: 'No project', subtitle: 'Create a standalone task', type: 'project' as const },
      ],
    };
  }

  // Deadline: what the user said > the project's internal deadline > ask.
  if (!dueDate && !overrides.dueDate && project) {
    const today = plusDays(now, 0);
    const projectDue = [project.internal_deadline, project.due_date]
      .map((d) => (d ? String(d).slice(0, 10) : ''))
      .find((d) => d && d >= today);
    if (projectDue) { dueDate = projectDue; dueDateSource = 'project'; }
  }
  if (!dueDate && !overrides.dueDate) {
    return {
      kind: 'clarify',
      field: 'due_date',
      message: `When is "${title}" due for ${assignee.full_name}? Say a date like "Friday", "20 November" or "in 3 days".`,
      options: dueDateOptions(now),
    };
  }

  return { kind: 'ready', title, assignee, project, dueDate, dueDateSource, priority, projectSource };
}
