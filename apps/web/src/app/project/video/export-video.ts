import { AppError, type Asset, type ProjectDocument } from '@media-studio/core';
import { getStorage } from '../../storage-client';
import type { ExportEvent, ExportJob, ExportRequest } from '../../../workers/export-protocol';
import type { ExportSettings } from './export-settings';

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
  settings: ExportSettings,
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
      settings,
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
