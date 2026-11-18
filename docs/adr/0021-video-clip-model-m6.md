# ADR-0021: The video clip model in M6 (text, transitions, speed, keyframes, markers)

- **Status:** Accepted for M6 (2026-11-19). Builds on [ADR-0014](0014-timeline-ui-rendering.md) and the video design in [architecture/video-editor.md](../architecture/video-editor.md).

## Context
M6 adds text and subtitles, transitions, speed, keyframes, markers and shuttle to a timeline that so far held only media clips. Each needed a choice of where it lives in the document and how preview and export stay identical. The choices were made slice by slice (format versions v6 to v11); this records them in one place.

## Decision
- **One clip type, optional fields.** Every feature is an optional field on `Clip` (`transform`, `opacity`, `colour`, `volume`, fades, `transitionIn`, `speed`, `text`, `backdrop`, `keyframes`). Absent means the default, so every older file opens unchanged and each migration is the identity function. Format versions: v6 look, v7 transitions, v8 text, v9 speed, v10 markers and in/out, v11 keyframes.
- **Text is a clip, not a layer.** A text clip has `assetId: null` and a `text` spec (the image editor's text spec, so one rasteriser draws both). It lives on a video track, so it moves, trims, splits and layers like any clip, and has the same position, scale, rotation, opacity and crop. Subtitles are a track of text clips, burned in on export. Cost: every place that read `clip.assetId` handles null; the compiler found them all.
- **A transition belongs to the incoming clip** (`transitionIn`) and starts at the cut. The clip going out keeps playing underneath past its end (it holds its last picture). No timing change, no handles needed. It is only in effect while the previous clip ends exactly where this one starts; otherwise it is paused, not deleted.
- **Speed keeps the stretch of the file.** `duration * speed` of the file plays, so a faster clip gets shorter. `sourceSpan` and `clipSourceAt` are the only conversions between timeline and file time; trim, split, join, drag limits, audio and video planning all use them. Picture and sound of a linked pair change together. Pitch follows speed (decision 11).
- **Keyframes are per property, in microseconds from the clip start,** each with the easing of the move to the next one. Evaluation lives in core (`clipTransformAt`, `clipOpacityAt`, `clipGainAt`) and is the only thing preview, export, the live gain and the offline mix read. The fixed value stays as the fallback. Editing commands keep animation right through trim, split, join and speed.
- **One scene builder for preview and export.** `buildPreviewScene` produces what the compositor draws, for both. Text is measured through an injected `RasterMetrics`, so the engine package stays free of canvas APIs.
- **One gain function for live and offline sound.** `clipGainOnTimeline` feeds both the live player (as a curve on a gain node) and the export mix (per sample), so they agree by construction; a test compares them.
- **Scoped shortcuts.** A command can have a `scope` (`image`, `video`); commands of different scopes may share a key (video J/K/L/M against the image tools L/M), conflicts are only refused within a scope or against an unscoped command.

## Consequences
- Old files always open; a file written by a newer version than the app knows is refused by the existing version check.
- Undo is per command, and repeated edits of one value merge (`coalesceKey`).
- Known limits are listed per slice in the [roadmap](../engineering/roadmap.md) (M6): no bezier curves, transitions run after the cut rather than centred on it, constant speed only, burned-in subtitles only, generic fonts only.
- Revisit if: a centred transition or speed ramps are wanted (both need the clip model to carry handles or a time map), or if soft subtitle tracks are needed (they would be a separate track kind).
