# S4 export pipeline (ADR-0003 / ADR-0007)

Run 2026-11-17T17:12:11.243Z to 2026-11-17T17:31:25.041Z. Browser: 157.0.8103.79 (branded Chrome, headed, temp profile). Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36
Machine: 16 logical cores, 16 GB, WebGL2 renderer `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)`.
Timeline: 60 s, 1920x1080, 30 fps (1800 frames), stereo 48 kHz audio mixed from 3 oscillators with OfflineAudioContext, AAC-LC 128 kbps. Video 8 Mbps target, keyframe every 60 frames, `latencyMode` default, encode queue cap 6.
Every timed export ran inside `withBenchLock('s4')`. **Other agents were running untimed work (and holding the lock for their own timed runs in between) on the same laptop**, so wall-clock numbers carry CPU/GPU contention noise; the run-to-run spread below is the honest uncertainty.

## Method
Page (main thread) mixes audio with OfflineAudioContext (not available in workers) and hands the planar Float32 channels to a dedicated worker. The worker draws each frame (gradient + 14 circles + 6 rotating rects + text, cheap 2D) on a 1920x1080 OffscreenCanvas, makes `new VideoFrame(canvas, {timestamp, duration})` with timestamp = round(i*1e6/30) microseconds, calls `VideoEncoder.encode`, and closes the frame immediately. Backpressure: wait while `encodeQueueSize > 6` or > 40 packets are pending in the muxer. Encoded chunks go to Mediabunny `EncodedVideoPacketSource` / `EncodedAudioPacketSource` (AAC fed one second at a time, one second ahead of video) in an `Output` with `Mp4OutputFormat` and either `BufferTarget` (default fastStart: in-memory moov-first) or `StreamTarget` over an OPFS `createWritable()` stream (default: moov at end). Mediabunny 1.66.0 is used unmodified.
Reported "wall" = first frame drawn to finalized file (worker side; excludes audio mix, worker start-up and the later verification). Audio mix time is listed separately and added in the "incl. mix" column. JS heap of the worker and the page are read from Node via CDP `Runtime.getHeapUsage` every ~0.8 s (`performance.memory` does not exist inside workers); per-process working set (RSS) every ~10 s via PowerShell; per-process-type CPU seconds via CDP `SystemInfo.getProcessInfo`. Verification re-opens the output with Mediabunny `Input` and decodes **all** frames (outside the timed section).

## Results: full 60 s exports

| Run | Codec | HW requested | Sink | Wall s | Encode fps | x realtime | x realtime incl. audio mix (0.55 s) | Render+VideoFrame ms/frame | Peak encode queue | Max open VideoFrames (end) | File MB | Bitrate Mbps | Output verified |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h264-hw-buffer | avc1.640028 | hardware | buffer | 18.5 | 97.1 | 3.24 | 3.11 | 0.52 | 7 | 1 (0) | 63.43 | 8.46 | PASS |
| h264-sw-buffer | avc1.640028 | software | buffer | 26.6 | 67.8 | 2.26 | 2.20 | 0.52 | 7 | 1 (0) | 59.67 | 7.96 | PASS |
| h264-hw-opfs | avc1.640028 | hardware | opfs | 21.2 | 84.8 | 2.83 | 2.75 | 0.84 | 7 | 1 (0) | 63.43 | 8.46 | PASS |
| h264-hw-buffer-rerun | avc1.640028 | hardware | buffer | 19.6 | 91.9 | 3.06 | 3.00 | 0.54 | 7 | 1 (0) | 63.43 | 8.46 | PASS |
| vp9-hw-buffer | vp09.00.40.08 | hardware | buffer | 14.8 | 121.4 | 4.05 | 3.94 | 0.52 | 7 | 1 (0) | 59.62 | 7.95 | PASS |
| vp9-sw-buffer | vp09.00.40.08 | software | buffer | 21.7 | 83.0 | 2.77 | 2.71 | 0.44 | 7 | 1 (0) | 47.12 | 6.28 | PASS |

### Where the time went (CPU seconds by browser process type during the timed section; hardware vs software evidence)

| Run | browser | renderer (incl. worker) | GPU | utility/other | Wall s |
|---|---|---|---|---|---|
| h264-hw-buffer | 0.64 | 5.74 | 22.29 | 0.07 | 18.5 |
| h264-sw-buffer | 0.23 | 76.2 | 7.27 | 0.07 | 26.6 |
| h264-hw-opfs | 4.11 | 8.01 | 30.98 | 0.22 | 21.2 |
| h264-hw-buffer-rerun | 1.64 | 5.58 | 22.88 | 0.09 | 19.6 |
| vp9-hw-buffer | 0.66 | 4.67 | 21.65 | 0.05 | 14.8 |
| vp9-sw-buffer | 0.16 | 112.82 | 4.63 | 0.06 | 21.7 |

### Memory (criterion: heap plateaus; growth = mean of last quarter of samples minus mean of second quarter must be < 25 MB, fixed before looking at data)

| Run | Worker heap min / max MB | 2nd-quarter mean | last-quarter mean | growth MB | slope MB/s | Page heap max MB | Peak RSS by type (MB) | Frames created / closed | Plateau? |
|---|---|---|---|---|---|---|---|---|---|
| h264-hw-buffer | 11.8 / 14.6 | 13.1 | 14.0 | 0.9 | 0.10 | 13.3 | renderer 335, GPU 394, browser 132 | 1800 / 1800 | PASS |
| h264-sw-buffer | 12.5 / 14.4 | 13.2 | 13.7 | 0.5 | 0.04 | 14.0 | renderer 517, GPU 297, browser 86 | 1800 / 1800 | PASS |
| h264-hw-opfs | 11.8 / 14.2 | 13.0 | 13.2 | 0.3 | 0.05 | 14.2 | renderer 370, GPU 403, browser 187 | 1800 / 1800 | PASS |
| h264-hw-buffer-rerun | 11.8 / 14.5 | 13.0 | 13.8 | 0.7 | 0.09 | 14.2 | renderer 347, GPU 400, browser 129 | 1800 / 1800 | PASS |
| vp9-hw-buffer | 12.4 / 14.2 | 13.3 | 13.8 | 0.4 | 0.09 | 13.9 | renderer 431, GPU 416, browser 133 | 1800 / 1800 | PASS |
| vp9-sw-buffer | 12.5 / 14.4 | 13.3 | 13.7 | 0.4 | 0.05 | 13.3 | renderer 587, GPU 259, browser 135 | 1800 / 1800 | PASS |

### Cancel at ~50% (criterion: < 2 s, encoders closed, frames released, no partial file, no callbacks after cancel)

| Run | Cancel msg latency ms | Encoders closed after ms | Output.cancel done ms | Total cleanup ms | Frame at cancel | Frames created / closed | Open after | Encoder states | Partial file remains | OPFS entries after | Callbacks after cancel (1.5 s watch) | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cancel50-h264-hw-opfs | 0.30 | 1.20 | 3.00 | 8.50 | 901 | 901 / 901 | 0 | closed/closed | false | [] | 0 | PASS |
| cancel50-h264-sw-buffer | 0.00 | 0.20 | 0.40 | 0.40 | 901 | 901 / 901 | 0 | closed/closed | n/a (buffer sink: nothing on disk) | "n/a" | 0 | PASS |

Note on OPFS cancel: `writable.abort()` throws TypeError because Mediabunny holds the stream's writer lock; `output.cancel()` plus `removeEntry()` is what actually cleaned up (see the `writableAbort`/`removeEntry` fields in the JSON).

### Output verification (Mediabunny Input re-open of the produced file)

| Run | Format | Duration s (video / audio) | Video codec, size | Packets / decoded frames | Max timestamp error vs N/30 (s) | Audio | First / last frame | SHA-256 (first 12) | Decode-all ms |
|---|---|---|---|---|---|---|---|---|---|
| h264-hw-buffer | MP4 | 60.01 / 60.01 | avc 1920x1080 | 1800 / 1800 | 0 | aac 2ch 48000 Hz | ok (0) / ok (59.97) | 01001a5a4b27 | 1395.8 |
| h264-sw-buffer | MP4 | 60.01 / 60.01 | avc 1920x1080 | 1800 / 1800 | 0 | aac 2ch 48000 Hz | ok (0) / ok (59.97) | 8f011bc93b55 | 3434.1 |
| h264-hw-opfs | MP4 | 60.01 / 60.01 | avc 1920x1080 | 1800 / 1800 | 0 | aac 2ch 48000 Hz | ok (0) / ok (59.97) | 942f99a8a0e3 | 1517.6 |
| h264-hw-buffer-rerun | MP4 | 60.01 / 60.01 | avc 1920x1080 | 1800 / 1800 | 0 | aac 2ch 48000 Hz | ok (0) / ok (59.97) | 5e06ddfbd5ca | 1454.6 |
| vp9-hw-buffer | MP4 | 60.01 / 60.01 | vp9 1920x1080 | 1800 / 1800 | 0 | aac 2ch 48000 Hz | ok (0) / ok (59.97) | e8fc62b3e043 | 1054.2 |
| vp9-sw-buffer | MP4 | 60.01 / 60.01 | vp9 1920x1080 | 1800 / 1800 | 0 | aac 2ch 48000 Hz | ok (0) / ok (59.97) | be144d8914b6 | 1003.1 |

Determinism: h264-hw-buffer vs h264-hw-buffer-rerun output SHA-256 DIFFER (bytes differ between two identical runs; timestamps/frame count are still exact, see table); packet/frame timestamps equal N/30 within the "max timestamp error" column in every run.

## Pass criteria

| Criterion | Measured | Verdict |
|---|---|---|
| >= 1x realtime (>= 30 fps) on hardware H.264 encode | h264-hw-buffer: 97.1 fps (3.24x); h264-hw-opfs: 84.8 fps (2.83x); h264-hw-buffer-rerun: 91.9 fps (3.06x) | PASS |
| Heap plateaus (no growth per frame) | worker-heap growth Q4-Q2 MB: h264-hw-buffer 0.9; h264-sw-buffer 0.5; h264-hw-opfs 0.3; h264-hw-buffer-rerun 0.7; vp9-hw-buffer 0.4; vp9-sw-buffer 0.4 | PASS |
| Cancel < 2 s with clean-up | cancel50-h264-hw-opfs: 8.5 ms, partial file: false, open frames 0; cancel50-h264-sw-buffer: 0.4 ms, partial file: n/a, open frames 0 | PASS |
| Output re-opens with correct duration (and 1800 frames, 1920x1080, audio, first/last decodable) | h264-hw-buffer: all checks pass; h264-sw-buffer: all checks pass; h264-hw-opfs: all checks pass; h264-hw-buffer-rerun: all checks pass; vp9-hw-buffer: all checks pass; vp9-sw-buffer: all checks pass | PASS |


## Caveats (read before relying on the numbers)

- **The render step is deliberately cheap** (2D canvas, about 0.5 ms/frame). These figures measure the encode + mux + pipeline side only. A real compositor (S3: PixiJS, effects, decoded source video, 4K) will cost more per frame, so the 2.3x to 4x realtime headroom measured here is an **upper bound** for end-to-end export, not a prediction of it. With the encoder as the only load, hardware H.264 encode alone sustained about 85 to 97 fps on this Iris Xe.
- Other agents ran untimed work on the same laptop and held the bench lock for their own timed runs in between; there is contention noise. Hardware H.264 at 1080p ranged 84.8 to 97.1 fps across 3 runs (about 13% spread); the OPFS sink was the slowest of the three. Single machine, single Chrome (157.0.8103.79), headed, one 60 s timeline. Nothing here transfers to other GPUs, laptops on battery, thermally throttled runs, or Safari/Firefox.
- Hardware vs software is **inferred**, not reported by the API: `isConfigSupported` accepted `prefer-hardware`, and the per-process CPU split matches (hardware runs: GPU process 22 to 31 CPU-s and renderer about 5 to 8 CPU-s; software runs: renderer 76 to 113 CPU-s and GPU 5 to 7 CPU-s). Software H.264 used about 76 CPU-seconds on the renderer process for a 60 s clip, which would starve a real renderer sharing those cores.
- Heap plateau evidence is the JS heap of the worker (11.8 to 14.6 MB for every run, growth 0.3 to 0.9 MB between the 2nd and last quarter) plus a frame leak counter (created == closed == 1800; at most 1 open frame; encode queue peaked at 7 against a cap of 6 because the check happens before `encode`). This does **not** measure native/GPU memory inside `VideoFrame` or encoder buffers: process RSS was only sampled about every 10 s (2 to 3 samples per run: renderer 240-590 MB, GPU 260-420 MB, no sign of growth between the last two samples but too coarse to prove a plateau). The BufferTarget holds the whole 63 MB file in memory; the OPFS StreamTarget avoids that.
- Cancel was triggered from the page at frame 900 and measured **inside the worker** (message received to everything closed). The worker yields to the event loop every 4 frames, so cancel latency is bounded by roughly 4 frames of render time plus one encode call; with a heavier renderer, add that. It was measured once per variant (hardware+OPFS, software+buffer), not repeated. For the OPFS sink, `writable.abort()` threw a TypeError (Mediabunny holds the writer lock); `output.cancel()` followed by `removeEntry()` left no partial file and no callbacks fired in the 1.5 s afterwards.
- Output verified by re-opening with Mediabunny `Input` and decoding all 1800 frames: duration 60.011 s (video and audio; the extra 11 ms is the AAC tail), 1920x1080, AAC stereo 48 kHz, timestamps exactly N/30. Bytes are not deterministic across identical hardware runs (different SHA-256), frame count and timestamps are.
- Not done: an "export in a background tab" throttling test (ADR-0007 mentions throttled tabs; the worker pipeline ran in a foreground tab only), segmented/resumable export, 4K, HEVC, WebM/Opus output, hardware-encode behaviour on battery. Audio fallback to Opus was not exercised in S4 (AAC worked); S6 confirms Opus encode works.

## Recommendation

Verdict: **PASS on all four criteria**, with the above caveats. **ADR-0003 and ADR-0007 can stay as proposed** for the export side: WebCodecs + Mediabunny, worker-driven render/encode, backpressure on `encodeQueueSize`, strict frame closing, `OfflineAudioContext` mix in the page, and cancel by closing encoders then `output.cancel()` all behaved as the ADRs say. Suggested clarifications rather than changes:
1. ADR-0007 item 3: `OfflineAudioContext` is not available in workers, so the audio mix has to run on the main thread (or be replaced by a hand-written mixer in the worker); the mix took about 0.6 to 0.7 s for 60 s here.
2. ADR-0007 item 4: `performance.memory` does not exist in workers, so dev-build leak detection should count frames (as the spike did) and read heap via a main-thread message or CDP.
3. Prefer the OPFS/StreamTarget path for long exports (no whole-file buffer); handle cancel as `output.cancel()` + delete the file.
4. Hardware vs software output differ in size at the same nominal bitrate (H.264 63.4 MB hardware vs 59.7 MB software; VP9 59.6 vs 47.1 MB), as ADR-0007 consequences already say.

Fallback triggers (from the spike plan, unchanged): switch to segmented export and a software-encode fallback with a user warning if, on a target machine, hardware encode is below 1x realtime **with the real renderer**, the heap or process RSS grows with frame count, cancel takes 2 s or more, or the output fails re-open verification. Software H.264 was also at least 2.2x realtime here, but costs most of the CPU, so expect it to be the first thing to fail once the real compositor shares those cores.
