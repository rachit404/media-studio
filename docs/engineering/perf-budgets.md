# Performance budgets

Budgets that run on every `pnpm test` (file: `scripts/perf-budgets.test.mjs`, plus `scripts/perf-undo.test.mjs` for PERF-5).
Each is a measured cost with a limit several times above what a normal machine needs, so a failure means something got
much slower (a loop that became quadratic, a copy of the whole document on every frame), not that the computer was busy.
Measured on the reference machine (Core i7-1360P, Iris Xe, 16 GB) on 2026-11-19.

| What | Budget | Typical here |
| --- | --- | --- |
| Find what is on screen at a time in a 2,000-clip sequence (`previewPlan`) | 5 ms | under 1 ms |
| Build the scene for one frame of that sequence (`buildPreviewScene`) | 10 ms | under 1 ms |
| Plan the sound of a two second window (`audioSegments`) | 10 ms | under 1 ms |
| One million keyframed values (200 keyframes, eased) | 600 ms | about 150 ms (found by bisection; a linear scan took 1.1 s) |
| Read a 20,000-cue subtitle file | 800 ms | about 150 ms |
| Fingerprint a 2,000-clip project for an export | 300 ms | under 50 ms |
| Undo, redo and execute on 1,000 layers and 2,000 clips (PERF-5) | 50 ms | 2.5 ms |

Measured by hand, not in `pnpm test` (machine dependent): playback dropped frames ([m6-playback-measurement.md](m6-playback-measurement.md)),
export speed ([m7-export-measurement.md](m7-export-measurement.md)), the 30-minute soak ([../../spikes/results/s9-soak.md](../../spikes/results/s9-soak.md)).
