// @media-studio/engine-video
// Video editor logic: timeline views and snapping, preview planning, transport, caches. No browser APIs here.
export { audibleTracks, clipGainOnTimeline, isAudible } from './audio-gain';
export { audioSegments } from './audio-plan';
export type { AudioSegment } from './audio-plan';
export { FrameCache } from './frame-cache';
export type { Closable, FrameCacheOptions } from './frame-cache';
export {
  buildPreviewScene,
  clipMatrix,
  containMatrix,
  frameTextureId,
  previewPlan,
  sourceTimeAt,
  transitionLook,
} from './preview';
export type { AudioClipPlan, LayerTransition, PreviewPlan, VideoLayerPlan } from './preview';
export {
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  clampScale,
  fitScale,
  rulerTicks,
  snapClipStart,
  snapEdge,
  snapPoints,
  snapTime,
  timeToX,
  xToTime,
  zoomAround,
} from './timeline-view';
export type { RulerTick, SnapResult, TimelineScale } from './timeline-view';
export {
  DEFAULT_BACKDROP,
  DEFAULT_TEXT_DURATION_US,
  defaultTextSpec,
  subtitleStyle,
  textTrackFor,
} from './text-defaults';
export { SHUTTLE_RATES, formatRate, shuttle } from './shuttle';
export type { ShuttleKey, ShuttleResult } from './shuttle';
export { Transport } from './transport';
export type { PlaybackStats, TransportOptions } from './transport';
export { FramePump } from './frame-pump';
export type { FrameStreamSource, TimedFrame } from './frame-pump';
export { placeAsset } from './placement';
export type { Placement } from './placement';
export { isTrimChange, trimRange } from './drag-limits';
export { mixAudioBlock } from './audio-mix';
export type { AudioReader } from './audio-mix';
export { exportFrameCount, exportSequence, hasExportAudio } from './export-sequence';
export type {
  ExportDependencies,
  ExportFrame,
  ExportOptions,
  ExportRenderer,
  ExportSink,
} from './export-sequence';
