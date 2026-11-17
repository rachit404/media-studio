# Media Studio

A privacy-first image and video editor that runs entirely in your browser. Your media never leaves your device: no uploads, no accounts, no analytics.

> **Status:** under construction. The foundation (step 1 of 10) is in place; the editors are being built step by step. See [CLAUDE/plan.md](CLAUDE/plan.md) and [docs/STATUS.md](docs/STATUS.md).

## Highlights (target v1.0)

- **Image editor:** layers and groups, masks, blend modes, selections, brush, text and shapes, non-destructive adjustments, JPEG/PNG/WebP export.
- **Video editor:** multi-track timeline, trim/split/ripple, overlays, transitions, speed, text and subtitles, audio mixing, MP4 and WebM export.
- **Local-first:** WebCodecs, WebGL2 and the browser file system. Works offline as an installable PWA.
- **Quality:** strict TypeScript, tests with every feature, enforced module boundaries, one global design-token file.

## Requirements

Node.js 22.12+ (24 recommended) and pnpm 10. Chrome or Edge (current) is the primary browser; Safari 26+ and Firefox are best-effort.

## Getting started

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm check        # lint, format, types, boundaries, theme contrast, tests, build, size, licences
pnpm test:e2e     # builds, then runs Playwright against the production build
```

## Repository layout

| Path         | Purpose                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| `apps/web`   | The application (composition root)                                                                       |
| `packages/*` | `core`, `capabilities`, `media-io`, `render`, `storage`, `engine-image`, `engine-video`, `ui`, `testing` |
| `docs/`      | Requirements, architecture, ADRs, roadmap, research                                                      |
| `CLAUDE/`    | Project guidelines and the development plan used by Claude Code                                          |
| `e2e/`       | Playwright tests                                                                                         |
| `spikes/`    | Throwaway feasibility experiments (not part of the product)                                              |

Design documentation starts at [docs/README.md](docs/README.md). Module boundaries are enforced in CI (see [ADR-0010](docs/adr/0010-tooling-and-repo-structure.md)).

## Privacy

The app is static files. After it loads it makes no third-party requests, and an automated test enforces this. Exports strip location and camera metadata by default. Details: [security and privacy](docs/architecture/security-privacy.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party notices: [docs/third-party.md](docs/third-party.md).
