import { AppError } from '@media-studio/core';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';

/** What an export was asked to produce. */
export interface ExpectedOutput {
  container: 'mp4' | 'webm';
  videoCodec: 'avc' | 'vp9';
  width: number;
  height: number;
  /** Frames the picture should have (one more or fewer is accepted). */
  frameCount: number;
  /** Frames per second, to turn the duration tolerance into time. */
  frameRate: number;
  /** Length of the file in seconds. */
  durationSeconds: number;
  /** Null for a file without sound. */
  audio: { sampleRate: number } | null;
}

/** What a finished file actually contains, read back from the file itself. */
export interface OutputFacts {
  /** Lower case container name: `mp4`, `webm`, `mkv` ... */
  container: string;
  videoCodec: string | null;
  width: number;
  height: number;
  frameCount: number;
  durationSeconds: number;
  audio: { codec: string | null; sampleRate: number; channels: number } | null;
}

/** The frame count may differ by this many frames (the last frame can fall either side of the end). */
export const FRAME_COUNT_TOLERANCE = 1;
/** The duration may differ by this many frame lengths (the sound can be a little longer than the picture). */
export const DURATION_TOLERANCE_FRAMES = 3;

const HINT = 'Export again. If it keeps happening, try a smaller size.';

function failed(message: string, cause?: unknown): AppError {
  return new AppError({ code: 'verification-failed', message, hint: HINT, cause });
}

/**
 * Open a finished file again and read what is in it: container, picture codec and size, number of frames, length, and
 * the sound. Nothing is decoded; this reads the file's index and packet table only. Throws a `verification-failed`
 * error when the file cannot be opened or has no picture (a cut-off or empty file).
 */
export async function probeOutput(blob: Blob): Promise<OutputFacts> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw failed('The exported file has no picture, or is cut off.');
    const audio = await input.getPrimaryAudioTrack();
    const format = await input.getFormat();
    const stats = await video.computePacketStats();
    return {
      container: format.name.toLowerCase(),
      videoCodec: video.codec,
      width: video.displayWidth,
      height: video.displayHeight,
      frameCount: stats.packetCount,
      durationSeconds: await input.computeDuration(),
      audio: audio
        ? { codec: audio.codec, sampleRate: audio.sampleRate, channels: audio.numberOfChannels }
        : null,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw failed('The exported file could not be opened again.', error);
  } finally {
    input.dispose();
  }
}

/** Every way the file differs from what was asked for, in plain words (empty when it matches). */
export function checkOutput(facts: OutputFacts, expected: ExpectedOutput): string[] {
  const problems: string[] = [];
  if (facts.container !== expected.container) {
    problems.push(
      `it is a ${facts.container.toUpperCase()} file, not ${expected.container.toUpperCase()}`,
    );
  }
  if (facts.videoCodec !== expected.videoCodec) {
    problems.push(
      `the picture uses ${facts.videoCodec ?? 'an unknown codec'}, not ${expected.videoCodec}`,
    );
  }
  if (facts.width !== expected.width || facts.height !== expected.height) {
    problems.push(
      `the picture is ${String(facts.width)} x ${String(facts.height)}, not ${String(expected.width)} x ${String(expected.height)}`,
    );
  }
  if (Math.abs(facts.frameCount - expected.frameCount) > FRAME_COUNT_TOLERANCE) {
    problems.push(`it has ${String(facts.frameCount)} frames, not ${String(expected.frameCount)}`);
  }
  const slack = DURATION_TOLERANCE_FRAMES / Math.max(1, expected.frameRate);
  if (Math.abs(facts.durationSeconds - expected.durationSeconds) > slack) {
    problems.push(
      `it is ${facts.durationSeconds.toFixed(2)} s long, not ${expected.durationSeconds.toFixed(2)} s`,
    );
  }
  if (expected.audio && !facts.audio) {
    problems.push('the sound is missing');
  } else if (!expected.audio && facts.audio) {
    problems.push('it has sound, but the project has none');
  } else if (
    expected.audio &&
    facts.audio &&
    facts.audio.sampleRate !== expected.audio.sampleRate
  ) {
    problems.push(
      `the sound is ${String(facts.audio.sampleRate)} Hz, not ${String(expected.audio.sampleRate)} Hz`,
    );
  }
  return problems;
}

/**
 * Check a finished export before it is handed over (EXP-7): open it again and compare it with what was asked for.
 * Returns what was found; throws a `verification-failed` error naming the first difference when it does not match.
 */
export async function verifyExport(blob: Blob, expected: ExpectedOutput): Promise<OutputFacts> {
  const facts = await probeOutput(blob);
  const problems = checkOutput(facts, expected);
  const [first] = problems;
  if (first !== undefined) {
    const more = problems.length > 1 ? ` (and ${String(problems.length - 1)} more)` : '';
    throw failed(`The exported file did not pass the check: ${first}${more}.`, { facts, problems });
  }
  return facts;
}
