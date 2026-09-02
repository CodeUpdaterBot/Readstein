import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const checks = {
  translations: {
    label: 'untranslated strings',
    roots: ['public/locales'],
    pattern: /__STRING_NOT_TRANSLATED__/,
  },
  'lookbehind-regex': {
    label: 'lookbehind regular expressions',
    roots: ['.next/static/chunks', 'out/_next/static/chunks'],
    pattern: /\(\?<(?=[!=])/,
  },
};

const checkName = process.argv[2];
const check = checks[checkName];
if (!check) {
  console.error(`Unknown build-output check: ${checkName ?? '(missing)'}`);
  process.exit(2);
}

function* filesIn(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) yield* filesIn(path);
    else yield path;
  }
}

const matches = [];
for (const root of check.roots.map((root) => resolve(root))) {
  for (const path of filesIn(root)) {
    const content = readFileSync(path, 'utf8');
    if (check.pattern.test(content)) matches.push(path);
  }
}

if (matches.length > 0) {
  console.error(`❌ ${check.label} found in output:`);
  for (const path of matches) console.error(`- ${path}`);
  process.exit(1);
}

console.log(`✅ No ${check.label} found.`);
