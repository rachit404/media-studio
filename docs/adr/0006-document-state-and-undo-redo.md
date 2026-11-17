# ADR-0006: Document model, state management and undo/redo

- **Status:** Proposed. Must be validated by spike S5 (2026-11-17). Source quality for this topic is low (mostly blog opinion), so we prototype before committing.

## Context
Both editors need a serialisable document (layers / tracks, clips, keyframable properties), reliable undo/redo,
autosave, crash recovery and a stable file format. Heavy pixel and frame data must not live in React state.

## Options
| Option | Licence | Notes |
|---|---|---|
| **A. Plain immutable document + Immer patches (v11) for history, Zustand (v5) for UI state** | MIT | Patches and inverse patches give compact undo; commands give meaningful history labels |
| B. Redux Toolkit (RTK bundles Immer) | MIT | Strong time-travel/devtools story; heavier; more ceremony |
| C. Custom event-sourced command log | n/a | Most control, enables the journal in ADR-0005; most code to own |

## Decision
Proposed: **A, with command semantics.** 
- The document is plain, serialisable, versioned data validated by Zod (v4, MIT) at every boundary (load, paste, import).
- The only way to change it is to dispatch a **command**. A command produces Immer patches and inverse patches; the history stack stores those. The same command records feed the crash-recovery journal.
- Zustand holds **UI state only** (selection, zoom, tool, panel layout). It never owns the document.
- Pixel and frame data lives in the engines (GPU textures, OPFS tiles, frame caches) and is referenced by ID.
- Consecutive small edits (slider drags, brush strokes, nudges) are **coalesced** into one history entry.

## Consequences
- Schema versioning and migrations are first-class from M2.
- Brush-stroke history stores stroke parameters (or tile deltas) rather than full bitmaps; decided in the image-engine doc.
- Keyframe-capable property model from day one (animated properties are `value | keyframes[]`).
- If S5 shows poor memory growth or apply time on large documents, fall back to option C.

## Spike findings (2026-11-17, see ../research/spike-results.md)
- S5: memory PASS (history 60-118 MB at 10,000 edits) and correctness PASS, but undo/redo latency is **INCONCLUSIVE**: simple edits ~0.2-0.7 ms, structural edits (split, ripple delete, reorder, add/remove) worst case 79 ms undo / 91 ms redo, measured while other agents loaded the CPU.
- Cause: a single array splice produces hundreds to 2,000+ index-based Immer patches. The crash-recovery journal was 114-204 MB for 10,000 edits and took 16-24 s to replay.
- **Amendments (before M2):** store ordered collections as a map by id plus order keys; run Immer with `autoFreeze` off in production; add periodic journal checkpoints; re-run S5 on the normalised shape on an idle machine. Option C (custom command log) is not triggered yet; naive snapshots are ruled out (~0.64-0.93 MB per entry, extrapolated).
