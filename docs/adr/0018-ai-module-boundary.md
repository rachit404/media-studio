# ADR-0018: Optional AI module boundary

- **Status:** Proposed (2026-11-17). Interface only in v1; no AI features ship in v1.

## Context
Candidate features: background removal, enhancement, object removal, automatic subtitles, noise reduction, smart crop, summarisation, generative features. They must stay optional, local, and decoupled from the editing core, consistent with the privacy principles.

## Decision
- The core defines two small interfaces in `core`: `EffectProvider` (image/frame in → image/frame out, with parameters) and `AnalysisProvider` (media in → structured result such as a mask, a transcript or a crop box). Editors call providers through a registry and handle "provider missing" gracefully.
- **No AI package is imported by `core`, the engines or the app shell statically.** Modules load lazily from separate bundles, run in their own worker, and have no network access after installation.
- **Runtimes (candidates, to verify at implementation):** ONNX Runtime Web (MIT) and/or transformers.js with WebGPU where available, WASM fallback.
- **Models:** downloaded on demand with explicit consent showing size, source and licence; hash-verified; cached in OPFS; deletable. Model weights count as dependencies under [ADR-0011](0011-dependency-licence-policy.md): permissive or clearly commercial-use-allowed licences only (some popular background-removal weights are non-commercial and are excluded).
- **Priority order after v1:** background removal, automatic subtitles (speech to text), smart crop, noise reduction.
- Generative image/video features are not planned: they would require large model downloads, heavy GPU/memory use and licence review that conflict with the 1080p/Iris Xe baseline.

## Consequences
- Adding AI later does not change the document model: AI outputs become ordinary assets, masks or layers.
- Hardware needs (WebGPU, memory) are probed before offering a module.
