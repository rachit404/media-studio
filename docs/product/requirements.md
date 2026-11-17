# Functional and non-functional requirements

- **Status:** Draft for owner review (2026-11-17). Priority: **M** must (v1.0), **S** should (v1.0 if time), **C** could (post-v1).
- IDs are stable and referenced by milestone acceptance criteria in the [roadmap](../engineering/roadmap.md).

## Functional requirements

### Platform and shell (PLAT)
| ID | Requirement | Pri |
|---|---|---|
| PLAT-1 | App runs as static files in Chrome/Edge current stable (tier 1); Safari 26+/Firefox degraded (tier 2) | M |
| PLAT-2 | Startup capability probe (encode/decode codecs, WebGL2, OPFS, pickers, storage write test); results available to UI | M |
| PLAT-3 | Unsupported browser/feature shows a clear explanation page, never a blank screen | M |
| PLAT-4 | Installable PWA; app shell works offline after first load | M |
| PLAT-5 | Dark and light themes from one token file; theme persists | M |
| PLAT-6 | Layout supports widths from 1024 px up | M |
| PLAT-7 | "Clear all local data" and storage usage view | M |

### Assets and import (ASSET)
| ID | Requirement | Pri |
|---|---|---|
| ASSET-1 | Import by file picker and drag-and-drop; multiple files | M |
| ASSET-2 | Clipboard paste of images | M |
| ASSET-3 | Probe metadata (type, duration, resolution, fps, codecs, audio) with clear errors for unsupported files | M |
| ASSET-4 | Thumbnails for all assets; waveform peaks for audio | M |
| ASSET-5 | Proxy generation for sources above 1080p, long-GOP (keyframe interval > 2 s), or software-decoded; automatic switch between proxy and original | M |
| ASSET-6 | Missing/moved file detection and relink flow | M |
| ASSET-7 | Asset library panel: search, sort, filter by type, usage indicator | S |

### Projects and persistence (PROJ)
| ID | Requirement | Pri |
|---|---|---|
| PROJ-1 | Create, open, save, save-as, duplicate, delete projects; recent list | M |
| PROJ-2 | Autosave with write-ahead command journal; recovery prompt after crash | M |
| PROJ-3 | Versioned, schema-validated project format with migrations | M |
| PROJ-4 | Portable archive export/import (`.msproj`) | M |
| PROJ-5 | Chromium: originals referenced in place via file handles; other browsers: copy into OPFS | M |
| PROJ-6 | Undo/redo for all document edits, with coalescing of continuous edits | M |
| PROJ-7 | Project templates | C |

### Shared editing UX (UX)
| ID | Requirement | Pri |
|---|---|---|
| UX-1 | Customizable keyboard shortcuts with conflict detection and a shortcut reference | M |
| UX-2 | Copy/cut/paste of layers, clips and properties | M |
| UX-3 | Drag-and-drop from library to canvas/timeline; reorder by drag | M |
| UX-4 | Export presets (e.g. "Web 1080p", "Social square") | M |
| UX-5 | Context menus, tooltips with shortcuts, empty states, onboarding hints | S |

### Image editor (IMG)
| ID | Requirement | Pri |
|---|---|---|
| IMG-1 | Import JPEG, PNG, WebP, GIF (first frame), SVG; honour EXIF orientation | M |
| IMG-2 | Crop (free/ratio), resize with resampling choice, rotate (90/free), flip | M |
| IMG-3 | Layer tree with groups; visibility, lock, rename, reorder, opacity, blend mode | M |
| IMG-4 | Raster layers (tile-backed) and image layers (referencing an asset) with non-destructive transform | M |
| IMG-5 | Layer masks (raster, paintable) and clipping masks | M |
| IMG-6 | Blend modes: normal, multiply, screen, overlay, soft light, hard light, darken, lighten, colour dodge/burn, difference, exclusion, hue/saturation/colour/luminosity; each tested against reference formulas | M |
| IMG-7 | Text layers (font, size, weight, colour, alignment, line height, letter spacing) with bundled open-licence fonts | M |
| IMG-8 | Shape layers (rectangle, ellipse, line, polygon) with fill, stroke, corner radius | M |
| IMG-9 | Selections: rectangle, ellipse, lasso; add/subtract/intersect; feather; invert; save as mask | M |
| IMG-10 | Brush and eraser (size, hardness, opacity, flow); pressure support where available | M |
| IMG-11 | Adjustment layers (non-destructive): exposure, brightness/contrast, saturation/vibrance, hue, levels, curves, black & white; blur and sharpen effects | M |
| IMG-12 | Filter presets (one-click looks) built from adjustment stacks | S |
| IMG-13 | Export JPEG/PNG/WebP: quality, scale, background fill, metadata strip (default on) | M |
| IMG-14 | Magic wand, colour range, refine edge | C |
| IMG-15 | AVIF export, HEIC import | C |

### Video editor (VID)
| ID | Requirement | Pri |
|---|---|---|
| VID-1 | Import MP4/MOV/WebM with H.264/VP9 (and HEVC/AV1 where the browser decodes them); audio extraction | M |
| VID-2 | Sequence settings: resolution, fps, sample rate; sensible defaults from the first clip | M |
| VID-3 | Multi-track timeline: unlimited tracks in the model, UI tested to 8 video + 8 audio | M |
| VID-4 | Trim (drag, numeric), split at playhead, merge/join, ripple delete, move, snap, lock/mute/solo tracks | M |
| VID-5 | Frame-accurate scrubbing and stepping; J/K/L playback shuttle | M |
| VID-6 | Overlays and picture-in-picture with transform (position, scale, rotation, opacity, crop) | M |
| VID-7 | Transitions: cross-fade, dip to black/white, wipe, slide; adjustable duration | M |
| VID-8 | Constant speed 0.25-4x (audio pitch changes in v1, documented) | M |
| VID-9 | Text clips and subtitle track; SRT/VTT import; burned-in at export | M |
| VID-10 | Audio: per-clip and per-track volume, fades, mute, waveform display, master meter | M |
| VID-11 | Basic colour adjustments per clip (brightness, contrast, saturation, temperature) | S |
| VID-12 | Keyframes on transform/opacity/volume properties (data model required; UI minimal in v1) | S |
| VID-13 | Markers and in/out ranges | S |
| VID-14 | Pitch-preserving speed change, noise reduction, soft subtitle tracks | C |

### Export (EXP)
| ID | Requirement | Pri |
|---|---|---|
| EXP-1 | Video export MP4 (H.264/AAC) and WebM (VP9/Opus); available codecs probed at runtime | M |
| EXP-2 | Choose resolution, frame rate, bitrate/quality, audio bitrate, range (whole/in-out) | M |
| EXP-3 | Deterministic, timestamp-driven offline render of full-resolution sources | M |
| EXP-4 | Progress, time remaining, cancel with clean-up, and resumable segmented export | M |
| EXP-5 | Stream to disk where supported; size warning and fallback elsewhere | M |
| EXP-6 | Typed, user-readable errors (unsupported codec, out of memory/quota, decode failure, write failure) | M |
| EXP-7 | Post-export verification (re-open output, check duration/frames) in dev and as an option for users | S |
| EXP-8 | GIF export | C |

### Future AI (AI) (all post-v1, optional, local)
| ID | Requirement | Pri |
|---|---|---|
| AI-1 | Plugin interface lets optional modules provide effects/analysis without core changes | S (interface only) |
| AI-2 | Background removal, automatic subtitles, smart crop, enhancement, noise reduction | C |
| AI-3 | Models download on demand with explicit consent, hash-verified; no data leaves the device | C |

## Non-functional requirements

### Performance (budgets measured on Intel Iris Xe, Chrome tier 1)
| ID | Requirement | Basis |
|---|---|---|
| PERF-1 | Image canvas pan/zoom/brush at 60 fps for a 4096x4096 document with 10 layers; interaction latency under 50 ms | S3 headroom is ~1.5x at 60 Hz, so budget conservatively |
| PERF-2 | Video preview at 30 fps for a 1080p project with 2 video layers + transition; dropped frames under 2% | S1/S3 |
| PERF-3 | Seek to an exact frame under 150 ms (hardware decode, GOP at most 2 s); proxies otherwise | S1 |
| PERF-4 | Export at 1x realtime or better with hardware encode for the reference project (1080p, 3 layers) | S4 gave 2.8-3.2x for a trivial scene |
| PERF-5 | Undo/redo under 50 ms for any command on a 1,000-layer / 2,000-clip document | S5 (not yet met for structural edits) |
| PERF-6 | Cold start to interactive under 3 s on broadband; app shell under 300 KB gzip (engines lazy-loaded) | Design target |
| PERF-7 | Decoder frame cache holds copies, never more than 6 live `VideoFrame`s per decoder | S1 hold test |
| PERF-8 | Total browser memory (all processes) budgeted and monitored, not just JS heap | S7 |

### Reliability and data safety
| ID | Requirement |
|---|---|
| REL-1 | No lost edits older than the last autosave interval (default 5 s) after crash or forced close |
| REL-2 | Project load never executes content; malformed files fail with a clear error and no partial state |
| REL-3 | Export failure or cancel leaves no partial output and no leaked decoders/frames |
| REL-4 | Every worker failure is surfaced to the user and logged locally; the editor stays usable |
| REL-5 | Storage write capacity probed at startup; quota failures are handled, not assumed away |

### Privacy and security
| ID | Requirement |
|---|---|
| SEC-1 | No network requests to third parties at runtime; automated test enforces it |
| SEC-2 | Strict Content Security Policy; no `eval`; no inline scripts |
| SEC-3 | SVG and project data are never rendered as live HTML; imported SVG is rasterised via an image element only |
| SEC-4 | Exports strip location/camera metadata by default |
| SEC-5 | No analytics or telemetry; any future crash reporting is opt-in and local-first |
| SEC-6 | Dependency licence and vulnerability checks gate CI |

### Compatibility and accessibility
| ID | Requirement |
|---|---|
| COMP-1 | Feature behaviour decided by capability probing, never user-agent sniffing |
| COMP-2 | Tier 2 browsers have documented limitations in the UI and docs |
| A11Y-1 | WCAG 2.2 AA colour contrast in both themes; visible focus; reduced-motion respected |
| A11Y-2 | All commands reachable by keyboard; panels, menus, dialogs, sliders accessible via an accessible primitives library |
| A11Y-3 | Canvas-based surfaces expose equivalent keyboard/command alternatives and labelled layer/clip lists |

### Maintainability and quality
| ID | Requirement |
|---|---|
| MAINT-1 | Strict TypeScript; no `any` without a justified comment; module boundaries enforced by tooling |
| MAINT-2 | Every feature ships with tests; coverage targets in the [testing strategy](../engineering/testing-strategy.md) |
| MAINT-3 | Complex pipelines documented in `docs/architecture`; decisions recorded as ADRs |
| MAINT-4 | No placeholder UI that looks functional but is not; unfinished features are hidden or labelled |
| MAINT-5 | Dependencies minimal, pinned, and licence-checked |

### Localisation and observability
| ID | Requirement |
|---|---|
| L10N-1 | English only in v1; all user-facing strings centralised so localisation is possible later |
| OBS-1 | Local-only diagnostic log (viewable, exportable by the user) with performance counters for decode, render, export and memory |
