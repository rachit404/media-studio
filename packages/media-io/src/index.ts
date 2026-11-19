// @media-studio/media-io: media probing, decoding and encoding adapters (browser APIs live here).
export {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  createThumbnail,
  extensionFor,
  fitWithin,
  probeImage,
  sniffImageType,
  validateImageBytes,
} from './image';
export type { ImageInfo, ImageType } from './image';
export { computePeaks, createVideoThumbnail } from './media-analysis';
export { MAX_MEDIA_BYTES, extensionForMime, probeMedia } from './media-probe';
export type { MediaInfo } from './media-probe';
export { AudioPlayer, applyGain, levelToDb, peakLevel, placeBuffer } from './audio-player';
export type { AudioSlice, BufferPlacement } from './audio-player';
export { VideoSource } from './video-source';
export type { DecodedFrame } from './video-source';
export { AudioFileReader } from './audio-file-reader';
export { FORMATS, VideoWriter, defaultVideoBitrate } from './video-writer';
export type {
  ContainerFormat,
  FormatInfo,
  HardwarePreference,
  VideoWriterOptions,
} from './video-writer';
export { probeFormats } from './codec-probe';
export type { FormatSupport } from './codec-probe';
