# Security and privacy architecture

- **Status:** Draft for owner review (2026-11-17)
- **Requirements:** SEC-1 to SEC-6, REL-2, REL-5. **Related:** [ADR-0011](../adr/0011-dependency-licence-policy.md), [project format](project-format.md), [deployment](../engineering/deployment.md)

## 1. Privacy model
The promise: **your media and projects never leave your device.** The app is static files; after loading, it makes no network requests except to its own origin (app updates). There is no backend, account, analytics, telemetry, ad or third-party script. This is verified by an automated test, not just stated.

| Data | Where it lives | Leaves the device? |
|---|---|---|
| Source media | User filesystem (FSA) or browser-private OPFS copy | Never |
| Projects, tiles, caches, proxies | Project folder / OPFS | Never (user may export an archive themselves) |
| Settings, shortcuts, recents | localStorage / IndexedDB | Never |
| Diagnostic log | OPFS ring buffer | Only if the user exports it |
| AI models (future) | OPFS cache | Download-only, with consent; no user data uploaded |

## 2. Threat model
This is a local, single-user app, so the main threats are **malicious input files**, **supply-chain compromise**, **web-origin attacks** (XSS, malicious embedding), and **accidental data exposure** (metadata, shared machines).

| Threat | Mitigation |
|---|---|
| Malicious or malformed media file | Parsing and decoding run in browser-sandboxed code (WebCodecs, Mediabunny in a worker). Enforce size/dimension limits before allocation; time-box probe/decode; treat all demuxed metadata as untrusted text (never HTML) |
| Malicious SVG | Never inlined; rasterised through an `<img>` (scripts do not run); size limits |
| Malicious/corrupt project or archive | Zod validation at load; reject unknown future versions; archive extraction rejects `..` paths, absolute paths, symlinks, excessive size or file count (zip-slip, zip-bomb limits) |
| XSS | React escaping; no `dangerouslySetInnerHTML`; strict CSP: `default-src 'self'`; `script-src 'self'` (+ `'wasm-unsafe-eval'` only if a WASM module is bundled); no inline scripts/styles beyond hashed ones; `object-src 'none'`; `base-uri 'none'`; `frame-ancestors 'none'` |
| Third-party script injection | No third-party scripts or CDNs at runtime; all assets self-hosted; `connect-src 'self'` |
| Clickjacking / embedding | `frame-ancestors 'none'` and `X-Frame-Options: DENY` |
| Dependency compromise | Lockfile + pinned versions; minimal dependencies; licence + vulnerability scan in CI (`npm audit`/OSV); dependency-update PRs reviewed; no install scripts run by default where avoidable; provenance noted in `docs/third-party.md` |
| WASM supply chain | Prebuilt WASM binaries recorded with source, version, hash; verified at build; lazy-loaded only for the feature that needs them |
| Metadata leakage on export | Strip EXIF/GPS/camera/software tags from image exports by default; video metadata minimised; explicit opt-in to keep |
| Shared machine / private browsing | "Clear all local data" control; storage usage view; warn when running in a mode where storage may be ephemeral |
| File handle abuse | Handles persisted only for user-chosen files/folders; permission re-requested per session; no broader access |
| Service worker cache poisoning | Only same-origin, hashed assets cached; update flow shows version; HTTPS required |
| Crash/diagnostic leakage | Diagnostic log local only; no automatic upload; user reviews before exporting |

## 3. Browser security headers (set by the host; see deployment)
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:;
  worker-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()
Cross-Origin-Opener-Policy: same-origin        # optional hardening; the app does not require cross-origin isolation (ADR-0007)
Strict-Transport-Security: max-age=31536000    # HTTPS only
```
`style-src 'self'` assumes Tailwind builds to a CSS file (no runtime style injection); any necessary inline styles use nonces or hashes. CSP is tested in CI with the production build.

## 4. Code and secure development practices
- No `eval`/`new Function`; ESLint rule enforced. No dynamic code loading from user content.
- Strict TypeScript; boundary validation (Zod) for every external input: files, project JSON, clipboard, drag-and-drop, URL params, IndexedDB/localStorage values.
- Typed error handling; no swallowed exceptions in storage or export paths.
- Secrets: none exist in the app; the repo must never contain credentials; secret-scanning in CI; `.gitignore` excludes media, caches, env files.
- Test fixtures: tiny generated or CC0 media only; never personal footage (repo rule).

## 5. Privacy-by-design checks (CI and review)
1. **No-network test:** Playwright asserts zero requests to non-origin hosts during a full edit/export scenario; fails the build otherwise.
2. **Bundle audit:** build report lists every third-party package; additions need a licence + purpose note.
3. **Header test:** production build served with the intended CSP; app functions with it (no CSP violations in console).
4. **Metadata test:** exported JPEG/PNG/WebP contain no EXIF/GPS by default.

## 6. Optional AI modules (future)
Disabled by default; installed explicitly; each module declares permissions, model licence, size and source URL. Model downloads need consent, are hash-verified, cached in OPFS, and run in an isolated worker with no network access after download. No user media is ever sent to a service.

## 7. Residual risks
OPFS/IndexedDB data is not encrypted at rest (it is protected by the OS user profile); on a shared account, anyone with profile access can read it. Browser vulnerabilities in codec implementations are outside our control; we rely on timely browser updates and surface a "browser too old" warning where detectable.
