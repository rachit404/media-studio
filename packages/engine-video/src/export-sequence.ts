import {
  AppError,
  formatTimecode,
  frameToTime,
  samplesToTime,
  sequenceDuration,
  timeToFrame,
  timeToSamples,
  toAppError,
  type Asset,
  type FrameRate,
  type VideoContent,
} from '@media-studio/core';
import type { RasterMetrics, RenderScene } from '@media-studio/render';
import { mixAudioBlock, type AudioReader } from './audio-mix';
import type { Closable } from './frame-cache';
import { FramePump, type FrameStreamSource } from './frame-pump';
import { buildPreviewScene, frameTextureId, previewPlan } from './preview';

/** The picture of a decoded frame, as far as export needs to know. */
export interface ExportFrame extends Closable {
  width: number;
  height: number;
}

/** Draws the sequence at export size (the adapter owns the canvas, the GPU context and the textures). */
export interface ExportRenderer<F extends ExportFrame> {
  uploadFrame(textureId: string, frame: F): void;
  deleteTexture(textureId: string): void;
  /** Draw `scene`, scaled to the export size, into the canvas the sink reads from. */
  render(scene: RenderScene): void;
}

/** Encodes and muxes. Every method may take as long as the encoder needs (it provides the back-pressure). */
export interface ExportSink {
  /** Encode the picture that was just rendered. */
  addVideoFrame(timestampUs: number, durationUs: number): Promise<void>;
  addAudio(channels: [Float32Array, Float32Array], timestampUs: number): Promise<void>;
  /** Finish the file. */
  finalize(): Promise<Blob>;
  /** Abandon everything written so far. */
  cancel(): Promise<void>;
}

export interface ExportDependencies<F extends ExportFrame> {
  frameSource(assetId: string): FrameStreamSource<F>;
  audioReader(assetId: string): AudioReader;
  renderer: ExportRenderer<F>;
  /** Measures text clips, which the renderer draws itself (the adapter owns the canvas). */
  metrics: RasterMetrics;
  sink: ExportSink;
}

export interface ExportOptions {
  fps: FrameRate;
  sampleRate: number;
  signal?: AbortSignal;
  /**
   * Export only this part of the sequence (timeline microseconds, from the in point to the out point). The file
   * starts at 0: picture and sound are taken from `start` on and written as if it were the beginning.
   */
  range?: { start: number; end: number };
  /** Called after every frame with the frames done and the total. */
  onProgress?: (done: number, total: number) => void;
}

/** Sound is produced and written in blocks of this many seconds, ahead of the pictures that go with it. */
const AUDIO_BLOCK_SECONDS = 1;

/** Whether the sequence has any sound to export (an unmuted audio track with a clip whose media is present). */
export function hasExportAudio(
  content: VideoContent,
  assets: Readonly<Record<string, Asset>>,
): boolean {
  return Object.values(content.clips).some((clip) => {
    const track = content.tracks.byId[clip.trackId];
    const asset = clip.assetId === null ? undefined : assets[clip.assetId];
    return (
      track?.kind === 'audio' &&
      !track.muted &&
      (asset?.kind === 'audio' || asset?.kind === 'video')
    );
  });
}

/** How many frames export produces for the sequence at a frame rate. */
export function exportFrameCount(duration: number, fps: FrameRate): number {
  return duration <= 0 ? 0 : timeToFrame(duration - 1, fps) + 1;
}

interface ClipStream<F extends ExportFrame> {
  pump: FramePump<F>;
  uploaded: number | null;
}

/**
 * Render the sequence frame by frame, deterministically: for each output frame the picture of every visible clip is
 * decoded (never skipped, however long it takes), drawn, and encoded, and the mixed sound is written alongside.
 * Nothing is left behind on cancel or failure: decoders are stopped, textures freed and the output abandoned.
 */
export async function exportSequence<F extends ExportFrame>(
  content: VideoContent,
  assets: Readonly<Record<string, Asset>>,
  deps: ExportDependencies<F>,
  options: ExportOptions,
): Promise<Blob> {
  const { fps, sampleRate, signal } = options;
  const range = options.range;
  const offset = range ? Math.max(0, range.start) : 0;
  const duration = range
    ? Math.min(range.end, sequenceDuration(content)) - offset
    : sequenceDuration(content);
  const total = exportFrameCount(duration, fps);
  if (total === 0) {
    throw new AppError({
      code: 'invalid-project',
      message: 'There is nothing to export yet.',
      hint: 'Add a video or audio file to the timeline first.',
    });
  }
  const withAudio = hasExportAudio(content, assets);
  const totalSamples = timeToSamples(duration, sampleRate);
  const sampleOffset = timeToSamples(offset, sampleRate);
  const blockSamples = Math.round(AUDIO_BLOCK_SECONDS * sampleRate);
  const readers = new Map<string, AudioReader>();
  const readerFor = (assetId: string): AudioReader => {
    let reader = readers.get(assetId);
    if (!reader) {
      reader = deps.audioReader(assetId);
      readers.set(assetId, reader);
    }
    return reader;
  };

  const streams = new Map<string, ClipStream<F>>();
  const sizes = new Map<string, { width: number; height: number }>();
  let audioDone = 0;

  const release = (clipId: string) => {
    const stream = streams.get(clipId);
    if (!stream) return;
    stream.pump.stop();
    streams.delete(clipId);
    sizes.delete(clipId);
    deps.renderer.deleteTexture(frameTextureId(clipId));
  };

  const writeAudioUntil = async (timeUs: number) => {
    const wanted = Math.min(totalSamples, timeToSamples(timeUs, sampleRate));
    while (audioDone < wanted) {
      const frames = Math.min(blockSamples, totalSamples - audioDone);
      const block = await mixAudioBlock(
        content,
        assets,
        readerFor,
        sampleOffset + audioDone,
        frames,
        sampleRate,
      );
      await deps.sink.addAudio(block, samplesToTime(audioDone, sampleRate));
      audioDone += frames;
    }
  };

  try {
    for (let index = 0; index < total; index += 1) {
      if (signal?.aborted)
        throw new AppError({ code: 'cancelled', message: 'The export was cancelled.' });
      // `written` is the time in the file, `time` the time on the timeline (they differ by the start of the range).
      const written = frameToTime(index, fps);
      const time = offset + written;
      const next = Math.min(frameToTime(index + 1, fps), duration);
      if (withAudio) await writeAudioUntil(written + AUDIO_BLOCK_SECONDS * 1_000_000);

      const plan = previewPlan(content, assets, time);
      const active = new Set<string>();
      for (const layer of plan.video) {
        if (layer.assetId === null) continue; // text is drawn from its own description
        const asset = assets[layer.assetId];
        if (!asset) continue;
        active.add(layer.clipId);
        let stream = streams.get(layer.clipId);
        if (!stream) {
          const pump = new FramePump<F>(deps.frameSource(asset.id), 4);
          pump.start(layer.sourceTime);
          stream = { pump, uploaded: null };
          streams.set(layer.clipId, stream);
        }
        await stream.pump.settled(layer.sourceTime);
        if (stream.pump.error !== null) {
          throw stream.pump.error instanceof AppError
            ? stream.pump.error
            : new AppError({
                code: 'decode-failed',
                message: `A video file could not be decoded at ${formatTimecode(time, fps)}.`,
                hint: 'The file may be damaged. Remove it from the timeline or import it again.',
                cause: stream.pump.error,
              });
        }
        const picture = stream.pump.frameFor(layer.sourceTime);
        if (!picture) continue;
        if (stream.uploaded !== picture.timestamp) {
          deps.renderer.uploadFrame(frameTextureId(layer.clipId), picture.frame);
          sizes.set(layer.clipId, { width: picture.frame.width, height: picture.frame.height });
          stream.uploaded = picture.timestamp;
        }
      }
      for (const clipId of [...streams.keys()]) if (!active.has(clipId)) release(clipId);

      deps.renderer.render(buildPreviewScene(content, assets, time, sizes, deps.metrics));
      await deps.sink.addVideoFrame(written, Math.max(1, next - written));
      options.onProgress?.(index + 1, total);
    }
    if (withAudio) await writeAudioUntil(duration);
    return await deps.sink.finalize();
  } catch (error) {
    await deps.sink.cancel().catch(() => undefined);
    throw error instanceof AppError ? error : toAppError(error);
  } finally {
    for (const clipId of [...streams.keys()]) release(clipId);
  }
}
