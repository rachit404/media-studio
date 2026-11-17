// Fails the build when the production app shell exceeds the size budget (PERF-6). Run after `pnpm build`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = resolve(root, 'scripts/size-budget.json');
const DIST = resolve(root, 'apps/web/dist');

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** Sum of gzip sizes in KB for files with the given extensions. Source maps are excluded. */
export function gzipKb(files, extensions) {
  const bytes = files
    .filter((f) => extensions.includes(extname(f)))
    .reduce((sum, f) => sum + gzipSync(readFileSync(f)).length, 0);
  return bytes / 1024;
}

export function checkBudget(sizes, budget) {
  return Object.entries(budget)
    .filter(
      ([key, limit]) => typeof limit === 'number' && key in sizes && (sizes[key] ?? 0) > limit,
    )
    .map(([key, limit]) => `${key}: ${(sizes[key] ?? 0).toFixed(1)} KB exceeds budget ${limit} KB`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
  let files;
  try {
    files = listFiles(DIST);
  } catch {
    console.error('apps/web/dist not found. Run `pnpm build` first.');
    process.exit(1);
  }
  const sizes = {
    jsGzipKb: gzipKb(files, ['.js']),
    cssGzipKb: gzipKb(files, ['.css']),
  };
  console.log(
    `JS gzip: ${sizes.jsGzipKb.toFixed(1)} KB, CSS gzip: ${sizes.cssGzipKb.toFixed(1)} KB`,
  );
  const failures = checkBudget(sizes, budget);
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('Bundle size: OK');
}
