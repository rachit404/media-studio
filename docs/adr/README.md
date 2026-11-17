# Architecture Decision Records

All ADRs are **Proposed** drafts (2026-11-17). They become **Accepted** when the owner approves them. Each lists alternatives, licences, limits and sources;
ADRs 0003-0007 and 0012 also carry a "Spike findings" section from the [spike results](../research/spike-results.md).

| ADR | Decision | Spike |
|---|---|---|
| [0001](0001-web-first-platform.md) | Web-first app with swappable `MediaEngine` | n/a |
| [0002](0002-browser-support-tiers.md) | Tier 1 Chrome/Edge; tier 2 Safari/Firefox; runtime capability probing | n/a |
| [0003](0003-video-io-and-codec-stack.md) | WebCodecs + Mediabunny; no GPL ffmpeg.wasm; proxies mandatory for long-GOP/software decode | S1, S4: pass |
| [0004](0004-rendering-stack.md) | PixiJS v8 (WebGL2) behind `Renderer`; own blend shaders; fallback custom WebGL2 not triggered | S3: speed pass, overlay blend fail |
| [0005](0005-storage-and-project-persistence.md) | Hybrid File System Access + OPFS; startup write probe | S2: OPFS pass, FSA manual pending |
| [0006](0006-document-state-and-undo-redo.md) | Immutable normalised document + command patches (Immer); Zustand for UI only | S5: inconclusive, needs changes |
| [0007](0007-concurrency-and-export-pipeline.md) | Separate preview/export paths; workers; frame cache of copies; offline audio mix on page thread | S4, S7: pass with concerns |
| [0008](0008-image-codecs-and-processing.md) | Native image codecs in v1; jSquash later for AVIF | n/a |
| [0009](0009-ui-stack-and-theming.md) | React + Tailwind v4 semantic tokens | n/a |
| [0010](0010-tooling-and-repo-structure.md) | pnpm workspaces, enforced boundaries, **pin TypeScript 6.0** | n/a |
| [0011](0011-dependency-licence-policy.md) | Permissive licences only in the shipped app | n/a |
| [0012](0012-testing-media-features-in-ci.md) | Unit-heavy tests, WebGL2 in CI, codec tests where proven | S6: local only |
| [0013](0013-ui-primitives-react-aria.md) | React Aria Components for accessible primitives (provisional, M1 spike) | n/a |
| [0014](0014-timeline-ui-rendering.md) | Virtualised DOM timeline + canvas waveforms + imperative playhead | M5 validate |
| [0015](0015-raster-history-tile-deltas.md) | Raster undo via tile deltas | M4 validate |
| [0016](0016-project-container-format.md) | Project folder package + optional ZIP archive | M2 |
| [0017](0017-colour-management.md) | 8-bit sRGB only in v1 | n/a |
| [0018](0018-ai-module-boundary.md) | Optional AI behind provider interfaces, lazy, local | n/a |
| [0019](0019-project-licence.md) | Apache-2.0 for first-party code | n/a |

Spike plan: [feasibility-spikes.md](../research/feasibility-spikes.md). Open items are tracked in [STATUS.md](../STATUS.md).
