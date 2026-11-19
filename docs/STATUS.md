# Project status

- **Last updated:** 2026-11-18
- **Phase:** Build phase started on the owner's instruction. Development follows the 10-step plan in [CLAUDE/plan.md](../CLAUDE/plan.md); integration branch is `claude-takeover` (`main` is frozen).
- **Step 1 (M0 Foundation): done.** Monorepo, strict tooling, CI, token theme, boundary/licence/theme-contrast/size/CSP gates and e2e are in place and green.
- **Step 2 (M1 App shell): done.** Capability probe and tiers, typed errors, diagnostics, shortcut registry with rebinding, React Aria UI kit, resizable workspace panels, settings, offline service worker, strict CSP; 65 unit/policy tests and 16 e2e tests (including axe in both themes). 
- **Step 3 (M2 Storage, project format, undo): done.** Normalised document with fractional-index ordering (undo/redo p95 under 1 ms and execute p95 2.5 ms on a 1,000-layer / 2,000-clip document, PERF-5), command history with coalescing, write-ahead journal with checkpoints and crash recovery, OPFS storage worker, project package with validation and migrations, `.msproj` archive export/import with zip-slip and zip-bomb limits, startup write probe, image import with thumbnails, project list, storage settings. 148 unit tests and 25 e2e tests. Known limit: files are copied into browser storage; in-place editing through the File System Access API arrives with video in step 6. 
- **Step 4 (M3 Image engine essentials): done.** Own WebGL2 compositor ([ADR-0020](adr/0020-custom-webgl2-compositor.md)), image document v2 with layers and adjustment layers (format migration v1 to v2), commands for layers and canvas crop/resize/rotate/flip (all undoable), interactive canvas with zoom and pan, export to PNG/JPEG/WebP with scale, quality and fill colour. Blend modes (normal, multiply, screen, overlay) and adjustments match the W3C/CPU reference within 2/255 in end-to-end pixel tests; PERF-1 baseline measured at 16.7 ms p50 / 16.9 ms p95 (display-limited 60 fps) for a 4096² canvas with ten layers. 211 unit tests and 44 e2e tests. Next: step 5 (M4 image editor tier 2).
- **Step 6 (M5 Video engine and timeline): done.** Time model, video document (format v5), import with probe/thumbnail/waveform, WebCodecs preview on the shared compositor with audio-clock playback, virtualised timeline with snapping and keyboard editing, and MP4 export verified with ffprobe. Decoder concurrency measured (16 at once on Iris Xe). Not built: proxies, worker-side preview decoding, stream-to-disk export, real-footage test (see roadmap M5). Next: step 7 (M6 video editor tier 2).
- **Step 9 (M8 Performance and hardening): done, with open items.** Worker crash recovery (storage and analysis workers replaced when they die, noticed through a held Web Lock), adaptive decoder limit, performance budgets in `pnpm test` ([perf-budgets.md](engineering/perf-budgets.md)), keyframe lookup 7 times faster, 4K export validated (0.33 to 0.37 times real time). Open: a 60-minute soak, a real Safari and Firefox pass, automatic proxy tuning (see roadmap M8). Next: step 10 (M9 production readiness).
- **Step 8 (M7 Export reliability): done.** MP4 and WebM with presets, frame rate, quality, sound bitrate and encoder choice, probed at runtime; check of the finished file; typed errors and failure-injection tests; stream to disk; long exports in parts that continue after a stop; time left; background tab; export speed 1.3 to 1.5 times real time at 1080p (see [m7-export-measurement.md](engineering/m7-export-measurement.md)). Next: step 9 (M8 performance and hardening).
- **Step 7 (M6 Video editor tier 2): done.** Slice A done: document format v6, clip position/scale/rotation/crop/opacity/colour, clip and track volume, fades and solo, shared by preview and export, with inspector controls. Slice B done: format v7 and transitions (cross-fade, dip to black/white, wipe, slide) in preview and export. Slice C done: format v8, text clips and SRT/VTT subtitle import (burned in on export). Slice D done: format v9 and constant clip speed 0.25 to 4 times in preview and export (pitch follows speed). Slice E done: format v10, markers, in/out points (export can be limited to them), J/K/L shuttle, master meter, scoped shortcuts. On-canvas transform handles are merged. Slice F done: keyframes (format v11) for position, scale, rotation, opacity and volume, with inspector and timeline diamonds, previous/next keyframe keys and handle drags that write keyframes. Acceptance checks done: preview and export sound agree within 1e-3 per sample (measured under 1e-4) and dropped frames on the 1080p reference project were at most 0.43% (limit 2%); the requirement-to-test table and three small test gaps are in [m6-acceptance.md](engineering/m6-acceptance.md). 122 end-to-end tests and 613 unit and policy tests pass. Next: step 8 (M7 export reliability).
- **Step 5 (M4 Image editor tier 2): done.** 16 GPU-verified blend modes, text and shape layers, levels / black & white / blur / sharpen, filter presets, layer duplicate/copy/paste/drag; then painting: paint layers on a tile store, brush and eraser, layer masks, clipping, rectangle/ellipse/lasso selections with add/subtract/intersect/feather/invert, selection to mask, durable pixel saving with crash recovery and archive support. Document format v4. 299 unit tests and 73 e2e tests. Not built: curves, SVG import, layer lock/groups, bundled fonts (see roadmap M4). Next: step 6 (M5 video engine and timeline).
- **Application code:** M0 shell only (a themed foundation page; no editor features yet). `spikes/` is throwaway and not part of the product.

## Process phases
| Phase | State |
|---|---|
| 1. Product discovery | Done |
| 2. Requirements and scope | Done: [PRD](product/PRD.md), [requirements](product/requirements.md) (draft for review) |
| 3. Technical research and decisions | Done: [ADRs 0001-0019](adr/README.md) (all Proposed), [spike results](research/spike-results.md) |
| 4. Documentation | Drafted (this folder); awaiting owner review |
| 5. Structure and roadmap | Drafted: [repo structure](engineering/repo-structure.md), [roadmap](engineering/roadmap.md); awaiting approval |
| 6. Build approval | Not given |

## Decisions confirmed by the owner
Web app only (extendable to desktop later); local-first/privacy-first; no backend or accounts; single-user; Chrome/Edge tier 1, Safari/Firefox best-effort, no mobile; hybrid FSA + OPFS storage with offline PWA; 1080p guaranteed, 4K best-effort via proxies; one app shell with image and video project types; prosumer audience; image editor tier 2; video editor tier 2; formats (assistant's call, accepted); React + Tailwind (global theme) + TypeScript; GitHub as source of truth; defaults for AI/undo/UI/testing/licensing agreed; spikes approved.

## Decisions awaiting owner confirmation
These were decided provisionally by the assistant to keep the docs consistent. Please accept or change each.
| # | Decision | Where |
|---|---|---|
| 1 | React Aria Components for accessible primitives (validated by an M1 spike) | [ADR-0013](adr/0013-ui-primitives-react-aria.md) |
| 2 | Timeline: virtualised DOM clips + canvas waveforms + imperative playhead | [ADR-0014](adr/0014-timeline-ui-rendering.md) |
| 3 | Raster history through tile deltas | [ADR-0015](adr/0015-raster-history-tile-deltas.md) |
| 4 | Project = folder package + optional ZIP `.msproj` archive | [ADR-0016](adr/0016-project-container-format.md) |
| 5 | 8-bit sRGB only in v1 | [ADR-0017](adr/0017-colour-management.md) |
| 6 | AI: interface only in v1; no generative features planned | [ADR-0018](adr/0018-ai-module-boundary.md) |
| 7 | Own code licensed Apache-2.0 | [ADR-0019](adr/0019-project-licence.md) |
| 8 | Pin TypeScript 6.0.x (7.x breaks typescript-eslint) | [ADR-0010](adr/0010-tooling-and-repo-structure.md) |
| 9 | Persistence milestone moved before the editors (M2) | [roadmap](engineering/roadmap.md) |
| 10 | Spike code archived to a git tag and removed from `main` | [repo structure](engineering/repo-structure.md) |
| 11 | Pitch changes with speed in v1 (pitch-preserving needs LGPL/GPL libraries or custom code) | [video editor](architecture/video-editor.md) |

## Open items and risks (from the spikes)
- Real File System Access path not verified: owner to run `spikes/s2-storage/manual-fsa.html`.
- GPU-process memory growth in long playback: the 30-minute soak (S9) shows it grows about 43 MB per minute on Iris Xe (shared system memory), slowing (59, 52, then 23 MB per minute per 10 minutes) but not plateaued; JS side is flat and nothing crashed. Cause unknown; 60-minute run and isolation runs in M8 ([s9-soak.md](../spikes/results/s9-soak.md)).
- ~~Concurrent hardware decoder limit unknown~~: measured in S8, 16 decoders ran together on Iris Xe.
- Pixi overlay blend inexact; all other blend modes untested: own blend shaders in M3/M4.
- Undo latency on structural edits near 80 ms: normalised data model + re-measure in M2.
- Linux/GitHub-runner codec support unverified: probe command in `spikes/results/s6-probe.md`.
- Spike footage was synthetic; Safari/Firefox untested.

## Information still needed from the owner
- Weekly time available (roadmap sizes are relative until then).
- Product name check and copyright holder name for LICENSE (M0).
- Domain/hosting: deferred by request.

## Next actions
1. Owner reviews docs, answers the confirmation table, runs the manual FSA test.
2. Assistant revises docs and moves ADRs from Proposed to Accepted.
3. Owner explicitly approves starting M0.
