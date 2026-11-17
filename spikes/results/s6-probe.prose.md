## ADR-0012 questions, answered

1. **Does headless Chrome have working VideoEncoder / H.264 / AAC?** On this machine: **yes**. Branded Chrome 157 launched headless (playwright `headless: true` on the Program Files executable, i.e. new headless) reports identical support to headed Chrome. A real 1280x720x30-frame round trip produced 30 chunks for H.264 with both `prefer-hardware` and `prefer-software`, for VP9, VP8 and AV1 (software), and AAC (mp4a.40.2) and Opus audio encoders produced output. `VideoEncoder` is also present inside a dedicated worker. Edge 157 (headed and headless) is identical except HEVC *encode* is not available in Edge.
2. **Does headless have WebGL2, software or hardware?** WebGL2 is **available, and hardware-backed on this box**: renderer string `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)` in headless Chrome, identical to headed (also identical inside an OffscreenCanvas in a worker). WebGPU adapter is also present in both (vendor intel, gen-12lp; not a fallback adapter). **This does not predict CI**: a GitHub Actions Linux runner has no GPU, so Chromium will use SwiftShader (software) there; that is UNVERIFIED and must be measured on the runner.
3. **Unverified cells.** Linux, GitHub Actions `ubuntu-latest` and `windows-latest` runners, Playwright's bundled Chromium / chrome-headless-shell (not installed here: `ms-playwright` cache absent), Firefox and WebKit were NOT tested. Every "Linux CI / GitHub Actions" cell above is UNVERIFIED. Hardware-vs-software *H.264 encode on a runner* is the single most important unknown for ADR-0012 item 4: on a runner without a GPU, `prefer-hardware` is expected to be refused or fall back, and H.264/AAC availability depends on the Chromium build (branded Chrome vs open-source Chromium).

## Other findings worth knowing

- `isConfigSupported` is a claim, not proof of hardware use: the API gives no signal which implementation was used. The S4 spike inferred it from per-process CPU time (GPU process vs renderer).
- Hardware support list on this Iris Xe: H.264 enc/dec up to 4K, VP9 enc/dec, HEVC 1080p (Chrome only; Edge no encode), AV1 **decode** only in hardware (AV1 encode is software-only). VP8 is software only. `prefer-software` HEVC is "no" for both encode and decode (no software HEVC in Chrome).
- Audio: AAC and Opus encode OK; FLAC/Vorbis/MP3 are decode-only. ImageDecoder supports png/jpeg/webp/gif/avif.
- `crossOriginIsolated` is false and `SharedArrayBuffer` is unavailable on the dev server (no COOP/COEP): consistent with ADR-0007 item 6 (core pipeline must not need SAB). `isSecureContext` is true on `http://127.0.0.1`.
- OPFS `createSyncAccessHandle` works in a dedicated worker; File System Access pickers (open/save/directory) exist in Chrome and Edge. `navigator.storage.persist()` returned false (not granted automatically for a fresh temp profile on localhost); quota estimate is about 10.7 GB.
- `performance.memory` exists on the main thread but **not inside workers** (S4 had to read the worker heap through CDP `Runtime.getHeapUsage`). Relevant for ADR-0007's "leak detection in dev builds".

## How to run this probe elsewhere (Linux / CI runners)

```
cd spikes && npm ci && npm run dev &            # serves http://127.0.0.1:5199
CHROME_PATH=/usr/bin/google-chrome node s6-probe/run.mjs   # writes spikes/results/s6-probe.json
node s6-probe/gen-md.mjs                         # regenerates this markdown
```
`run.mjs` also tries Edge at its Windows path (reported as "executable not found" elsewhere). For Playwright's bundled Chromium, edit the `targets` array in `run.mjs` or run `npx playwright install chromium` and point `CHROME_PATH` at it. On Linux CI, additionally try the flags from ADR-0012 (`--enable-unsafe-webgpu`, `--use-angle=swiftshader`, `--ignore-gpu-blocklist`) and record which of them changes the matrix.

## Recommendation for ADR-0012 (and its links to ADR-0003 / ADR-0007)

Verdict: **ADR-0012 can stay as proposed, with two wording changes**, because this probe only covers Windows + Intel Iris Xe + branded Chrome/Edge 157, and ADR-0012's biggest unknown (a GPU-less Linux/GitHub runner) is **UNVERIFIED** here.

- Confirmed on this machine: headless (new headless, branded Chrome 157) has working `VideoEncoder`/`VideoDecoder`, H.264 (hardware and software paths), VP9, AAC and Opus encode, WebGL2 (hardware ANGLE/D3D11 on Iris Xe) and WebGPU. So item 4 ("codec tests run where the spike proves encoders exist") is satisfied by "a Windows machine with branded Chrome"; item 2 (target WebGL2) is satisfied.
- Wording change 1: ADR-0012 says Windows is "likely" the codec-test runner. State that the Windows/Chrome result here came from a **physical GPU laptop**; `windows-latest` (no GPU, WARP/software D3D) must be probed with the command below before the claim "hardware encode is not testable in CI" is relaxed or hardened.
- Wording change 2: record that `isConfigSupported` is not evidence of hardware use (no API signal); the codec tests should assert round-trip output (as this probe does), not support flags.
- Fallback triggers: if the Linux/Windows runner probe shows no `VideoEncoder` or no H.264/AAC encode, move codec tests to a self-hosted Windows runner or the manual per-release checklist (already in ADR-0012's consequences), skip them with an explicit marker, and keep WebGL2 golden-image tests on SwiftShader. If SwiftShader WebGL2 is unavailable, shift render regression to the Windows runner. ADR-0003 (codec stack) and ADR-0007 (no SharedArrayBuffer: `crossOriginIsolated` is false here and nothing in the probe needed it) need no change from S6.

Exact command to run the probe on a runner (writes `spikes/results/s6-probe.json`; compare the matrix against this file's columns):
```
cd spikes && npm ci && (npm run dev &) && sleep 5 && CHROME_PATH=$(which google-chrome || which chromium) node s6-probe/run.mjs && node s6-probe/gen-md.mjs
```
