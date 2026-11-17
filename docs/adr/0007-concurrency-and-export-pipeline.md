# ADR-0007: Concurrency model and export pipeline

- **Status:** Proposed. Pending spikes S4, S7 (2026-11-17)

## Context
Reliable exports are a core product principle. Browser tabs can be throttled, memory is limited and
`VideoFrame` objects hold GPU/decoder memory until closed. Open-source browser editors surveyed
converge on one pattern: a real-time preview path and a separate deterministic offline export path
([Timeline Studio write-up](https://dev.to/martindelophy/how-i-built-a-local-first-ai-video-editor-with-webcodecs-webgpu-and-wasm-4lkn)).

## Decision
1. **Two paths, one scene description.**
   - *Preview:* real-time, may drop frames, uses proxy media, audio through Web Audio.
   - *Export:* timestamp-driven (frame N maps to an exact timeline time), full-resolution originals, never drops frames.
   Both consume the same immutable document snapshot and the same `Renderer` interface.
2. **Workers.** Decode, render/encode and storage I/O run in dedicated workers; the main thread only handles UI. Typed message protocol
   (Comlink, Apache-2.0, is an acceptable implementation). Rendering uses `OffscreenCanvas`.
3. **Audio.** Preview uses live Web Audio. Export mixes with `OfflineAudioContext`, encodes with `AudioEncoder`, and the muxer
   interleaves it with video. Encoders are configured before tracks are created.
4. **Backpressure and memory.** Bounded queues between stages; a strict ownership rule that whoever receives a `VideoFrame`
   closes it; a frame-cache budget with eviction; leak detection in dev builds.
5. **Failure handling.** A typed export error taxonomy (unsupported codec, out of memory/quota, decode error, cancelled,
   write failure) with user-readable messages. Cancel completes quickly and cleans up partial files.
   Long exports render in segments so a failure can resume instead of restarting.
6. **No cross-origin isolation requirement in v1.** The core pipeline must not need `SharedArrayBuffer`, so hosting never depends on
   COOP/COEP headers. (Only a future multithreaded WASM fallback would.)

## Consequences
- More up-front architecture than a single-thread prototype, but it is the part that makes exports predictable.
- Hardware vs software encode differences make output bitrates vary; export presets expose bitrate/quality targets, not "same bytes".

## Spike findings (2026-11-17, see ../research/spike-results.md)
- S4 PASS: render+encode+mux in a worker, backpressure on `encodeQueueSize`, strict frame closing (1800/1800), flat worker heap (12-15 MB), cancel clean-up under 10 ms, correct output. Rendering was cheap synthetic 2D, so speeds are upper bounds.
- **Amendments:**
  1. The decoder-side **frame cache must hold copies (e.g. `ImageBitmap`), not `VideoFrame`s**: hardware decoding stalls when ~8 frames are held.
  2. **JS heap is not a health metric.** GPU-process memory grew ~1 GB in 90 s with balanced counters (cause unknown). Budgets must include process/GPU memory; a long soak test is required.
  3. `OfflineAudioContext` and `performance.memory` are not available in workers; the audio mix runs on the page thread.
  4. Cancel by closing encoders, then `output.cancel()`, then `removeEntry()`. `writable.abort()` throws a `TypeError` on the OPFS sink.
  5. Proxy media (short GOP) is mandatory for long-GOP and software-decoded sources. Proxy generation ran at 7.3x (1080p to 540p) and 2.5x (4K).
