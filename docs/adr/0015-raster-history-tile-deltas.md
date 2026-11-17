# ADR-0015: Raster edit history via tile deltas

- **Status:** Proposed (2026-11-17). Validated in M4 (brush) with a memory-growth test.

## Context
Brush strokes, fills and erasing change pixels. Undo must restore exact pixels without storing full-layer bitmaps per step (a 24 MP RGBA layer is ~96 MB). Replaying strokes from parameters is compact but slow and non-deterministic across GPUs.

## Options
| Option | Pros | Cons |
|---|---|---|
| **A. Tile deltas: store before/after versions only of tiles touched by the command** | Exact, fast undo/redo; memory proportional to touched area; works for any pixel operation (fill, filter-to-pixels, paste) | Needs a tile store and garbage collection |
| B. Store stroke parameters and replay | Tiny history | Slow for many strokes; GPU rounding differences break exactness |
| C. Full-layer snapshots | Simplest | Memory explosion |

## Decision
**A.** Raster layers are sparse 256x256 RGBA8 tiles, content-addressed. A paint command records the tile IDs before and after; history entries hold references, not copies. Unreferenced tile versions are garbage-collected when they fall out of history and the document. Cold versions spill to OPFS ([project format](../architecture/project-format.md)). Strokes coalesce into one history entry per pointer-down/up.

## Consequences
- Brush determinism is not required for undo (pixels are stored).
- Tile hashing cost is paid at commit, not per dab; hash on a worker.
- Memory growth test in M4: N strokes must stay under the history memory budget with spill active.
