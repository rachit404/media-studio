# ADR-0014: Timeline UI rendering approach

- **Status:** Accepted and implemented in M5 (2026-11-18). Performance at 2,000 clips is not measured yet (M8).

## Context
The timeline must show up to thousands of clips, thumbnails and waveforms, support dragging/trimming with snapping, theme via tokens, and be operable by keyboard and assistive technology. The playhead updates every frame during playback.

## Options
| Option | Pros | Cons |
|---|---|---|
| **A. Virtualised DOM clips + canvas for ruler, waveforms and thumbnails + imperative playhead** | Accessible (real elements, focus, ARIA), themeable via tokens, simple hit-testing/drag with pointer events, easy testing | Needs virtualisation; many DOM nodes if not careful |
| B. Fully canvas-rendered timeline | Highest raw performance, total drawing control | No native accessibility or focus; custom hit-testing, text and theming; harder to test |
| C. DOM for everything, including waveforms and thumbnails | Simplest | Waveform/thumbnail drawing in DOM is slow and heavy |

## Decision
**A.** Only clips inside the visible time window (plus a margin) are mounted. Waveforms and thumbnail strips are drawn per clip on small canvases from cached data. The playhead and scrub position are moved via CSS transforms/variables outside React state. Interaction logic (snapping, trimming, dragging, selection) lives in a headless model in `engine-video` with unit tests; React only renders it.

## Consequences
- Keyboard operations for every timeline action are required anyway (A11Y-3) and exercise the same headless model.
- Performance targets: 60 fps scroll/zoom with 2,000 clips on the reference document; if virtualised DOM misses the target in M5, fall back to canvas for clip bodies while keeping DOM for focusable overlays.

## Implementation notes (M5)
- Clips are real `<button>` elements positioned by time; only clips overlapping the visible window plus a margin are mounted. The ruler is DOM too (a few dozen marks). Waveforms are drawn on one small canvas per audio clip from cached peaks; thumbnails are a single image per clip.
- The playhead and the clock readout move by `transform` and `textContent` from the player's per-frame callback, outside React state.
- Pointer drags keep their state in a ref (events arrive faster than renders), show the move or trim live, and commit one undoable command on release. The limits and snapping are computed by headless functions in `engine-video` and `core` (`clampMoveDelta`, `trimRange`, `snapClipStart`), tested without a browser.
- Every pointer action has a keyboard or button equivalent (split, delete, ripple delete, join, unlink, nudge, trim to playhead, numeric start and length).
