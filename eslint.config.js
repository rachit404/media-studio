import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { policyConfigs } from './tools/eslint/policy.js';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'spikes/**',
      'docs/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  js.configs.recommended,

  // Type-aware rules for TypeScript.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 10 },
      ],
    },
  },

  // Plain JavaScript: tooling, scripts and public assets.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  { files: ['apps/web/public/**/*.js'], languageOptions: { globals: { ...globals.browser } } },

  // React.
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    ignores: ['packages/core/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  { files: ['e2e/**/*.ts', 'apps/web/*.ts'], languageOptions: { globals: { ...globals.node } } },

  // Project policy: security, module boundaries, theme tokens.
  ...policyConfigs,
);
