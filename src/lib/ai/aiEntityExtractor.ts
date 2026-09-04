import type { ExtractedEntity, ResolvedDate, NormalizedInput } from './aiTypes';
import { todayInput, addDays } from '../date';

/**
 * Extract named entities, numbers, dates, priorities, and statuses from input text.
 */
export function extractEntities(normalized: NormalizedInput): ExtractedEntity[] {
  const text = normalized.normalizedInput;
  const original = normalized.originalInput;
  const entities: ExtractedEntity[] = [];

  // 1. Status entities
  const statusMatches = text.match(/\b(in progress|pending|completed|done|delivered|files required|overdue|paused|cancelled|active|archived)\b/gi);
  if (statusMatches) {
    statusMatches.forEach((match) => {
      entities.push({
        type: 'status',
        rawText: match,
        normalizedText: match.toLowerCase(),
        confidence: 0.95,
      });
    });
  }

  // 2. Priority entities
  const priorityMatches = text.match(/\b(urgent|high|normal|low|important)\b/gi);
  if (priorityMatches) {
    priorityMatches.forEach((match) => {
      entities.push({
        type: 'priority',
        rawText: match,
        normalizedText: match.toLowerCase(),
        confidence: 0.95,
      });
    });
  }

  // 3. Amount & Currency entities ($500, 1000 pkr, 50$, etc.)
  const amountRegex = /(\$|pkr|rs|usd|\u20b9)?\s*(\d+(?:\.\d+)?)\s*(pkr|rs|usd|\$)?/gi;
  let amtMatch;
  while ((amtMatch = amountRegex.exec(text)) !== null) {
    const rawNum = amtMatch[2];
    const val = parseFloat(rawNum);
    if (!isNaN(val) && val > 0 && (amtMatch[1] || amtMatch[3] || val >= 50)) {
      entities.push({
        type: 'amount',
        rawText: amtMatch[0],
        normalizedText: val.toString(),
        confidence: 0.9,
      });
    }
  }

  // 4. Proper Name Candidates (Capitalized words or names following "ko", "assign to", "for")
  const personMatches = original.match(/\b(assign to|ko|for|with|by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g);
  if (personMatches) {
    personMatches.forEach((m) => {
      const parts = m.split(/\s+/);
      const name = parts.slice(1).join(' ');
      entities.push({
        type: 'person',
        rawText: name,
        normalizedText: name,
        confidence: 0.85,
      });
    });
  }

  // Standalone capitalized words
  const standaloneCaps = original.match(/\b[A-Z][a-z]{2,}\b/g);
  if (standaloneCaps) {
    standaloneCaps.forEach((cap) => {
      if (!['Task', 'Project', 'Friday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday', 'Sunday', 'Today', 'Tomorrow', 'Yesterday'].includes(cap)) {
        entities.push({
          type: 'person',
          rawText: cap,
          normalizedText: cap,
          confidence: 0.7,
        });
      }
    });
  }

  return entities;
}

/**
 * Extract and resolve relative and natural date expressions into exact ISO datetimes.
 */
export function extractAndResolveDates(text: string): ResolvedDate[] {
  const lower = (text || '').toLowerCase();
  const dates: ResolvedDate[] = [];
  const today = todayInput();

  // "aaj" / "today"
  if (/\b(aaj|aj|today)\b/i.test(lower)) {
    dates.push({
      originalExpression: 'today',
      resolvedDate: today,
      isRange: false,
      confidence: 0.98,
    });
  }

  // "kal" / "tomorrow" / "yesterday"
  if (/\b(tomorrow)\b/i.test(lower)) {
    dates.push({
      originalExpression: 'tomorrow',
      resolvedDate: addDays(1),
      isRange: false,
      confidence: 0.98,
    });
  } else if (/\b(yesterday)\b/i.test(lower)) {
    dates.push({
      originalExpression: 'yesterday',
      resolvedDate: addDays(-1),
      isRange: false,
      confidence: 0.98,
    });
  } else if (/\b(kal|kl)\b/i.test(lower)) {
    dates.push({
      originalExpression: 'kal',
      resolvedDate: addDays(1),
      isRange: false,
      confidence: 0.92,
    });
  }

  // "parson" / "parso" (day after tomorrow / 2 days later)
  if (/\b(parson|parso|perso)\b/i.test(lower)) {
    dates.push({
      originalExpression: 'parson',
      resolvedDate: addDays(2),
      isRange: false,
      confidence: 0.95,
    });
  }

  // Relative days "2 din baad", "3 days later", "in 4 days"
  const relDaysMatch = lower.match(/\b(\d+)\s*(din|days?)\s*(baad|later|after|in)?\b/i);
  if (relDaysMatch) {
    const days = parseInt(relDaysMatch[1], 10);
    if (!isNaN(days)) {
      dates.push({
        originalExpression: relDaysMatch[0],
        resolvedDate: addDays(days),
        isRange: false,
        confidence: 0.92,
      });
    }
  }

  // Weekdays: "Friday", "next Friday", "coming Monday"
  const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  weekdayNames.forEach((dayName, targetDayIndex) => {
    if (lower.includes(dayName)) {
      const currentDayIndex = new Date().getDay();
      let daysAhead = targetDayIndex - currentDayIndex;
      if (daysAhead <= 0) daysAhead += 7;

      dates.push({
        originalExpression: dayName,
        resolvedDate: addDays(daysAhead),
        isRange: false,
        confidence: 0.95,
      });
    }
  });

  return dates;
}
