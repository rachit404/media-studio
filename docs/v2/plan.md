# Media Studio v2 plan (frontend first)

Status: drafted 2026-11-19, after v1.0 was complete in the repository (steps 1 to 10 of `CLAUDE/plan.md`). This plan covers what
a person sees and touches. Anything that needs a change in the engines or the document format is listed at the end, not planned
here. The owner decides the order; nothing below is promised.

## Where v1 leaves the interface

These come from the written limits of M3 to M9 and the v1.0 audit ([audit-v1.md](../engineering/audit-v1.md)):

- The corners and rotation knob of the preview box, and moving a keyframe along the timeline, can only be done with a pointer.
- Buttons show shortcuts only through the shortcut list in Settings; there are no tooltips (UX-5 is a "should").
- An empty timeline or canvas says little about what to do first; there is no onboarding.
- The layout is designed for 1024 px and wider (PLAT-6); there is no narrow or touch layout.
- Commands are found by knowing the key or the button; there is no search.
- Export is one dialog with many choices; there is no preview of the result before a long export.
- Only a dark and a light theme exist; no high-contrast theme.

## v2 frontend work

Ordered by value for effort. "Done" means built, tested and merged on `feat/v2-frontend`.

| # | Item | Why | Requirement | State |
| --- | --- | --- | --- | --- |
| F1 | Tooltips that show shortcuts on the timeline and playback buttons | People find the keys while using the app | UX-5, UX-1 | done |
| F2 | Helpful empty states: an empty timeline says what to do first | New users do not know where to start | UX-5 | done |
| F3 | Keyboard control of the preview box: rotate and scale with keys, not only arrows to move | Closes the pointer-only gap | A11Y-3 | done |
| F4 | Keyboard and pointer moving of keyframes on the timeline | Closes the other pointer-only gap | A11Y-3, VID-12 | done |
| F5 | Command palette (Ctrl+K): search every command by name, run it, see its key | Reaches any command without knowing the key | A11Y-2, UX-1 | done |
| F6 | First-run walkthrough: three dismissible steps on the start screen and in each editor | Onboarding | UX-5 | done |
| F7 | Export dialog: a summary line ("MP4, 1920 x 1080, 30 fps, about 120 MB, about 3 minutes") and a "test export" of the first five seconds | Long exports are a commitment | EXP-2, EXP-4 | done |
| F8 | High-contrast theme from the same token file | Low-vision users | A11Y-1, PLAT-5 | done |
| F9 | Narrow layout below 1024 px: panels become tabs | Small windows and tablets | PLAT-6 (stretch) | planned |
| F10 | Timeline: zoom to selection, track height choice, collapse tracks | Large projects | VID-3 | done |

## v2 engine and format work (planned 2026-11-19, not started)

Each item gets its own branch from `claude-takeover` (after `feat/v2-frontend` is merged), a small spike or measurement first
where the risk is in the browser, then code, tests and an end-to-end check. "Doc" says whether the project document changes:
v12 would only add optional fields, so older files open unchanged (identity migration, as in v2 to v11).

| # | Item | What the person gets | Doc | Effort | Risk | Needs first |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | Social frames: square (1:1), vertical (9:16), 4:5 and the sequence's own, each as "fit with bars" or "fill and crop", with a position control | Exports ready for phones and feeds | no (an export setting) | S | low | frame size in the export scene |
| E2 | Subtitle files: export `.srt` and `.vtt` next to the video from the subtitle track (burned-in already works) | Captions for players and uploads | no | S | low | none |
| E3 | Master limiter and a loudness readout; optional "normalise to -14 LUFS" at export | No clipping, steady volume | optional export field | M | low | audio mix test vectors |
| E4 | Text outline, shadow and background box; a small set of bundled fonts | Readable titles on any picture | v12 (optional text fields) | M | medium (font licences, export parity) | licence check of each font |
| E5 | Centred and "over the cut" transitions | More natural cuts | v12 (optional field) | S | low | preview and export parity test |
| E6 | Bezier keyframe curves and a curve editor (the frontend part comes after the engine part) | Smooth, custom motion | v12 (easing kind) | M | medium | keyframe maths tests; editor design |
| E7 | Speed ramps (speed changes along the clip); then reverse playback | Slow motion that eases in and out | v12 (speed keyframes) | M for ramps, L for reverse | high for reverse (needs decoding backwards) | spike: reverse on long-GOP sources |
| E8 | Proxies for heavy sources (ASSET-5): made in the background, switched automatically, never used for export | 4K and long-GOP footage edits smoothly | v12 (asset proxy fields) | L | high (disk use, decoder time, export must use the original) | spike: proxy speed and size on real 4K |
| E9 | Soft subtitle tracks inside the MP4 or WebM (VID-14) | Switchable captions | no | M | high (muxer support unverified) | spike: what mediabunny can write |
| E10 | Audio effects: three-band equaliser, then noise reduction (VID-14, AI-2 later) | Cleaner sound | v12 (effect fields) | M for the equaliser, L for noise reduction | medium | decide on a local-only method |

### Suggested order

1. **E1, E2** first: small, visible, no format change, and they finish the "publish a video" story.
2. **E3, E5** next: small and safe.
3. **E4** then **E6** (with its curve-editor frontend): the largest visible gains for editing quality.
4. **E7 ramps**, then the spikes for **E7 reverse**, **E8 proxies** and **E9 soft subtitles**: decide each from its spike result, not before.
5. **E10** last (the equaliser first).

### Frontend work that follows the engine items

F9 (narrow layout) stays a stretch item. Each engine item above adds its own small interface (a frame menu, a captions button,
a loudness readout, text styling fields, a curve editor), built and tested together with it.

### Decisions (owner delegated them on 2026-11-19: "your call for all")

- **Order:** as suggested above. E1 and E2 first, in parallel.
- **Fonts (E4):** bundled fonts are acceptable only with an open licence that allows redistribution (SIL OFL or Apache 2.0), a
  small set (about four families), each listed in `docs/third-party.md`. Anything else uses system fonts.
- **Proxies (E8):** a setting with three choices, "Automatic" (default: only for sources above 1080p, with a long GOP, or decoded
  in software), "Always" and "Never". Export always reads the original.
- **F9 (narrow layout):** after E1 to E3, not before; it is a stretch item and nothing in E1 to E3 depends on it.

## How v2 is built

One branch per item (`feat/v2-frontend` for F1 to F10, then `feat/v2-e1-...` and so on from `claude-takeover`), small commits,
each with unit tests and, for visible changes, an end-to-end test and an axe check. `pnpm check` and the full end-to-end
suite stay green. No change to the document format was needed for F1 to F10.
