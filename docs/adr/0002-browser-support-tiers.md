# ADR-0002: Browser support tiers and runtime capability detection

- **Status:** Proposed (2026-11-17)

## Context
Research findings (verify against MDN/caniuse at implementation time; several sources conflict
on version numbers):
- **File System Access pickers** (`showOpenFilePicker`, `showSaveFilePicker`): Chromium only
  (Chrome/Edge 86+). Not in Firefox or Safari. Brave ships it behind a flag. [web.dev](https://web.dev/file-system-access)
- **OPFS sync access handles** (`createSyncAccessHandle`, dedicated workers only): Chrome 102+,
  Safari 15.2+, Firefox 111+. The `readwrite-unsafe` mode (concurrent handles on one file) is *not*
  available in Firefox or Safari. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle)
- **WebCodecs:** Chromium full; Firefox desktop since ~130; Safari full only from ~26. HEVC encode is
  largely Apple-only; HEVC decode is uneven. Audio encoding has gaps in some browsers.
  [MDN](https://developer.mozilla.org/Web/API/WebCodecs_API)
- **WebGPU:** shipped on Windows/macOS Chromium (113+), Safari 26, Firefox on Windows (141+).
  Linux is still rolling out. WebGL2 is universal. [web.dev](https://web.dev/blog/webgpu-supported-major-browsers)

## Decision
| Tier | Browsers | Promise |
|---|---|---|
| 1 | Chrome, Edge (current stable) | Full feature set, tested on every release |
| 2 | Safari 26+, Firefox (current) | Core editing works. Degraded paths: no in-place file editing (copy-import), possible missing codecs |
| 3 | Brave, mobile, older versions | Not supported; show a clear capability screen, never a blank app |

Support is decided by **runtime probing, not user-agent sniffing**: a `capabilities` module probes
`VideoEncoder/VideoDecoder.isConfigSupported`, `AudioEncoder.isConfigSupported`, WebGL2, OPFS,
file pickers, and storage quota at startup and exposes a typed report. UI and export presets
read the report; unavailable options are disabled with an explanation.

## Consequences
- Every feature that depends on a browser API documents its fallback.
- E2E tests run full suites on Chromium; Firefox/WebKit run capability and smoke tests.
- Brave users get the OPFS-copy path (and a hint to enable the flag), same as Firefox/Safari.
