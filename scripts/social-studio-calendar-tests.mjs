import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const path = new URL('../src/components/social/SocialEditorialCalendar.tsx', import.meta.url);
const source = readFileSync(path, 'utf8');
const studio = readFileSync(new URL('../src/pages/SocialStudioPage.tsx', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
const require = (path) => {
  if (path === 'react') return { useMemo: (fn) => fn(), useState: (value) => [value, () => {}] };
  if (path === 'lucide-react') return {};
  if (path === 'react/jsx-runtime') return { jsx: () => ({}), jsxs: () => ({}) };
  throw Error('Unexpected import: ' + path);
};
vm.runInNewContext(js, { exports, require, Date, Intl, String, Map, Array });
const { mondayOfWeek, localDayKey, WEEKLY_EDUCATIONAL_TOPICS } = exports;

assert.equal(WEEKLY_EDUCATIONAL_TOPICS.length, 7);
assert.equal(new Set(WEEKLY_EDUCATIONAL_TOPICS).size, 7);
for (const title of WEEKLY_EDUCATIONAL_TOPICS) assert.ok(title.length > 20);

function expectWeekStart(date, expected) {
  const result = mondayOfWeek(new Date(date + 'T13:30:00'));
  assert.equal(localDayKey(result), expected);
  assert.equal(result.getDay(), 1, 'Week starts on Monday');
}
expectWeekStart('2026-10-19', '2026-10-19'); // Monday
expectWeekStart('2026-10-23', '2026-10-19'); // Friday
expectWeekStart('2026-10-25', '2026-10-19'); // Sunday
expectWeekStart('2026-11-01', '2026-10-26'); // Across month boundary
expectWeekStart('2027-01-01', '2026-12-28'); // Across year boundary
expectWeekStart('2028-02-29', '2028-02-28'); // Leap year
assert.equal(localDayKey(new Date('2026-10-23T13:30:00')), '2026-10-23');

assert.match(source, /entry\.status === 'scheduled' && entry\.scheduledAt/);
assert.match(source, /No posts are published automatically/);
assert.match(source, /Times are displayed in your browser/);
assert.match(source, /Planned · not posted/);
assert.match(source, /onChooseTopic\(WEEKLY_EDUCATIONAL_TOPICS\[i\]\)/);
assert.match(studio, /<SocialEditorialCalendar/);
assert.match(studio, /id="social-ai-content-generator"/);
assert.match(studio, /setSuggestion\(null\)/);
console.log('Social weekly content calendar and date boundary tests passed.');
