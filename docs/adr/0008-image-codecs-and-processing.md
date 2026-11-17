# ADR-0008: Image decoding, encoding and metadata

- **Status:** Proposed (2026-11-17)

## Context
v1 formats: import JPEG, PNG, WebP, GIF, SVG; export JPEG, PNG, WebP. Later: AVIF export, HEIC import, JPEG XL (not planned).

## Options
| Need | Option | Licence | Verdict |
|---|---|---|---|
| Decode | Browser-native (`createImageBitmap`, `<img>` for SVG, WebCodecs `ImageDecoder` for animated GIF) | n/a | **Chosen**: zero bytes shipped, GPU-friendly |
| Encode JPEG/PNG/WebP | `OffscreenCanvas.convertToBlob` with quality | n/a | **Chosen** for v1 |
| Encode AVIF / better JPEG | **jSquash** (`@jsquash/avif` 2.1; wraps libavif, MozJPEG, libwebp, libjxl; derived from Squoosh) | Apache-2.0 (wrapper) | **Chosen for post-v1 AVIF**; upstream codec licences to be audited before use ([repo](https://github.com/jamsinclair/jSquash)) |
| Everything via a WASM image library | e.g. libvips/ImageMagick WASM | varies, often LGPL/GPL | Rejected: large and licence-sensitive |
| HEIC import | WASM libheif | LGPL + HEVC patents | Deferred; needs legal review |

## Decision
Use native browser decode/encode in v1; lazy-load jSquash only when AVIF export is added.
Pixel manipulation (filters, adjustments, blend) happens on the GPU through the renderer (ADR-0004), not in WASM.

## Consequences
- Honour EXIF orientation on import. v1 is sRGB only; embedded ICC profiles are converted or ignored, with a documented limitation.
- **Privacy default:** exports strip EXIF/GPS metadata unless the user opts to keep it.
- Very large images: respect canvas size limits per browser; tile large documents (decided in the image-engine doc).
