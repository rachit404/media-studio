import { AppError, toAppError } from '@media-studio/core';
import {
  exportSequence,
  hasExportAudio,
  type ExportDependencies,
} from '@media-studio/engine-video';
import { AudioFileReader, VideoSource, VideoWriter } from '@media-studio/media-io';
import { OffscreenRenderer, rasterMetrics } from '@media-studio/render';
import type { ExportEvent, ExportJob, ExportRequest } from './export-protocol';

// Dedicated worker: decoding, drawing and encoding a whole sequence never blocks the interface.

let controller: AbortController | null = null;

function send(event: ExportEvent): void {
  self.postMessage(event);
}

async function run(job: ExportJob): Promise<void> {
  const abort = new AbortController();
  controller = abort;
  const { settings } = job;
  const sources = new Map<string, Promise<VideoSource>>();
  const readers = new Map<string, AudioFileReader>();
  let renderer: OffscreenRenderer | null = null;

  const fileFor = (assetId: string): Blob => {
    const file = job.files[assetId];
    if (!file) {
      throw new AppError({
        code: 'invalid-project',
        message: 'A media file of this project is missing, so it cannot be exported.',
        hint: 'Remove its clips from the timeline or import the file again.',
      });
    }
    return file;
  };

  try {
    renderer = new OffscreenRenderer(settings.width, settings.height);
    const withAudio = hasExportAudio(job.content, job.assets);
    const writer = await VideoWriter.create({
      format: settings.format,
      hardware: settings.hardware,
      canvas: renderer.canvas,
      width: settings.width,
      height: settings.height,
      frameRate: settings.fps.num / settings.fps.den,
      videoBitrate: settings.videoBitrate,
      audio: withAudio ? { sampleRate: settings.sampleRate, bitrate: settings.audioBitrate } : null,
    });
    const active = renderer;
    const deps: ExportDependencies<ImageBitmap> = {
      metrics: rasterMetrics,
      frameSource: (assetId) => ({
        frames: async function* (startUs: number) {
          let source = sources.get(assetId);
          if (!source) {
            source = VideoSource.open(fileFor(assetId));
            sources.set(assetId, source);
          }
          for await (const decoded of (await source).frames(startUs)) {
            yield { frame: decoded.frame, timestamp: decoded.timestamp };
          }
        },
      }),
      audioReader: (assetId) => {
        let reader = readers.get(assetId);
        if (!reader) {
          reader = new AudioFileReader(fileFor(assetId));
          readers.set(assetId, reader);
        }
        return reader;
      },
      renderer: {
        uploadFrame: (id, frame) => active.uploadFrame(id, frame),
        deleteTexture: (id) => active.deleteTexture(id),
        render: (scene) => active.render(scene),
      },
      sink: writer,
    };
    const blob = await exportSequence(job.content, job.assets, deps, {
      fps: settings.fps,
      sampleRate: settings.sampleRate,
      signal: abort.signal,
      ...(job.range ? { range: job.range } : {}),
      onProgress: (done, total) => send({ type: 'progress', done, total }),
    });
    send({ type: 'done', blob });
  } catch (error) {
    const appError = toAppError(error);
    send({
      type: 'error',
      code: appError.code,
      message: appError.message,
      ...(appError.hint ? { hint: appError.hint } : {}),
    });
  } finally {
    renderer?.dispose();
    for (const reader of readers.values()) reader.close();
    for (const source of sources.values())
      void source.then((open) => open.close()).catch(() => undefined);
    controller = null;
  }
}

self.addEventListener('message', (event: MessageEvent<ExportRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') controller?.abort();
  else if (controller === null) void run(request.job);
});
