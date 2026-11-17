# Principles

## Product
- Privacy-first, local-first: media never leaves the device; no backend, accounts, analytics or third-party requests at runtime.
- Free/open-source, permissive licences only (MIT, ISC, BSD, Apache-2.0; MPL-2.0 unmodified). No GPL/AGPL/non-commercial. Check with `pnpm check:licences`.
- Image and video are separate modules sharing shell, assets, storage and export UI. AI stays optional behind provider interfaces.

## Code
- TypeScript strict. No `any` without a one-line justification. Validate every external input (files, project JSON, clipboard, storage) with schemas.
- Small modules (aim under ~300 lines), one responsibility, public API only through each package's `index.ts`, no default exports in packages.
- Browser media/storage APIs (WebCodecs, OPFS, FSA, WebGL, Web Audio) live only in `media-io`, `render`, `storage`, `capabilities` and `apps/web` worker entries. `core` is pure TypeScript.
- Only commands change the document (undo/redo, journal). UI state is separate. Pixel/frame data never lives in React state.
- Colours and spacing come from semantic tokens. No raw colours, no inline hex.
- Errors: use the typed taxonomy, never swallow exceptions, never show raw exceptions to users. Free every `VideoFrame`/`ImageBitmap` exactly once.
- Comment only the non-obvious why. Document complex pipelines in `docs/architecture`; decisions as ADRs.
- Never add features that look operational but are not. Hide or label unfinished work.

## Quality
- Tests alongside every feature: unit/property for logic, browser tests for rendering/codecs, e2e for flows. Every bug fix gets a regression test.
- Performance budgets are requirements (see `docs/product/requirements.md` PERF-*). Measure before optimising.
- Accessibility is part of done: keyboard operable, visible focus, contrast checked in both themes.
