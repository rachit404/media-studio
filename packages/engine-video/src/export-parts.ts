import {
  AppError,
  frameToTime,
  samplesToTime,
  timeToSamples,
  type Asset,
  type FrameRate,
  type VideoContent,
} from '@media-studio/core';
import { mixAudioBlock, type AudioReader } from './audio-mix';

/** A stable text for any plain value: object keys sorted, so the same data always gives the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A 53-bit hash of a text (cyrb53): not secret, only used to tell exports apart. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Identifies an export: the project content, the media it uses and the settings and range. If any of them changes,
 * parts made earlier are not reused. A missed match only costs a restart; a false match would be wrong, so every
 * input that changes the picture or sound is included.
 */
export function exportFingerprint(input: {
  content: VideoContent;
  assets: Readonly<Record<string, Asset>>;
  settings: unknown;
  range: { start: number; end: number } | null;
}): string {
  return hash(canonical(input));
}

/** Frames in each part of a long export, from the length wanted (about 20 s). */
export function framesPerPart(fps: FrameRate, seconds: number): number {
  return Math.max(1, Math.round((fps.num / fps.den) * seconds));
}

/** One part of an export: where it starts in frames and how many it has. */
export interface PartPlan {
  index: number;
  firstFrame: number;
  frames: number;
}

export function planParts(totalFrames: number, partFrames: number): PartPlan[] {
  const parts: PartPlan[] = [];
  for (let first = 0; first < totalFrames; first += partFrames) {
    parts.push({
      index: parts.length,
      firstFrame: first,
      frames: Math.min(partFrames, totalFrames - first),
    });
  }
  return parts;
}

/** Writes the mixed sound of the export in order, a block at a time, as the pictures go by. */
export interface AudioWriter {
  /** Write all sound up to `timeUs` after the start of the export (or less if the export ends first). */
  writeUntil(timeUs: number, add: AddAudio): Promise<void>;
}

/** Hands a block of mixed sound (left and right) and its time in the export to the encoder. */
export type AddAudio = (
  channels: [Float32Array, Float32Array],
  timestampUs: number,
) => Promise<void>;

export function createAudioWriter(
  content: VideoContent,
  assets: Readonly<Record<string, Asset>>,
  readerFor: (assetId: string) => AudioReader,
  options: { sampleRate: number; start: number; duration: number },
): AudioWriter {
  const { sampleRate } = options;
  const totalSamples = timeToSamples(options.duration, sampleRate);
  const offset = timeToSamples(options.start, sampleRate);
  let done = 0;
  return {
    async writeUntil(timeUs, add) {
      const wanted = Math.min(totalSamples, timeToSamples(timeUs, sampleRate));
      while (done < wanted) {
        const frames = Math.min(sampleRate, totalSamples - done);
        const block = await mixAudioBlock(
          content,
          assets,
          readerFor,
          offset + done,
          frames,
          sampleRate,
        );
        await add(block, samplesToTime(done, sampleRate));
        done += frames;
      }
    },
  };
}

/** Where finished parts are kept (the storage package's ExportJobStore does this on disk). */
export interface PartStore {
  begin(init: {
    fingerprint: string;
    totalFrames: number;
    segmentFrames: number;
  }): Promise<{ state: PartState; resumed: boolean }>;
  saveSegment(state: PartState, index: number, blob: Blob): Promise<PartState>;
  readSegment(index: number): Promise<Blob>;
  clear(): Promise<void>;
}

/** What the store remembers: which parts are complete. */
export interface PartState {
  done: number[];
}

/** A finished part, with the time it starts at in the export. */
export interface FinishedPart {
  index: number;
  startUs: number;
  blob: Blob;
}

export interface PartsDependencies {
  store: PartStore;
  /** Make one part: `count` frames from export frame `first`, as a file with the picture only. */
  encodePart(first: number, count: number): Promise<Blob>;
  /** Join the parts, in order, with the sound, into the finished file. `audioUntil` writes sound up to a time. */
  assemble(
    parts: FinishedPart[],
    audioUntil: (timeUs: number, add: AddAudio) => Promise<void>,
  ): Promise<Blob>;
}

/**
 * Make a long export in parts (EXP-4). Each part is saved to disk as soon as it is done, so a crash, a closed tab
 * or an encoder error loses at most the part in progress, and starting the same export again continues after the
 * last complete part. The parts are joined without re-encoding. Cancelling (the user's own choice) removes
 * everything; a failure keeps the parts for another try; success removes them.
 */
export async function exportInParts(
  params: {
    fingerprint: string;
    totalFrames: number;
    partFrames: number;
    fps: FrameRate;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    /** Writes the sound for the whole export, in order; null when there is none. */
    audio: AudioWriter | null;
  },
  deps: PartsDependencies,
): Promise<Blob> {
  const { store } = deps;
  const { state: begun } = await store.begin({
    fingerprint: params.fingerprint,
    totalFrames: params.totalFrames,
    segmentFrames: params.partFrames,
  });
  let state: PartState = begun;
  const plans = planParts(params.totalFrames, params.partFrames);
  const cancelled = () => new AppError({ code: 'cancelled', message: 'The export was cancelled.' });

  try {
    let framesDone = 0;
    for (const plan of plans) {
      if (params.signal?.aborted) throw cancelled();
      if (!state.done.includes(plan.index)) {
        const blob = await deps.encodePart(plan.firstFrame, plan.frames);
        state = await store.saveSegment(state, plan.index, blob);
      }
      framesDone += plan.frames;
      params.onProgress?.(framesDone, params.totalFrames);
    }
    if (params.signal?.aborted) throw cancelled();
    const parts: FinishedPart[] = [];
    for (const plan of plans) {
      parts.push({
        index: plan.index,
        startUs: frameToTime(plan.firstFrame, params.fps),
        blob: await store.readSegment(plan.index),
      });
    }
    const audio = params.audio;
    const result = await deps.assemble(
      parts,
      (timeUs, add) => audio?.writeUntil(timeUs, add) ?? Promise.resolve(),
    );
    await store.clear();
    return result;
  } catch (error) {
    if (error instanceof AppError && error.code === 'cancelled') await store.clear();
    throw error;
  }
}
