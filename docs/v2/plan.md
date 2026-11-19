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
| F7 | Export dialog: a summary line ("MP4, 1920 x 1080, 30 fps, about 120 MB, about 3 minutes") and a "test export" of the first five seconds | Long exports are a commitment | EXP-2, EXP-4 | planned |
| F8 | High-contrast theme from the same token file | Low-vision users | A11Y-1, PLAT-5 | planned |
| F9 | Narrow layout below 1024 px: panels become tabs | Small windows and tablets | PLAT-6 (stretch) | planned |
| F10 | Timeline: zoom to selection, track height choice, collapse tracks | Large projects | VID-3 | done |

## Needs engine or format work (not frontend; listed so they are not forgotten)

- Social square and vertical exports that crop or letterbox the picture (the export scene fits the whole sequence today).
- Text outline and shadow, bundled fonts, text on a path.
- Bezier keyframe curves, speed ramps, reverse, centred transitions.
- Proxies for 4K editing; background (idle) proxy generation.
- Soft subtitle tracks and `.srt` export.
- Audio effects (equaliser, noise reduction) and a limiter on the master.

## How v2 is built

One branch (`feat/v2-frontend`), small commits per item, each with unit tests and, for visible changes, an end-to-end test
and an axe check. `pnpm check` and the full end-to-end suite stay green. No change to the document format is needed for F1 to F10.
