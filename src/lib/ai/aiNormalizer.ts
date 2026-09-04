import type { NormalizedInput, ScriptType } from './aiTypes';

/**
 * Roman Urdu dictionary map for spelling normalization.
 * Tolerant of phonetic variations and informal SMS/social media Roman Urdu.
 */
const ROMAN_URDU_DICTIONARY: Record<string, string> = {
  // Verbs & Actions
  kro: 'kar do',
  krdo: 'kar do',
  kar: 'kar',
  karo: 'kar do',
  ker: 'kar',
  kerdo: 'kar do',
  kerdof: 'kar do',
  krd: 'kar do',
  btao: 'batao',
  bataao: 'batao',
  batain: 'batao',
  batayen: 'batao',
  dikhao: 'dikhao',
  dkhao: 'dikhao',
  dikhado: 'dikhao',
  dikhayein: 'dikhao',
  dikhayen: 'dikhao',
  bhejdo: 'bhej do',
  bhejo: 'bhej do',
  bhejen: 'bhej do',
  kardein: 'kar do',
  karden: 'kar do',
  kardo: 'kar do',
  ho: 'ho',
  hogya: 'ho gaya',
  hogaya: 'ho gaya',
  hojaye: 'ho jaye',
  hojayega: 'ho jayega',
  chahiye: 'chahiye',
  chahiyay: 'chahiye',
  rakho: 'rakho',
  rakh: 'rakho',
  daldo: 'dal do',

  // Pronouns & References
  mujhe: 'mujhe',
  muje: 'mujhe',
  mjhe: 'mujhe',
  mjh: 'mujhe',
  meri: 'meri',
  mera: 'mera',
  mere: 'mere',
  mery: 'mere',
  meray: 'mere',
  ap: 'aap',
  aap: 'aap',
  tm: 'tum',
  tum: 'tum',
  us: 'us',
  iski: 'iski',
  iske: 'iske',
  iska: 'iska',
  is: 'is',
  isko: 'isko',
  isay: 'isko',
  ise: 'isko',
  usko: 'usko',
  usay: 'usko',
  unko: 'unko',
  woh: 'woh',
  wo: 'woh',
  ye: 'ye',
  yeh: 'ye',
  yh: 'ye',

  // Question words
  kya: 'kya',
  kyaah: 'kya',
  kyu: 'kyun',
  kyun: 'kyun',
  kdr: 'kahan',
  kahan: 'kahan',
  khn: 'kahan',
  kaun: 'kaun',
  kon: 'kaun',
  konse: 'kaunse',
  konsa: 'kaunsa',
  konsi: 'kaunsi',
  kitna: 'kitna',
  kitne: 'kitne',
  kitni: 'kitni',
  kab: 'kab',
  kb: 'kab',
  kaise: 'kaise',
  kese: 'kaise',

  // Time & Dates
  aaj: 'aaj',
  aj: 'aaj',
  kal: 'kal',
  kl: 'kal',
  parson: 'parson',
  parso: 'parson',
  perso: 'parson',
  haftay: 'hafte',
  hafte: 'hafte',
  mahine: 'mahine',
  maheene: 'mahine',
  saal: 'saal',

  // Status & Fillers
  bhi: 'bhi',
  b: 'bhi',
  h: 'hai',
  hai: 'hai',
  hain: 'hain',
  hn: 'hain',
  tha: 'tha',
  thi: 'thi',
  the: 'the',
  matlab: 'matlab',
  pls: 'please',
  plz: 'please',
  plzz: 'please',
  thx: 'thanks',
  ty: 'thanks',

  // Common Business/Tracker Typos & Misspellings
  asgn: 'assign',
  asign: 'assign',
  assgn: 'assign',
  pendng: 'pending',
  pndg: 'pending',
  pnding: 'pending',
  projetc: 'project',
  projct: 'project',
  prject: 'project',
  projt: 'project',
  taskk: 'task',
  tsks: 'tasks',
  invice: 'invoice',
  invc: 'invoice',
  perfomance: 'performance',
  perfmance: 'performance',
  overdeu: 'overdue',
  overdu: 'overdue',
  cmplete: 'complete',
  cmpleted: 'completed',
  deleat: 'delete',
  delet: 'delete',
  dues: 'dues',
  duess: 'dues',
};

/**
 * Detect script type (Latin, Arabic script, or Mixed).
 */
export function detectScript(input: string): ScriptType {
  const hasLatin = /[a-zA-Z]/.test(input);
  const hasArabic = /[\u0600-\u06FF]/.test(input);

  if (hasLatin && hasArabic) return 'mixed';
  if (hasArabic) return 'arabic';
  if (hasLatin) return 'latin';
  return 'unknown';
}

/**
 * Tokenize text into words preserving relative order.
 */
export function tokenize(text: string): string[] {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s\u0600-\u06FF]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Collapse consecutive repeated letters (e.g., "aaaaaj" -> "aaj", "plzzzz" -> "plz", "taskkkk" -> "task").
 */
export function collapseRepeatedLetters(word: string): string {
  if (word.length <= 2) return word;
  return word.replace(/(.)\1{2,}/gi, '$1$1');
}

/**
 * Generate simple phonetic metaphone-like token representation for fuzzy matching.
 */
export function phoneticToken(word: string): string {
  return word
    .toLowerCase()
    .replace(/ph/g, 'f')
    .replace(/gh/g, 'g')
    .replace(/kh/g, 'k')
    .replace(/ck/g, 'k')
    .replace(/sh/g, 's')
    .replace(/zh/g, 'z')
    .replace(/ch/g, 'c')
    .replace(/[aeiou]/g, '');
}

/**
 * Perform non-destructive semantic normalization on incoming user input.
 */
export function normalizeInput(input: string): NormalizedInput {
  const originalInput = input || '';
  const script = detectScript(originalInput);
  const rawTokens = tokenize(originalInput);

  const replacements: Array<{ original: string; normalized: string; type: string }> = [];
  const normalizedTokens: string[] = [];
  const phoneticTokens: string[] = [];

  for (const token of rawTokens) {
    const collapsed = collapseRepeatedLetters(token);
    let normalized = collapsed;
    let replacementType = 'none';

    // 1. Direct dictionary lookup
    if (ROMAN_URDU_DICTIONARY[collapsed]) {
      normalized = ROMAN_URDU_DICTIONARY[collapsed];
      replacementType = 'dictionary_roman_urdu';
    } else if (ROMAN_URDU_DICTIONARY[token]) {
      normalized = ROMAN_URDU_DICTIONARY[token];
      replacementType = 'dictionary_roman_urdu';
    }

    if (normalized !== token) {
      replacements.push({
        original: token,
        normalized,
        type: replacementType,
      });
    }

    normalizedTokens.push(normalized);
    phoneticTokens.push(phoneticToken(normalized));
  }

  // Build clean normalized string
  let normalizedInput = normalizedTokens.join(' ');

  // Common multi-word phrase normalizations
  normalizedInput = normalizedInput
    .replace(/\bassign kr\b/gi, 'assign kar')
    .replace(/\bassign krdo\b/gi, 'assign kar do')
    .replace(/\bassign kardo\b/gi, 'assign kar do')
    .replace(/\bkr do\b/gi, 'kar do')
    .replace(/\bkal wali\b/gi, 'kal wali')
    .replace(/\bpehle wali\b/gi, 'pehli wali')
    .replace(/\bpehli wali\b/gi, 'pehli wali');

  return {
    originalInput,
    normalizedInput: normalizedInput || originalInput,
    tokens: rawTokens,
    normalizedTokens,
    phoneticTokens,
    detectedScript: script,
    replacements,
  };
}
