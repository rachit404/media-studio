# Feasibility spike results (2026-11-17)

Throwaway spikes run on the owner's machine: Windows 11, Intel Iris Xe (no discrete GPU), Chrome 157 (branded) and Edge 157.
Full write-ups with raw numbers are in `spikes/results/*.md|json` (code in `spikes/`, not part of the product).

**How to read this.** Each row was checked against the spike's own result file. Footage is synthetic (ffmpeg testsrc2 + noise), so real
footage may compress and decode differently. Other agents ran concurrently during some untimed work; timed runs used a lock but the
lock only covered the spike agents, not the rest of the machine.

| Spike | Verdict | Key measured numbers | ADR impact |
|---|---|---|---|
| **S1 decode** | **PASS** (with seek caveats) | 1080p H.264 hardware 744-860 fps (25-29x realtime), software 250 fps; 4K H.264 hardware 310-322 fps (10x); seek on a 2 s GOP: p95 83 ms raw / 130 ms via Mediabunny (hardware), but **p95 244-325 ms on software decode, and p95 315 ms on a 10 s GOP (hardware)**; HEVC decodes on hardware only | ADR-0003: keep. Proxies needed for long-GOP and non-hardware sources |
| **S2 storage** | **PASS** for OPFS; **File System Access picker NOT verified** | OPFS sync handle in a worker: 4 GB write at 1,186 MB/s, 0 integrity errors, flat memory; `createWritable` stream 108-130 MB/s; single-writer rule confirmed; `persist()` false; one automation context hit `QuotaExceededError` at ~930 MB while `estimate()` claimed 11.7 GB | ADR-0005: keep, add startup write probe. **Owner must run `spikes/s2-storage/manual-fsa.html`** |
| **S3 render** | **PASS on speed, PARTIAL on blend exactness** | 8-layer scene with live video 58.5 fps, p95 16.8 ms; export-style readback 75.8 fps (2.5x) and works in a Worker; normal/multiply/screen error 1.2/255; **overlay below full opacity error up to 64/255** | ADR-0004: keep PixiJS, amend; fallback not triggered |
| **S4 export** | **PASS** (all four criteria) | Hardware H.264 85-97 fps (2.8-3.2x realtime); software 68 fps (2.3x); VP9 hardware 121 fps; worker heap flat at 12-15 MB; 1800/1800 frames closed; cancel clean-up 0.4-8.5 ms; output re-opens at 60.01 s, 1800 frames, audio present | ADR-0003/0007: keep. Cheap synthetic rendering means these are upper bounds |
| **S5 undo** | **INCONCLUSIVE on latency; PASS on memory and correctness** | History heap 60-118 MB at 10,000 edits; simple edits 0.2-0.7 ms; **structural edits (split, ripple delete, reorder) worst case 79 ms undo / 91 ms redo**; one array splice makes 470-1,070+ Immer patches; autoFreeze off cut apply cost from ~0.4 ms to 0.01 ms | ADR-0006: needs changes (normalised data) before M2 |
| **S6 probe** | **Answered for this machine only** | Headless branded Chrome 157 has working VideoEncoder, H.264 (hardware and software), VP9, AAC, Opus, and hardware-backed WebGL2/WebGPU. Linux and GitHub-runner cells **UNVERIFIED** | ADR-0012: keep, scope claims to "verified on Windows + Iris Xe" |
| **S7 memory/proxy** | **PASS on stated criteria; one serious unresolved concern** | JS heap 37-86 MB flat; all VideoFrames closed; proxy 1080p to 540p 7.3x realtime, 4K 2.5x; scrubbing p95 96 ms; **GPU process memory grew 634 to 1,686 MB over 90 s with balanced counters (leak vs lazy reclaim unknown)** | ADR-0007: frame cache design changes, soak test needed |

## Findings that change the architecture
1. **The hardware decoder stalls when about 8 `VideoFrame`s are held** (S1 hold test). The frame cache must hold copies (e.g. `ImageBitmap`), never decoder-owned frames. A VideoFrame cache of 30-120 frames is not feasible. (S7 reasoning from the S1 hold test; the VideoFrame-cache run itself was not completed.)
2. **JS heap is not a valid health metric.** The GPU process grew ~1 GB in 90 s while every counter balanced. Memory budgets must include GPU/process memory, and a longer soak test is required before claiming long-session stability.
3. **PixiJS blend modes are not all exact.** Overlay is wrong below full opacity. Only normal, multiply, screen and overlay were tested; every other blend mode is unverified.
4. **Immer array patches are the undo bottleneck**, not history depth. Ordered collections need a map-by-id plus order-key shape.
5. **Software decode and long-GOP sources miss the seek target.** Proxy media (short GOP) is required, not optional, for those.
6. **`OfflineAudioContext` and `performance.memory` do not exist in workers.** Export audio mixing stays on the page thread (or needs another approach).
7. **Never trust `navigator.storage.estimate()`.** Probe real write capacity at startup.

## Not verified / still open
- Real File System Access API path (native dialogs cannot be automated): **owner to run `spikes/s2-storage/manual-fsa.html`**.
- Linux and GitHub Actions runner behaviour (probe command is in `spikes/results/s6-probe.md`).
- Real (non-synthetic) footage; 4K through the full playback cache; 30-minute soak; background-tab throttling during export; segmented export.
- Blob-download fallback above 2 GB; Safari and Firefox (no spike ran on them).
- S5 on a normalised document, on an idle machine.
- Why one automation browser context hit a ~930 MB OPFS quota error (possibly RAM-backed storage); check in a real Incognito window.
