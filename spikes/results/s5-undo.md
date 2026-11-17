# S5 result: does Immer-patch history scale? (ADR-0006)

Generated 2026-11-17T17:11:39.331Z from `spikes/results/s5-undo.json` by `spikes/s5-undo/report.mjs`. Every number below is read from that JSON, produced by one run of `node --expose-gc s5-undo/bench.mjs` (total runtime 472.5 s).

## Environment

- Node v24.3.0 on win32 10.0.26300; 16 logical cores (os.cpus()), 13th Gen Intel(R) Core(TM) i7-1360P; 15.7 GB RAM
- immer 11.2.10, zod 4.6.7; `--expose-gc`; no browser.
- **Other load existed**: 4 other agents were running browser benchmarks on the same laptop during this run. Tail latencies (p95/max) may be inflated by CPU contention and GC; p50 is the more reliable figure.

## Method

- Synthetic docs. Image: 1,000 layers (id, name, visible, opacity, blendMode, transform{x,y,scaleX,scaleY,rotation}, optional maskId, adjustments[]); opacity and rotation are `number | Keyframe[]` (10% start as keyframes). Video: 2,000 clips flat array with `trackId` over 8 tracks (start, duration, sourceId, in/out, speed, properties{opacity,volume,scale} as value|keyframes[], optional transition). Both validated with Zod v4 schemas.
- Command layer: Immer `produceWithPatches`; history stack (label, patches, inversePatches); undo/redo via `applyPatches`; redo truncated on new edit; coalescing of consecutive same-key edits (opacity drags in bursts of 20, nudge/move bursts of 10, trims bursts of 8). Replace-only coalesced bursts are compacted (latest value wins, earliest inverse wins).
- Workload: 10,000 dispatched edits (seeded PRNG). Image mix: opacity-drag bursts, nudge bursts, single moves, add/remove layer, reorder, rename, blend, add keyframe. Video mix: move/opacity/trim bursts, split, ripple delete (shifts later clips on the same track), add clip, add keyframe. Document size is held near 1,000 layers / 2,000 clips by the generator.
- "Edits" = dispatches (10,000). "Entries" = history entries after coalescing. Undo-depth rows labelled "uncoalesced" use coalescing OFF so entries == edits (10 / 1,000 / 10,000).
- Timings via `performance.now()`; apply-latency includes `produceWithPatches` + history push/merge (command construction and index lookups are outside the timed region; indices come from the pre-edit state). Heap via `process.memoryUsage().heapUsed` after 3x `global.gc()`.
- Verdict rules fixed before running: undo/redo PASS if p95 < 50 ms and max < 50 ms, INCONCLUSIVE if p95 < 50 ms but max >= 50 ms, FAIL if p95 >= 50 ms. History memory PASS if history heap < 200 MB at 10,000 edits (worst of coalesced/uncoalesced, image/video).

## Results vs pass criteria

| Criterion | Measured | Verdict |
|---|---|---|
| Undo < 50 ms at 1,000 layers / 2,000 clips | worst case over all depths: p50/p95/max ms = 0.33 / 8.13 / 78.90 (video depth 10000 (uncoalesced)) | **INCONCLUSIVE** |
| Redo < 50 ms | worst case: p50/p95/max ms = 0.42 / 9.05 / 91.29 (video depth 10000 (uncoalesced)) | **INCONCLUSIVE** |
| History memory < 200 MB at 10,000 edits | worst history heap = 118.1 MB (see memory table) | **PASS** |
| (informational) apply-command latency, no formal limit | worst repeat p95 = 2.79 ms, worst max = 148.23 ms | n/a (see 16 ms frame budget discussion) |
| Correctness (N edits then N undos == original; redo == final; truncation; coalescing) | all checks passed (image and video, coalesced and uncoalesced, 2,000 edits each) | **PASS** |

## (a) Apply-command latency (ms, p50 / p95 / max), autoFreeze on, 3 repeats of 10,000 edits

| Doc | Repeat | p50 / p95 / max | first edit | history entries | final size |
|---|---|---|---|---|---|
| image | 0 | 0.18 / 1.74 / 24.54 | 3.17 | 2978 | 989 |
| image | 1 | 0.15 / 1.51 / 10.03 | 1.65 | 3010 | 998 |
| image | 2 | 0.15 / 1.36 / 11.49 | 1.86 | 2909 | 992 |
| video | 0 | 0.59 / 2.70 / 148.23 | 2.83 | 1881 | 2050 |
| video | 1 | 0.48 / 2.68 / 35.64 | 11.64 | 1917 | 2047 |
| video | 2 | 0.56 / 2.79 / 27.75 | 12.99 | 1977 | 2050 |

Per command type (repeat 0): apply p50 / p95 / max ms, and patches per dispatch p50 / max:

| Doc | Command | n | apply p50 / p95 / max | patches p50 / max |
|---|---|---|---|---|
| image | move | 3166 | 0.18 / 0.56 / 16.68 | 2 / 2 |
| image | removeLayer | 276 | 1.83 / 6.31 / 9.75 | 472 / 998 |
| image | opacity | 5080 | 0.17 / 0.56 / 9.79 | 1 / 2 |
| image | addKeyframe | 387 | 0.21 / 0.65 / 1.09 | 1 / 4 |
| image | rename | 421 | 0.18 / 0.59 / 1.22 | 1 / 1 |
| image | blend | 153 | 0.16 / 0.56 / 0.86 | 1 / 1 |
| image | reorder | 252 | 2.95 / 11.19 / 24.54 | 334 / 971 |
| image | addLayer | 265 | 1.83 / 6.99 / 11.19 | 491 / 993 |
| video | move | 3110 | 0.54 / 1.07 / 148.23 | 1 / 1 |
| video | addKeyframe | 340 | 0.64 / 1.05 / 1.95 | 1 / 4 |
| video | trim | 2232 | 0.54 / 1.00 / 5.78 | 2 / 2 |
| video | split | 256 | 4.45 / 13.75 / 21.76 | 1045 / 2047 |
| video | rippleDelete | 371 | 6.13 / 16.12 / 21.48 | 1073 / 2044 |
| video | opacity | 3526 | 0.53 / 0.93 / 7.21 | 1 / 2 |
| video | addClip | 165 | 0.90 / 1.38 / 1.96 | 1 / 1 |

## (b) Undo / redo latency (ms, p50 / p95 / max)

| Case | Undo | Redo | Verdict (undo/redo) |
|---|---|---|---|
| image depth 10 (uncoalesced) | 0.39 / 0.51 / 1.00 | 0.40 / 0.59 / 1.69 | PASS / PASS |
| image depth 1000 (uncoalesced) | 0.19 / 10.45 / 36.26 | 0.24 / 8.26 / 22.91 | PASS / PASS |
| image depth 10000 (uncoalesced) | 0.28 / 9.19 / 23.68 | 0.28 / 9.08 / 41.82 | PASS / PASS |
| image depth 2978 (10k edits, coalesced) | 0.21 / 14.88 / 29.96 | 0.20 / 13.76 / 18.91 | PASS / PASS |
| video depth 10 (uncoalesced) | 0.32 / 0.68 / 1.31 | 0.32 / 0.67 / 0.81 | PASS / PASS |
| video depth 1000 (uncoalesced) | 0.58 / 14.81 / 51.85 | 0.55 / 17.55 / 55.47 | INCONCLUSIVE / INCONCLUSIVE |
| video depth 10000 (uncoalesced) | 0.33 / 8.13 / 78.90 | 0.42 / 9.05 / 91.29 | INCONCLUSIVE / INCONCLUSIVE |
| video depth 1881 (10k edits, coalesced) | 0.70 / 42.51 / 64.46 | 0.69 / 32.65 / 63.97 | INCONCLUSIVE / INCONCLUSIVE |

Heaviest entry types at depth 10,000 (uncoalesced), undo p50 / p95 / max ms:

| Doc | Type | n | undo | redo |
|---|---|---|---|---|
| image | rename | 20 | 0.24 / 0.38 / 0.38 | 0.26 / 0.56 / 0.56 |
| image | reorder | 14 | 10.70 / 22.06 / 22.06 | 9.51 / 28.56 / 28.56 |
| image | move | 119 | 0.17 / 0.36 / 0.49 | 0.24 / 0.41 / 0.46 |
| image | opacity | 198 | 0.28 / 0.35 / 0.50 | 0.28 / 0.51 / 0.64 |
| image | addKeyframe | 20 | 0.16 / 0.41 / 0.41 | 0.35 / 0.68 / 0.68 |
| image | addLayer | 11 | 9.19 / 23.07 / 23.07 | 12.41 / 41.82 / 41.82 |
| image | blend | 9 | 0.16 / 0.33 / 0.33 | 0.27 / 0.41 / 0.41 |
| image | removeLayer | 9 | 8.87 / 23.68 / 23.68 | 9.27 / 26.04 / 26.04 |
| video | trim | 61 | 0.36 / 1.19 / 1.34 | 0.34 / 0.77 / 1.09 |
| video | addKeyframe | 14 | 0.30 / 1.16 / 1.16 | 0.50 / 1.32 / 1.32 |
| video | split | 11 | 17.52 / 78.90 / 78.90 | 10.55 / 91.29 / 91.29 |
| video | rippleDelete | 19 | 10.96 / 41.03 / 41.03 | 16.43 / 56.33 / 56.33 |
| video | move | 110 | 0.34 / 0.98 / 1.28 | 0.48 / 1.06 / 1.31 |
| video | opacity | 177 | 0.27 / 1.07 / 1.34 | 0.36 / 0.71 / 0.97 |
| video | addClip | 8 | 0.39 / 1.38 / 1.38 | 0.39 / 0.88 / 0.88 |

(Depth samples: first 400 undos from the top of the stack then the same 400 redos; for depth 10, 50 undo-all/redo-all cycles. Undo cost is essentially independent of depth, as expected from patch application.)

## (c) History memory after 10,000 edits (MB, heapUsed after gc)

| Case | edits | entries | heap before | heap after (with history) | heap after history cleared | **history heap** | patches+inverse | history JSON size |
|---|---|---|---|---|---|---|---|---|
| image_coalesced | 10000 | 2933 | 307.7 | 368.4 | 307.9 | **60.5** | 686698 | 226.21 MB |
| image_uncoalesced | 10000 | 9808 | 307.5 | 372.8 | 307.9 | **64.9** | 702624 | 227.23 MB |
| video_coalesced | 10000 | 1791 | 307.8 | 421.1 | 308.4 | **112.7** | 1206836 | 307.36 MB |
| video_uncoalesced | 10000 | 9758 | 307.8 | 426.5 | 308.4 | **118.1** | 1225504 | 308.55 MB |

## (d) Immer autoFreeze on vs off (same seeds, 2 repeats each; ms p50 / p95 / max)

| Doc | autoFreeze | apply (rep0) | apply (rep1) | first edit (rep0) | undo (rep0) | redo (rep0) |
|---|---|---|---|---|---|---|
| image | on | 0.38 / 3.20 / 24.36 | 0.42 / 3.94 / 498.31 | 8.03 | 0.43 / 29.35 / 50.55 | 0.62 / 40.30 / 74.92 |
| image | off | 0.01 / 1.78 / 18.25 | 0.01 / 1.78 / 12.81 | 0.09 | 0.03 / 15.88 / 34.15 | 0.05 / 24.99 / 49.33 |
| video | on | 0.48 / 2.69 / 21.14 | 0.84 / 4.37 / 809.70 | 2.13 | 0.59 / 32.31 / 58.10 | 0.64 / 43.62 / 91.65 |
| video | off | 0.01 / 1.82 / 18.89 | 0.03 / 3.39 / 52.75 | 0.10 | 0.10 / 56.67 / 133.23 | 0.12 / 76.23 / 177.43 |

## (e) Document save/load cost (ms p50 / p95 / max over 22 timed runs)

| Doc | items | JSON size | Zod parse | JSON.stringify | JSON.parse | structuredClone |
|---|---|---|---|---|---|---|
| image | 1000 | 283.5 KB | 1.72 / 6.46 / 6.53 | 3.69 / 5.35 / 7.85 | 3.58 / 6.29 / 7.05 | 8.43 / 10.31 / 15.39 |
| video | 2000 | 428.9 KB | 2.32 / 5.29 / 6.32 | 5.95 / 9.14 / 13.17 | 6.04 / 9.90 / 23.71 | 13.31 / 16.59 / 75.94 |

## (f) Crash-recovery journal (one JSON line of patches per dispatch, 10,000 dispatches, replayed over the base document)

| Doc | lines | serialise (ms) | size | replay total (ms), 3 runs | replay per entry p50 / p95 / max (ms) | deepStrictEqual with live final state |
|---|---|---|---|---|---|---|
| image | 10000 | 2646.4 | 114.16 MB | 23521.7 / 23957 / 16475.6 | 0.22 / 7.67 / 92.98 | true |
| video | 10000 | 2632.1 | 204.40 MB | 20988.5 / 20147.7 / 16523.6 | 0.26 / 10.87 / 95.76 | true |

## (g) Baselines

| Baseline | Doc | Edits run | Apply p50 / p95 / max (ms) | Undo p50 / p95 / max (ms) | Heap growth (MB) | Notes |
|---|---|---|---|---|---|---|
| snapshot | image | 2000 | 0.00 / 9.29 / 359.83 | 0.00 / 0.00 / 0.01 | 423.5 | 0.636 MB/entry; extrapolated (not measured) to 10,000 entries = 6360 MB |
| snapshot | video | 2000 | 0.00 / 7.19 / 44.03 | 0.00 / 0.00 / 0.00 | 362.6 | 0.930 MB/entry; extrapolated (not measured) to 10,000 entries = 9298 MB |
| stateRefs | image | 10000 | 0.13 / 1.09 / 15.19 | 0.00 / 0.00 / 0.01 | 25.1 | 3069 entries; structural-sharing, no patches/journal |
| stateRefs | video | 10000 | 0.30 / 1.38 / 25.99 | 0.00 / 0.00 / 0.00 | 40.4 | 1877 entries; structural-sharing, no patches/journal |
| optionC | image | 10000 | 0.00 / 0.02 / 0.73 | 0.00 / 0.01 / 0.11 | 2.5 | undoAll==original true, redo==final true; 2951 entries; mutable in-place doc |

## Caveats

- Documents are synthetic and hand-shaped (flat `layers[]` / flat `clips[]`); real documents may be nested (tracks[].clips[]) and have heavier per-layer metadata. Pixel/frame data is excluded by design (ADR-0006).
- Other agents were running browser benchmarks concurrently on the same machine (16 logical cores); tail latencies are noise-sensitive. Single machine, single Node version, no browser (V8 in Chromium may differ in GC behaviour; heap numbers are Node `heapUsed`, not a browser heap snapshot).
- Index lookups (`findIndex` by id) are done outside the timed region from the pre-edit state; app code that searches by id inside a draft would create proxies for every visited element and could be slower. Not measured.
- Coalescing here is by consecutive same key (no time window); undo/redo resets the coalescing target. Brush strokes / pixel history are not modelled (decided in the image-engine doc).
- Snapshot-baseline heap cost is extrapolated from a scaled-down run (see table); it is not a 10,000-entry measurement.
- Option C (hand-rolled log) was implemented for the image doc only and mutates in place, so it is not a like-for-like substitute for React-friendly immutable state; it has no automatic patches for the ADR-0005 journal.

## Recommendation (hand-written after reading the numbers above; figures are from this single noisy run)

**ADR-0006 should stay Proposed but needs changes before acceptance; do NOT trigger the option-C fallback yet.**

- Memory criterion: PASS with margin (history heap 60-118 MB for 10,000 edits). Coalescing barely changed heap (bursts compact to one patch) but cut entries from ~9,800 to ~1,800-3,000. Naive structuredClone snapshots are not viable (0.64-0.93 MB per entry; extrapolated, not measured, 6-9 GB at 10,000 entries).
- Undo/redo criterion: INCONCLUSIVE, not a clean PASS. Simple property edits (move, opacity, rename, keyframe, trim) undo in about 1 ms or less at p95. The breaches of the 50 ms bar are all structural edits on flat arrays (split, ripple delete, reorder, add/remove layer): Immer emits index-based patches, so one splice produced ~470-1,070 patches at p50 (up to ~2,050 for a 2,000-clip doc). Their undo/redo took p95 22-79 ms and max up to 91 ms (video split / ripple delete), measured while 4 other benchmark agents loaded the CPU. On an idle machine these may fall below 50 ms, but this run cannot show that; repeat on an idle machine to settle it.
- The same root cause hurts the crash-recovery journal: 10,000 dispatches serialise to 114 MB (image) / 204 MB (video) of JSON lines and replay in 16-24 s (correctness held: deepStrictEqual passed). Full history JSON is 226-309 MB. That is too heavy for ADR-0005 as written; periodic base checkpoints plus truncation would be mandatory.
- Proposed ADR changes: (1) model ordered collections as normalised maps (layers and clips as Record by id, with order represented by fractional/lexicographic order keys per parent), so move/reorder/split/ripple produce O(changed items) patches instead of O(n) index shifts; make ripple delete a single semantic command or per-track offset rather than shifting 250+ clip starts; (2) set setAutoFreeze(false) in production (apply p50 0.38 -> 0.01 ms image, 0.48 -> 0.01 ms video; first edit 8 -> 0.09 ms) and keep freezing in dev/tests only; (3) require periodic journal checkpoints. Then rerun S5 on the normalised shape (not done here) and trigger option C only if structural-edit undo still exceeds 50 ms on an idle machine.
- Option C for reference (image doc only, mutable in-place): apply p50 0.003 ms, undo p95 0.006 ms, heap +2.5 MB. Far cheaper, but it gives up immutable snapshots for React and automatic patches for the journal.
- Not measured: normalised document shape; an idle-machine rerun; in-browser heap; id lookups inside drafts; option C for the video doc; snapshot baseline at the full 10,000 entries (stopped at 2,000, extrapolated). The ~308 MB heap baseline before each memory run was residue from earlier phases in the same process, so only deltas are meaningful.
