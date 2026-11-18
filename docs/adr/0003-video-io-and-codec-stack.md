# ADR-0003: Video I/O and codec stack

- **Status:** Proposed. Pending feasibility spikes S1, S4 (2026-11-17)

## Context
We need to demux/decode import files, decode frames for preview, encode frames and audio for
export, and mux to MP4/WebM, all in the browser, with predictable export behavior and licences
compatible with later commercial distribution.

## Options
| Option | Licence | Perf | Notes |
|---|---|---|---|
| **A. WebCodecs + Mediabunny** (v1.66) | MPL-2.0 | Hardware-accelerated where the browser/OS provides it | TypeScript, zero deps, tree-shakable. Reads/writes MP4, MOV, WebM, MKV and more; wraps WebCodecs. Supersedes mp4-muxer. |
| B. WebCodecs + MP4Box.js (v2.5) + separate WebM muxer | BSD-3-Clause | Same as A | More glue code; MP4/ISOBMFF focused |
| C. ffmpeg.wasm (`@ffmpeg/ffmpeg`) | wrapper MIT, **`@ffmpeg/core` GPL-2.0-or-later** | Software only; its own docs say it will not match native; Remotion's non-scientific benchmark found WebCodecs ≥5× faster | Broadest format support; **GPL core is incompatible with our licence policy (ADR-0011)** |
| D. libav.js (v6) | LGPL-2.1 | Software | LGPL + WASM static linking raises relinking obligations; needs legal review |

Sources: [Mediabunny](https://mediabunny.dev/), [Remotion WebCodecs benchmark](https://awesome.ecosyste.ms/projects/github.com%2Fremotion-dev%2Fwebcodecs-benchmark), npm registry licences (checked 2026-11-17).

## Decision
Use **A: WebCodecs for codec work and Mediabunny for container I/O**, behind our own
`MediaIO` interface so Mediabunny can be replaced. No ffmpeg.wasm or libav.js in the core bundle.
If a later need justifies a fallback for unsupported formats, it ships as an **optional,
lazy-loaded module** after a licence review, never as a hard dependency.

## Consequences
- v1 formats: import MP4/MOV/WebM (MKV later); export MP4 (H.264 + AAC) then WebM (VP9 + Opus).
  Actual availability is probed at runtime (ADR-0002); AAC/H.264 *encode* is not guaranteed everywhere.
- MPL-2.0 is file-level copyleft: we may use it freely, but any modification to Mediabunny's own files
  must be published. Policy: do not patch it in place; wrap it or upstream fixes.
- ProRes, DNxHD, exotic containers are out of scope.
- Risk: library maturity is moderate (single maintainer). Mitigated by the interface and spikes.

## Spike findings (2026-11-17, see ../research/spike-results.md)
- S1 PASS: 1080p H.264 hardware decode 744-860 fps, 4K 310-322 fps; S4 PASS: hardware H.264 export 85-97 fps (2.8-3.2x realtime), output re-opens correctly. Decision stands.
- Seek-to-frame meets the target only on hardware decode with a 2 s GOP (p95 83 ms raw, 130 ms via Mediabunny). Software decode (p95 244-325 ms) and 10 s GOPs (p95 315 ms) fail, so **proxy media is mandatory for long-GOP or software-decoded sources**.
- HEVC decoded on hardware only here; software HEVC is unsupported. Availability stays a runtime probe.
- Caveat: synthetic footage and a Baseline-profile 4K fixture; re-test with real clips.

## M5 implementation notes (2026-11-18)
- Mediabunny (1.66) is used for demuxing, decoding, muxing and encoding behind our own adapters in `media-io` (`probeMedia`, `VideoSource`, `AudioFileReader`, `Mp4Writer`); nothing outside `media-io` imports it.
- Spike S8: 16 concurrent 1080p30 H.264 decoders ran on Iris Xe in Chrome, hardware and software, at 850 to 1,000 frames per second in total; the decoder count is not the limiting factor for 1080p. See [spikes/results/s8-concurrency.md](../../spikes/results/s8-concurrency.md).
- Export uses H.264 and AAC only for now, written to memory; WebM/VP9, hardware and software selection, stream-to-disk and verification are M7.
