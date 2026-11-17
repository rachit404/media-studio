# Changelog

All notable changes are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/); versions follow semantic versioning.

## [Unreleased]

### Added
- Projects: create image and video projects, undo/redo with coalescing, autosave through a write-ahead journal with crash recovery, image import (picker, drop, paste) with thumbnails, `.msproj` archive export/import, project list, storage settings with a startup write check and "clear all local data".
- App shell: browser capability probe with support tiers, explanation screen for unsupported browsers, limitations notice, resizable and collapsible workspace layout, settings dialog (theme, rebindable keyboard shortcuts, local diagnostics log), offline service worker, typed error taxonomy.
- Project foundation: pnpm workspace, strict TypeScript, Vite + React + Tailwind shell with a single design-token file, CI, module-boundary, licence, theme-contrast and bundle-size gates, and Playwright e2e against the production build.
