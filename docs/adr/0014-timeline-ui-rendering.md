# ADR-0014: Timeline UI rendering approach

- **Status:** Proposed (2026-11-17). Prototype validated during M5.

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
