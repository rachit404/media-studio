# Testing strategy

- **Status:** Draft for owner review (2026-11-17)
- **Related:** [ADR-0012](../adr/0012-testing-media-features-in-ci.md), [requirements](../product/requirements.md), [roadmap](roadmap.md)

## 1. Principles
- Tests are written **with** each feature, not after. A milestone is not done without them.
- Most logic is pure and lives in `core` and the engines' pure modules, so most tests need no browser.
- Anything that depends on a real browser API is tested in a real browser; what CI cannot prove (hardware encode, real File System Access dialogs) goes on a **manual release checklist**, never silently skipped.
- Tests use tiny generated or CC0 fixtures. Never commit real user media.
- No test is allowed to rely on external network services.

## 2. Test pyramid
| Layer | Tool | What it covers | Target |
|---|---|---|---|
| Unit | Vitest | `core` (document, commands, history, journal, migrations, time maths), pure engine logic (timeline ops, selection algebra, tool state machines), capability logic with mocked APIs | `core` ≥ 90% line and branch; engines' pure modules ≥ 80% |
| Property-based | fast-check (MIT) | Command do/undo/redo round trips; timeline invariants (no overlaps, duration conservation); time conversions; selection algebra; migrations | Every command and timeline op has a property test |
| Component | Vitest + Testing Library + axe | UI kit components and panels: behaviour, keyboard, a11y | Every `ui` component |
| Browser integration | Playwright (Chromium, real GPU-backed Chrome channel where needed) | Renderer correctness, decode/seek accuracy, frame leaks, audio sync, storage workers, export round trip | Per milestone acceptance criteria |
| End-to-end | Playwright | User flows: open → edit → undo → save → reload → recover → export | One scenario per requirement group |
| Cross-browser smoke | Playwright Firefox + WebKit | Capability detection, fallbacks, shell loads, project open/save in tier-2 paths | Smoke only |

## 3. Specialised test types
- **Golden images:** render fixtures through the renderer and compare to references with a per-channel tolerance (default 2/255, stricter for blend/adjustment maths, looser for anti-aliased edges). Goldens are generated on the CI renderer; any difference on real hardware is checked manually. Every blend mode and adjustment has a golden **and** a numeric test against the W3C formula (S3 found Pixi overlay off by up to 64/255).
- **Export round trip:** export a generated project, re-open the file with the decoder, assert duration (±0.1 s), frame count, resolution, codec, audio present, first/middle/last frames decodable, and metadata stripped. Run for H.264/AAC and VP9/Opus where supported.
- **Failure injection:** force encoder errors, quota errors, write failures, decode failures, worker crashes and cancel-at-every-stage; assert the typed error, no partial files, and zero leaked frames/decoders.
- **Leak and memory tests:** created/closed `VideoFrame` and `ImageBitmap` counters must balance; process-wide memory sampled during soak runs (JS heap alone is insufficient: S7).
- **Performance tests:** benchmarks for decode, seek, composite, undo/redo, export with thresholds from the requirements; results tracked per commit; regression beyond a margin fails the job (on a stable runner) or warns (on noisy shared runners).
- **Soak/chaos:** 30-60 minute playback/scrub with memory sampling (M5, M8); kill workers randomly; kill the tab mid-edit and verify recovery.
- **Security tests:** zero third-party network requests during full flows; CSP active with no violations; zip-slip and zip-bomb archives rejected; malformed/huge media rejected cleanly; project fuzzing (random mutations never crash or partially load).
- **Accessibility:** axe on every panel/dialog in both themes, keyboard-only scenarios, contrast checks on tokens.
- **Licence and dependency tests:** CI scanner fails on non-allow-listed licences and on known vulnerabilities.

## 4. Environments and CI matrix
| Job | Runner | Notes |
|---|---|---|
| lint, typecheck, unit, property, component | ubuntu | fast, every PR |
| build + size budget + CSP/header test | ubuntu | every PR |
| browser integration + e2e (Chromium) | ubuntu with software GL | WebGL2 via software rendering is acceptable; WebGPU not required |
| codec tests (encode/decode/export round trip) | **windows-latest and/or Chrome channel**, decided after running the S6 probe on GitHub runners | **Currently UNVERIFIED** whether Linux runners have working `VideoEncoder`; Windows + branded Chrome was verified locally |
| cross-browser smoke | ubuntu (Firefox, WebKit) | capability and fallback paths |
| performance benchmarks | self-hosted or local reference machine (Iris Xe) | not on shared runners for hard gates |
| release checklist | manual, real machines | hardware encode, FSA dialogs, Safari/Firefox spot-check |

## 5. Manual release checklist (v1.0 and every release)
1. Hardware encode works and is selected on the Iris Xe machine; software fallback message appears when forced.
2. File System Access: open, relink, save-as, stream-to-disk export, persisted handles after restart.
3. Crash recovery after killing the browser mid-edit and mid-export.
4. Safari and Firefox: capability screen, import, edit, save, export fallback path.
5. Offline start after install; update prompt flow.
6. 4K proxy workflow on a real clip; 30-minute soak.
7. Keyboard-only walkthrough and screen-reader spot-check of main flows.

## 6. Conventions
- Test files colocated (`*.test.ts`), browser tests under `e2e/` or `packages/*/browser-tests/`.
- Fixtures: builders in `packages/testing`; generated media via `scripts/`; golden images committed only when small and reviewed.
- Flaky tests are quarantined within one day and fixed or deleted within a week; no retries that mask real failures.
- Every bug fix includes a regression test.
- Coverage is a signal, not a goal: review uncovered branches in `core` rather than chasing numbers.

## 7. Per-milestone test deliverables
See each milestone's **Tests** section in the [roadmap](roadmap.md). The acceptance criteria there map to requirement IDs, and each ID has at least one automated test or a named manual-checklist item.
