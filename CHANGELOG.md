# Changelog

All notable changes are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/); versions follow semantic versioning.

## [Unreleased]

## [1.0.0] - 2026-11-19

The first complete release: an image editor and a video editor that run in the browser, keep everything on the computer, and work offline.

### Added
- Video editor, second tier: clip properties (position, scale, rotation, crop, opacity, colour, volume, fades), transitions (cross-fade, dip to black or white, wipe, slide), text clips and SRT/VTT subtitles burned in on export, constant speed 0.25 to 4 times, keyframes for position, scale, rotation, opacity and volume, markers and in/out points, J/K/L shuttle, a master level meter, on-canvas transform handles, solo and track volume. Project format v11.
- Export: MP4 (H.264, AAC) and WebM (VP9, Opus) with presets, frame rate, quality, sound bitrate and encoder choice probed at runtime; a check of the finished file; typed errors with failure-injection tests; stream to a file on disk; long exports made in parts that continue after a stop; time left; export limited to the in/out range.
- Hardening: the storage and analysis workers are replaced when they die; the number of clips decoded at once follows the computer; performance budgets run with the tests; 4K export validated.
- Offline update flow: a new version waits until you choose "Update now".
- Documentation: user guide, release checklist, v1.0 audit of security, accessibility and reliability.

### Changed
- Keyboard shortcuts can share a key between the image and video editors (scoped commands).

### Known limits
- Not tested in Safari or Firefox; hardware encoders other than Intel Iris Xe untested; a 60 minute soak and the manual release checklist are still to be done; see the roadmap and `docs/engineering/release-checklist.md`.

### Added
- Video editor: import video and audio (probe, preview picture, waveform), preview with frame stepping and sound, a timeline with tracks, snapping, split/trim/move/join/delete/ripple, linked picture and sound, numeric clip fields, and export to MP4 (H.264 and AAC). Project format v5. The image and video editors now load on demand.
- Image editor painting: paint layers, brush and eraser (size, hardness, opacity, flow, pen pressure), layer masks, clipping to the layer below, rectangle/ellipse/lasso selections with add/subtract/intersect/feather/invert and "selection to layer mask". Strokes are saved durably and survive a crash; painted pixels are included in exported `.msproj` archives. Project format v4.
- Image editor: all 16 blend modes, text and shape layers, levels, black & white, blur and sharpen adjustments, filter presets, duplicate/copy/paste/delete of layers, drag to reorder, drag from the asset library onto the canvas. Project format v3.
- Image editor essentials: layers (image and adjustment), blend modes, opacity, transform, canvas crop/resize/rotate/flip, interactive GPU canvas, and PNG/JPEG/WebP export with scale and quality.
- Projects: create image and video projects, undo/redo with coalescing, autosave through a write-ahead journal with crash recovery, image import (picker, drop, paste) with thumbnails, `.msproj` archive export/import, project list, storage settings with a startup write check and "clear all local data".
- App shell: browser capability probe with support tiers, explanation screen for unsupported browsers, limitations notice, resizable and collapsible workspace layout, settings dialog (theme, rebindable keyboard shortcuts, local diagnostics log), offline service worker, typed error taxonomy.
- Project foundation: pnpm workspace, strict TypeScript, Vite + React + Tailwind shell with a single design-token file, CI, module-boundary, licence, theme-contrast and bundle-size gates, and Playwright e2e against the production build.
