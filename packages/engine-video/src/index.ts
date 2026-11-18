// @media-studio/engine-video
// Video editor logic: timeline views and snapping, preview planning, transport, caches. No browser APIs here.
export { audioSegments } from './audio-plan';
export type { AudioSegment } from './audio-plan';
export { FrameCache } from './frame-cache';
export type { Closable, FrameCacheOptions } from './frame-cache';
export {
  buildPreviewScene,
  containMatrix,
  frameTextureId,
  previewPlan,
  sourceTimeAt,
} from './preview';
export type { AudioClipPlan, PreviewPlan, VideoLayerPlan } from './preview';
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
export { Transport } from './transport';
export type { PlaybackStats, TransportOptions } from './transport';
