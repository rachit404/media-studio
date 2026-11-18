# ADR-0020: Custom WebGL2 compositor instead of PixiJS

- **Status:** Accepted for M3 (2026-11-18). Amends [ADR-0004](0004-rendering-stack.md); this is that ADR's own fallback option D.

## Context
ADR-0004 proposed PixiJS v8 and named a fallback: "if Pixi cannot express non-destructive adjustment layers and exact blend maths, switch to D (our own small WebGL2 compositor) behind the same interface". Spike S3 found exactly those problems:
- Overlay blending was off by up to 64/255 below full opacity, so blend modes need our own shaders regardless.
- Advanced blend modes need a back buffer, and a multiply child inside a filtered container rendered black, which is the composition that adjustment layers need.
- Raw WebGL2 was 1.6x faster than Pixi without video.
M3 is the milestone where blend modes and adjustment layers become real, and their acceptance criterion is "within 2/255 of the W3C formulas".

## Decision
Write a small WebGL2 compositor in `packages/render`:
- Layers are drawn one at a time into an off-screen layer texture, then composited onto an accumulation texture with a shader that reads both the backdrop and the source and implements the W3C compositing equations exactly (normal, multiply, screen, overlay now; the rest in M4).
- Adjustment layers are full-screen passes over the accumulation texture, mixed by layer opacity.
- Accumulation uses 16-bit float textures when the browser supports rendering to them (RGBA8 otherwise).
- The same compositor serves the interactive canvas (screen resolution, re-rendered on demand) and export (document resolution times scale, on an `OffscreenCanvas`), so what you see is what you export.
- Everything sits behind a small `scene` description, so a future WebGPU or native renderer can replace it.

## Consequences
- No PixiJS dependency (saves ~100 KB gzip). We own about 600 lines of GL code, tested through pixel comparisons against a CPU reference implementation of the same formulas.
- Two full-screen passes per layer (draw, composite). Interactive rendering is bounded by the screen size, not the document size, so cost stays flat for large documents.
- Limits for M3: no edge anti-aliasing on rotated layers beyond bilinear sampling, no selection masks, no layer masks (M4), canvas size limited by `MAX_TEXTURE_SIZE` and a 100 MP guard.

## Update (M4, 2026-11-18)
- All 16 W3C blend modes are implemented in the composite shader (the four HSL modes use the spec's non-separable helpers) and checked against the CPU reference in `packages/core/src/color.ts`.
- Blur and sharpen are two-pass filters on the accumulated image (13 taps spaced sigma/2, sigma = radius / 2 in document pixels), clamped to the document rectangle so nothing outside it bleeds in. Levels and black & white are per-pixel passes with exact CPU references.
- Text and shape layers are rasterised from parameters on an OffscreenCanvas at 2x supersampling and uploaded as ordinary textures; they are released after each render when no longer used.
