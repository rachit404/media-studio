import { AppError } from '@media-studio/core';
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  WebMOutputFormat,
  canEncodeAudio,
} from 'mediabunny';
import { FORMATS, type ContainerFormat, type WriteChunk } from './video-writer';

type AddAudio = (channels: [Float32Array, Float32Array], timestampUs: number) => Promise<void>;

export interface AssembleOptions {
  format: ContainerFormat;
  /** Frames per second, as a number. */
  frameRate: number;
  /** The parts in order: files with the picture only, each starting at 0, and where each belongs in the export. */
  parts: readonly { blob: Blob; startUs: number }[];
  /** The sound for the whole export, or null for a file without. `writeUntil` hands blocks of sound to `add`. */
  audio: {
    sampleRate: number;
    bitrate: number;
    writeUntil: (timeUs: number, add: AddAudio) => Promise<void>;
  } | null;
  /** Write to this stream instead of keeping the file in memory (EXP-5); the result is then an empty Blob. */
  stream?: WritableStream<WriteChunk>;
  signal?: AbortSignal;
}

/**
 * Join the parts of a long export into one file (EXP-4) without encoding the picture again: the encoded pictures of
 * each part are copied over with their times moved to where the part belongs. The sound is mixed and encoded once
 * for the whole export (so there is no click where one part meets the next) and written alongside the pictures.
 */
export async function assembleParts(options: AssembleOptions): Promise<Blob> {
  const info = FORMATS[options.format];
  const target = options.stream ? null : new BufferTarget();
  const output = new Output({
    format:
      options.format === 'mp4'
        ? new Mp4OutputFormat({ fastStart: options.stream ? false : 'in-memory' })
        : new WebMOutputFormat(),
    target: options.stream
      ? new StreamTarget(options.stream, { chunked: true })
      : (target as BufferTarget),
  });
  const video = new EncodedVideoPacketSource(info.video);
  output.addVideoTrack(video, { frameRate: options.frameRate });
  let sound: AudioSampleSource | null = null;
  if (options.audio) {
    const ok = await canEncodeAudio(info.audio, {
      numberOfChannels: 2,
      sampleRate: options.audio.sampleRate,
      bitrate: options.audio.bitrate,
    });
    if (!ok) {
      throw new AppError({
        code: 'unsupported-codec',
        message: `This browser cannot encode ${info.audio.toUpperCase()} sound.`,
        hint: 'Mute or remove the audio tracks, choose another format, or use Chrome or Edge.',
      });
    }
    sound = new AudioSampleSource({ codec: info.audio, bitrate: options.audio.bitrate });
    output.addAudioTrack(sound);
  }

  const addAudio: AddAudio = async (channels, timestampUs) => {
    if (!sound || !options.audio) return;
    const frames = channels[0].length;
    const data = new Float32Array(frames * 2);
    data.set(channels[0], 0);
    data.set(channels[1], frames);
    const sample = new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: 2,
      sampleRate: options.audio.sampleRate,
      timestamp: timestampUs / 1_000_000,
    });
    try {
      await sound.add(sample);
    } finally {
      sample.close();
    }
  };

  try {
    await output.start();
    let first = true;
    for (const [index, part] of options.parts.entries()) {
      const input = new Input({ source: new BlobSource(part.blob), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) {
          throw new AppError({
            code: 'write-failed',
            message: 'A saved part of the export could not be read.',
            hint: 'Start the export again.',
          });
        }
        const config = await track.getDecoderConfig();
        const shift = part.startUs / 1_000_000;
        for await (const packet of new EncodedPacketSink(track).packets()) {
          if (options.signal?.aborted) {
            throw new AppError({ code: 'cancelled', message: 'The export was cancelled.' });
          }
          await video.add(
            packet.clone({ timestamp: packet.timestamp + shift }),
            first && config ? { decoderConfig: config } : undefined,
          );
          first = false;
        }
      } finally {
        input.dispose();
      }
      // Sound goes in step with the pictures, a little ahead of them.
      const next = options.parts[index + 1];
      await options.audio?.writeUntil(
        next ? next.startUs + 1_000_000 : Number.MAX_SAFE_INTEGER,
        addAudio,
      );
    }
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }
  if (!target) return new Blob([], { type: info.mime });
  const buffer = target.buffer;
  if (!buffer) {
    throw new AppError({ code: 'encoder-error', message: 'The video file could not be finished.' });
  }
  return new Blob([buffer], { type: info.mime });
}
