# Changelog

All notable changes are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/); versions follow semantic versioning.

## [Unreleased]

### Added
- Video editor: import video and audio (probe, preview picture, waveform), preview with frame stepping and sound, a timeline with tracks, snapping, split/trim/move/join/delete/ripple, linked picture and sound, numeric clip fields, and export to MP4 (H.264 and AAC). Project format v5. The image and video editors now load on demand.
- Image editor painting: paint layers, brush and eraser (size, hardness, opacity, flow, pen pressure), layer masks, clipping to the layer below, rectangle/ellipse/lasso selections with add/subtract/intersect/feather/invert and "selection to layer mask". Strokes are saved durably and survive a crash; painted pixels are included in exported `.msproj` archives. Project format v4.
- Image editor: all 16 blend modes, text and shape layers, levels, black & white, blur and sharpen adjustments, filter presets, duplicate/copy/paste/delete of layers, drag to reorder, drag from the asset library onto the canvas. Project format v3.
- Image editor essentials: layers (image and adjustment), blend modes, opacity, transform, canvas crop/resize/rotate/flip, interactive GPU canvas, and PNG/JPEG/WebP export with scale and quality.
- Projects: create image and video projects, undo/redo with coalescing, autosave through a write-ahead journal with crash recovery, image import (picker, drop, paste) with thumbnails, `.msproj` archive export/import, project list, storage settings with a startup write check and "clear all local data".
- App shell: browser capability probe with support tiers, explanation screen for unsupported browsers, limitations notice, resizable and collapsible workspace layout, settings dialog (theme, rebindable keyboard shortcuts, local diagnostics log), offline service worker, typed error taxonomy.
- Project foundation: pnpm workspace, strict TypeScript, Vite + React + Tailwind shell with a single design-token file, CI, module-boundary, licence, theme-contrast and bundle-size gates, and Playwright e2e against the production build.
