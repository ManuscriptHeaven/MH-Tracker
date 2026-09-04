import type { IntentResult, NormalizedInput, LanguageAnalysis } from './aiTypes';
import { INTENT_TAXONOMY, type IntentDefinition } from './aiIntentTaxonomy';

export function detectIntent(
  normalized: NormalizedInput,
  language: LanguageAnalysis,
  previousIntent?: string,
): IntentResult {
  const text = normalized.normalizedInput;
  const original = normalized.originalInput;

  // Check compound multi-intent sentences split by "aur", "and", "phir", "then"
  const clauses = text
    .split(/\b(aur|and|phir|then|also)\b/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 3 && !/^(aur|and|phir|then|also)$/i.test(c));

  const detectedIntents: IntentResult[] = [];

  for (const clause of clauses) {
    const singleIntent = matchSingleIntent(clause, original, previousIntent);
    if (singleIntent.name !== 'general_query' && singleIntent.confidence > 0.5) {
      detectedIntents.push(singleIntent);
    }
  }

  if (detectedIntents.length > 1) {
    const primary = detectedIntents[0];
    primary.secondaryIntents = detectedIntents.slice(1);
    return primary;
  }

  return matchSingleIntent(text, original, previousIntent);
}

function matchSingleIntent(
  text: string,
  originalText: string,
  previousIntent?: string,
): IntentResult {
  const lower = text.toLowerCase();

  let bestMatch: IntentDefinition | null = null;
  let maxScore = 0;

  for (const def of INTENT_TAXONOMY) {
    let score = 0;

    // Pattern matching
    for (const pattern of def.patterns) {
      const match1 = pattern.exec(lower);
      const match2 = pattern.exec(originalText);
      if (match1 || match2) {
        const index = match1 ? match1.index : match2!.index;
        score += 1.0 + (1 / (index + 1));
        break;
      }
    }

    // Keyword matching
    for (const kw of def.keywords.english) {
      if (lower.includes(kw)) score += 0.25;
    }
    for (const kw of def.keywords.romanUrdu) {
      if (lower.includes(kw)) score += 0.25;
    }
    for (const kw of def.keywords.urdu) {
      if (originalText.includes(kw)) score += 0.3;
    }

    if (score > maxScore) {
      maxScore = score;
      bestMatch = def;
    }
  }

  // Handle follow-up queries (e.g. "in me se overdue wali dikhao", "Format Chapter 12")
  if ((!bestMatch || maxScore < 0.4) && previousIntent) {
    if (
      lower.includes('overdue') ||
      lower.includes('pending') ||
      lower.includes('completed') ||
      lower.includes('in me se') ||
      lower.includes('inmei se') ||
      lower.includes('which ones') ||
      (lower.split(/\s+/).length <= 4 && !/\b(dikhao|batao|banao|delete|create|assign|show|view)\b/i.test(lower))
    ) {
      return {
        name: previousIntent,
        category: 'follow_up',
        confidence: 0.85,
      };
    }
  }

  if (!bestMatch || maxScore < 0.3) {
    return {
      name: 'general_query',
      category: 'unknown',
      confidence: 0.4,
    };
  }

  return {
    name: bestMatch.name,
    category: bestMatch.category,
    confidence: Number(Math.min(0.98, maxScore).toFixed(2)),
  };
}
