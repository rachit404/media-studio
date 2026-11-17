# ADR-0011: Dependency licence policy

- **Status:** Proposed (2026-11-17)

## Context
The project must be shippable commercially later. Licence mistakes found late force rewrites.
Concrete example found during research: `@ffmpeg/ffmpeg` is MIT, but its `@ffmpeg/core` WASM binary is **GPL-2.0-or-later**.

## Decision
| Category | Licences | Rule |
|---|---|---|
| Allowed | MIT, ISC, BSD-2/3, Apache-2.0, 0BSD, Unlicense/CC0 | Use freely |
| Allowed with care | MPL-2.0 (e.g. Mediabunny) | File-level copyleft. Do not modify the library's files in place; keep notices |
| Needs written review | LGPL (e.g. libav.js) | WASM is statically linked, which raises relinking obligations |
| Forbidden in the shipped app | GPL, AGPL, SSPL, "non-commercial" or research-only licences (includes some AI model weights) | Never in the core bundle |

- Own code: **Apache-2.0** recommended (explicit patent grant); MIT is acceptable. To be confirmed in the contribution docs.
- Every dependency is checked at add-time. CI runs a licence scan and fails on anything outside the allow-list (transitive dependencies included).
- WASM binaries and model weights count as dependencies and are recorded with source, version and licence in `docs/third-party.md`.
- Codec patents are not solved by licences. We rely on browser/OS-provided codecs; shipping our own H.264/HEVC/AAC encoders would reopen the question.

## Consequences
Some convenient libraries are off-limits. In exchange the commercial path stays open and the dependency list stays small.
