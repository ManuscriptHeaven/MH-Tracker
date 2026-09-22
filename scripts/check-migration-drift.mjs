import fs from 'node:fs';
import path from 'node:path';

function migrationVersions() {
  const root = path.resolve('supabase/migrations');
  return fs.readdirSync(root)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .map((name) => name.match(/^(\d+)_/)?.[1])
    .filter(Boolean)
    .sort();
}

function parseArgs(argv) {
  const parsed = { file: null, column: 'local' };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--column') {
      parsed.column = argv[index + 1] || '';
      index += 1;
    } else if (!parsed.file) {
      parsed.file = value;
    }
  }
  if (!parsed.file) throw new Error('Usage: node scripts/check-migration-drift.mjs <migration-list.txt> --column local|remote');
  if (!['local', 'remote'].includes(parsed.column)) throw new Error('--column must be local or remote');
  return parsed;
}

function parseMigrationList(textValue, column) {
  const index = column === 'local' ? 0 : 1;
  return textValue.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('|'))
    .map((line) => line.split('|').map((item) => item.trim())[index])
    .filter((value) => /^\d+$/.test(value))
    .sort();
}

const cli = parseArgs(process.argv);
const expected = migrationVersions();
const actual = parseMigrationList(fs.readFileSync(cli.file, 'utf8'), cli.column);

const expectedSet = new Set(expected);
const actualSet = new Set(actual);
const missing = expected.filter((version) => !actualSet.has(version));
const extra = actual.filter((version) => !expectedSet.has(version));

console.log('Migration drift check (' + cli.column + ')');
console.log('Expected repository migrations: ' + expected.length);
console.log('Observed ' + cli.column + ' migrations: ' + actual.length);

if (missing.length || extra.length) {
  if (missing.length) console.error('Missing from ' + cli.column + ': ' + missing.join(', '));
  if (extra.length) console.error('Unexpected in ' + cli.column + ': ' + extra.join(', '));
  process.exit(1);
}

console.log('Migration ledger is in exact parity.');
