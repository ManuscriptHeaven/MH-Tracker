import type { AIToolResult, LanguageCode } from './aiTypes';

export function generateLanguageResponse(
  result: AIToolResult,
  userLanguage: LanguageCode,
): { displayText: string; spokenText: string } {
  const isRomanUrdu = userLanguage === 'roman_urdu';
  const isUrduScript = userLanguage === 'urdu';

  let displayText = result.displayText || '';
  let spokenText = result.spokenText || displayText;

  if (isRomanUrdu) {
    if (result.count !== undefined && result.toolName.includes('task')) {
      displayText = `Aap ki **${result.count} task(s)** mili hain.\n\n${displayText}`;
      spokenText = `Aap ki ${result.count} tasks mili hain.`;
    } else if (result.toolName.includes('project')) {
      displayText = `Project ki details yahan hain:\n\n${displayText}`;
      spokenText = `Project details mil gayi hain.`;
    }
  } else if (isUrduScript) {
    if (result.count !== undefined && result.toolName.includes('task')) {
      displayText = `آپ کی **${result.count} ٹاسکس** موجود ہیں:\n\n${displayText}`;
      spokenText = `آپ کی ${result.count} ٹاسکس موجود ہیں۔`;
    }
  }

  return {
    displayText,
    spokenText,
  };
}
