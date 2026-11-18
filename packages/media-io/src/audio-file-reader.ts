import { AppError } from '@media-studio/core';
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, type AudioSample } from 'mediabunny';

type Stereo = [Float32Array, Float32Array];

/** Mix any channel layout down to stereo: mono is copied to both sides, more channels alternate left and right. */
export function toStereo(
  sample: Pick<AudioSample, 'numberOfFrames' | 'numberOfChannels' | 'copyTo'>,
): Stereo {
  const frames = sample.numberOfFrames;
  const channels = sample.numberOfChannels;
  const plane = new Float32Array(frames);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const leftCount = Math.ceil(channels / 2);
  const rightCount = Math.floor(channels / 2);
  for (let channel = 0; channel < channels; channel += 1) {
    sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
    const target = channel % 2 === 0 ? left : right;
    const weight = channel % 2 === 0 ? 1 / leftCount : 1 / Math.max(1, rightCount);
    for (let i = 0; i < frames; i += 1) target[i] = (target[i] ?? 0) + (plane[i] ?? 0) * weight;
  }
  if (channels === 1) right.set(left);
  return [left, right];
}

/** Linear-interpolation resampling (a no-op when the rates match). Good enough for export; see the M7 notes. */
export function resample(input: Stereo, from: number, to: number): Stereo {
  if (from === to) return input;
  const frames = Math.max(1, Math.round((input[0].length * to) / from));
  const out: Stereo = [new Float32Array(frames), new Float32Array(frames)];
  for (let channel = 0; channel < 2; channel += 1) {
    const source = input[channel as 0 | 1];
    const target = out[channel as 0 | 1];
    const last = source.length - 1;
    for (let i = 0; i < frames; i += 1) {
      const position = (i * from) / to;
      const index = Math.min(last, Math.floor(position));
      const next = Math.min(last, index + 1);
      const fraction = position - index;
      target[i] = (source[index] ?? 0) * (1 - fraction) + (source[next] ?? 0) * fraction;
    }
  }
  return out;
}

/**
 * Reads a file's sound as stereo at a chosen rate, in order. Sequential calls (each starting where the last one
 * ended) stream through the decoder once; a jump restarts decoding there. Anything outside the file is silence.
 */
export class AudioFileReader {
  private input: Input | null = null;
  private sink: AudioSampleSink | null = null;
  private iterator: AsyncGenerator<AudioSample, void, undefined> | null = null;
  private opening: Promise<void> | null = null;
  /** Decoded sound waiting to be read: planar chunks that follow each other from `bufferStart`. */
  private chunks: Stereo[] = [];
  private bufferStart = 0;
  private bufferEnd = 0;
  private ended = false;
  private rate = 0;

  constructor(private readonly blob: Blob) {}

  private open(): Promise<void> {
    this.opening ??= (async () => {
      const input = new Input({ source: new BlobSource(this.blob), formats: ALL_FORMATS });
      const track = await input.getPrimaryAudioTrack();
      if (!track) {
        input.dispose();
        throw new AppError({ code: 'decode-failed', message: 'This file has no sound to read.' });
      }
      this.input = input;
      this.sink = new AudioSampleSink(track);
    })();
    return this.opening;
  }

  private async restart(startSample: number, sampleRate: number): Promise<void> {
    await this.iterator?.return().catch(() => undefined);
    await this.open();
    this.chunks = [];
    this.bufferStart = startSample;
    this.bufferEnd = startSample;
    this.ended = false;
    this.rate = sampleRate;
    this.iterator = (this.sink as AudioSampleSink).samples(Math.max(0, startSample / sampleRate));
  }

  /** Add decoded sound after what is buffered, filling gaps with silence and dropping overlap. */
  private append(chunk: Stereo, startSample: number): void {
    const frames = chunk[0].length;
    if (startSample > this.bufferEnd) {
      const gap = startSample - this.bufferEnd;
      this.chunks.push([new Float32Array(gap), new Float32Array(gap)]);
      this.bufferEnd = startSample;
    }
    const skip = this.bufferEnd - startSample;
    if (skip >= frames) return;
    this.chunks.push(skip === 0 ? chunk : [chunk[0].subarray(skip), chunk[1].subarray(skip)]);
    this.bufferEnd += frames - skip;
  }

  async read(startUs: number, frames: number, sampleRate: number): Promise<Stereo> {
    const start = Math.round((startUs * sampleRate) / 1_000_000);
    const end = start + frames;
    const continuing =
      this.iterator !== null &&
      this.rate === sampleRate &&
      start >= this.bufferStart &&
      start <= this.bufferEnd;
    if (!continuing) await this.restart(start, sampleRate);

    try {
      while (this.bufferEnd < end && !this.ended && this.iterator) {
        const next = await this.iterator.next();
        if (next.done) {
          this.ended = true;
          break;
        }
        const sample = next.value;
        try {
          const chunk = resample(toStereo(sample), sample.sampleRate, sampleRate);
          this.append(chunk, Math.round(sample.timestamp * sampleRate));
        } finally {
          sample.close();
        }
      }
    } catch (error) {
      throw new AppError({
        code: 'decode-failed',
        message: 'The sound of a file could not be read.',
        hint: 'The file may be damaged. Remove it from the timeline or import it again.',
        cause: error,
      });
    }

    // Copy the wanted range out of the buffer (silence past the end), then forget what came before it.
    const out: Stereo = [new Float32Array(frames), new Float32Array(frames)];
    let position = this.bufferStart;
    for (const chunk of this.chunks) {
      const chunkEnd = position + chunk[0].length;
      if (chunkEnd > start && position < end) {
        const from = Math.max(start, position);
        const to = Math.min(end, chunkEnd);
        out[0].set(chunk[0].subarray(from - position, to - position), from - start);
        out[1].set(chunk[1].subarray(from - position, to - position), from - start);
      }
      position = chunkEnd;
    }
    // Keep a few samples: resampled (sped up or slowed down) reads continue just before where this one ended.
    this.dropBefore(end - 4);
    return out;
  }

  private dropBefore(sample: number): void {
    while (this.chunks.length > 0) {
      const first = this.chunks[0];
      if (!first) break;
      const chunkEnd = this.bufferStart + first[0].length;
      if (chunkEnd <= sample) {
        this.chunks.shift();
        this.bufferStart = chunkEnd;
      } else {
        break;
      }
    }
    if (this.chunks.length === 0)
      this.bufferStart = Math.max(this.bufferStart, Math.min(sample, this.bufferEnd));
  }

  close(): void {
    void this.iterator?.return().catch(() => undefined);
    this.iterator = null;
    this.input?.dispose();
    this.input = null;
  }
}
