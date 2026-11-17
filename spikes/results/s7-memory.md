# S7 - Memory and proxy generation (throwaway spike)

Environment: see `s7-memory.json` -> `env` (Windows 11, Intel Iris Xe, Chrome 157 branded headed, 16 cores, 16 GB).
Data origin: every number below is from `s7-memory.json`, produced by runs I did this session (`spikes/s7-memory/run2.mjs`, `run3.mjs`), except items marked "earlier-agent log" (`spikes/s7-memory/bench.log`, re-read, not in the json).

## Method limits (read first)
- This is NOT a 30-minute playback. The 60 s fixture is played as 30 consecutive clips x 3 s (non-keyframe-aligned in-points, 2700 timeline frames) at real time: 90 s wall clock. It exercises 29 clip boundaries, not 30 minutes of drift.
- `performance.memory` is not exposed in Workers, so playback/scrub ran with decode+cache on the MAIN thread (`?direct=1`). JS heap for the Worker layout of ADR-0007 was not measured. I also sampled the OS working set of the launched Chrome process tree every 10 s (PowerShell), which includes the GPU process.
- Cache = LRU keyed by timeline frame; evicted entries are always closed; counters track every VideoFrame/ImageBitmap created and closed. The cache stores ImageBitmap copies because the HW decoder stalls after 8 held VideoFrames (see S1 holdTest).
- Decode runs at most 30 frames ahead of the playhead; frames are drawn to a 960x540 OffscreenCanvas. Synthetic footage.

## (a) Playback and leak check
| Run | Result | Criterion | Verdict |
|---|---|---|---|
| 90 s, 30 clips, HW decode, bitmap LRU max 60 | presented 2700/2700, missed 0, boundary misses 0 (29 boundaries), startup 57 ms | smooth | OK |
| same: JS heap (main thread, 1 Hz, n=89) | min 37 MB, max 79 MB, avg 52 MB first half vs 59 MB second half, last 45 MB | < 1 GB, no unbounded growth | PASS (90 s only) |
| same: counters | VideoFrame 3645 created / 3645 closed; ImageBitmap 2700 / 2700; max open bitmaps 61; final open 0; evictions 2640 | evicted frames closed | PASS |
| same: OS working set of Chrome tree | 1168 MB at 1 s -> 2250 MB at 90 s; GPU process 634 -> 1686 MB; renderer 258-330 MB flat; browser ~200 MB flat; still rising at the end | not a stated criterion | CONCERN / INCONCLUSIVE (leak vs lazy reclaim not determined) |

Earlier-agent log, same 90 s case in Worker mode (JS heap unavailable): OS total 1238 -> 2157 MB, the same pattern, so the GPU growth reproduces. Earlier-agent log, cache 30, 30 clips x 1 s: 900/900 presented, 0 missed, counters balanced (1815/1815 VideoFrame, 900/900 bitmaps), OS 1798 -> 2471 MB (that browser had run earlier workloads).

INCONCLUSIVE / not completed: cache 120 comparison; raw-VideoFrame cache with HW and SW decode; 4K playback through the cache. In my first batch Chrome disconnected during the second run for an unknown reason (GPU process was above 2 GB at the time; cause not established), so those runs were dropped rather than guessed. Reasoning only: S1 holdTest shows the HW decoder halts at 8 held frames, so a VideoFrame cache of 30-120 frames is not feasible on HW decode.

## Fast scrubbing (random seek every 100 ms for 20 s, HW, LRU 60)
186 requests, 154 completed, 30 superseded (cancelled by a newer request), 0 failed, 5 cache hits. Completed latency p50 69.9 ms, p95 96.3 ms, max 100.6 ms. JS heap 38-86 MB. Counters balanced: VideoFrame 5083/5083, ImageBitmap 149/149, final open 0. OS working set 850 MB -> 2074 MB over 12 s (GPU process 317 -> 1498 MB), only two OS samples. Verdict: no JS leak, latency fine; GPU memory growth INCONCLUSIVE.

## (b) Proxy generation (decode HW -> resize to 960x540 on OffscreenCanvas -> VideoEncoder H.264 3 Mbps -> Mediabunny MP4 -> reopen)
| Source | Encoder flag | fps | x realtime | Output check | Criterion >= 1x |
|---|---|---|---|---|---|
| 1080p, 60 s | no-preference (HW expected, not verified) | 220.3 | 7.34x | 960x540, duration 60 s, 1800 packets, 1800 decodable, 23.1 MB | PASS |
| 4K, 20 s | no-preference | 75.6 | 2.52x | 960x540, duration 20 s, 600/600 decodable, 8.1 MB | PASS |
| 1080p, 60 s | prefer-software | 161.4 | 5.38x | 960x540, 60 s, 1800/1800 decodable | PASS |

Open VideoFrames at end: 0, max open 2, in all proxy runs. Output size matches 3 Mbps (23.1 MB over 60 s is about 3.1 Mbps). One run each, no repetitions.

## Verdicts vs criteria
- JS heap < 1 GB, no unbounded growth: PASS (peak 86 MB in playback and scrub, flat; main thread; 90 s of playback, not 30 minutes).
- Proxy generation >= 1x realtime: PASS (7.3x for 1080p, 2.5x for 4K).
- Whole-process memory: not a stated criterion but the dominant risk. The GPU process grew roughly 1 GB in 90 s of operation with balanced counters. Cause unresolved; needs a longer soak with per-process memory sampling to see whether it plateaus.

## Recommendation
ADR-0007: keep Proposed but amend: (1) the frame-cache rule should say cache copies (ImageBitmap/texture), never live VideoFrames on HW decode (limit about 8); (2) JS heap is the wrong sole health metric, so add GPU/process memory and a plateau check to leak detection; (3) keep frame-cache budgets low (30-60 frames) until a 10-30 minute soak shows GPU memory plateaus. Fallback trigger: if GPU memory does not plateau in a soak, lower the cache to 30 frames and re-test. Proxies are cheap (>= 2.5x realtime even from 4K), so making them mandatory above 1080p is affordable whenever needed.
