import { AppError } from './errors';

/**
 * Waveform peaks: the loudest sample in each small slice of an audio file, one byte per slice (0 to 255), used to
 * draw the waveform on the timeline without decoding the audio again. File layout: 'M','P', version, then the
 * number of slices per second as a 16-bit little-endian number, then one byte per slice.
 */
export const PEAKS_PER_SECOND = 100;
const MAGIC = [0x4d, 0x50] as const;
const VERSION = 1;
const HEADER = 5;
/** Longest audio we compute peaks for (24 hours at the default rate is about 8.6 MB). */
export const MAX_PEAKS = 24 * 3600 * PEAKS_PER_SECOND;

export interface Peaks {
  perSecond: number;
  /** 0..255 per slice. */
  data: Uint8Array;
}

export function encodePeaks(peaks: Peaks): Uint8Array {
  const out = new Uint8Array(HEADER + peaks.data.length);
  out[0] = MAGIC[0];
  out[1] = MAGIC[1];
  out[2] = VERSION;
  out[3] = peaks.perSecond & 0xff;
  out[4] = (peaks.perSecond >> 8) & 0xff;
  out.set(peaks.data, HEADER);
  return out;
}

export function decodePeaks(bytes: Uint8Array): Peaks {
  const perSecond = (bytes[3] ?? 0) | ((bytes[4] ?? 0) << 8);
  if (
    bytes.length < HEADER ||
    bytes[0] !== MAGIC[0] ||
    bytes[1] !== MAGIC[1] ||
    bytes[2] !== VERSION ||
    perSecond < 1 ||
    bytes.length - HEADER > MAX_PEAKS
  ) {
    throw new AppError({
      code: 'invalid-project',
      message: 'The waveform data for this file is damaged.',
      hint: 'It is drawn again the next time the file is imported.',
    });
  }
  return { perSecond, data: bytes.slice(HEADER) };
}

/**
 * Collects peaks while audio is decoded in order. Feed it mono-mixed absolute samples (any chunk size) with
 * `add`, then take the result with `finish`.
 */
export class PeakBuilder {
  private readonly slice: number;
  private readonly values: number[] = [];
  private max = 0;
  private filled = 0;

  constructor(
    sampleRate: number,
    readonly perSecond = PEAKS_PER_SECOND,
  ) {
    this.slice = sampleRate / perSecond;
  }

  /** Add samples in -1..1 (sign is ignored). */
  add(samples: Float32Array): void {
    let position = this.filled;
    for (const sample of samples) {
      const level = Math.abs(sample);
      if (level > this.max) this.max = level;
      position += 1;
      if (position >= this.slice) {
        this.flush();
        position -= this.slice;
      }
    }
    this.filled = position;
  }

  private flush(): void {
    if (this.values.length < MAX_PEAKS) this.values.push(Math.min(255, Math.round(this.max * 255)));
    this.max = 0;
  }

  finish(): Peaks {
    if (this.filled > 0) this.flush();
    this.filled = 0;
    return { perSecond: this.perSecond, data: Uint8Array.from(this.values) };
  }
}

/**
 * Reduce peaks to `bins` values for a stretch of the file (seconds), keeping the loudest value of each bin. Used to
 * draw a clip's waveform at the current zoom.
 */
export function peaksForRange(
  peaks: Peaks,
  startSeconds: number,
  endSeconds: number,
  bins: number,
): Uint8Array {
  const out = new Uint8Array(Math.max(0, Math.floor(bins)));
  if (out.length === 0 || endSeconds <= startSeconds) return out;
  const from = startSeconds * peaks.perSecond;
  const span = ((endSeconds - startSeconds) * peaks.perSecond) / out.length;
  for (let bin = 0; bin < out.length; bin += 1) {
    const first = Math.max(0, Math.floor(from + bin * span));
    const last = Math.min(peaks.data.length - 1, Math.max(first, Math.ceil(from + (bin + 1) * span) - 1));
    let loudest = 0;
    for (let i = first; i <= last; i += 1) loudest = Math.max(loudest, peaks.data[i] ?? 0);
    out[bin] = loudest;
  }
  return out;
}
