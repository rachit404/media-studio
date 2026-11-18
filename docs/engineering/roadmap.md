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
**Status: done** (branches `feat/m4-image-editor` for the first part and `feat/m4b-painting` for painting). Document format is now v4.
**Delivered:**
- All 16 W3C blend modes (CPU reference plus GPU shader, GPU within 2/255 for every mode at two opacities); text layers and shape layers (rectangle, ellipse, polygon, line) drawn from parameters; levels, black & white, blur and sharpen adjustment layers; five filter presets as editable adjustment stacks; duplicate, copy, paste and delete of layers; reorder by dragging; drag from the asset library onto the canvas.
- Paint layers: sparse 256 x 256 tiles of straight-alpha RGBA ([ADR-0015](../adr/0015-raster-history-tile-deltas.md)); brush and eraser with size, hardness, opacity, flow and pen pressure; each stroke is one undo step that restores the exact earlier pixels.
- Layer masks on any layer (painted with the same brush: brush reveals, eraser hides), enable/disable/delete; clipping to the layer below.
- Selections: rectangle, ellipse and lasso; new/add/subtract/intersect (also Shift/Alt); select all, deselect, invert, feather; "selection to layer mask"; marching-ants outline. Painting is limited to the selection.
- Painted pixels are saved as tile files plus a manifest per version (`tiles/`, `pixels/`), written before the journal record that refers to them, restored after a crash, and included in `.msproj` archives.
**Measurements:** brush cost per pointer move on a 4096 x 4096 layer (pointer moves 10 px apart, hardness 0.7): 1.0 ms at 20 px, 3.9 ms at 100 px, 10.6 ms at 300 px. Memory for undo grows with the area touched, not the surface size (test: identical bytes for 512 px and 8192 px surfaces after 100 strokes in one tile). PERF-1 baseline unchanged.
**Deviations and known limitations:**
- Only the generic font families (sans-serif, serif, monospace) are offered; no font files are bundled, so text looks different per operating system. Curves, SVG import, layer locking and layer groups are not implemented.
- A paint layer is as large as the canvas when it is created and moves, scales and rotates like an image layer; strokes outside its bounds are clipped. Canvas resize scales the pixels (they are not resampled).
- A layer mask lives in the layer's own pixel space, so it follows the layer. If a text or shape layer later changes size, its mask keeps its old pixel grid.
- The selection is working state: it is not saved with the project and is not part of undo (use Deselect or select again). It is cleared when the canvas size changes (crop, resize, rotate) but not by a flip, which leaves an old selection mirrored from the picture.
- Undo history keeps every tile version in memory (shared between versions) until the project is closed; old tile files stay on disk until the project is deleted. Spilling cold versions and collecting unused files are not built yet.
- Pasting a layer only works inside the same project. Pen pressure scales size and flow but has not been tested with a real tablet.
**Acceptance:** IMG-3 to IMG-13 and UX-2, UX-3 are met except where listed above (groups, lock, curves, SVG, bundled fonts); every blend mode within 2/255; brush stroke undo restores exact pixels (end-to-end test compares whole images).
**Tests:** selection algebra properties, brush determinism and memory growth, tile store, manifest and archive round trips, durable-before-journal ordering, blend and adjustment references, end-to-end painting/selection/mask/clip tests, accessibility checks on the new panels in both themes.

## M5: Video engine and timeline core (XL)
**Status: done** (branch `feat/m5-video-engine`). Document format is now v5. Proxy generation and the long soak have documented outcomes below instead of full features.
**Delivered:**
- Time model in integer microseconds with frame, sample and timecode conversions (29.97 and 23.976 do not drift; round trip proven for every frame in tests).
- Video document: a sequence (size, frame rate, sample rate) with video and audio tracks and clips; the picture and sound of one file are linked clips. Commands: add to timeline, move (also between tracks), trim either edge (optionally rippling), split, join, delete and ripple delete, unlink, track mute/lock/add/remove. A property test with random edits proves the timeline never overlaps and that undo/redo is exact.
- Import: probe (container, codecs, size, frame rate, keyframe interval, audio facts), preview picture, waveform peaks, original copied into project storage in chunks (nothing is loaded whole). Clear errors for damaged files and for codecs the browser cannot decode.
- Preview: pictures decoded by WebCodecs through Mediabunny, read ahead per clip, uploaded to the same WebGL compositor as the image editor, letterboxed in the sequence frame; sound scheduled on the Web Audio clock, which is also the master clock for the picture (the picture never slows the sound, late frames are skipped and counted). Latest-wins seeking, frame stepping, play/pause, Home/End.
- Timeline: virtualised lanes, ruler, imperatively moved playhead, snapping (clip edges, playhead, start), drag to move and trim, waveform and thumbnail on clips, keyboard use (S split, Delete, Shift+Delete ripple, Alt+arrows nudge, [ and ] trim to playhead), numeric start and length fields, zoom and fit.
- Thin export: the whole timeline to MP4 (H.264 and AAC) in a worker, frame by frame and deterministic, with an offline audio mix, progress, cancel, and a download link. Checked in an end-to-end test with ffprobe: codec, size, exact frame count (125), duration, picture colour per clip, sound present then silent.
- The two editors are loaded on demand: the app shell is 200 KB gzip (budget 300); the editors and workers load when needed and are warmed while idle so they work offline.
**Measurements (this machine: Intel Iris Xe, Chrome):**
- Concurrent decoders (spike S8, 1080p30 H.264, 3 s runs): 1 to 16 decoders all worked, hardware and software. Aggregate about 850 to 1,000 fps; each of 8 decoders ran at 112 fps and each of 16 at 64 fps, still above real time. The preview keeps a cap of 4 decoders (memory, not the decoder limit, is the reason).
- Soak (spike S9): see [spikes/results/s9-soak.md](../../spikes/results/s9-soak.md).
- Export of a 5 s, 320 x 240 sequence takes a few seconds including start-up; the frame count matched exactly.
**Deviations and known limitations:**
- **No proxies yet.** Long-GOP and above-1080p sources decode directly; seeking in a 10 s-GOP file is slow (S1: p95 315 ms). Proxy generation and automatic switching move to M8 (performance). The probe already records the keyframe interval for that decision.
- No real-footage spike: only generated clips were used. A real clip set from the owner is still needed to confirm.
- Decoding for the preview runs on the main thread (WebCodecs decodes off-thread, but demuxing and bitmap copies do not). Moving it to a worker is part of M8.
- Export builds the file in memory (no stream-to-disk, no resume, H.264/AAC only, linear resampling). Large exports warn above about 1 GB; stream-to-disk, VP9/WebM and verification are M7.
- Importing copies the file into project storage; File System Access in-place referencing and relink are still not built (storage is OPFS only). Exporting a project archive is refused when its media is over 1 GB.
- Media files are not deleted when assets are removed (they go when the project is deleted).
- Audio: no volume, fades, meters or solo yet (M6). Speed, transitions, text, keyframes and effects are M6.
- The sequence frame rate and size come from the first video; changing them does not resample existing clips.
- Overlays: several video tracks composite with normal blending, but there are no transform, opacity or crop controls yet (M6).
**Acceptance:** VID-1, VID-2, VID-3 (two video tracks work; UI tested with two), VID-4, VID-5 (frame stepping and scrubbing; J/K/L shuttle is M6), ASSET-3 and ASSET-4 are met; ASSET-5 (proxies) is not; PERF-2/3/7/8 are measured in M8.
**Tests:** time conversion properties, timeline operation properties (24 random seeds) with undo/redo, frame pump and frame cache leak counters, audio mix placement, export with fakes (counts, ordering, cancel, failure, clean-up), end-to-end import/preview/playback/editing/persistence and ffprobe-verified export, accessibility check of the video workspace in both themes.

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
