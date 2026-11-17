# ADR-0004: Rendering stack (image canvas and video compositor)

- **Status:** Superseded for the renderer by [ADR-0020](0020-custom-webgl2-compositor.md) (2026-11-18): the fallback option D was taken. The `Renderer`/scene boundary described here still holds.
- **Original status:** Proposed. Must be confirmed by spike S3 (2026-11-17)

## Context
Both editors need GPU compositing: layers, masks, blend modes, filters/adjustments, text and
shapes, plus video frames as textures, and an offscreen path for deterministic export.

## Options
| Option | Licence | Strengths | Weaknesses |
|---|---|---|---|
| **A. PixiJS v8** (8.23) on WebGL2 | MIT | Mature scene graph, filters, masks, blend modes, WebGL and WebGPU backends | Game-oriented; exact blend/adjustment semantics and per-layer render-to-texture must be validated |
| B. Custom WebGPU renderer | n/a | Full control, future-proof | Large build/maintenance cost; WebGPU not universal (Linux rollout, Firefox partial) |
| C. Canvas2D / Konva (10.x) | MIT | Easy editor features (selection, transform handles) | CPU-bound; no custom shader filters; poor fit for video compositing |
| D. Thin custom WebGL2 compositor | n/a | Total control, universal | We write batching, blend modes, filter graph ourselves |

Sources: [PixiJS v8 launch](https://pixijs.com/blog/pixi-v8-launches) (the Pixi team notes WebGPU is not automatically faster, and may help with
frequent batch breaks from filters/masks/blend modes), [WebGPU status](https://web.dev/blog/webgpu-supported-major-browsers).

## Decision
Proposed: **A, using the WebGL2 backend as the baseline**, behind our own `Renderer` interface.
WebGPU is an optional later backend, never a requirement. Selection/transform handles and other UI
chrome are drawn by our own overlay layer, not by the compositor.

**Fallback plan:** if S3 shows Pixi cannot meet the frame budget, or cannot express non-destructive
adjustment layers and exact blend maths, switch to D (our own small WebGL2 compositor) behind the
same interface. Because the interface isolates it, this is a contained rewrite, not a rearchitecture.

## Consequences
- sRGB only in v1. Wide-gamut/ICC colour management is explicitly post-v1.
- Export renders on an `OffscreenCanvas` in a worker and hands frames to `VideoEncoder`.
- Pixel-exact snapshot tests must account for GPU vs SwiftShader differences (ADR-0012).

## Spike findings (2026-11-17, see ../research/spike-results.md)
- S3: PixiJS v8 on WebGL2 passes speed (8 layers + live video: 58.5 fps, p95 16.8 ms; export readback 75.8 fps, also in a Worker). Fallback D is **not** triggered.
- **Amendments:** (1) overlay is inexact below full opacity (error up to 64/255) because the shader blends premultiplied colour, so we need our own blend shader or a patch, and an acceptance test for **every** blend mode before M4 (only normal, multiply, screen, overlay were tested); (2) advanced blend modes need `useBackBuffer: true`; (3) a multiply child inside a filtered Container rendered black, so avoid or work around that composition; (4) a 1080p VideoFrame upload costs ~8 ms per frame; (5) the full scene costs ~11 ms GPU time, so 60 Hz headroom is only ~1.5x on Iris Xe.
- Raw WebGL2 was only 1.06x faster than Pixi with video, so the fallback would buy little for the video path.
