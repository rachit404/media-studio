import { AppError } from '@media-studio/core';
import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkOutput,
  probeOutput,
  verifyExport,
  type ExpectedOutput,
  type OutputFacts,
} from './verify-output';

// Files are made here from synthetic packets (no encoder, no media in the repository): mediabunny writes the
// container, and `verifyExport` reads it back like any other file.

const SPS = new Uint8Array([0x67, 0x42, 0xc0, 0x1f, 0x8c, 0x68, 0x0a, 0x0f, 0x60]);
const PPS = new Uint8Array([0x68, 0xce, 0x06, 0xe2]);
const AVCC = new Uint8Array([
  ...[1, 0x42, 0xc0, 0x1f, 0xff, 0xe1, 0, SPS.length, ...SPS, 1, 0, PPS.length, ...PPS],
]);
const OPUS_HEAD = new Uint8Array([
  ...[0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0],
]);

interface MakeOptions {
  container?: 'mp4' | 'webm';
  frames?: number;
  fps?: number;
  width?: number;
  height?: number;
  /** Seconds of sound, or null for a file without sound. */
  audioSeconds?: number | null;
  sampleRate?: number;
}

async function makeFile(options: MakeOptions = {}): Promise<Blob> {
  const {
    container = 'mp4',
    frames = 30,
    fps = 30,
    width = 320,
    height = 240,
    audioSeconds = 1,
    sampleRate = 48_000,
  } = options;
  const target = new BufferTarget();
  const mp4 = container === 'mp4';
  const output = new Output({
    format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target,
  });
  const video = new EncodedVideoPacketSource(mp4 ? 'avc' : 'vp9');
  output.addVideoTrack(video, { frameRate: fps });
  const audio = audioSeconds === null ? null : new EncodedAudioPacketSource(mp4 ? 'aac' : 'opus');
  if (audio) output.addAudioTrack(audio);
  await output.start();
  const data = new Uint8Array([0, 0, 0, 5, 0x41, 1, 2, 3, 4]);
  for (let i = 0; i < frames; i += 1) {
    const meta = {
      decoderConfig: mp4
        ? { codec: 'avc1.42c01f', codedWidth: width, codedHeight: height, description: AVCC }
        : { codec: 'vp09.00.10.08', codedWidth: width, codedHeight: height },
    };
    await video.add(
      new EncodedPacket(data, i === 0 ? 'key' : 'delta', i / fps, 1 / fps),
      i === 0 ? meta : undefined,
    );
  }
  if (audio && audioSeconds !== null) {
    const step = 1024 / sampleRate;
    const count = Math.ceil(audioSeconds / step);
    for (let i = 0; i < count; i += 1) {
      const meta = {
        decoderConfig: mp4
          ? {
              codec: 'mp4a.40.2',
              numberOfChannels: 2,
              sampleRate,
              // AudioSpecificConfig: AAC-LC, stereo, and the sample rate index (3 = 48 kHz, 4 = 44.1 kHz).
              description: new Uint8Array(sampleRate === 44_100 ? [0x12, 0x10] : [0x11, 0x90]),
            }
          : { codec: 'opus', numberOfChannels: 2, sampleRate, description: OPUS_HEAD },
      };
      await audio.add(
        new EncodedPacket(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'key', i * step, step),
        i === 0 ? meta : undefined,
      );
    }
  }
  await output.finalize();
  return new Blob([target.buffer ?? new ArrayBuffer(0)], {
    type: mp4 ? 'video/mp4' : 'video/webm',
  });
}

const EXPECTED: ExpectedOutput = {
  container: 'mp4',
  videoCodec: 'avc',
  width: 320,
  height: 240,
  frameCount: 30,
  frameRate: 30,
  durationSeconds: 1,
  audio: { sampleRate: 48_000 },
};

async function failure(blob: Blob, expected: ExpectedOutput = EXPECTED): Promise<AppError> {
  try {
    await verifyExport(blob, expected);
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('the check passed');
}

beforeEach(() => {
  // The made-up SPS in the test files is not a real one; mediabunny logs that it cannot parse it.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('reading a finished file back', () => {
  it('reports the container, codec, size, frames, length and sound of an MP4', async () => {
    const facts = await probeOutput(await makeFile());
    expect(facts).toMatchObject({
      container: 'mp4',
      videoCodec: 'avc',
      width: 320,
      height: 240,
      frameCount: 30,
      audio: { codec: 'aac', sampleRate: 48_000, channels: 2 },
    });
    expect(facts.durationSeconds).toBeGreaterThan(0.95);
    expect(facts.durationSeconds).toBeLessThan(1.1);
  });

  it('reports a file without sound as having none', async () => {
    const facts = await probeOutput(await makeFile({ audioSeconds: null }));
    expect(facts.audio).toBeNull();
  });

  it('reads a WebM too', async () => {
    const facts = await probeOutput(await makeFile({ container: 'webm' }));
    expect(facts).toMatchObject({
      container: 'webm',
      videoCodec: 'vp9',
      width: 320,
      frameCount: 30,
    });
    expect(facts.audio?.codec).toBe('opus');
  });
});

describe('verifyExport', () => {
  it('accepts a file that matches what was asked for', async () => {
    const facts = await verifyExport(await makeFile(), EXPECTED);
    expect(facts.frameCount).toBe(30);
  });

  it('accepts a WebM when a WebM was asked for', async () => {
    const blob = await makeFile({ container: 'webm' });
    await expect(
      verifyExport(blob, { ...EXPECTED, container: 'webm', videoCodec: 'vp9' }),
    ).resolves.toMatchObject({ container: 'webm' });
  });

  it('accepts a file without sound when none was expected', async () => {
    const blob = await makeFile({ audioSeconds: null });
    await expect(verifyExport(blob, { ...EXPECTED, audio: null })).resolves.toBeTruthy();
  });

  it('rejects the wrong picture size, naming both sizes', async () => {
    const error = await failure(await makeFile({ width: 640, height: 360 }));
    expect(error.code).toBe('verification-failed');
    expect(error.message).toContain('640 x 360, not 320 x 240');
    expect(error.hint).toBeTruthy();
  });

  it('allows one frame more or fewer, not two', async () => {
    await expect(verifyExport(await makeFile({ frames: 31 }), EXPECTED)).resolves.toBeTruthy();
    await expect(
      verifyExport(await makeFile({ frames: 29, audioSeconds: 0.97 }), EXPECTED),
    ).resolves.toBeTruthy();
    const error = await failure(await makeFile({ frames: 27 }));
    expect(error.message).toContain('27 frames, not 30');
  });

  it('rejects a file that is much shorter or longer than asked', async () => {
    const short = await failure(await makeFile({ frames: 15, audioSeconds: 0.5 }), {
      ...EXPECTED,
      frameCount: 15,
    });
    expect(short.message).toContain('s long, not 1.00 s');
    const long = await failure(await makeFile({ audioSeconds: 2 }));
    expect(long.message).toContain('s long');
  });

  it('rejects missing sound, unexpected sound and the wrong sample rate', async () => {
    const missing = await failure(await makeFile({ audioSeconds: null }));
    expect(missing.message).toContain('the sound is missing');
    const extra = await failure(await makeFile(), { ...EXPECTED, audio: null });
    expect(extra.message).toContain('it has sound, but the project has none');
    const rate = await failure(await makeFile({ sampleRate: 44_100 }));
    expect(rate.message).toContain('44100 Hz, not 48000 Hz');
  });

  it('rejects the wrong container and codec', async () => {
    const error = await failure(await makeFile({ container: 'webm' }));
    expect(error.message).toContain('WEBM file, not MP4');
  });

  it('names the first difference and counts the others', async () => {
    const error = await failure(await makeFile({ width: 640, height: 360, audioSeconds: null }));
    expect(error.message).toMatch(
      /^The exported file did not pass the check: .* \(and 1 more\)\.$/,
    );
    expect(error.cause).toMatchObject({ problems: expect.any(Array) as unknown });
  });

  it('rejects a file that is cut off, empty or not a video, with a typed error', async () => {
    const whole = await makeFile();
    for (const broken of [
      new Blob([whole.slice(0, Math.floor(whole.size / 2))]),
      new Blob([]),
      new Blob(['this is not a video file at all, just some text']),
      new Blob([whole.slice(0, 20)]),
    ]) {
      const error = await failure(broken);
      expect(error.code).toBe('verification-failed');
      expect(error.message).not.toContain('Error:');
      expect(error.hint).toBeTruthy();
    }
  });
});

describe('checkOutput (the comparison alone)', () => {
  const facts: OutputFacts = {
    container: 'mp4',
    videoCodec: 'avc',
    width: 320,
    height: 240,
    frameCount: 30,
    durationSeconds: 1,
    audio: { codec: 'aac', sampleRate: 48_000, channels: 2 },
  };

  it('finds nothing when everything matches', () => {
    expect(checkOutput(facts, EXPECTED)).toEqual([]);
  });

  it('scales the duration tolerance with the frame rate: three frames', () => {
    const at = (seconds: number) =>
      checkOutput({ ...facts, durationSeconds: seconds }, { ...EXPECTED, frameRate: 30 });
    expect(at(1.09)).toEqual([]);
    expect(at(1.11)).toHaveLength(1);
    const slow = checkOutput({ ...facts, durationSeconds: 1.2 }, { ...EXPECTED, frameRate: 10 });
    expect(slow).toEqual([]);
  });

  it('lists every problem it finds', () => {
    const problems = checkOutput(
      {
        ...facts,
        container: 'webm',
        videoCodec: 'vp9',
        width: 1,
        height: 1,
        frameCount: 5,
        audio: null,
      },
      EXPECTED,
    );
    expect(problems).toHaveLength(5);
  });

  it('copes with an unknown codec', () => {
    expect(checkOutput({ ...facts, videoCodec: null }, EXPECTED)[0]).toContain('an unknown codec');
  });
});
