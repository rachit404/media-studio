# ADR-0001: Web-first platform with a swappable MediaEngine

- **Status:** Proposed (draft from research step 2, 2026-11-17)
- **Supersedes:** earlier "desktop-first" discussion (never implemented)

## Context
Media Studio is a personal portfolio project that must be shippable later. The owner has no
experience with native or WASM toolchains, develops on Windows with integrated Intel Iris Xe
graphics, and wants a privacy-first, local-first, single-user product with no backend.

## Options considered
| Option | Summary | Verdict |
|---|---|---|
| A. Web app only | Browser APIs (WebCodecs, WebGL/WebGPU, WASM, OPFS), static hosting | **Chosen** |
| B. Desktop-first (Electron/Tauri + native FFmpeg) | Full codec support, no memory cap | Rejected for v1: heavier distribution/signing, not what the owner wants |
| C. Hybrid from day one | Two engines behind one UI | Rejected: doubles maintenance |

## Decision
Build a web application. All media processing is client-side. Every capability that could differ
between a browser and a future desktop shell (decode, encode, file access, storage) sits behind a
narrow interface (`MediaEngine`, `ProjectStore`, `FileAccess`). The desktop build later swaps
implementations (native FFmpeg, real filesystem) without touching editor logic.

## Consequences
- Codec licensing is mostly delegated to the browser/OS (WebCodecs), which helps "shippable later".
- Hard ceilings exist: browser memory, tab throttling, codec availability varies by machine.
- Hosting is static files only; no accounts, no server-side media, no analytics by default.
- Interfaces must be kept honest: no editor package may import a browser-only API directly
  outside its adapter package (enforced by lint rules, see ADR-0010).

## Limitations
Professional codecs (ProRes, DNxHD), 4K+ guaranteed editing and very long projects are not
v1 goals. They are what the future desktop engine is for.
