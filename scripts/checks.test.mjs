// Tests for the CI check scripts themselves: licence gate, theme contrast, bundle budget.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkBudget, splitShell } from './check-bundle-size.mjs';
import { classifyExpression, evaluateLicences, loadPolicy } from './check-licences.mjs';
import { checkThemes, contrastRatio, loadThemes, THEME_FILE } from './check-theme-contrast.mjs';

const policy = loadPolicy();

describe('licence gate', () => {
  it('classifies single identifiers', () => {
    expect(classifyExpression('MIT', policy)).toBe('allowed');
    expect(classifyExpression('Apache-2.0', policy)).toBe('allowed');
    expect(classifyExpression('MPL-2.0', policy)).toBe('care');
    expect(classifyExpression('LGPL-2.1', policy)).toBe('review');
    expect(classifyExpression('GPL-2.0-or-later', policy)).toBe('forbidden');
    expect(classifyExpression('AGPL-3.0-only', policy)).toBe('forbidden');
    expect(classifyExpression('Totally-Custom', policy)).toBe('unknown');
  });

  it('evaluates OR (best option) and AND (worst option) expressions', () => {
    expect(classifyExpression('(MIT OR GPL-3.0-only)', policy)).toBe('allowed');
    expect(classifyExpression('MIT AND GPL-3.0-only', policy)).toBe('forbidden');
    expect(classifyExpression('(Apache-2.0 OR MPL-2.0) AND ISC', policy)).toBe('allowed');
  });

  it('fails the gate for a GPL dependency (M0 acceptance)', () => {
    const { violations } = evaluateLicences(
      {
        MIT: [{ name: 'ok-pkg', versions: ['1.0.0'] }],
        'GPL-2.0-or-later': [{ name: '@ffmpeg/core', versions: ['0.12.10'] }],
      },
      policy,
    );
    expect(violations.map((v) => v.name)).toEqual(['@ffmpeg/core']);
  });

  it('honours documented exceptions', () => {
    const withException = { ...policy, exceptions: [{ name: 'special', reason: 'reviewed' }] };
    const { violations } = evaluateLicences(
      { 'LGPL-2.1': [{ name: 'special', versions: ['1.0.0'] }] },
      withException,
    );
    expect(violations).toEqual([]);
  });

  it('keeps MPL-2.0 allowed but visible', () => {
    const { violations, care } = evaluateLicences(
      { 'MPL-2.0': [{ name: 'mediabunny', versions: ['1.66.0'] }] },
      policy,
    );
    expect(violations).toEqual([]);
    expect(care).toHaveLength(1);
  });
});

describe('theme contrast gate', () => {
  it('computes known ratios', () => {
    expect(contrastRatio({ l: 1, c: 0, h: 0 }, { l: 0, c: 0, h: 0 })).toBeCloseTo(21, 0);
    expect(contrastRatio({ l: 0.5, c: 0, h: 0 }, { l: 0.5, c: 0, h: 0 })).toBeCloseTo(1, 5);
  });

  it('passes for the real theme file in all three themes', () => {
    const themes = loadThemes(readFileSync(THEME_FILE, 'utf8'));
    expect(checkThemes(themes)).toEqual([]);
  });

  it('fails when a token has too little contrast', () => {
    const css = readFileSync(THEME_FILE, 'utf8').replace(
      '--color-fg-muted: oklch(0.75 0.01 260);',
      '--color-fg-muted: oklch(0.3 0.01 260);',
    );
    const failures = checkThemes(loadThemes(css));
    expect(failures.some((f) => f.startsWith('dark: fg-muted on surface'))).toBe(true);
  });

  it('holds high contrast to 7:1 for text and 3:1 for borders', () => {
    const css = readFileSync(THEME_FILE, 'utf8').replace(
      '--color-fg-muted: oklch(0.92 0 0);',
      '--color-fg-muted: oklch(0.5 0 0);',
    );
    const failures = checkThemes(loadThemes(css));
    expect(failures.some((f) => f.startsWith('high-contrast: fg-muted on surface'))).toBe(true);
    expect(failures.some((f) => f.startsWith('dark:') || f.startsWith('light:'))).toBe(false);
    const weak = readFileSync(THEME_FILE, 'utf8').replace(
      '--color-line: oklch(0.7 0 0);',
      '--color-line: oklch(0.3 0 0);',
    );
    expect(checkThemes(loadThemes(weak)).some((f) => f.startsWith('high-contrast: line on'))).toBe(
      true,
    );
  });

  it('fails when high contrast forgets a required token', () => {
    const css = readFileSync(THEME_FILE, 'utf8').replace(
      '--color-accent: oklch(0.9 0.17 100);',
      '',
    );
    expect(checkThemes(loadThemes(css))).toContain(
      'high-contrast theme does not override --color-accent',
    );
  });

  it('fails when the light theme forgets a required token', () => {
    const css = readFileSync(THEME_FILE, 'utf8').replace(
      '--color-accent: oklch(0.5 0.19 260);',
      '',
    );
    expect(checkThemes(loadThemes(css))).toContain('light theme does not override --color-accent');
  });
});

describe('bundle budget gate', () => {
  it('passes under budget and fails over budget', () => {
    expect(checkBudget({ jsGzipKb: 100, cssGzipKb: 5 }, { jsGzipKb: 300, cssGzipKb: 40 })).toEqual(
      [],
    );
    expect(
      checkBudget({ jsGzipKb: 301, cssGzipKb: 5 }, { jsGzipKb: 300, cssGzipKb: 40 }),
    ).toHaveLength(1);
  });
});

describe('bundle shell split', () => {
  it('counts the scripts index.html names and the storage worker as the shell, the rest as lazy', () => {
    const files = [
      'dist/assets/index-abc.js',
      'dist/assets/storage.worker-def.js',
      'dist/assets/analysis.worker-ghi.js',
      'dist/assets/VideoWorkspace-jkl.js',
      'dist/assets/vendor-mno.js',
    ];
    const html =
      '<script type="module" src="/assets/index-abc.js"></script><link rel="modulepreload" href="/assets/vendor-mno.js">';
    const { shell, lazy } = splitShell(files, html);
    expect(shell).toEqual([
      'dist/assets/index-abc.js',
      'dist/assets/storage.worker-def.js',
      'dist/assets/vendor-mno.js',
    ]);
    expect(lazy).toEqual([
      'dist/assets/analysis.worker-ghi.js',
      'dist/assets/VideoWorkspace-jkl.js',
    ]);
  });
});
