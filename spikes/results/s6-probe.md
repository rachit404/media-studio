# S6 capability probe (ADR-0012)

Generated 2026-11-17T17:05:13.560Z by `spikes/s6-probe/run.mjs` (page: `spikes/s6-probe/index.html`). Windows 11, Intel Iris Xe (no discrete GPU), 16 logical cores, 16 GB.
Other agents may have been running concurrently; this probe is capability-only (nothing here is a timing result except the tiny OPFS write figure, which is indicative only).

Browsers: **chrome-headed** = Chrome/157.0.0.0 (branded Chrome) / launched headed; **chrome-headless** = HeadlessChrome/157.0.0.0 (branded Chrome) / launched with playwright headless:true on the branded executable (new headless); **edge-headed** = Chrome/157.0.0.0 (Edge) / launched headed; **edge-headless** = HeadlessChrome/157.0.0.0 (Edge) / launched with playwright headless:true on the branded executable (new headless).

Cell legend for codec rows: `prefer-hardware / prefer-software / no-preference`, Y = isConfigSupported says supported, - = not supported. isConfigSupported is a *claim*; the round-trip table further down actually encodes frames.

## Environment cells

| Capability | chrome-headed | chrome-headless | edge-headed | edge-headless | Linux CI / GitHub Actions |
|---|---|---|---|---|---|
| isSecureContext on http://127.0.0.1 | true | true | true | true | UNVERIFIED |
| crossOriginIsolated | false | false | false | false | UNVERIFIED |
| SharedArrayBuffer (main / worker) | false / false | false / false | false / false | false / false | UNVERIFIED |
| WebGL2 | true | true | true | true | UNVERIFIED |
| WebGL2 renderer (main) | `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)` | `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)` | `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)` | `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)` | UNVERIFIED |
| WebGL2 in OffscreenCanvas (worker) | true | true | true | true | UNVERIFIED |
| OffscreenCanvas 2D in worker | true | true | true | true | UNVERIFIED |
| WebGPU API / adapter | true / intel gen-12lp | true / intel gen-12lp | true / intel gen-12lp | true / intel gen-12lp | UNVERIFIED |
| OPFS getDirectory (main) | true | true | true | true | UNVERIFIED |
| OPFS createSyncAccessHandle in dedicated worker | true | true | true | true | UNVERIFIED |
| OPFS 16 MB sync write (MB/s, indicative) | 142.9 | 86.1 | 141.3 | 127.2 | UNVERIFIED |
| showOpenFilePicker / showSaveFilePicker / showDirectoryPicker | true / true / true | true / true / true | true / true / true | true / true / true | UNVERIFIED |
| navigator.storage.estimate quota | 10737 MB | 10737 MB | 10737 MB | 10737 MB | UNVERIFIED |
| navigator.storage.persist() | false | false | false | false | UNVERIFIED |
| performance.memory (main) | true | true | true | true | UNVERIFIED |
| VideoEncoder / AudioEncoder in main; VideoEncoder in worker | true / true; true | true / true; true | true / true; true | true / true; true | UNVERIFIED |

## Video codecs (encode | decode), cells = prefer-hardware / prefer-software / no-preference

| Config | chrome-headed enc | chrome-headed dec | chrome-headless enc | chrome-headless dec | edge-headed enc | edge-headed dec | edge-headless enc | edge-headless dec |
|---|---|---|---|---|---|---|---|---|
| H.264 Baseline@3.1 720p (`avc1.42001f`) | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y |
| H.264 Baseline@4.2 1080p (`avc1.42002a`) | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y |
| H.264 Main@4.0 1080p (`avc1.4d0028`) | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y |
| H.264 High@3.1 720p (`avc1.64001f`) | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y |
| H.264 High@4.0 1080p (`avc1.640028`) | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y |
| H.264 High@5.0 1080p (`avc1.640032`) | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y |
| H.264 High@5.1 4K (`avc1.640033`) | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y |
| H.264 High@5.2 4K (`avc1.640034`) | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y |
| HEVC Main@4.0 1080p (hvc1) (`hvc1.1.6.L120.B0`) | Y/-/Y | Y/-/Y | Y/-/Y | Y/-/Y | -/-/- | Y/-/Y | -/-/- | Y/-/Y |
| HEVC Main@5.1 4K (hev1) (`hev1.1.6.L153.B0`) | -/-/- | Y/-/Y | -/-/- | Y/-/Y | -/-/- | Y/-/Y | -/-/- | Y/-/Y |
| VP9 p0 L4.0 1080p (`vp09.00.40.08`) | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y |
| VP9 p0 L5.1 4K (`vp09.00.51.08`) | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y | Y/Y/Y |
| VP8 1080p (`vp8`) | -/Y/Y | -/Y/Y | -/Y/Y | -/Y/Y | -/Y/Y | -/Y/Y | -/Y/Y | -/Y/Y |
| AV1 Main L4.0 1080p (`av01.0.08M.08`) | -/Y/Y | Y/Y/Y | -/Y/Y | Y/Y/Y | -/Y/Y | Y/Y/Y | -/Y/Y | Y/Y/Y |
| AV1 Main L5.0 4K (`av01.0.12M.08`) | -/Y/Y | Y/Y/Y | -/Y/Y | Y/Y/Y | -/Y/Y | Y/Y/Y | -/Y/Y | Y/Y/Y |

## Audio codecs (48 kHz stereo)

| Codec | chrome-headed enc / dec | chrome-headless enc / dec | edge-headed enc / dec | edge-headless enc / dec |
|---|---|---|---|---|
| AAC-LC mp4a.40.2 | Y / Y | Y / Y | Y / Y | Y / Y |
| Opus | Y / Y | Y / Y | Y / Y | Y / Y |
| FLAC | - / Y | - / Y | - / Y | - / Y |
| Vorbis | - / Y | - / Y | - / Y | - / Y |
| MP3 | - / Y | - / Y | - / Y | - / Y |

## ImageDecoder

| Type | chrome-headed | chrome-headless | edge-headed | edge-headless |
|---|---|---|---|---|
| image/png | true | true | true | true |
| image/jpeg | true | true | true | true |
| image/webp | true | true | true | true |
| image/gif | true | true | true | true |
| image/avif | true | true | true | true |

## Real round-trip (1280x720, 30 frames / 1 s audio actually encoded; ok = all outputs produced, no error)

| Test | chrome-headed | chrome-headless | edge-headed | edge-headless |
|---|---|---|---|---|
| h264_hw | ok (30 chunks) | ok (30 chunks) | ok (30 chunks) | ok (30 chunks) |
| h264_sw | ok (30 chunks) | ok (30 chunks) | ok (30 chunks) | ok (30 chunks) |
| vp9_sw | ok (30 chunks) | ok (30 chunks) | ok (30 chunks) | ok (30 chunks) |
| vp8_sw | ok (30 chunks) | ok (30 chunks) | ok (30 chunks) | ok (30 chunks) |
| av1_sw | ok (30 chunks) | ok (30 chunks) | ok (30 chunks) | ok (30 chunks) |
| aac | ok (47 chunks) | ok (47 chunks) | ok (47 chunks) | ok (47 chunks) |
| opus | ok (51 chunks) | ok (51 chunks) | ok (51 chunks) | ok (51 chunks) |

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
