# ADR-0017: Colour management scope for v1

- **Status:** Proposed (2026-11-17)

## Context
Real colour management (ICC profiles, wide gamut, 16-bit, HDR) multiplies complexity in the renderer, codecs and UI. Browsers convert most imported images to sRGB by default.

## Decision
v1 is **8-bit sRGB, premultiplied alpha** end to end:
- Images decoded with the browser's default colour conversion to sRGB (`createImageBitmap` default conversion).
- Canvas and render targets are sRGB; blend and adjustment maths are defined for sRGB values and tested against reference formulas.
- Video is treated as sRGB/BT.709 limited-to-full as decoded by the browser; no HDR or wide-gamut handling; sources flagged HDR/10-bit show a notice and are tone-mapped by the browser where it does so.
- No ICC export; exports are sRGB. Embedded ICC/EXIF metadata is stripped by default.

## Future path
Display-P3 canvas and render targets, higher bit depth, and ICC-aware import/export are post-v1 and need a renderer ADR (linear-light compositing option, float textures) before work starts.

## Consequences
Colours may differ slightly from colour-managed desktop editors for wide-gamut sources; this is documented as a known limitation in the UI help and README.
