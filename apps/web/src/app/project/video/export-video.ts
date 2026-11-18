import {
  AppError,
  type Asset,
  type FrameRate,
  type ProjectDocument,
  type VideoContent,
} from '@media-studio/core';
import { exportFrameCount } from '@media-studio/engine-video';
import { defaultVideoBitrate } from '@media-studio/media-io';
import { getStorage } from '../../storage-client';
import type { ExportEvent, ExportJob, ExportRequest } from '../../../workers/export-protocol';

export interface ExportPreset {
  id: string;
  label: string;
  /** Longest side of the picture in pixels, or null to keep the sequence size. */
  longSide: number | null;
}

export const EXPORT_PRESETS: readonly ExportPreset[] = [
  { id: 'sequence', label: 'Same as the sequence', longSide: null },
  { id: '1080', label: '1080p (1920 on the long side)', longSide: 1920 },
  { id: '720', label: '720p (1280 on the long side)', longSide: 1280 },
  { id: '480', label: '480p (854 on the long side)', longSide: 854 },
];

/** Round down to an even number (H.264 needs even picture sizes), at least 2. */
const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);

/** The picture size for a preset: the sequence's shape scaled to the long side (never enlarged). */
export function exportSize(
  sequence: { width: number; height: number },
  longSide: number | null,
): { width: number; height: number } {
  const long = Math.max(sequence.width, sequence.height);
  const scale = longSide === null ? 1 : Math.min(1, longSide / long);
  return { width: even(sequence.width * scale), height: even(sequence.height * scale) };
}

export interface ExportEstimate {
  frames: number;
  /** Rough size of the file in bytes. */
  bytes: number;
  videoBitrate: number;
}

const AUDIO_BITRATE = 192_000;

export function estimateExport(
  content: VideoContent,
  size: { width: number; height: number },
  duration: number,
): ExportEstimate {
  const fps: FrameRate = content.sequence.fps;
  const videoBitrate = defaultVideoBitrate(size.width, size.height, fps.num / fps.den);
  return {
    frames: exportFrameCount(duration, fps),
    videoBitrate,
    bytes: Math.round(((videoBitrate + AUDIO_BITRATE) / 8) * (duration / 1_000_000)),
  };
}

/** The most the in-memory file is allowed to grow to before we warn. */
export const LARGE_EXPORT_BYTES = 1024 * 1024 * 1024;

export interface RunningExport {
  /** Resolves with the MP4, or rejects with an AppError (code `cancelled` when stopped by the user). */
  result: Promise<Blob>;
  cancel: () => void;
}

/** Start the export worker for the current document. The worker is created for this export only. */
export function startVideoExport(
  projectId: string,
  project: ProjectDocument,
  size: { width: number; height: number },
  onProgress: (done: number, total: number) => void,
  range: { start: number; end: number } | null = null,
): RunningExport {
  const content = project.content;
  if (content.kind !== 'video') throw new Error('Not a video project');
  const worker = new Worker(new URL('../../../workers/export.worker.ts', import.meta.url), {
    type: 'module',
  });
  let settle: (outcome: { blob: Blob } | { error: AppError }) => void = () => undefined;
  const outcome = new Promise<{ blob: Blob } | { error: AppError }>((resolve) => {
    settle = resolve;
  });

  worker.addEventListener('message', (message: MessageEvent<ExportEvent>) => {
    const event = message.data;
    if (event.type === 'progress') onProgress(event.done, event.total);
    else if (event.type === 'done') settle({ blob: event.blob });
    else {
      settle({
        error: new AppError({
          code: event.code,
          message: event.message,
          ...(event.hint ? { hint: event.hint } : {}),
        }),
      });
    }
  });
  worker.addEventListener('error', () => {
    settle({
      error: new AppError({
        code: 'worker-crashed',
        message: 'The export stopped unexpectedly.',
        hint: 'Try again with a smaller size.',
      }),
    });
  });

  const used = new Set(
    Object.values(content.clips).flatMap((clip) => (clip.assetId === null ? [] : [clip.assetId])),
  );
  const start = async (): Promise<void> => {
    const files: Record<string, Blob> = {};
    const assets: Record<string, Asset> = {};
    for (const id of used) {
      const asset = project.assets.byId[id];
      if (!asset) continue;
      assets[id] = asset;
      const blob = await getStorage().getBlob(projectId, asset.file);
      if (blob) files[id] = blob;
    }
    const job: ExportJob = {
      content,
      assets,
      files,
      ...(range ? { range } : {}),
      settings: {
        width: size.width,
        height: size.height,
        fps: content.sequence.fps,
        sampleRate: content.sequence.sampleRate,
        videoBitrate: defaultVideoBitrate(
          size.width,
          size.height,
          content.sequence.fps.num / content.sequence.fps.den,
        ),
        audioBitrate: AUDIO_BITRATE,
      },
    };
    const request: ExportRequest = { type: 'start', job };
    worker.postMessage(request);
  };

  const result = start()
    .then(() => outcome)
    .then((done) => {
      if ('error' in done) throw done.error;
      return done.blob;
    })
    .finally(() => worker.terminate());

  return {
    result,
    cancel: () => {
      const request: ExportRequest = { type: 'cancel' };
      worker.postMessage(request);
    },
  };
}
