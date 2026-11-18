# ADR-0015: Raster edit history via tile deltas

- **Status:** Accepted and implemented in M4 (2026-11-18); memory growth verified by test.

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

## Implementation notes (M4)
- Tiles are 256 x 256, immutable once committed, with a `rev` counter that only a stroke in progress changes. A "version" of a surface is a map of tile key to tile; versions share every untouched tile.
- The document stores only a **content id** per paint layer and per mask. A stroke creates a new version in the in-memory `PixelStore` and then runs an ordinary command that points the layer at the new id, so undo and redo are Immer patches of one string and restore exact pixels with no special history code.
- Mask tiles are one channel (default 255 = visible); paint tiles are four channels, straight alpha (default 0).
- On disk: `tiles/<tileId>.bin` (deflated) and `pixels/<contentId>.json` (manifest). Tiles are written first and the manifest last; the autosave journal and checkpoints wait for pending pixel writes, so a record never refers to missing pixels.
- Not built yet: spilling cold versions to disk, and deleting tile files that no version refers to any more.
