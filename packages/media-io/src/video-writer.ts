import { AppError } from '@media-studio/core';
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  StreamTarget,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type StreamTargetChunk,
  type VideoCodec,
} from 'mediabunny';

/** A piece of the file being written, with its place in the file. */
export type WriteChunk = StreamTargetChunk;

/** The files export can make. */
export type ContainerFormat = 'mp4' | 'webm';

/** Whether to ask the browser for a hardware or a software encoder. It is a preference; the browser may decide otherwise. */
export type HardwarePreference = 'no-preference' | 'prefer-hardware' | 'prefer-software';

export interface FormatInfo {
  label: string;
  video: VideoCodec;
  audio: AudioCodec;
  mime: string;
  extension: string;
  /** Sample rates the sound encoder takes; others are converted to the first one. */
  audioRates: readonly number[] | null;
}

export const FORMATS: Readonly<Record<ContainerFormat, FormatInfo>> = {
  mp4: {
    label: 'MP4 (H.264 and AAC)',
    video: 'avc',
    audio: 'aac',
    mime: 'video/mp4',
    extension: 'mp4',
    audioRates: null,
  },
  webm: {
    label: 'WebM (VP9 and Opus)',
    video: 'vp9',
    audio: 'opus',
    mime: 'video/webm',
    extension: 'webm',
    // Opus only takes these; export mixes at the first one for WebM.
    audioRates: [48_000, 24_000, 16_000, 12_000, 8_000],
  },
};

export interface VideoWriterOptions {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  width: number;
  height: number;
  /** Frames per second, as a number (29.97 for 30000/1001). */
  frameRate: number;
  format: ContainerFormat;
  /** Bits per second of the picture. */
  videoBitrate: number;
  hardware: HardwarePreference;
  /** Null for a file without sound. */
  audio: { sampleRate: number; bitrate: number } | null;
  /**
   * Write the file to this stream as it is made, instead of keeping it in memory (stream to disk, EXP-5). The
   * chunks carry their position, so a seekable file writer is needed. `finalize` then returns an empty Blob.
   */
  stream?: WritableStream<StreamTargetChunk>;
}

/** Bits per second that give a good picture at a size and frame rate (about 0.1 bit per pixel for H.264). */
export function defaultVideoBitrate(width: number, height: number, frameRate: number): number {
  return Math.round(Math.min(80_000_000, Math.max(1_000_000, width * height * frameRate * 0.1)));
}

/**
 * Writes an MP4 (H.264 and AAC) or a WebM (VP9 and Opus). The picture is whatever is on `canvas` when
 * `addVideoFrame` is called. The file is built in memory, so very long exports are limited by memory.
 */
export class VideoWriter {
  private constructor(
    private readonly output: Output,
    private readonly target: BufferTarget | null,
    private readonly video: CanvasSource,
    private readonly sound: AudioSampleSource | null,
    private readonly sampleRate: number,
    private readonly format: ContainerFormat,
  ) {}

  /** Check that this browser can encode the formats, then start the file. Throws an AppError when it cannot. */
  static async create(options: VideoWriterOptions): Promise<VideoWriter> {
    const info = FORMATS[options.format];
    const videoOk = await canEncodeVideo(info.video, {
      width: options.width,
      height: options.height,
      bitrate: options.videoBitrate,
      frameRate: options.frameRate,
      hardwareAcceleration: options.hardware,
    });
    if (!videoOk) {
      throw new AppError({
        code: 'unsupported-codec',
        message: `This browser cannot encode ${info.label.split(' (')[0] ?? 'this'} video at this size.`,
        hint:
          options.hardware === 'no-preference'
            ? 'Use a smaller size or another format, or open the project in Chrome or Edge.'
            : 'Set the encoder to automatic, use a smaller size, or choose another format.',
      });
    }
    if (options.audio) {
      const audioOk = await canEncodeAudio(info.audio, {
        numberOfChannels: 2,
        sampleRate: options.audio.sampleRate,
        bitrate: options.audio.bitrate,
      });
      if (!audioOk) {
        throw new AppError({
          code: 'unsupported-codec',
          message: `This browser cannot encode ${info.audio.toUpperCase()} sound.`,
          hint: 'Mute or remove the audio tracks, choose another format, or use Chrome or Edge.',
        });
      }
    }
    const target = options.stream ? null : new BufferTarget();
    const output = new Output({
      format:
        options.format === 'mp4'
          ? // Streaming cannot keep the media in memory to put the index first, so the index goes last.
            new Mp4OutputFormat({ fastStart: options.stream ? false : 'in-memory' })
          : new WebMOutputFormat(),
      target: options.stream
        ? new StreamTarget(options.stream, { chunked: true })
        : (target as BufferTarget),
    });
    const video = new CanvasSource(options.canvas, {
      codec: info.video,
      bitrate: options.videoBitrate,
      hardwareAcceleration: options.hardware,
    });
    output.addVideoTrack(video, { frameRate: options.frameRate });
    let sound: AudioSampleSource | null = null;
    if (options.audio) {
      sound = new AudioSampleSource({ codec: info.audio, bitrate: options.audio.bitrate });
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
    return new VideoWriter(
      output,
      target,
      video,
      sound,
      options.audio?.sampleRate ?? 48_000,
      options.format,
    );
  }

  async addVideoFrame(timestampUs: number, durationUs: number): Promise<void> {
    try {
      await this.video.add(timestampUs / 1_000_000, durationUs / 1_000_000);
    } catch (error) {
      throw new AppError({
        code: 'encoder-error',
        message: 'The video encoder stopped working.',
        hint: 'Try a smaller size, another format, or close other tabs that use the camera or video.',
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
    if (!this.target) return new Blob([], { type: FORMATS[this.format].mime });
    const buffer = this.target.buffer;
    if (!buffer) {
      throw new AppError({
        code: 'encoder-error',
        message: 'The video file could not be finished.',
      });
    }
    return new Blob([buffer], { type: FORMATS[this.format].mime });
  }

  async cancel(): Promise<void> {
    await this.output.cancel();
  }
}
