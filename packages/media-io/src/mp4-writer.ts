import { AppError } from '@media-studio/core';
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';

export interface Mp4WriterOptions {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  width: number;
  height: number;
  /** Frames per second, as a number (29.97 for 30000/1001). */
  frameRate: number;
  /** Bits per second of the picture. */
  videoBitrate: number;
  /** Null for a file without sound. */
  audio: { sampleRate: number; bitrate: number } | null;
}

/** Bits per second that give a good picture at a size and frame rate (about 0.1 bit per pixel for H.264). */
export function defaultVideoBitrate(width: number, height: number, frameRate: number): number {
  return Math.round(Math.min(80_000_000, Math.max(1_000_000, width * height * frameRate * 0.1)));
}

/**
 * Writes an MP4 with H.264 picture and AAC sound. The picture is whatever is on `canvas` when `addVideoFrame` is
 * called. The file is built in memory (stream-to-disk arrives with the export milestone), so very long exports are
 * limited by memory.
 */
export class Mp4Writer {
  private constructor(
    private readonly output: Output<Mp4OutputFormat, BufferTarget>,
    private readonly target: BufferTarget,
    private readonly video: CanvasSource,
    private readonly sound: AudioSampleSource | null,
    private readonly sampleRate: number,
  ) {}

  /** Check that this browser can encode the formats, then start the file. Throws an AppError when it cannot. */
  static async create(options: Mp4WriterOptions): Promise<Mp4Writer> {
    const videoOk = await canEncodeVideo('avc', {
      width: options.width,
      height: options.height,
      bitrate: options.videoBitrate,
      frameRate: options.frameRate,
    });
    if (!videoOk) {
      throw new AppError({
        code: 'unsupported-codec',
        message: 'This browser cannot encode H.264 video at this size.',
        hint: 'Use a smaller size, or open the project in Chrome or Edge on a computer with hardware video encoding.',
      });
    }
    if (options.audio) {
      const audioOk = await canEncodeAudio('aac', {
        numberOfChannels: 2,
        sampleRate: options.audio.sampleRate,
        bitrate: options.audio.bitrate,
      });
      if (!audioOk) {
        throw new AppError({
          code: 'unsupported-codec',
          message: 'This browser cannot encode AAC sound.',
          hint: 'Mute or remove the audio tracks, or use Chrome or Edge.',
        });
      }
    }
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const video = new CanvasSource(options.canvas, { codec: 'avc', bitrate: options.videoBitrate });
    output.addVideoTrack(video, { frameRate: options.frameRate });
    let sound: AudioSampleSource | null = null;
    if (options.audio) {
      sound = new AudioSampleSource({ codec: 'aac', bitrate: options.audio.bitrate });
      output.addAudioTrack(sound);
    }
    try {
      await output.start();
    } catch (error) {
      throw new AppError({
        code: 'encoder-error',
        message: 'The video file could not be started.',
        cause: error,
      });
    }
    return new Mp4Writer(output, target, video, sound, options.audio?.sampleRate ?? 48_000);
  }

  async addVideoFrame(timestampUs: number, durationUs: number): Promise<void> {
    try {
      await this.video.add(timestampUs / 1_000_000, durationUs / 1_000_000);
    } catch (error) {
      throw new AppError({
        code: 'encoder-error',
        message: 'The video encoder stopped working.',
        hint: 'Try a smaller size, or close other tabs that use the camera or video.',
        cause: error,
      });
    }
  }

  async addAudio(channels: [Float32Array, Float32Array], timestampUs: number): Promise<void> {
    if (!this.sound) return;
    const frames = channels[0].length;
    const data = new Float32Array(frames * 2);
    data.set(channels[0], 0);
    data.set(channels[1], frames);
    const sample = new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: 2,
      sampleRate: this.sampleRate,
      timestamp: timestampUs / 1_000_000,
    });
    try {
      await this.sound.add(sample);
    } catch (error) {
      throw new AppError({
        code: 'encoder-error',
        message: 'The audio encoder stopped working.',
        cause: error,
      });
    } finally {
      sample.close();
    }
  }

  async finalize(): Promise<Blob> {
    await this.output.finalize();
    const buffer = this.target.buffer;
    if (!buffer) {
      throw new AppError({
        code: 'encoder-error',
        message: 'The video file could not be finished.',
      });
    }
    return new Blob([buffer], { type: 'video/mp4' });
  }

  async cancel(): Promise<void> {
    await this.output.cancel();
  }
}
