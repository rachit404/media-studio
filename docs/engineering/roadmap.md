# Development roadmap

- **Status:** Draft for owner review (2026-11-17). Implementation does not start until the owner explicitly approves.
- **Related:** [requirements](../product/requirements.md), [repo structure](repo-structure.md), [testing strategy](testing-strategy.md), [spike results](../research/spike-results.md)
- **Sizing:** S ≈ 1 week, M ≈ 2 weeks, L ≈ 3-4 weeks, XL ≈ 5-6 weeks of focused solo work. Calendar dates depend on the owner's weekly hours (not yet given).

## How milestones work
- One milestone at a time, each independently testable and demoable. No unrelated milestones in parallel.
- A milestone is **done** only when every acceptance criterion passes, tests are green in CI, docs are updated, known limitations are written down, and the owner has seen a demo.
- Each milestone ends with a short status update in [STATUS.md](../STATUS.md) and any needed ADR updates.

## Order and why it differs from the initial list
| # | Milestone | Size | Change vs. original priority list |
|---|---|---|---|
| M0 | Foundation | S | same |
| M1 | App shell and workspace | M | same |
| M2 | Storage, project format, undo core | L | **Moved up** from "5. Project management" because both editors depend on it and the spikes showed the document shape must be right before engines are built (S5) |
| M3 | Image engine and essential workflows | L | same (image before video) |
| M4 | Image editor, tier 2 | L | split from M3 to keep each milestone testable |
| M5 | Video engine and timeline core | XL | includes a thin end-to-end export and three risk spikes |
| M6 | Video editor, tier 2 | L | |
| M7 | Export and rendering reliability | M | A thin export exists from M3/M5; M7 makes it production-grade |
| M8 | Performance and hardening | M | |
| M9 | Production readiness (v1.0) | M | |
| M10+ | Post-v1: AI plugins, desktop wrapper, extras | - | Optional, after v1.0 |

## Pre-M0 gate (before any application code)
1. Owner approves the docs and ADRs (this document set).
2. Owner runs the manual File System Access test (`spikes/s2-storage/manual-fsa.html`) and shares the outcome.
3. Owner confirms the provisional decisions listed in [STATUS.md](../STATUS.md#decisions-awaiting-owner-confirmation).
4. Spike code is archived to a git tag and removed from `main`; spike results stay in `docs/research/`.

---

## M0: Foundation (S)
**Status: done** (branch `feat/m0-foundation`). Acceptance verified by negative tests: boundary violations, raw colours, `eval`, GPL dependencies and low-contrast tokens all fail the gates; the production build runs under the real CSP with no external requests. CI on GitHub still needs branch protection configured by the owner.
**Scope:** repository, tooling, CI, quality gates, theme token skeleton. No product features.
**Files/modules:** root config, `.github/`, `apps/web` (empty shell), `packages/*` (empty with boundaries), `scripts/`, `docs/third-party.md`, README, LICENSE (Apache-2.0), CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, `.gitignore`, `.editorconfig`.
**Implementation plan:**
1. pnpm workspace; TypeScript **6.0.x** strict (+ `noUncheckedIndexedAccess`); Vite 8; React 19; Tailwind 4 with `theme.css` tokens (dark/light).
2. ESLint 10 + typescript-eslint, Prettier, lint rules: no `eval`, no raw colour classes, no browser APIs outside adapter packages, no `any` without comment.
3. dependency-cruiser (or eslint-plugin-boundaries) enforcing the package graph in [repo structure](repo-structure.md).
4. Vitest + Playwright (Chromium; Firefox/WebKit smoke later); licence scanner and vulnerability audit; bundle-size budget; no-network test skeleton.
5. GitHub Actions: lint, typecheck, unit, build, e2e, licence/audit; branch protection on `main`; conventional commits check; PR/issue templates.
6. README with architecture overview and links; `docs/third-party.md` bootstrap; STATUS updated.
**Acceptance criteria:** CI green on `main` with an empty page; a deliberate boundary violation fails CI; a raw-colour class fails lint; a GPL test dependency fails the licence scan; switching `data-theme` changes tokens app-wide; production build passes the size budget and loads with the target CSP without violations.
**Tests:** CI self-tests (negative cases above), a smoke e2e test, token contrast check script.
**Known limitations:** no features; deployment pipeline only produces an artefact.

## M1: App shell and workspace (M)
**Status: done** (branch `feat/m1-app-shell`). Delivered: capability probe and tiers, typed errors, diagnostics log, shortcut registry with rebinding and conflict detection, accessible UI kit (React Aria Components), resizable and collapsible workspace panels, settings (appearance, shortcuts, diagnostics), offline service worker, strict CSP. All verified in 16 e2e tests including axe checks in both themes. Not done here: a Render Worker preview spike (moved to step 4 where the renderer exists), PWA install icons (PNG, step 10) and the in-app update prompt (step 10).
**Scope:** capability probing and fallbacks, shell layout, theming, command and shortcut system, settings, error and diagnostics foundations, accessible UI kit core, PWA shell, home screen skeleton.
**Files/modules:** `capabilities`, `ui`, `core/errors`, `apps/web` (shell, routes, home, settings), diagnostics log.
**Implementation plan:**
1. Capability probe module (codecs hardware/software, WebGL2, OPFS, pickers, write probe stub) with typed report; unsupported/tier-2 notices.
2. Layout with resizable/collapsible panels; light/dark theme persistence; routes for Home / Image / Video.
3. Command registry + shortcut manager with conflict detection and shortcut reference.
4. UI kit: Button, Menu, Dialog, Tabs, Slider, NumberField, Tooltip, Toast, Panel (React Aria Components, [ADR-0013](../adr/0013-ui-primitives-react-aria.md)).
5. Typed error taxonomy; local diagnostics ring buffer and viewer.
6. Service worker + manifest (offline app shell).
7. **Spike:** Pixi interactive preview inside a Render Worker (OffscreenCanvas) vs main-thread fallback; decision recorded.
**Acceptance:** PLAT-1 to PLAT-6, UX-1, A11Y-1/2 for the kit, SEC-2 (CSP with the production build); tier-3 browser sees the explanation page; shortcuts rebind and persist; offline reload works.
**Tests:** unit (shortcut resolution, capability logic with mocked APIs), component tests with axe, e2e (theme, layout, shortcuts, offline), CSP/no-network checks.
**Known limitations:** no project or editing features yet; capability results for Safari/Firefox come from manual checks.

## M2: Storage, project format, undo core (L)
**Status: done** (branch `feat/m2-storage-project`). Delivered as designed except: (1) files are always copied into OPFS; referencing originals in place via the File System Access API (PROJ-5, Chromium) moves to step 6 (M5), where large video files make it matter; (2) the persisted-handle and relink flow (ASSET-6) moves with it; (3) SVG import moves to step 4 with the renderer. PERF-5 re-measured on the normalised model: execute p95 2.5 ms / max 5.8 ms, undo and redo p95 under 1 ms / max 1.2 ms (spike S5 had structural undo at up to 79 ms). Zod runs without JIT so the strict CSP never sees an eval attempt.
**Scope:** everything needed to create, edit, persist and recover a project, independent of any editor.
**Files/modules:** `storage`, `core` (document base types, schemas, migrations, commands, history, journal), `capabilities` (write probe), home screen project list, asset ingest for images.
**Implementation plan:**
1. `FileAccess` (FSA + fallback) and `ProjectStore` (OPFS + FSA-backed) with the storage worker (sync handles, single writer).
2. Project package ([project format](../architecture/project-format.md)), Zod schemas v1, migration framework with backups.
3. Command/history engine on Immer patches with **normalised data**, `autoFreeze` off in production, coalescing, journal append, checkpoints, crash recovery.
4. Archive export/import with zip-slip and size limits; relink flow; recent projects; clear-all-data and storage usage.
5. Image asset import (picker, drag-drop, clipboard paste), thumbnails.
6. **Re-run S5** on the normalised model on an idle machine; record in `docs/research`.
**Acceptance:** PROJ-1 to PROJ-6, ASSET-1/2/4/6 (images), PLAT-7, REL-1/2/5, PERF-5 (undo/redo under 50 ms for all structural commands at 1,000 layers/2,000 clips, p95 and max); recovery test passes after forced tab kill.
**Tests:** property-based command round trips; migration fixtures; journal replay equals live state; fuzzed project/archive inputs; e2e kill-and-recover; storage fallback tests.
**Known limitations:** FSA path verified only on Chromium; ZIP library choice may change; quota behaviour in other browsers untested.

## M3: Image engine and essential workflows (L)
**Status: done** (branch `feat/m3-image-engine`). Differences from the plan: the renderer is our own WebGL2 compositor, not PixiJS (ADR-0020); layers are a flat stack (groups arrive with masks in M4); SVG import and layer locking move to M4; the Render Worker preview spike is not needed because interactive rendering is on-demand on the main thread (export runs on an OffscreenCanvas). PERF-1 baseline: 4096² canvas, ten layers (nine at 2048²) with overlay/multiply blends, 240 frames of zoom: p50 16.7 ms, p95 16.9 ms, max 17.0 ms on Intel Iris Xe (vsync-bound).
**Scope:** an image can be opened, transformed, adjusted and exported, end to end, on a correct GPU renderer.
**Files/modules:** `render` (Renderer interface, Pixi/WebGL2 impl, blend shader framework), `engine-image` (layer tree, tools: move/transform, crop, resize, rotate, flip), `apps/web` image workspace, tile store.
**Implementation plan:**
1. Renderer interface and Pixi implementation; scene reconciliation; tiled raster layers; viewport pan/zoom; on-demand rendering.
2. Own blend shader framework: normal, multiply, screen, overlay first, tested against W3C formulas.
3. Layer panel basics; image layers with non-destructive transform; crop/resize/rotate/flip commands.
4. Adjustment layers (exposure, brightness/contrast, saturation) as group-scoped effects.
5. Export JPEG/PNG/WebP with quality, scale, background, metadata strip.
**Acceptance:** IMG-1, IMG-2, IMG-3 (basic), IMG-4, IMG-13; implemented blend modes within 2/255; PERF-1 baseline met on the reference document; undo/redo works for every command.
**Tests:** golden images per blend mode/adjustment; unit tests for transforms and tile logic; e2e open → edit → export → pixel compare; export metadata test.
**Known limitations:** limited tools and blend set; large-document limits measured not yet enforced.

## M4: Image editor, tier 2 (L)
**Scope:** complete the v1 image feature set.
**Files/modules:** `engine-image` (masks, selections, brush, text, shapes), `render` (all blend modes, effects), `ui` (colour picker, layer tree), fonts.
**Implementation plan:** masks and clipping; all blend modes with golden tests; selections (rect/ellipse/lasso, algebra, feather) and marching-ants overlay; brush/eraser with tile-delta history ([ADR-0015](../adr/0015-raster-history-tile-deltas.md)); text layers and bundled fonts; shape layers; levels/curves/B&W/blur/sharpen; filter presets; clipboard and drag-drop; shortcuts.
**Acceptance:** IMG-3 to IMG-13, UX-2, UX-3; every blend mode ≤ 2/255 vs reference; brush stroke undo restores exact pixels; PERF-1 on the reference document.
**Tests:** selection algebra properties; brush determinism; blend and adjustment goldens; history memory growth test (many strokes); a11y checks on new panels.
**Known limitations:** no magic wand, no ICC, text rasterised, 8-bit sRGB.

## M5: Video engine and timeline core (XL)
**Scope:** import, play, scrub, cut and export a basic video project on one or two tracks.
**Files/modules:** `media-io`, `engine-video` (time model, timeline ops, playback, decode scheduler, frame cache, proxy manager), `render` (video texture path), timeline UI, analysis worker.
**Implementation plan:**
1. Video probe and import; thumbnails; waveform peaks; proxy rules and generation.
2. Decode scheduler with GOP-aware seek, frame cache of copies, audio-clock playback engine.
3. Timeline model and operations (split, trim, move, ripple, snap) with property tests; virtualised timeline UI ([ADR-0014](../adr/0014-timeline-ui-rendering.md)).
4. Basic compositor (clip + one overlay), preview quality levels.
5. **Thin export tracer:** timeline → MP4 (H.264/AAC) via the export worker.
6. **Risk spikes (gate to proceed):** (a) concurrent hardware decoder limit on Iris Xe; (b) 30-minute playback/scrub soak with process-wide memory sampling to resolve the GPU-memory-growth concern from S7; (c) real (non-synthetic) footage set.
**Acceptance:** VID-1, VID-2, VID-3 (two tracks), VID-4, VID-5, ASSET-3/4/5, PERF-2/3/7/8; soak shows plateau or documented limits; thin export produces a verified MP4.
**Tests:** time-conversion and timeline-op properties; decode/seek accuracy fixtures; frame-leak counters; A/V sync test; export round-trip.
**Known limitations:** limited effects; decoder concurrency cap may reduce overlay count; HEVC/AV1 depend on browser.

## M6: Video editor, tier 2 (L)
**Scope:** the v1 video feature set.
**Files/modules:** `engine-video` (multi-track, transitions, speed, text/subtitles, audio engine, keyframes), `render` (transition/effect shaders), timeline and inspector UI.
**Implementation plan:** multi-track overlays/PiP; transitions with handles; constant speed; text clips and SRT/VTT import; audio volume/fades/mute/solo/meter and offline-mix parity; basic colour; keyframe model with minimal UI; markers, in/out; J/K/L shuttle; shortcuts.
**Acceptance:** VID-3 to VID-13; preview vs export audio mix parity within tolerance; dropped frames under 2% on the reference project.
**Tests:** transition overlap and keyframe properties; subtitle parsing fuzz/fixtures; audio mix golden (RMS/peak comparison); e2e editing scenarios with undo/redo.
**Known limitations:** pitch shifts with speed; keyframe UI minimal; no nested sequences.

## M7: Export and rendering reliability (M)
**Scope:** production-grade export for both editors.
**Files/modules:** export worker, `media-io`, `storage` (stream-to-disk), export dialog, error taxonomy wiring.
**Implementation plan:** presets and advanced settings; hardware/software/VP9 selection with warnings; segmented, resumable export; stream-to-disk and Blob fallback with size warning; verification step; cancel/clean-up hardening; background-tab behaviour measured and mitigated; image export polish.
**Acceptance:** EXP-1 to EXP-7, REL-3, PERF-4; forced failures at each stage produce the right typed error and no leftovers; exported files verified for duration/frames/resolution/audio.
**Tests:** failure injection (encoder error, quota, write error, cancel at every stage), resume tests, round-trip verification, metadata stripping, large-export memory test.
**Known limitations:** hardware encode paths other than Intel QSV unverified locally; Safari/Firefox export capabilities vary.

## M8: Performance and hardening (M)
**Scope:** meet budgets with margin and survive abuse.
**Files/modules:** all engines, workers supervision, diagnostics, CI perf jobs.
**Implementation plan:** profile and optimise on Iris Xe; process-wide memory guards and adaptive cache sizing; automatic proxy tuning; large-document tiling limits and warnings; worker crash recovery; performance budgets in CI; bundle-size and lazy loading; 4K best-effort validation; tier-2 browser pass (Safari, Firefox).
**Acceptance:** PERF-1 to PERF-8 on the reference projects; no unbounded growth in a 60-minute soak; worker-kill tests recover; tier-2 limitations documented in-app.
**Tests:** perf benchmarks with thresholds, soak and chaos tests, memory-budget tests.
**Known limitations:** results are for the measured hardware; other GPUs rely on probes.

## M9: Production readiness, v1.0 (M)
**Scope:** release quality.
**Files/modules:** docs, CI/CD, accessibility fixes, security hardening.
**Implementation plan:** accessibility audit and fixes; CSP/headers validation; offline PWA update flow; error and empty-state polish; user guide; third-party notices and licence audit; release process and changelog; demo project and walkthrough video; manual release checklist (hardware encode, FSA, Safari/Firefox).
**Acceptance:** all "M" requirements pass; SEC-1 to SEC-6; A11Y-1 to A11Y-3; no open high-severity bugs; release checklist signed off; v1.0 tag and public demo.
**Tests:** full regression, accessibility suite, no-network and header tests, manual checklist.
**Known limitations:** items listed in the PRD's post-v1 section.

## Post-v1 candidates
AVIF/GIF export, MKV/HEIC import, templates, magic wand, pitch-preserving speed, curve editor, AI plugin modules ([ADR-0018](../adr/0018-ai-module-boundary.md)), desktop wrapper with native engine.
