// Negative tests: the lint policy must actually reject what the docs say it rejects (M0 acceptance).
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { findRawColour } from '../tools/eslint-rules/no-raw-colors.js';
import { policyConfigs } from '../tools/eslint/policy.js';

const root = resolve(import.meta.dirname, '..');
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } },
    ...policyConfigs,
  ],
});

/** @returns {Promise<string[]>} rule ids reported for the code at the given repo-relative path */
async function rulesFor(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath: resolve(root, filePath) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `parse-error: ${m.message}`);
}

describe('theme policy: raw colours are rejected', () => {
  it('rejects Tailwind palette classes in app and ui source', async () => {
    expect(
      await rulesFor("export const c = 'bg-red-500 text-white';", 'apps/web/src/a.ts'),
    ).toContain('ms/no-raw-colors');
    expect(
      await rulesFor('export const c = `border-blue-300`;', 'packages/ui/src/a.tsx'),
    ).toContain('ms/no-raw-colors');
  });

  it('rejects arbitrary colour values and colour literals', async () => {
    expect(await rulesFor("export const c = 'bg-[#ff0000]';", 'apps/web/src/a.ts')).toContain(
      'ms/no-raw-colors',
    );
    expect(
      await rulesFor("export const c = 'text-[oklch(0.5_0.1_20)]';", 'apps/web/src/a.ts'),
    ).toContain('ms/no-raw-colors');
    expect(await rulesFor("export const c = '#ff0000';", 'apps/web/src/a.ts')).toContain(
      'ms/no-raw-colors',
    );
  });

  it('accepts semantic tokens', async () => {
    const rules = await rulesFor(
      "export const c = 'bg-surface text-fg border-line hover:bg-surface-sunken';",
      'apps/web/src/a.ts',
    );
    expect(rules).not.toContain('ms/no-raw-colors');
  });

  it('does not apply to tests or to adapter packages that need real colours', async () => {
    expect(await rulesFor("export const c = '#ff0000';", 'apps/web/src/a.test.ts')).not.toContain(
      'ms/no-raw-colors',
    );
    expect(await rulesFor("export const c = '#ff0000';", 'packages/render/src/a.ts')).not.toContain(
      'ms/no-raw-colors',
    );
  });

  it('findRawColour classifies correctly', () => {
    expect(findRawColour('hover:bg-gray-100')).toBe('palette class');
    expect(findRawColour('p-4 flex')).toBeNull();
    expect(findRawColour('text-fg-muted')).toBeNull();
  });
});

describe('security policy', () => {
  it('rejects eval, Function constructor and HTML injection', async () => {
    expect(await rulesFor("eval('1');", 'apps/web/src/a.ts')).toContain('no-eval');
    expect(
      await rulesFor("export const f = new Function('return 1');", 'packages/core/src/a.ts'),
    ).toContain('no-new-func');
    expect(
      await rulesFor(
        'export const x = <div dangerouslySetInnerHTML={{ __html: h }} />;',
        'apps/web/src/a.tsx',
      ),
    ).toContain('no-restricted-syntax');
    expect(await rulesFor("el.innerHTML = 'x';", 'apps/web/src/a.ts')).toContain(
      'no-restricted-syntax',
    );
  });
});

describe('module boundary policy', () => {
  it('forbids DOM globals in core', async () => {
    expect(await rulesFor('export const t = document.title;', 'packages/core/src/a.ts')).toContain(
      'no-restricted-globals',
    );
    expect(
      await rulesFor("export const s = localStorage.getItem('x');", 'packages/core/src/a.ts'),
    ).toContain('no-restricted-globals');
  });

  it('forbids media APIs outside adapter packages', async () => {
    const code = 'export const e = new VideoEncoder({ output() {}, error() {} });';
    expect(await rulesFor(code, 'packages/engine-video/src/a.ts')).toContain(
      'no-restricted-globals',
    );
    expect(await rulesFor(code, 'packages/ui/src/a.ts')).toContain('no-restricted-globals');
    expect(await rulesFor(code, 'packages/core/src/a.ts')).toContain('no-restricted-globals');
  });

  it('allows media APIs in adapter packages', async () => {
    const code = 'export const e = new VideoEncoder({ output() {}, error() {} });';
    expect(await rulesFor(code, 'packages/media-io/src/a.ts')).not.toContain(
      'no-restricted-globals',
    );
    expect(await rulesFor(code, 'apps/web/src/workers/export.ts')).not.toContain(
      'no-restricted-globals',
    );
  });

  it('forbids storage and file-picker properties outside adapters', async () => {
    expect(
      await rulesFor('export const s = navigator.storage;', 'packages/engine-image/src/a.ts'),
    ).toContain('no-restricted-properties');
    expect(
      await rulesFor('export const p = window.showOpenFilePicker;', 'packages/ui/src/a.ts'),
    ).toContain('no-restricted-properties');
  });
});
