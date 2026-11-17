// Project-specific lint policy (security, module boundaries, theming). Shared by eslint.config.js and the
// policy tests so the tests exercise exactly what CI enforces. Rationale: docs/engineering/repo-structure.md,
// docs/architecture/security-privacy.md, ADR-0009, ADR-0010.
import noRawColors from '../eslint-rules/no-raw-colors.js';

const ADAPTERS =
  'Allowed only in adapter packages (media-io, render, storage, capabilities) and app worker entry points.';

const MEDIA_GLOBAL_NAMES = [
  'VideoDecoder',
  'VideoEncoder',
  'AudioDecoder',
  'AudioEncoder',
  'VideoFrame',
  'AudioData',
  'ImageDecoder',
  'OffscreenCanvas',
  'AudioContext',
  'OfflineAudioContext',
  'AudioWorkletNode',
  'MediaRecorder',
  'FileSystemFileHandle',
  'FileSystemDirectoryHandle',
  'FileSystemSyncAccessHandle',
  'WebGL2RenderingContext',
  'GPUDevice',
];

const DOM_GLOBAL_NAMES = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'SharedWorker',
  'self',
  'location',
  'history',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'alert',
  'confirm',
  'prompt',
  'Image',
  'HTMLElement',
];

export const MEDIA_GLOBALS = MEDIA_GLOBAL_NAMES.map((name) => ({
  name,
  message: `${name}: ${ADAPTERS}`,
}));
export const DOM_GLOBALS = DOM_GLOBAL_NAMES.map((name) => ({
  name,
  message: `${name}: the core package is pure TypeScript with no DOM or browser APIs.`,
}));

export const MEDIA_PROPERTIES = [
  ...['storage', 'gpu', 'mediaDevices'].map((property) => ({
    object: 'navigator',
    property,
    message: ADAPTERS,
  })),
  ...['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker'].flatMap((property) =>
    ['window', 'self'].map((object) => ({ object, property, message: ADAPTERS })),
  ),
];

const SECURITY_SYNTAX = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML is forbidden (SEC-3). Render data as text.',
  },
  {
    selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
    message: 'Assigning innerHTML/outerHTML is forbidden (SEC-3).',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'insertAdjacentHTML is forbidden (SEC-3).',
  },
  {
    selector: "CallExpression[callee.object.name='document'][callee.property.name='write']",
    message: 'document.write is forbidden (SEC-3).',
  },
];

const SOURCE_FILES = ['apps/*/src/**/*.{ts,tsx,js,jsx}', 'packages/*/src/**/*.{ts,tsx,js,jsx}'];

/** Flat-config objects. All globs are relative to the repository root. */
export const policyConfigs = [
  {
    name: 'ms/security',
    files: SOURCE_FILES,
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-restricted-syntax': ['error', ...SECURITY_SYNTAX],
    },
  },
  {
    name: 'ms/boundary-core',
    files: ['packages/core/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-globals': ['error', ...DOM_GLOBALS, ...MEDIA_GLOBALS],
      'no-restricted-properties': ['error', ...MEDIA_PROPERTIES],
    },
  },
  {
    name: 'ms/boundary-no-media-apis',
    files: [
      'packages/engine-image/**/*.{ts,tsx}',
      'packages/engine-video/**/*.{ts,tsx}',
      'packages/ui/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-globals': ['error', ...MEDIA_GLOBALS],
      'no-restricted-properties': ['error', ...MEDIA_PROPERTIES],
    },
  },
  {
    name: 'ms/theme-tokens-only',
    files: ['apps/web/src/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    plugins: { ms: { rules: { 'no-raw-colors': noRawColors } } },
    rules: { 'ms/no-raw-colors': 'error' },
  },
];
