# ADR-0010: Tooling and repository structure

- **Status:** Proposed. Final folder layout is presented in step 5 (2026-11-17)

## Versions checked on npm (2026-11-17)
React 19.3.1, Vite 8.3.8, Vitest 5.1.0, Tailwind 4.3.5, Playwright 1.65.1, ESLint 10.15, typescript-eslint 8.73, Zod 4.6.7,
Zustand 5.1.0, Immer 11.2.10, Mediabunny 1.66.0, PixiJS 8.23.0. All MIT, Apache-2.0 or MPL-2.0.

## Key finding: pin TypeScript 6.0, not 7
The npm `latest` TypeScript is **7.0.2**, but `typescript-eslint@8.73` declares peer support for `typescript >=4.8.4 <6.1.0`.
Using TS 7 today would break linting. **Pin TypeScript 6.0.x (6.0.3 is available)** and revisit when typescript-eslint supports 7.
Re-check at M0 before locking versions.

## Decisions
- **Package manager / monorepo:** pnpm workspaces. No Turborepo or Nx until build times demand it (avoids unnecessary dependencies).
- **Strict module boundaries**, enforced by tooling (dependency-cruiser or eslint-plugin-boundaries, both MIT) and not by convention. Planned packages:
  - `core`: document model, commands, history, timeline maths. Pure TypeScript, no DOM, no browser APIs.
  - `media-io`: container/codec access (Mediabunny, WebCodecs) behind interfaces.
  - `render`: `Renderer` interface and implementation.
  - `engine-image`, `engine-video`: editor logic on top of core, media-io and render.
  - `storage`: `FileAccess` and `ProjectStore` implementations.
  - `ui`: design-system components and theme.
  - `apps/web`: composition root, routes, panels.
  - Dependency direction: `apps/web` → engines/ui/storage → `core`. `core` depends on nothing. Browser-only APIs appear only in adapter packages.
- **Quality gates:** TypeScript `strict` (plus `noUncheckedIndexedAccess`), ESLint, Prettier, Vitest, Playwright, licence scan, bundle-size budget.
- **Git:** `main` is the source of truth, conventional commits, PR-based changes, GitHub Actions CI. Secrets and media never committed (`.gitignore`, fixture rules in ADR-0012).
- **Deployment:** static build artefact; hosting details deferred (the owner said not to worry yet).
