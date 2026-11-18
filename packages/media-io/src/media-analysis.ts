import { AppError, PeakBuilder, type Peaks } from '@media-studio/core';
import { ALL_FORMATS, AudioSampleSink, BlobSource, CanvasSink, Input } from 'mediabunny';
import { fitWithin } from './image';

/**
 * A small picture of a video: the frame about one second in (or the middle for short clips), at most
 * `maxSize` pixels on the long side. WebP where the browser can encode it.
 */
export async function createVideoThumbnail(blob: Blob, maxSize = 256): Promise<Blob> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track');
    const size = fitWithin(track.displayWidth, track.displayHeight, maxSize);
    const sink = new CanvasSink(track, { width: size.width, height: size.height, fit: 'fill' });
    const duration = (await input.getDurationFromMetadata()) ?? (await input.computeDuration());
    const first = await input.getFirstTimestamp([track]);
    const at = first + Math.min(1, duration / 2);
    const wrapped = (await sink.getCanvas(at)) ?? (await sink.getCanvas(first));
    if (!wrapped) throw new Error('no frame');
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D context unavailable');
    context.drawImage(wrapped.canvas, 0, 0, size.width, size.height);
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
  } catch (error) {
    throw new AppError({
      code: 'decode-failed',
      message: 'A preview picture could not be made from this video.',
      hint: 'The file may be damaged or use a format this browser cannot decode.',
      cause: error,
    });
  } finally {
    input.dispose();
  }
}

/**
 * Waveform peaks of the audio in a file. Decodes the audio once, in order, mixing channels by taking the loudest.
 * `onProgress` receives 0..1. Works in a worker (no AudioContext needed).
 */
export async function computePeaks(
  blob: Blob,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<Peaks> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('no audio track');
    const seconds = (await input.getDurationFromMetadata()) ?? (await input.computeDuration());
    const builder = new PeakBuilder(track.sampleRate);
    const sink = new AudioSampleSink(track);
    let channelData = new Float32Array(0);
    let mixed = new Float32Array(0);
    for await (const sample of sink.samples()) {
      if (options.signal?.aborted) {
        sample.close();
        throw new AppError({ code: 'cancelled', message: 'Cancelled.' });
      }
      try {
        const frames = sample.numberOfFrames;
        if (mixed.length < frames) {
          mixed = new Float32Array(frames);
          channelData = new Float32Array(frames);
        } else mixed.fill(0, 0, frames);
        for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
          sample.copyTo(channelData, { planeIndex: channel, format: 'f32-planar' });
          for (let i = 0; i < frames; i += 1) {
            const level = Math.abs(channelData[i] ?? 0);
            if (level > (mixed[i] ?? 0)) mixed[i] = level;
          }
        }
        builder.add(mixed.subarray(0, frames));
        if (seconds > 0) options.onProgress?.(Math.min(1, sample.timestamp / seconds));
      } finally {
        sample.close();
      }
    }
    return builder.finish();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: 'decode-failed',
      message: 'The sound of this file could not be read for its waveform.',
      hint: 'The file can still be used; the waveform will be missing.',
      cause: error,
    });
  } finally {
    input.dispose();
  }
}
