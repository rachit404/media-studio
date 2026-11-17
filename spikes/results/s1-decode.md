# S1 - Decode throughput and seeking (throwaway spike)

Machine: Windows 11, Intel Iris Xe (ANGLE D3D11), 16 logical cores, 16 GB; Chrome 157 (branded, headed, temp profile). Environment block: `s1-decode.json` -> `env`.
Fixtures are synthetic ffmpeg testsrc2+noise, so complexity differs from real footage (the 4K fixture is 30 Mbps Baseline profile; the 1080p one is 8 Mbps High profile, so they are not like-for-like).
Data origin: all numbers are from `s1-decode.json` (re-read and cross-checked against `spikes/s1-decode/bench.log`). The seq/seek/gopCache runs were produced by the earlier (stopped) agent; I reviewed them (all 4 fixtures plus the GOP10 file, HW and SW, seeks present, no frame leaks, support probe present) and found nothing that needed a re-run. The `holdTest` block was run by me this session.

## Method
Worker; Mediabunny `Input`/`EncodedPacketSink` demux; raw WebCodecs `VideoDecoder`; every VideoFrame closed (leak = 0 in every run); decode queue bounded to 8. Sequential timing = decoder feed -> flush with packets pre-collected (demux 80-180 ms excluded, recorded separately). Two repetitions per case. Cross-check through Mediabunny `VideoSampleSink.samples()` (end-to-end demux+decode). Seek = 30 random frame-aligned timestamps (seed 7, 2 warm-ups discarded), request -> target frame output, decoding forward from the previous keyframe on a warm, reused decoder. The raw-path seek does not record whether the target-frame callback fired (it falls back to flush completion), so exact-frame correctness is only enforced in the Mediabunny `getSample` path (timestamp checked, no WRONG_FRAME).

## Sequential decode
| Case | HW fps (x realtime) | SW fps (x realtime) | Criterion | Verdict |
|---|---|---|---|---|
| 1080p H.264, 60 s | 744 / 860 (24.8x / 28.7x) | 250 / 248 (8.3x) | >= 60 fps | PASS (HW and SW) |
| 4K H.264, 20 s | 310 / 322 (10.3x / 10.7x) | 417 / 420 (13.9x / 14.0x) | >= 30 fps | PASS (HW and SW) |
| 1080p VP9, 10 s | 1592 (53x) | 278 / 319 (9.3x / 10.6x) | informational | OK |
| 1080p HEVC, 10 s | 1142 / 1220 (38x / 41x) | UNSUPPORTED (isConfigSupported false) | informational | HW only |

Mediabunny sink end-to-end: 1080p H.264 HW 849.5 fps (28.3x), SW 246.5 fps (8.2x); VP9 HW 1504 fps, SW 305 fps.
Surprise: 4K software decode beat 4K hardware decode (14x vs 10.5x). The 4K fixture is Baseline profile (cheap entropy decoding, no B-frames), so do not generalise; real High-profile 4K footage still needs a test.

## Random seek (30 seeks, ms)
| File / path | p50 | p95 | max | Criterion (<150 ms, GOP <= 2 s) |
|---|---|---|---|---|
| GOP 2 s, HW, raw WebCodecs | 37.9 | 82.6 | 98.7 | PASS |
| GOP 2 s, HW, Mediabunny getSample | 60.6 | 130.3 | 163.3 | PASS on p50/p95; max exceeds 150 (marginal) |
| GOP 2 s, SW, raw | 109.6 | 325 | 333 | FAIL (p95); p50 passes |
| GOP 2 s, SW, Mediabunny | 129 | 244 | 264 | FAIL (p95) |
| GOP 10 s, HW, raw | 160.6 | 315 | 330 | FAIL (outside criterion scope, informational) |
| GOP 10 s, HW, Mediabunny | 204 | 352 | 398 | FAIL |
| GOP 10 s, SW, raw | 558 | 1097 | 1188 | FAIL |

The criterion did not name a statistic; I judged on p95. Packets decoded per seek: GOP2 mean 28 (max 60), GOP10 mean 134 (max 255), so latency scales with frames since the keyframe.
GOP-interval frame cache experiment (extra): with small random-walk scrubbing the hit rate was 60% on GOP2, but fill misses cost 300-430 ms (decode whole GOP and copy to ImageBitmaps); with +-25 s jumps hit rate was 25% (GOP2, fill p50 301 ms) and GOP10 fill p50 1671 ms. Not a win for random access; useful only for local scrubbing.

## Held-frame test (new, important for ADR-0007)
Feeding 400 packets while holding every output VideoFrame un-closed: the hardware decoder stops after 8 outputs and `flush()` never completes (6 s timeout); the software decoder delivers all 400. A decoded-frame cache of live VideoFrames cannot exceed about 8 frames on the HW path; caches must hold copies (ImageBitmap/texture).

## Verdicts
- 1080p30 H.264 >= 2x realtime: PASS (24.8-28.7x HW; 8.3x SW).
- 4K H.264 >= 1x realtime: PASS (10.3-10.7x HW; 14x SW) on this synthetic Baseline fixture.
- Seek < 150 ms, GOP <= 2 s: PASS on hardware decode (p95 83 ms raw, 130 ms via Mediabunny; max 163 ms via Mediabunny). FAIL on the software decoder (p95 244-325 ms).
- Long-GOP (10 s) sources: p95 315 ms on HW, so the named fallback (proxy media) applies to long-GOP sources.

## Caveats
Synthetic footage; one machine; other agents were using the machine (timed runs held a shared lock, but processes outside the lock may still have loaded the GPU/CPU). HW vs SW is the requested flag; Chrome may fall back silently, but the 3x gap at 1080p suggests it was honoured. AV1 not tested (no fixture). Audio decode not measured.

## Recommendation
ADR-0003: S1 supports accepting Option A (WebCodecs + Mediabunny) for decode. Fallback triggers: (1) if a source's GOP is > 2 s or the hardware decoder is unavailable (software seek p95 > 150 ms), preview must use proxy media; (2) mandatory proxies above 1080p are not required by this data (4K decodes at 10x), but confirm with real High-profile 4K footage. Record the 8-held-frame hardware limit in ADR-0007.
