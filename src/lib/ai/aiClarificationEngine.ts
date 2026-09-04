import type {
  DisambiguationOption,
  IntentResult,
  ResolvedEntity,
  LanguageCode,
} from './aiTypes';

export interface ClarificationCheckResult {
  needsClarification: boolean;
  question: string | null;
  ambiguities: Array<{ field: string; options: DisambiguationOption[]; description: string }>;
  confidence: number;
}

export function evaluateClarification(
  intent: IntentResult,
  resolvedEntities: ResolvedEntity[],
  ambiguities: Array<{ field: string; options: DisambiguationOption[]; description: string }>,
  userLanguage: LanguageCode,
): ClarificationCheckResult {
  // If ambiguities were found during entity resolution (e.g. multiple matching employees or projects)
  if (ambiguities.length > 0) {
    const amb = ambiguities[0];
    const optionsText = amb.options.map((o) => o.title).join(' ya ');

    let question = '';
    if (userLanguage === 'roman_urdu') {
      question = `Aap kaunse ${amb.field} ki baat kar rahe hain: ${optionsText}?`;
    } else if (userLanguage === 'urdu') {
      question = `آپ کس ${amb.field} کی بات کر رہے ہیں: ${optionsText}؟`;
    } else {
      question = `Which ${amb.field} do you mean: ${optionsText}?`;
    }

    return {
      needsClarification: true,
      question,
      ambiguities,
      confidence: 0.6,
    };
  }

  // If intent needs an entity (e.g. assign_task requires assignee or task, but none could be resolved)
  if (intent.name === 'assign_task') {
    const hasEmployee = resolvedEntities.some((e) => e.type === 'employee' || e.type === 'person');
    if (!hasEmployee) {
      const question =
        userLanguage === 'roman_urdu'
          ? 'Ye task kiske naam assign karni hai?'
          : userLanguage === 'urdu'
          ? 'یہ ٹاسک کس کو تفویض کرنی ہے؟'
          : 'Who would you like to assign this task to?';

      return {
        needsClarification: true,
        question,
        ambiguities: [],
        confidence: 0.65,
      };
    }
  }

  if (intent.category === 'unknown' || intent.confidence < 0.4) {
    const question =
      userLanguage === 'roman_urdu'
        ? 'Mujhe aap ki baat poori tarah samajh nahi aayi. Kya aap dobara bata sakte hain?'
        : userLanguage === 'urdu'
        ? 'مجھے آپ کی بات پوری طرح سمجھ نہیں آئی۔ کیا آپ دوبارہ بتا سکتے ہیں؟'
        : 'I did not quite understand that. Could you please rephrase your request?';

    return {
      needsClarification: true,
      question,
      ambiguities: [],
      confidence: 0.35,
    };
  }

  return {
    needsClarification: false,
    question: null,
    ambiguities: [],
    confidence: intent.confidence,
  };
}
