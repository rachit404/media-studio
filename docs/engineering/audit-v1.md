# v1.0 audit: security, accessibility, reliability

Where each requirement of the final audit is proven, and what is not. Dated 2026-11-19.

## Security (SEC)

| ID | Requirement | Proven by | Gap |
| --- | --- | --- | --- |
| SEC-1 | No third-party requests | `e2e/shell.spec.ts` (every request in the production build is same-origin; fails on any other host); the service worker never fetches or caches cross-origin | the request check runs on the shell test only; the other e2e specs do not assert it |
| SEC-2 | Strict CSP, no eval, no inline script | CSP header test in `e2e/shell.spec.ts`; zod runs without `eval` (`packages/core/src/schema-common.ts`); the lint policy (`tools/eslint/policy.js`) makes `eval` and implied eval errors, with negative tests in `scripts/policy.test.mjs` | the lint policy does not ban `new Function` by name; the CSP (no `unsafe-eval`) would block it at run time |
| SEC-3 | SVG and project data never live HTML | project data is rendered through React text nodes only; the lint policy forbids assigning `innerHTML` and `outerHTML` and no code uses `dangerouslySetInnerHTML`; SVG is rasterised through an image element | SVG import itself is not built yet (post-v1), so there is nothing to test |
| SEC-4 | Exports carry no location or camera metadata | `e2e/image-editor.spec.ts` (images re-encoded from pixels) and `e2e/video.spec.ts` "metadata (SEC-4)": a source with location, maker and title tags exports with none of them | The sound of a source is decoded and re-encoded, so its tags cannot travel either; not separately tested |
| SEC-5 | No telemetry | there is no network code; the diagnostics log is local and only shown to the user | none |
| SEC-6 | Licence and vulnerability checks gate CI | `pnpm check:licences` (in `pnpm check`) and `pnpm audit` in CI (`.github/workflows/ci.yml`) | audit results depend on the advisory database at the time |

New in step 8: the worker that exports receives files as Blobs and never evaluates anything from them; the folder for parts of
unfinished exports is private browser storage, is keyed by a project id that is validated to letters, digits and dashes, and is
removed by "Clear all local data".

## Accessibility (A11Y)

| ID | Requirement | Proven by | Gap |
| --- | --- | --- | --- |
| A11Y-1 | Contrast AA in both themes, visible focus, reduced motion | `pnpm check:theme` (30 colour pairs in both themes); axe runs in both themes on the start screen, settings, image workspace, painting tools, and the video workspace with a keyframed clip, a marker, text and the export dialog (`e2e/a11y.spec.ts`) | focus visibility and reduced motion are by hand (checklist) |
| A11Y-2 | Commands reachable by keyboard, accessible primitives | React Aria components for menus, dialogs, sliders and fields; every shortcut is in the rebindable registry; axe has no violations in the covered screens | no full keyboard-only walk-through is automated (checklist) |
| A11Y-3 | Canvas surfaces have keyboard and list alternatives | image layers are a labelled list; timeline clips are buttons with names, times and lengths and move with the keyboard; the preview handles have arrow-key nudging and typed values in the inspector | dragging a keyframe along the timeline and the corners of the preview box are pointer-only (written in the roadmap) |

## Reliability (REL)

| ID | Proven by |
| --- | --- |
| REL-1 | journal and recovery tests in `packages/storage`, e2e reload tests that restore unsaved changes |
| REL-2 | project parsing tests (malformed files fail with a clear error, no partial state) |
| REL-3 | `packages/engine-video/src/export-failures.test.ts` (cancel and failure at every stage leave nothing), e2e cancel of an export in parts leaves no parts |
| REL-4 | `packages/storage/src/rpc-supervise.test.ts` and the e2e that kills the storage worker; export worker failure is a typed error |
| REL-5 | startup write probe (`packages/storage/src/probe.ts`), quota errors mapped to a typed error |
