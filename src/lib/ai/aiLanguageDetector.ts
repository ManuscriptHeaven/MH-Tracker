import type { LanguageAnalysis, LanguageCode, ScriptType } from './aiTypes';
import { detectScript, tokenize } from './aiNormalizer';

const ROMAN_URDU_MARKERS = new Set([
  'mujhe', 'muje', 'mjhe', 'ko', 'ye', 'yeh', 'isko', 'isay', 'us', 'usko',
  'karo', 'kro', 'krdo', 'kar', 'ker', 'kerdo', 'btao', 'batao', 'dikhao', 'dkhao',
  'aaj', 'aj', 'kal', 'kl', 'parson', 'parso', 'kitna', 'kitne', 'kitni', 'hai',
  'hain', 'hn', 'tha', 'thi', 'the', 'ka', 'ki', 'ke', 'se', 'main', 'mein',
  'wali', 'wala', 'wale', 'walay', 'bhi', 'kahan', 'kdr', 'khn', 'pehli',
  'pehle', 'pehla', 'mera', 'meri', 'mere', 'mery', 'ap', 'aap', 'tm', 'tum', 'woh',
  'wo', 'kya', 'kyun', 'kaun', 'kon', 'konsa', 'konsi', 'konse', 'sab', 'sare',
  'bhejo', 'rakho', 'hoga', 'hogya', 'hogaya', 'chahiye', 'par', 'pr'
]);

const ENGLISH_EXCLUSIVE_MARKERS = new Set([
  'the', 'a', 'an', 'is', 'are', 'am', 'was', 'were', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'shall', 'will', 'should',
  'would', 'may', 'might', 'must', 'can', 'could', 'of', 'for', 'with',
  'about', 'against', 'between', 'into', 'through', 'during', 'before',
  'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out',
  'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'what',
  'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'my', 'your',
  'his', 'her', 'its', 'our', 'their', 'show', 'create', 'update', 'delete',
  'assign', 'complete', 'display', 'view', 'list', 'summary', 'report',
  'performance', 'overdue', 'today', 'tomorrow', 'yesterday', 'income',
  'payroll', 'status', 'project', 'tasks', 'task', 'invoice', 'invoices',
  'team', 'overloaded', 'workload', 'manuscript', 'please'
]);

export function detectLanguage(input: string): LanguageAnalysis {
  const text = (input || '').trim();
  if (!text) {
    return {
      primary: 'unknown',
      secondary: [],
      script: 'unknown',
      codeSwitching: false,
      confidence: 0.5,
    };
  }

  const script: ScriptType = detectScript(text);
  const tokens = tokenize(text);

  let urduScriptCount = 0;
  let romanUrduCount = 0;
  let englishCount = 0;

  for (const token of tokens) {
    if (/[\u0600-\u06FF]/.test(token)) {
      urduScriptCount++;
    } else {
      const lower = token.toLowerCase();
      if (ENGLISH_EXCLUSIVE_MARKERS.has(lower)) {
        englishCount++;
      } else if (ROMAN_URDU_MARKERS.has(lower)) {
        romanUrduCount++;
      }
    }
  }

  const total = tokens.length || 1;
  const urduScriptRatio = urduScriptCount / total;
  const romanUrduRatio = romanUrduCount / total;
  const englishRatio = englishCount / total;

  let primary: LanguageCode = 'english';
  const secondary: LanguageCode[] = [];
  let codeSwitching = false;
  let confidence = 0.8;

  if (script === 'arabic' || urduScriptRatio > 0.4) {
    primary = 'urdu';
    if (englishCount > 0 || romanUrduCount > 0) {
      secondary.push('english');
      codeSwitching = true;
    }
    confidence = Math.min(0.98, urduScriptRatio + 0.3);
  } else if (romanUrduCount > 0 || romanUrduRatio > 0.1) {
    primary = 'roman_urdu';
    if (englishCount > 0) {
      secondary.push('english');
      codeSwitching = true;
    }
    confidence = Math.min(0.95, romanUrduRatio + 0.4);
  } else if (englishCount > 0) {
    primary = 'english';
    confidence = Math.min(0.95, englishRatio + 0.4);
  } else {
    // Default fallback
    primary = 'english';
    confidence = 0.7;
  }

  if (codeSwitching && secondary.length === 0) {
    secondary.push('mixed');
  }

  return {
    primary,
    secondary,
    script,
    codeSwitching,
    confidence: Number(confidence.toFixed(2)),
  };
}
