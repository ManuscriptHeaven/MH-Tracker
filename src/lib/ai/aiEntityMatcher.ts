export interface EntityMatchCandidate<T> {
  id: string;
  label: string;
  aliases?: string[];
  item: T;
}

export interface RankedEntityMatch<T> extends EntityMatchCandidate<T> {
  score: number;
  matchedAlias: string;
}

export interface UniqueEntityResolution<T> {
  match?: RankedEntityMatch<T>;
  ambiguous: RankedEntityMatch<T>[];
}

const STOP_WORDS = new Set([
  'a','an','the','this','that','it','project','projects','task','tasks','client','clients',
  'for','of','to','on','in','with','from','please','pls','plz','kindly','mera','meri','mere',
  'ye','yeh','is','isko','usay','usko','ka','ki','ke','ko','k','and','aur','then','phir',
  'create','add','make','generate','submit','send','share','move','set','change','update',
  'assign','record','approve','complete','deliver','banao','bnao','karo','kro','krdo','bhejo',
]);

export function normalizeEntityText(value: string): string {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_/\\-]+/g, ' ')
    .replace(/[^a-z0-9\u0600-\u06ff\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(value: string): string[] {
  return normalizeEntityText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  return 1 - levenshtein(a, b) / maxLength;
}

function scoreAlias(query: string, alias: string): number {
  const q = normalizeEntityText(query);
  const a = normalizeEntityText(alias);
  if (!q || !a) return 0;

  if (q === a) return 1;
  if (q.includes(a)) return 0.99;
  if (a.length >= 3 && a.includes(q) && significantTokens(q).length > 0) return 0.9;

  const qTokens = significantTokens(q);
  const aTokens = significantTokens(a);
  if (aTokens.length === 0 || qTokens.length === 0) return 0;

  let exact = 0;
  let fuzzy = 0;

  for (const aliasToken of aTokens) {
    if (qTokens.includes(aliasToken)) {
      exact += 1;
      continue;
    }

    const best = qTokens.reduce(
      (score, queryToken) => Math.max(score, tokenSimilarity(aliasToken, queryToken)),
      0,
    );
    if (best >= 0.82) fuzzy += best;
  }

  const coverage = Math.min(1, (exact + fuzzy * 0.8) / aTokens.length);
  const exactCoverage = exact / aTokens.length;

  if (aTokens.length === 1 && exactCoverage === 1) return 0.95;
  if (coverage >= 0.99) return 0.94;
  if (coverage >= 0.75) return 0.82 + exactCoverage * 0.08;
  if (coverage >= 0.5 && exactCoverage > 0) return 0.68 + exactCoverage * 0.08;

  return 0;
}

export function rankEntityCandidates<T>(
  query: string,
  candidates: EntityMatchCandidate<T>[],
  minScore = 0.5,
): RankedEntityMatch<T>[] {
  const ranked: RankedEntityMatch<T>[] = [];

  for (const candidate of candidates) {
    const aliases = [candidate.label, ...(candidate.aliases || [])].filter(Boolean);
    let score = 0;
    let matchedAlias = candidate.label;

    for (const alias of aliases) {
      const current = scoreAlias(query, alias);
      if (current > score) {
        score = current;
        matchedAlias = alias;
      }
    }

    if (score >= minScore) {
      ranked.push({ ...candidate, score, matchedAlias });
    }
  }

  return ranked.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

export function resolveUniqueEntityMatch<T>(
  query: string,
  candidates: EntityMatchCandidate<T>[],
  options: { minScore?: number; minGap?: number; ambiguityWindow?: number } = {},
): UniqueEntityResolution<T> {
  const minScore = options.minScore ?? 0.72;
  const minGap = options.minGap ?? 0.1;
  const ambiguityWindow = options.ambiguityWindow ?? 0.07;
  const ranked = rankEntityCandidates(query, candidates, minScore);

  if (ranked.length === 0) return { ambiguous: [] };
  if (ranked.length === 1) return { match: ranked[0], ambiguous: [] };

  const [first, second] = ranked;
  if (first.score - second.score >= minGap) {
    return { match: first, ambiguous: [] };
  }

  return {
    ambiguous: ranked
      .filter((candidate) => first.score - candidate.score <= ambiguityWindow)
      .slice(0, 6),
  };
}
