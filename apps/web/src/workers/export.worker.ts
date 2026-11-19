import { AppError, fpsValue, sequenceDuration, toAppError } from '@media-studio/core';
import {
  createAudioWriter,
  exportFingerprint,
  exportFrameCount,
  exportInParts,
  exportSequence,
  framesPerPart,
  hasExportAudio,
  type ExportDependencies,
  type ExportSink,
} from '@media-studio/engine-video';
import {
  AudioFileReader,
  VideoSource,
  VideoWriter,
  assembleParts,
  verifyExport,
  type WriteChunk,
} from '@media-studio/media-io';
import { OffscreenRenderer, rasterMetrics } from '@media-studio/render';
import { EXPORT_JOB_ROOT, ExportJobStore, OpfsFileSystem } from '@media-studio/storage';
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
  const disk: { open: FileSystemWritableFileStream | null } = { open: null };

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
  const audioReader = (assetId: string) => {
    let reader = readers.get(assetId);
    if (!reader) {
      reader = new AudioFileReader(fileFor(assetId));
      readers.set(assetId, reader);
    }
    return reader;
  };

  try {
    renderer = new OffscreenRenderer(settings.width, settings.height);
    const active = renderer;
    const withAudio = hasExportAudio(job.content, job.assets);
    const length = job.range
      ? Math.min(job.range.end, sequenceDuration(job.content)) - job.range.start
      : sequenceDuration(job.content);
    const totalFrames = exportFrameCount(length, settings.fps);
    const frameRate = fpsValue(settings.fps);

    /** A stream onto the chosen file, when the user asked for the file to be written straight to disk. */
    const diskStream = async (): Promise<WritableStream<WriteChunk> | undefined> => {
      if (!job.save) return undefined;
      const file = await job.save.createWritable();
      disk.open = file;
      return new WritableStream<WriteChunk>({
        write: (chunk) => file.write({ type: 'write', data: chunk.data, position: chunk.position }),
        close: async () => {
          await file.close();
          disk.open = null;
        },
        abort: async (reason) => {
          await file.abort(reason);
          disk.open = null;
        },
      });
    };

    const frameDeps: Omit<ExportDependencies<ImageBitmap>, 'sink'> = {
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
      audioReader,
      renderer: {
        uploadFrame: (id, frame) => active.uploadFrame(id, frame),
        deleteTexture: (id) => active.deleteTexture(id),
        render: (scene) => active.render(scene),
      },
    };

    let blob: Blob;
    if (job.parts) {
      // A long export made in parts that are saved as they are done, so it can be continued (EXP-4).
      const store = new ExportJobStore(new OpfsFileSystem(EXPORT_JOB_ROOT), job.parts.projectId);
      const partFrames = framesPerPart(settings.fps, job.parts.seconds);
      const rangeStart = job.range?.start ?? 0;
      const frameTime = (frame: number) => Math.round((frame * 1_000_000) / frameRate);
      blob = await exportInParts(
        {
          fingerprint: exportFingerprint({
            content: job.content,
            assets: job.assets,
            settings,
            range: job.range ?? null,
          }),
          totalFrames,
          partFrames,
          fps: settings.fps,
          signal: abort.signal,
          onProgress: (done, total) => send({ type: 'progress', done, total }),
          audio: withAudio
            ? createAudioWriter(job.content, job.assets, audioReader, {
                sampleRate: settings.sampleRate,
                start: rangeStart,
                duration: length,
              })
            : null,
        },
        {
          store,
          encodePart: async (first, count) => {
            const start = rangeStart + frameTime(first);
            const writer = await VideoWriter.create({
              format: settings.format,
              hardware: settings.hardware,
              canvas: active.canvas,
              width: settings.width,
              height: settings.height,
              frameRate,
              videoBitrate: settings.videoBitrate,
              audio: null,
            });
            return exportSequence(
              job.content,
              job.assets,
              { ...frameDeps, sink: writer },
              {
                fps: settings.fps,
                sampleRate: settings.sampleRate,
                signal: abort.signal,
                range: { start, end: start + frameTime(count) + 1 },
                frames: count,
                audio: false,
              },
            );
          },
          assemble: async (parts, audioUntil) =>
            assembleParts({
              format: settings.format,
              frameRate,
              parts,
              audio: withAudio
                ? {
                    sampleRate: settings.sampleRate,
                    bitrate: settings.audioBitrate,
                    writeUntil: audioUntil,
                  }
                : null,
              signal: abort.signal,
              ...(job.save ? { stream: await diskStream() } : {}),
            }).then(async (made) => (job.save ? job.save.getFile() : made)),
        },
      );
    } else {
      const stream = await diskStream();
      const writer = await VideoWriter.create({
        ...(stream ? { stream } : {}),
        format: settings.format,
        hardware: settings.hardware,
        canvas: active.canvas,
        width: settings.width,
        height: settings.height,
        frameRate,
        videoBitrate: settings.videoBitrate,
        audio: withAudio
          ? { sampleRate: settings.sampleRate, bitrate: settings.audioBitrate }
          : null,
      });
      const sink: ExportSink = {
        addVideoFrame: (time, duration) => writer.addVideoFrame(time, duration),
        addAudio: (channels, time) => writer.addAudio(channels, time),
        // A file on disk is handed back as a File that is read from disk, not loaded into memory.
        finalize: async () => {
          const made = await writer.finalize();
          return job.save ? job.save.getFile() : made;
        },
        cancel: () => writer.cancel(),
      };
      blob = await exportSequence(
        job.content,
        job.assets,
        { ...frameDeps, sink },
        {
          fps: settings.fps,
          sampleRate: settings.sampleRate,
          signal: abort.signal,
          ...(job.range ? { range: job.range } : {}),
          onProgress: (done, total) => send({ type: 'progress', done, total }),
        },
      );
    }

    if (job.verify) {
      send({ type: 'verifying' });
      await verifyExport(blob, {
        container: settings.format,
        videoCodec: settings.format === 'mp4' ? 'avc' : 'vp9',
        width: settings.width,
        height: settings.height,
        frameCount: totalFrames,
        frameRate,
        durationSeconds: length / 1_000_000,
        audio: withAudio ? { sampleRate: settings.sampleRate } : null,
      });
    }
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
    // A file that was started but not finished is thrown away, never left half written.
    await disk.open?.abort().catch(() => undefined);
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
