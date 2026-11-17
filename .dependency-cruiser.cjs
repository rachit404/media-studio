/* Enforces the package graph from docs/engineering/repo-structure.md (ADR-0010). Run: pnpm check:boundaries */

/** Allowed workspace dependencies per package (a package may always use itself). */
const ALLOWED = {
  core: [],
  capabilities: ['core'],
  'media-io': ['core', 'capabilities'],
  render: ['core', 'capabilities'],
  storage: ['core', 'capabilities'],
  'engine-image': ['core', 'render', 'storage'],
  'engine-video': ['core', 'media-io', 'render', 'storage'],
  ui: ['core'],
  testing: [
    'core',
    'capabilities',
    'media-io',
    'render',
    'storage',
    'engine-image',
    'engine-video',
    'ui',
  ],
};

const boundaryRules = Object.entries(ALLOWED).map(([pkg, allowed]) => ({
  name: `boundary-${pkg}`,
  severity: 'error',
  comment: `packages/${pkg} may only depend on: ${[pkg, ...allowed].join(', ')}. It must never depend on apps/.`,
  from: { path: `^packages/${pkg}/` },
  to: { path: `^(packages/(?!(?:${[pkg, ...allowed].join('|')})/)|apps/)` },
}));

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...boundaryRules,
    {
      name: 'no-deep-package-imports',
      severity: 'error',
      comment:
        'Import other packages through their public entry point (index.ts), never their internals.',
      from: { path: '^(?:packages|apps)/([^/]+)/' },
      to: { path: '^packages/[^/]+/src/(?!index\\.tsx?$)', pathNot: '^packages/$1/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are not allowed.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-undeclared-dependencies',
      severity: 'error',
      comment: 'Every import must be declared in the importing package.json.',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'no-dev-dependencies-in-source',
      severity: 'error',
      comment: 'Shipped source must not import devDependencies.',
      from: {
        path: '^(?:packages|apps)/[^/]+/src',
        pathNot: '\\.(?:test|spec)\\.[jt]sx?$|^packages/testing/',
      },
      to: { dependencyTypes: ['npm-dev'], pathNot: '@types/' },
    },
    { name: 'not-to-unresolvable', severity: 'error', from: {}, to: { couldNotResolve: true } },
    {
      name: 'not-to-spikes',
      severity: 'error',
      comment: 'Spike code is throwaway and never imported.',
      from: {},
      to: { path: '^spikes/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|node_modules|coverage|spikes)/' },
    tsPreCompilationDeps: true,
    moduleSystems: ['es6', 'cjs'],
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
