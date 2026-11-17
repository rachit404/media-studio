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
