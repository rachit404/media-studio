# Deployment strategy

- **Status:** Draft for owner review (2026-11-17). Hosting specifics are intentionally deferred: "create the product first."
- **Related:** [security & privacy](../architecture/security-privacy.md), [roadmap M0/M9](roadmap.md)

## 1. What gets deployed
A static site: hashed JS/CSS/WASM/font assets, `index.html`, web app manifest, service worker, icons. No server code, no database, no secrets. The build output is host-agnostic.

## 2. Hosting requirements (any host)
| Requirement | Why |
|---|---|
| **HTTPS with a real domain** (localhost is the only exception) | WebCodecs, OPFS, service workers and file pickers need a secure context. A bare `http://<ip>` will not work |
| Security headers as in [security-privacy §3](../architecture/security-privacy.md) | CSP, `nosniff`, referrer policy, permissions policy, frame protection |
| `Cache-Control: immutable, max-age=31536000` for hashed assets; `no-cache` for `index.html` and the service worker | Safe updates |
| Brotli/gzip compression; correct MIME types incl. `application/wasm` | Load time, WASM streaming compile |
| SPA fallback to `index.html` | Client-side routing |
| **No COOP/COEP requirement** | The core pipeline avoids `SharedArrayBuffer` ([ADR-0007](../adr/0007-concurrency-and-export-pipeline.md)); COOP may still be sent as hardening |

## 3. CI/CD (GitHub is the source of truth)
- `ci.yml` on every PR and push to `main`: lint, typecheck, unit/property/component, build, size budget, CSP/header test, e2e, licence and vulnerability scan.
- `release.yml` on version tags `vX.Y.Z`: full CI, production build, attach the build as a release artefact (`.zip` + checksums), generate release notes from conventional commits.
- Deployment is a **pull-or-push of the release artefact** to the host; choosing the mechanism is deferred. Credentials, when needed, live only in GitHub encrypted secrets and never in the repo.
- Branch protection on `main`: required checks, linear history, no force-push.

## 4. Versioning and release process
Semantic versioning (`MAJOR.MINOR.PATCH`); project-format version tracked separately ([project format](../architecture/project-format.md)). Release steps: update [STATUS.md](../STATUS.md) and CHANGELOG → pass manual checklist ([testing](testing-strategy.md#5-manual-release-checklist-v10-and-every-release)) → tag → CI builds artefact → deploy → smoke-test the live URL.

## 5. PWA updates
Service worker caches the app shell and engine bundles by hash. When a new version is found, the app shows an "Update available" prompt and applies it on the user's confirmation or next start; it never reloads mid-edit. Project-format migrations are backward compatible, so rolling back the app never corrupts newer projects (older versions refuse to open newer formats rather than overwrite them).

## 6. Rollback
Keep the previous N release directories on the host and switch via symlink/alias; roll back by switching back. The service worker version check prevents a mismatched cache from sticking.

## 7. Self-hosting on an Oracle VM (deferred; notes only)
When the time comes: a free-tier VM running Caddy or nginx; a domain (a free subdomain works) with automatic Let's Encrypt certificates; static root with the headers above; release artefact deployed by a GitHub Actions job over SSH or pulled by a small script; optional uptime check that does not collect user data. None of this affects the application code.

## 8. Privacy of the deployment
No analytics, no third-party scripts, no external fonts or CDNs. Server access logs, if kept, are the host's concern and should be minimal and short-lived; they contain no media and no project data because none is ever sent.
