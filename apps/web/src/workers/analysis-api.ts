import { encodePeaks } from '@media-studio/core';
import {
  computePeaks,
  createVideoThumbnail,
  probeMedia,
  type MediaInfo,
} from '@media-studio/media-io';

/** Media analysis that runs off the main thread: probing, a preview picture and waveform peaks. */
export class AnalysisApi {
  probe(file: Blob): Promise<MediaInfo> {
    return probeMedia(file);
  }

  async thumbnail(file: Blob): Promise<Blob> {
    return createVideoThumbnail(file);
  }

  /** The waveform file contents (see core/waveform.ts), or null when the file has no decodable sound. */
  async peaks(file: Blob): Promise<Uint8Array> {
    return encodePeaks(await computePeaks(file));
  }
}
