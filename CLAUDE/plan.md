# 10-step development plan

Goal: a working browser **image editor and video editor** (v1.0). One step at a time; each step is a branch cut from `claude-takeover`, gated by `pnpm check`, merged `--no-ff`.
Scope, modules, acceptance criteria, tests and limitations per step: `docs/engineering/roadmap.md` (M-number = step - 1).

| #   | Step                               | Branch                                      | Deliverable (summary)                                                                            | Status  |
| --- | ---------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| 1   | Foundation (M0)                    | `feat/m0-foundation`                        | Monorepo, strict tooling, CI, token theme, boundary/licence/CSP gates                            | done    |
| 2   | App shell and workspace (M1)       | `feat/m1-app-shell`                         | Capability probe, panels, theme, shortcuts, errors, diagnostics, a11y UI kit, PWA shell          | done    |
| 3   | Storage, project format, undo (M2) | `feat/m2-storage-project`                   | FSA+OPFS storage, project package, command history, journal recovery, asset import               | done    |
| 4   | Image engine essentials (M3)       | `feat/m3-image-engine`                      | Renderer, tiles, layers, transform/crop, adjustments, blend shaders, image export                | done    |
| 5   | Image editor tier 2 (M4)           | `feat/m4-image-editor`, `feat/m4b-painting` | Blend modes, text, shapes, filters, layer workflow; then raster layers, brush, masks, selections | done    |
| 6   | Video engine and timeline (M5)     | `feat/m5-video-engine`                      | Import/probe, preview playback, timeline UI, thin MP4 export; proxies and soak notes in the roadmap | done    |
| 7   | Video editor tier 2 (M6)           | `feat/m6-video-editor`                      | Multi-track, overlays, transitions, speed, text/subtitles, audio mixing, keyframes               | pending |
| 8   | Export reliability (M7)            | `feat/m7-export`                            | Presets, hw/sw/VP9, segmented resume, stream-to-disk, verify, typed errors                       | pending |
| 9   | Performance and hardening (M8)     | `feat/m8-performance`                       | Budgets, memory guards, soak/chaos tests, 4K via proxies, cross-browser pass                     | pending |
| 10  | Production readiness (M9)          | `feat/m9-release`                           | A11y audit, CSP/headers, offline update flow, docs, release checklist, v1.0                      | pending |

## Step completion checklist

- [ ] Acceptance criteria of the roadmap milestone met, mapped to requirement IDs
- [ ] `pnpm check` green (and `pnpm test:e2e` for UI changes)
- [ ] Docs, ADRs, `docs/STATUS.md` and this table updated
- [ ] Known limitations written down
- [ ] Merged `--no-ff` into `claude-takeover`
