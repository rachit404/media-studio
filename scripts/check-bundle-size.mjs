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

/**
 * Split built files into the app shell (loaded at start: the scripts index.html names, plus the storage worker) and
 * the lazy chunks (editors, analysis worker) that load only when needed.
 * @param {string[]} files @param {string} html
 */
export function splitShell(files, html) {
  const named = new Set(
    [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((match) =>
      (match[1] ?? '').split('/').pop(),
    ),
  );
  const isShell = (file) => {
    const name = file.split(/[\\/]/).pop() ?? '';
    return named.has(name) || name.startsWith('storage.worker');
  };
  return { shell: files.filter(isShell), lazy: files.filter((file) => !isShell(file)) };
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
  const { shell, lazy } = splitShell(files, readFileSync(join(DIST, 'index.html'), 'utf8'));
  const sizes = {
    jsGzipKb: gzipKb(shell, ['.js']),
    lazyJsGzipKb: gzipKb(lazy, ['.js']),
    cssGzipKb: gzipKb(files, ['.css']),
  };
  console.log(
    `Shell JS gzip: ${sizes.jsGzipKb.toFixed(1)} KB, lazy JS gzip: ${sizes.lazyJsGzipKb.toFixed(1)} KB, CSS gzip: ${sizes.cssGzipKb.toFixed(1)} KB`,
  );
  const failures = checkBudget(sizes, budget);
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('Bundle size: OK');
}
