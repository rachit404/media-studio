# Feasibility spikes (plan step 3)

Throwaway experiments that answer the questions our architecture bets on, measured on the owner's
Iris Xe machine. **Nothing here ships.** Spike code lives in a separate `spikes/` folder, is excluded from the app, and is deleted
or archived once the results are recorded in `docs/research/spike-results.md`.
**Requires explicit owner approval before any spike code is written.**

Thresholds are proposals to be agreed before running; a spike that fails does not stop the project, it triggers the named fallback.

| # | Question | Method | Proposed pass criteria | If it fails |
|---|---|---|---|---|
| S1 | Can we decode fast enough for preview and export? (ADR-0003) | WebCodecs decode of 1080p and 4K H.264, plus HEVC/VP9/AV1 where supported; sequential and random seek; Mediabunny demux | 1080p30 H.264 decode ≥ 2× realtime; 4K ≥ 1× realtime; seek-to-frame < 150 ms with GOP ≤ 2 s | Make proxies mandatory above 1080p |
| S2 | Is storage fast and safe enough? (ADR-0005) | OPFS sync handles in a worker: sequential/random read-write on 1 GB and 4 GB files; FSA streaming save; quota behaviour | Sustained ≥ 200 MB/s on OPFS; 4 GB save without exceeding a ~500 MB heap | Chunked/segmented files; lower stated size limits |
| S3 | Does PixiJS v8 meet the compositing need? (ADR-0004) | Composite 8 layers with 3 blend modes, 2 filters and a mask at 1080p; upload `VideoFrame` as texture; offscreen readback | ≥ 30 fps interactive; per-frame readback for export ≥ 1× realtime | Build the thin custom WebGL2 compositor |
| S4 | Can export be predictable? (ADR-0003, ADR-0007) | Render → `VideoEncoder` → Mediabunny MP4 for a 60 s 1080p30 timeline; probe H.264/AAC/VP9/Opus support; measure memory; test cancel | ≥ 1× realtime on hardware encode; heap plateaus (no growth per frame); cancel < 2 s with clean-up; output re-opens with correct duration | Segmented export; software-encode fallback with warning |
| S5 | Does Immer-patch history scale? (ADR-0006) | 1,000-layer and 2,000-clip documents; 10,000 coalesced edits; undo/redo timing and memory | Undo/redo < 50 ms; history memory < 200 MB at 10,000 edits | Move to a custom command log |
| S6 | What can CI actually test? (ADR-0012) | Probe WebGL2, WebGPU, `VideoEncoder`/`Decoder`, H.264/AAC in Playwright Chromium vs Chrome channel on Linux and Windows runners | A documented matrix of what runs where | Shift codec tests to the Windows runner / manual checklist |
| S7 | Do memory and proxies hold up? (ADR-0007) | 30-minute 1080p timeline: frame-cache budgets, proxy generation speed (1080p to 540p), 4K behaviour, leak check by closing frames | JS heap < 1 GB during playback; proxy generation ≥ 1× realtime | Lower documented limits; smaller caches |

## Test media
Generated with small, licence-clean sources only (e.g. synthetic test patterns, CC0 clips). Fixtures stay out of git unless tiny; large ones are
generated on demand by a script. Never use personal footage in the repo.
