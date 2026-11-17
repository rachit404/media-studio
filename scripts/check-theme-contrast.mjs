// Verifies WCAG contrast for the design tokens in apps/web/src/styles/theme.css, in both themes.
// Tokens are OKLCH. Run: pnpm check:theme
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const THEME_FILE = resolve(root, 'apps/web/src/styles/theme.css');

export const REQUIRED_LIGHT_OVERRIDES = [
  'surface',
  'surface-raised',
  'surface-sunken',
  'line',
  'line-strong',
  'fg',
  'fg-muted',
  'accent',
  'on-accent',
];

/** Text must reach 4.5:1, graphical objects and control borders 3:1 (WCAG 2.2 AA). */
export const PAIRS = [
  ...['surface', 'surface-raised', 'surface-sunken'].flatMap((bg) => [
    { fg: 'fg', bg, min: 4.5 },
    { fg: 'fg-muted', bg, min: 4.5 },
    { fg: 'accent', bg, min: 4.5 },
    { fg: 'success', bg, min: 4.5 },
    { fg: 'warning', bg, min: 4.5 },
    { fg: 'danger', bg, min: 4.5 },
    { fg: 'line-strong', bg, min: 3 },
    { fg: 'ring', bg, min: 3 },
  ]),
  { fg: 'on-accent', bg: 'accent', min: 4.5 },
  { fg: 'fg', bg: 'selection', min: 4.5 },
  { fg: 'fg-muted', bg: 'selection', min: 4.5 },
  { fg: 'fg', bg: 'canvas', min: 4.5 },
  { fg: 'track-video', bg: 'surface-sunken', min: 3 },
  { fg: 'track-audio', bg: 'surface-sunken', min: 3 },
];

/** @param {string} css @param {string} marker returns the text of the first {...} block after marker */
export function extractBlock(css, marker) {
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`Block not found: ${marker}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`Unclosed block: ${marker}`);
}

/** @param {string} block @returns {Record<string,{l:number,c:number,h:number}>} */
export function parseColours(block) {
  const colours = {};
  for (const m of block.matchAll(
    /--color-([a-z-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g,
  )) {
    colours[m[1]] = { l: Number(m[2]), c: Number(m[3]), h: Number(m[4]) };
  }
  return colours;
}

/** OKLCH to linear sRGB (clipped) to relative luminance. */
export function luminance({ l, c, h }) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (v) => Math.min(1, Math.max(0, v));
  const r = clip(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
  const g = clip(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
  const bl = clip(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** @param {string} css returns { dark, light } complete token maps (light = dark overridden by the light block) */
export function loadThemes(css) {
  const dark = parseColours(extractBlock(css, '@theme static'));
  const lightOverrides = parseColours(extractBlock(css, ":root[data-theme='light']"));
  return { dark, light: { ...dark, ...lightOverrides }, lightOverrides };
}

/** @returns {string[]} human-readable failures */
export function checkThemes({ dark, light, lightOverrides }) {
  const failures = [];
  // Surface, text and accent tokens must be defined for both themes; the rest may be inherited.
  for (const name of REQUIRED_LIGHT_OVERRIDES) {
    if (!(name in lightOverrides)) failures.push(`light theme does not override --color-${name}`);
  }
  for (const [themeName, theme] of [
    ['dark', dark],
    ['light', light],
  ]) {
    for (const pair of PAIRS) {
      const fg = theme[pair.fg];
      const bg = theme[pair.bg];
      if (!fg || !bg) {
        failures.push(`${themeName}: missing token for pair ${pair.fg} on ${pair.bg}`);
        continue;
      }
      const ratio = contrastRatio(fg, bg);
      if (ratio < pair.min) {
        failures.push(
          `${themeName}: ${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)}:1 (needs ${pair.min}:1)`,
        );
      }
    }
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const themes = loadThemes(readFileSync(THEME_FILE, 'utf8'));
  const failures = checkThemes(themes);
  if (failures.length > 0) {
    console.error('Theme contrast failures:');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`Theme contrast: OK (${PAIRS.length} pairs x 2 themes)`);
}
