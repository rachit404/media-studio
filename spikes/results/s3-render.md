# S3 - Does PixiJS v8 meet the compositing need? (ADR-0004)

Date 2026-11-17. Raw data: `s3-render.json`. Code: `spikes/s3-render/` (run: `node s3-render/run.mjs bench`, then `rest`).

## Environment
Chrome 157 (headed, real GPU path), Windows 11, 16 logical cores, 16 GB. GL renderer: `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)`.
pixi.js 8.23.0, `preference: 'webgl'` (WebGL2), mediabunny 1.66.0. rAF sanity check on an empty page: 60.0 Hz, p99 16.8 ms (before and after the run).
Timed runs were inside `withBenchLock('s3')`; other agents ran untimed work on the same machine, so treat small outliers as possibly contended.

## Method
Scene: 1920x1080, 8 layers: gradient bg, checker, **live video** (1080p H.264, 60 s GOP-2s fixture, decoded by Mediabunny `VideoSampleSink` -> WebCodecs), radial gradient (multiply), stripes (screen), blobs (overlay + BlurFilter), rings (Graphics circle mask), rounded panel. Filters: 2x ColorMatrixFilter (brightness/contrast, brightness/saturation) + BlurFilter(8, quality 3). Every layer's transform and alpha animated each frame. "Full" = everything above; "Simple" = same layers with no filters, no mask, overlay downgraded to normal.
Video -> texture: `new ImageSource({resource: videoFrame})`, then per frame `source.resource = frame; source.update()`. Pixi's uploader calls `gl.texSubImage2D(..., VideoFrame)` directly (confirmed by reading the pixi source). Works with no extra code. Pixel check against a 2D-canvas `drawImage(frame)` at 4 points: max diff 0.

## Results vs criteria

| Criterion | Threshold | Measured | Verdict |
|---|---|---|---|
| Interactive, full scene, video layer decoding live (10 s) | >= 30 fps, p95 <= 33 ms | 58.5 fps; frame interval p50 16.7 / p95 16.8 / p99 33.3 / max 66.5 ms; 2 frames > 33 ms, 13 > 20 ms (of 576) | PASS |
| Interactive, full scene, no video | same | 59.8 fps; p50 16.7 / p95 16.8 / p99 17.0 / max 33.3; 0 frames > 33 ms (2 > 20 ms) | PASS |
| Export-style readback `new VideoFrame(canvas)` + close, 300 frames, unpaced, no video | >= 30 fps | 127.6 fps (4.25x realtime) | PASS |
| Same with live decoded video (sequential decode, one frame per output frame) | >= 30 fps | 75.8 fps (2.53x); per-frame p95 49.6 ms (bursty) | PASS |
| Same inside a Worker on OffscreenCanvas (`pixi.js/webworker`), 2 runs each | >= 30 fps | no video 114.1 / 146.4 fps; with video 72.8 / 84.9 fps (2.4-2.8x) | PASS (works) |
| Worst-case readback: full `gl.readPixels` 1080p RGBA each frame, with video | informational | 42.4 fps (1.41x) | PASS |
| Blend exactness: normal / multiply / screen (solid, alpha 1/.75/.5/.25) | <= 2/255 | max err 1.0 / 1.0 / 1.2 | PASS |
| Same with canvas textures (premultiply-on-upload, alpha down to 8/255) | <= 2/255 | max err 0.67 / 0.73 / 0.65 | PASS |
| Overlay (`pixi.js/advanced-blend-modes`) | <= 2/255 | **opacity 1: 0; opacity .75/.5/.25: 48 / 64 / 48; canvas textures: 31.8** | **FAIL** |
| Container filter limited to its children (adjustment-layer basis) | exact | 0 error inside, 0 at the edges, neighbours untouched; identity filter on a 50% alpha child equals unfiltered and W3C (err 0); brightness 0.5 on 50% alpha child err 0.5 | PASS |

## Findings and surprises
1. **Overlay is wrong for non-opaque layers.** The shader (`OverlayBlend`) feeds the premultiplied `front.rgb` into the blend function as if it were the source colour, then mixes by `front.a`. Exact only at opacity 1. The same template is used by the other advanced modes (not tested here). This is a library behaviour, not a harness artefact: reproduced with solid tint+alpha and with canvas-alpha textures. A custom `BlendModeFilter` with un-premultiplied colour should fix it; untested.
2. **Advanced blend modes need `useBackBuffer: true`** in the renderer options. Without it Pixi warns "Blend filter requires backBuffer" on every draw. All numbers above use `useBackBuffer: true`.
3. **A blend-mode child inside a filtered Container renders black** (multiply child, identity filter, backdrop outside the container: got [0,0,0]; pass-through would be [23.5,62.7,43.1], an isolated group would be [30,160,220]). So "blend modes inside a group that has an adjustment filter" does not work as either semantic. Adjustment layers over groups must flatten or avoid blended children.
4. **Video upload is the dominant cost, not Pixi.** Getting a 1080p VideoFrame into a GL texture costs ~8 ms/frame on this iGPU: raw `texSubImage2D(VideoFrame)` 8.2 ms mean (p95 12.3); via Pixi ImageSource 7.9 ms; via `createImageBitmap` 6.95 ms mean (p99 37.9); via `copyTo` RGBA buffer 22.2 ms. Mediabunny decode alone ran 492 fps (main thread). Several simultaneous 1080p video layers would multiply the ~8 ms.
5. GPU-synchronised cost of the full scene (no video) is 10.9 ms/frame (p95 17.4) vs 4.9 ms for the Simple scene: the filters, mask and advanced blend add about 6 ms. Interactive is fine only because the frame budget is 16.7 ms at 60 Hz; headroom is roughly 1.5x, not large.
6. Blending is in gamma-encoded sRGB (no linearisation), which matches the W3C/CSS formulas used as the reference. Premultiply-on-upload gave no surprises for canvas alpha down to 8/255 (err <= 0.73).

## Raw WebGL2 baseline (option D, no library)
Same 8 quads, fixed-function blend (normal/multiply/screen; overlay as normal), no filters/mask. GPU-synchronised per-frame, 300 frames:

| Case | Raw WebGL2 | Pixi Simple | Pixi Full |
|---|---|---|---|
| no video | 3.11 ms (321 fps) | 4.92 ms (203 fps) | 10.92 ms (91 fps) |
| live video | 9.76 ms (102 fps) | 10.33 ms (97 fps) | n/a |
| live video + `VideoFrame` readback (wall fps) | 114.5 | n/a | 75.8 |

Raw is 1.6x faster than Pixi on a video-less simple scene but only 1.06x with a video layer (upload-bound). The raw version omits filters, mask and exact advanced blends, which are the work Pixi already does, so the fallback buys little speed for a lot of code.

## Caveats
- One machine, one iGPU, 60 Hz display (cannot show interactive headroom above 60 fps; the unpaced numbers do). Single 10 s / 300-frame runs per config (two for the worker), no repeats for variance.
- Other agents used the machine untimed during the run; the 2 dropped frames in the video run (66.5 ms max) could be contention or decode/main-thread work, not attributed.
- `new VideoFrame(canvas)` cost was measured; handing the frame to a real `VideoEncoder` is S4's job. The unpaced `videoframe` fps is wall time including a final GPU sync, but the per-frame numbers there exclude queued GPU work.
- The worker test used the Full scene; Pixi texture generation used OffscreenCanvas. Worker readback tested with `new VideoFrame(offscreenCanvas)`.
- WebGPU backend not tested. Only overlay was checked among the advanced blend modes. No selection-handle/text rendering tested.

## Recommendation
**Keep ADR-0004 option A (Pixi v8, WebGL2) but amend it; do not trigger the fallback yet.** Frame budget and export readback pass comfortably, container filters behave as non-destructive adjustment layers, and core blends are exact. Required changes: (1) set `useBackBuffer: true`; (2) treat Pixi's advanced blend modes as inexact for opacity < 1 and write our own un-premultiplied blend filters, validated with `blend.ts`, before claiming "exact blend semantics" (if that fails, option D for blending only); (3) specify that blend-mode layers cannot sit inside a filtered group (flatten first); (4) budget ~8 ms per 1080p video layer upload and keep proxies/downscaled frames for multi-video timelines.
