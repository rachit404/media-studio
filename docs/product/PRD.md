# Product Requirements Document (PRD): Media Studio

- **Status:** Draft for owner review (2026-11-17)
- **Related:** [Requirements](requirements.md), [System architecture](../architecture/system-architecture.md), [Roadmap](../engineering/roadmap.md), [ADRs](../adr/README.md)

## 1. Vision
A modern, privacy-first image and video editor that runs entirely in the browser. Your media never leaves your device. One polished
workspace, two editors (image and video) that share an asset library, UI kit, shortcuts and export dialogs, built on an architecture
that can later gain optional on-device AI features and a desktop shell without a rewrite.

## 2. Product principles
| Principle | What it means in practice |
|---|---|
| Privacy-first, local-first | All processing is client-side. No uploads, no accounts, no analytics. Works offline after first load. |
| Cost-conscious | Free and open-source dependencies, permissive licences only ([ADR-0011](../adr/0011-dependency-licence-policy.md)). Static hosting only. |
| Performance | Smooth 1080p editing on a low-end baseline (Intel Iris Xe). Measured, budgeted, regression-tested. |
| Modularity | Image engine, video engine, storage and rendering are separate packages with enforced boundaries. |
| Extensibility | AI features are optional plugins behind an interface; the core never depends on them. |
| Reliability | Exports are deterministic, cancellable and verified. Projects autosave and recover after a crash. |
| Maintainability | Strict TypeScript, tests alongside features, ADRs for decisions, documented pipelines. |

## 3. Target users and positioning
- **Primary persona: the prosumer creator** (students, small-business owners, hobbyists, social-media creators) who outgrew a basic
  editor but does not want a subscription pro suite. Wants simple defaults and the option to go deeper.
- **Secondary persona: the privacy-conscious user** who will not upload personal footage or photos to a cloud editor.
- **Portfolio audience:** reviewers who will judge architecture quality, polish and engineering rigour.
- **Positioning:** "Photopea meets a lightweight DaVinci, in a tab, with nothing uploaded." Comparable products: Photopea, Canva/Clipchamp,
  CapCut web, Kapwing. We learn from their workflows and do not copy their interfaces.

## 4. Platform
- Web app (static files). **Tier 1:** current Chrome and Edge. **Tier 2:** Safari 26+ and Firefox (degraded paths). Mobile not supported.
  See [ADR-0002](../adr/0002-browser-support-tiers.md).
- Installable offline PWA. Desktop and native engine are future extensions behind the `MediaEngine` interface ([ADR-0001](../adr/0001-web-first-platform.md)).
- Single-user. No backend, no accounts, no collaboration.
- Development order: Windows machine with Iris Xe first, then verify macOS and Linux browsers.

## 5. Scope
### 5.1 v1.0 (in scope)
**Shared:** home screen with recent projects, asset library, drag-and-drop import, clipboard paste of images, autosave and crash recovery,
undo/redo, customizable keyboard shortcuts, dark and light themes, export presets, capability detection with clear fallbacks.

**Image editor (tier 2):** import JPEG/PNG/WebP/GIF/SVG; crop, resize, rotate, flip; layers and groups; raster and vector masks; blend modes and
opacity; text and shapes; rectangle/ellipse/lasso selections; brush and eraser; non-destructive adjustment layers (exposure, brightness/contrast,
saturation, hue, levels/curves, blur, sharpen); filter presets; export JPEG/PNG/WebP with quality, scale and metadata-strip controls.

**Video editor (tier 2):** import MP4/MOV/WebM; multi-track video and audio; trim, split, merge, ripple delete; overlays and picture-in-picture;
transitions (cross-fade, dip, wipe, slide); constant speed change; text and subtitle tracks (SRT/VTT import); audio volume, fades, mute and
waveforms; basic colour adjustments; keyframe-capable property model; export MP4 (H.264/AAC) and WebM (VP9/Opus) at chosen resolution,
frame rate and bitrate; proxy workflow for heavy sources.

### 5.2 Planned after v1.0
AVIF export, animated GIF export, MKV import, HEIC import, project templates, magic wand and advanced selections, pitch-preserving speed change,
curves/colour grading panels, keyframe curve editor, desktop wrapper, optional on-device AI modules (background removal, subtitles, smart crop).

### 5.3 Non-goals
Collaboration, cloud storage or sync, accounts, social publishing, mobile apps, RAW/CMYK/ICC colour-managed workflows, ProRes/DNxHD,
3D, Photoshop-class smart objects and vector path editing, multicam, motion-graphics authoring.

## 6. Success criteria
| Area | Measure |
|---|---|
| Correctness | 100% of acceptance criteria per milestone pass; export round-trip tests pass in CI |
| Performance | 1080p preview at 30 fps or better on Iris Xe with the reference project; export at 1x realtime or better with hardware encode ([NFR](requirements.md#non-functional-requirements)) |
| Reliability | No data loss on forced tab close (autosave recovery test); exports cancel cleanly |
| Privacy | Zero third-party network requests at runtime (automated test) |
| Quality | Strict TypeScript, tests alongside every feature, no unresolved high-severity bugs at release |
| Portfolio | Public repo, README with architecture overview, ADRs, live demo, short walkthrough video |

## 7. Constraints and assumptions
- Solo developer, no prior WASM/native experience: prefer existing libraries and GPU shaders to custom native code.
- Hardware verified locally: Intel Iris Xe only. Other GPU/encoder paths rely on capability probing and community testing.
- Browser memory and codec availability limit long and 4K projects: 1080p guaranteed, 4K best-effort via proxies, projects up to about 30-60 minutes.
- Spike findings ([results](../research/spike-results.md)) are measured on synthetic footage and one machine. Real-footage and multi-machine
  validation continue through development.
- Self-hosting later (Oracle VM) needs a domain with HTTPS; deployment details are deferred ([deployment](../engineering/deployment.md)).

## 8. Top risks
| Risk | Impact | Mitigation |
|---|---|---|
| GPU-process memory growth in long playback (S7, cause unknown) | Tab crashes in long sessions | Soak-test spike in M5; frame-cache budgets; reload-safe autosave |
| Pixi blend modes inexact (S3) | Wrong colours vs other editors | Own blend shaders; per-mode acceptance tests |
| Undo on structural edits near 80 ms (S5) | Sluggish editing | Normalised data model; re-measure on idle machine in M2 |
| Browser codec availability varies | Export option missing on some machines | Runtime probing, fallbacks, clear messages |
| Concurrent hardware decoders limited (not yet spiked) | Overlay-heavy timelines stutter | Decoder pool, proxies, spike in M5 |
| File System Access only in Chromium | Weaker UX elsewhere | OPFS-copy fallback, archive export |
| Scope creep | Never ships | Tiered scope, milestone acceptance gates |

## 9. Glossary
**Asset:** an imported media file. **Proxy:** a low-resolution, short-GOP copy used for editing. **GOP:** group of pictures between keyframes.
**OPFS:** Origin Private File System. **FSA:** File System Access API. **Command:** the only way to change the document; yields patches for undo.
