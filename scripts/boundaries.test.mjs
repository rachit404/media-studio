// Negative tests for the package graph (M0 acceptance: "a deliberate boundary violation fails CI").
// Builds a throwaway tree in the OS temp directory and runs dependency-cruiser with the real rules.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cruise } from 'dependency-cruiser';
import { afterEach, describe, expect, it } from 'vitest';

const config = createRequire(import.meta.url)('../.dependency-cruiser.cjs');
/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** @param {Record<string,string>} files repo-relative path -> source. Returns violated rule names. */
async function violationsFor(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ms-boundaries-'));
  tempDirs.push(dir);
  for (const [path, source] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source);
  }
  // dependency-cruiser resolves these relative to baseDir; only pass top-level folders that exist.
  const roots = [...new Set(Object.keys(files).map((path) => path.split('/')[0] ?? ''))];
  const result = await cruise(
    roots,
    { ...config.options, baseDir: dir, validate: true, ruleSet: { forbidden: config.forbidden } },
    config.options.enhancedResolveOptions,
  );
  const violations = typeof result.output === 'string' ? [] : result.output.summary.violations;
  return violations.map((v) => v.rule.name);
}

describe('package boundaries', () => {
  it('accepts an allowed dependency', async () => {
    const rules = await violationsFor({
      'packages/core/src/index.ts': 'export const a = 1;',
      'packages/render/src/index.ts':
        "import { a } from '../../core/src/index'; export const b = a;",
    });
    expect(rules).toEqual([]);
  });

  it('rejects core importing another package', async () => {
    const rules = await violationsFor({
      'packages/render/src/index.ts': 'export const r = 1;',
      'packages/core/src/index.ts':
        "import { r } from '../../render/src/index'; export const c = r;",
    });
    expect(rules).toContain('boundary-core');
  });

  it('rejects an engine importing a sibling engine', async () => {
    const rules = await violationsFor({
      'packages/engine-video/src/index.ts': 'export const v = 1;',
      'packages/engine-image/src/index.ts':
        "import { v } from '../../engine-video/src/index'; export const i = v;",
    });
    expect(rules).toContain('boundary-engine-image');
  });

  it('rejects a package importing the app', async () => {
    const rules = await violationsFor({
      'apps/web/src/main.ts': 'export const m = 1;',
      'packages/ui/src/index.ts':
        "import { m } from '../../../apps/web/src/main'; export const u = m;",
    });
    expect(rules).toContain('boundary-ui');
  });

  it('rejects imports of another package internals', async () => {
    const rules = await violationsFor({
      'packages/render/src/internal/shader.ts': 'export const s = 1;',
      'packages/render/src/index.ts': 'export {};',
      'packages/engine-video/src/index.ts':
        "import { s } from '../../render/src/internal/shader'; export const v = s;",
    });
    expect(rules).toContain('no-deep-package-imports');
  });

  it('rejects circular dependencies', async () => {
    const rules = await violationsFor({
      'packages/core/src/a.ts': "import { b } from './b'; export const a = b;",
      'packages/core/src/b.ts': "import { a } from './a'; export const b = a;",
    });
    expect(rules).toContain('no-circular');
  });
});
