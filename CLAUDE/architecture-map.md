# Architecture map (quick reference)

## Packages (`packages/*`, scope `@media-studio/*`; app in `apps/web`)
| Package | Role | May import |
|---|---|---|
| core | Document model, schemas, commands, history, journal, time maths, errors. Pure TS | none |
| capabilities | Runtime probes and report | core |
| media-io | Probe, decode, encode, mux (WebCodecs + Mediabunny) | core, capabilities |
| render | Renderer interface, Pixi/WebGL2, blend and effect shaders | core, capabilities |
| storage | FileAccess, ProjectStore, OPFS/FSA, journal, archive | core, capabilities |
| engine-image | Layer ops, tools, selections, brush, image export | core, render, storage |
| engine-video | Timeline ops, playback, decode scheduling, audio, export orchestration | core, media-io, render, storage |
| ui | Design-system components (React Aria + tokens) | core |
| testing | Test utilities (dev only) | anything |

`apps/web` is the composition root. Enforced by `.dependency-cruiser.cjs` and `tools/eslint/policy.js`.

## Commands
`pnpm dev` | `pnpm check` (all gates) | `pnpm test` | `pnpm test:e2e` | `pnpm lint` | `pnpm typecheck` | `pnpm check:boundaries` | `pnpm check:licences` | `pnpm check:theme` | `pnpm check:size`

## Key files
- Tokens: `apps/web/src/styles/theme.css` (single source of colour/shape/motion).
- Security headers/CSP: `apps/web/security-headers.ts` (used by preview and e2e).
- Lint policy: `tools/eslint/policy.js`; licence policy: `scripts/licence-policy.json`.
- Requirements `docs/product/requirements.md`; roadmap `docs/engineering/roadmap.md`; ADRs `docs/adr/`.

## Spike findings that bind the design (details: `docs/research/spike-results.md`)
- Frame cache holds `ImageBitmap` copies, never long-held `VideoFrame`s (hardware decoder stalls near 8).
- JS heap is not a memory health metric; GPU-process memory grew in S7.
- Own blend shaders (Pixi overlay is inexact below full opacity); Pixi `useBackBuffer: true` for advanced blends.
- Normalised document (maps by id + order lists); Immer `autoFreeze` off in production; journal checkpoints.
- `OfflineAudioContext` and `performance.memory` are unavailable in workers.
- Probe write capacity at startup; do not trust `navigator.storage.estimate()`.
- Proxies mandatory for long-GOP, >1080p or software-decoded sources.
