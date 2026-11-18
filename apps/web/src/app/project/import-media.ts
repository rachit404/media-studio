import { AppError, toAppError, type NewAsset } from '@media-studio/core';
import { MAX_MEDIA_BYTES, extensionForMime, type MediaInfo } from '@media-studio/media-io';
import { displayName, type ImportFailure, type ImportResult } from './import-assets';

export interface MediaStorage {
  putFile(id: string, path: string, data: Uint8Array): Promise<void>;
  putBlob(id: string, path: string, blob: Blob): Promise<void>;
}

export interface MediaAnalysis {
  probe(file: Blob): Promise<MediaInfo>;
  thumbnail(file: Blob): Promise<Blob>;
  peaks(file: Blob): Promise<Uint8Array>;
}

/**
 * Import video and audio files: probe each (clear errors for unsupported files), make a preview picture and the
 * waveform, then copy the original into the project. Everything is analysed before anything is written, and a
 * waveform that cannot be made never blocks the import. One failing file never blocks the others.
 */
export async function importMediaFiles(
  files: readonly File[],
  projectId: string,
  storage: MediaStorage,
  analysis: MediaAnalysis,
  makeId: () => string,
): Promise<ImportResult> {
  const imported: NewAsset[] = [];
  const failures: ImportFailure[] = [];

  for (const file of files) {
    try {
      if (file.size > MAX_MEDIA_BYTES) {
        throw new AppError({
          code: 'out-of-memory',
          message: 'This file is larger than the 8 GB limit.',
          hint: 'Cut it into shorter files first.',
        });
      }
      const info = await analysis.probe(file);
      const extension = extensionForMime(info.mime);
      if (!extension) {
        throw new AppError({
          code: 'unsupported-codec',
          message: `Files of type ${info.mime} are not supported.`,
          hint: 'Use MP4, MOV, WebM, MP3, WAV, AAC or Ogg.',
        });
      }
      const thumb = info.video ? await analysis.thumbnail(file) : null;
      let peaks: Uint8Array | null = null;
      if (info.audio) {
        try {
          peaks = await analysis.peaks(file);
        } catch {
          peaks = null;
        }
      }

      const id = makeId();
      const filePath = `media/${id}.${extension}`;
      await storage.putBlob(projectId, filePath, file);
      let thumbPath: string | null = null;
      if (thumb) {
        thumbPath = `thumbs/${id}.webp`;
        await storage.putFile(projectId, thumbPath, new Uint8Array(await thumb.arrayBuffer()));
      }
      let peaksPath: string | null = null;
      if (peaks) {
        peaksPath = `peaks/${id}.bin`;
        await storage.putFile(projectId, peaksPath, peaks);
      }

      const common = {
        id,
        name: displayName(file.name, 'Media'),
        mime: info.mime,
        size: file.size,
        file: filePath,
      };
      if (info.video && thumbPath) {
        imported.push({
          ...common,
          kind: 'video',
          width: info.video.width,
          height: info.video.height,
          duration: info.duration,
          fps: info.video.fps,
          codec: info.video.codec,
          keyframeInterval: info.video.keyframeInterval,
          audio: info.audio,
          thumb: thumbPath,
          peaks: peaksPath,
        });
      } else if (info.audio) {
        imported.push({
          ...common,
          kind: 'audio',
          duration: info.duration,
          audio: info.audio,
          peaks: peaksPath,
        });
      }
    } catch (error) {
      failures.push({ name: displayName(file.name, 'Media'), error: toAppError(error) });
    }
  }
  return { imported, failures };
}
