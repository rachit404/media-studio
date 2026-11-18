import { fakeMetrics } from './fake-metrics';
import {
  AppError,
  FPS_30,
  History,
  addAssets,
  addMediaToTimeline,
  createProject,
  type ErrorCode,
  type NewAsset,
  type VideoContent,
} from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import type { AudioReader } from './audio-mix';
import { exportSequence, type ExportDependencies, type ExportFrame } from './export-sequence';
import type { FrameStreamSource, TimedFrame } from './frame-pump';

/**
 * M7 (EXP-6, REL-3): whatever goes wrong at any stage of an export, the user gets one typed error and nothing is left
 * behind: the output is abandoned exactly once, every decoded picture is closed exactly once, every texture that was
 * made is freed, and every decoder is stopped.
 */
const S = 1_000_000;
const RATE = 1000;
const FRAMES = 60; // 2 s at 30 fps
const AUDIO_BLOCKS = 2; // 1 s blocks

const VIDEO: NewAsset = {
  id: 'vid',
  kind: 'video',
  name: 'v.mp4',
  mime: 'video/mp4',
  size: 1,
  width: 64,
  height: 48,
  duration: 10 * S,
  fps: FPS_30,
  codec: 'avc1',
  keyframeInterval: S,
  audio: { sampleRate: RATE, channels: 2, codec: 'aac' },
  file: 'media/v.mp4',
  thumb: 'thumbs/v.webp',
  peaks: null,
};

interface Frame extends ExportFrame {
  closed: number;
}

/** What to make go wrong. Each hook may throw, or abort the export. */
interface Hooks {
  onVideo?: (index: number) => void;
  onAudio?: (index: number) => void;
  onFinalize?: () => void;
  onUpload?: () => void;
  onRender?: () => void;
  /** The decoder fails after this many pictures. */
  failDecodeAfter?: number;
  /** Reading the file's sound fails with this. */
  audioReadError?: Error;
}

function setup(hooks: Hooks = {}) {
  const controller = new AbortController();
  const frames: Frame[] = [];
  const log = {
    uploaded: new Set<string>(),
    deleted: new Set<string>(),
    video: 0,
    audio: 0,
    finalizeCalls: 0,
    cancelled: 0,
    generatorsStarted: 0,
    generatorsEnded: 0,
  };
  const fps = 25;
  const deps: ExportDependencies<Frame> = {
    metrics: fakeMetrics,
    frameSource: (): FrameStreamSource<Frame> => ({
      async *frames(startUs: number): AsyncGenerator<TimedFrame<Frame>, void, undefined> {
        log.generatorsStarted += 1;
        try {
          const first = Math.floor((startUs * fps) / S);
          for (let index = first; index < first + 2000; index += 1) {
            await Promise.resolve();
            if (hooks.failDecodeAfter !== undefined && index >= first + hooks.failDecodeAfter) {
              throw new Error('decoder crashed at secret-internal-detail');
            }
            const frame: Frame = {
              width: 64,
              height: 48,
              closed: 0,
              close() {
                this.closed += 1;
              },
            };
            frames.push(frame);
            yield { frame, timestamp: Math.round((index * S) / fps) };
          }
        } finally {
          log.generatorsEnded += 1;
        }
      },
    }),
    audioReader: (): AudioReader => ({
      read: (_start, count) => {
        if (hooks.audioReadError !== undefined) return Promise.reject(hooks.audioReadError);
        return Promise.resolve([
          new Float32Array(count).fill(0.25),
          new Float32Array(count).fill(0.25),
        ]);
      },
    }),
    renderer: {
      uploadFrame: (id) => {
        hooks.onUpload?.();
        log.uploaded.add(id);
      },
      deleteTexture: (id) => log.deleted.add(id),
      render: () => hooks.onRender?.(),
    },
    sink: {
      addVideoFrame: () => {
        hooks.onVideo?.(log.video);
        log.video += 1;
        return Promise.resolve();
      },
      addAudio: () => {
        hooks.onAudio?.(log.audio);
        log.audio += 1;
        return Promise.resolve();
      },
      finalize: () => {
        log.finalizeCalls += 1;
        hooks.onFinalize?.();
        return Promise.resolve(new Blob(['done']));
      },
      cancel: () => {
        log.cancelled += 1;
        return Promise.resolve();
      },
    },
  };

  const history = new History(
    createProject({ id: 'p', name: 'E', type: 'video', createdAt: '2026-11-19T10:00:00.000Z' }),
  );
  history.execute(addAssets([VIDEO]));
  history.execute(
    addMediaToTimeline({
      assetId: 'vid',
      start: 0,
      clipId: 'c0',
      audioClipId: 'a0',
      linkId: 'l0',
      duration: 2 * S,
    }),
  );
  const content = (): VideoContent => {
    if (history.state.content.kind !== 'video') throw new Error('video');
    return history.state.content;
  };

  const run = async (): Promise<unknown> => {
    const outcome = await exportSequence(content(), history.state.assets.byId, deps, {
      fps: FPS_30,
      sampleRate: RATE,
      signal: controller.signal,
    }).then(
      (blob) => blob,
      (error: unknown) => error,
    );
    // The decoders wind down in the background: let them finish before looking.
    await new Promise((resolve) => setTimeout(resolve, 15));
    return outcome;
  };
  return { run, controller, frames, log };
}

type Parts = ReturnType<typeof setup>;

/** Everything an export must leave clean, whatever stopped it. */
function expectNothingLeftBehind({ frames, log }: Parts, finalizeStarted = false): void {
  expect(log.cancelled).toBe(1);
  expect(log.finalizeCalls).toBe(finalizeStarted ? 1 : 0);
  for (const frame of frames) expect(frame.closed).toBe(1);
  for (const id of log.uploaded) expect(log.deleted.has(id)).toBe(true);
  expect(log.generatorsEnded).toBe(log.generatorsStarted);
}

const named = (name: string, message = 'raw internal text') =>
  Object.assign(new Error(message), { name });

describe('a failure at any stage gives one typed error and leaves nothing behind', () => {
  const cases: {
    name: string;
    hooks: () => Hooks;
    code: ErrorCode;
    finalizeStarted?: boolean;
  }[] = [
    {
      name: 'the encoder fails on a picture',
      hooks: () => ({
        onVideo: (i) => {
          if (i === 12)
            throw new AppError({ code: 'encoder-error', message: 'The encoder stopped.' });
        },
      }),
      code: 'encoder-error',
    },
    {
      name: 'the encoder throws a raw EncodingError on a picture',
      hooks: () => ({
        onVideo: (i) => {
          if (i === 5) throw named('EncodingError');
        },
      }),
      code: 'encoder-error',
    },
    {
      name: 'the encoder throws a raw OperationError on the first sound block',
      hooks: () => ({
        onAudio: (i) => {
          if (i === 0) throw named('OperationError');
        },
      }),
      code: 'encoder-error',
    },
    {
      name: 'the encoder fails on the second sound block',
      hooks: () => ({
        onAudio: (i) => {
          if (i === 1) throw new AppError({ code: 'encoder-error', message: 'The audio stopped.' });
        },
      }),
      code: 'encoder-error',
    },
    {
      name: 'the encoder fails while finishing the file',
      hooks: () => ({
        onFinalize: () => {
          throw new AppError({ code: 'encoder-error', message: 'The file could not be finished.' });
        },
      }),
      code: 'encoder-error',
      finalizeStarted: true,
    },
    {
      name: 'the browser storage is full while writing a picture',
      hooks: () => ({
        onVideo: (i) => {
          if (i === 20) throw named('QuotaExceededError');
        },
      }),
      code: 'quota-exceeded',
    },
    {
      name: 'the file cannot be written while finishing',
      hooks: () => ({
        onFinalize: () => {
          throw named('NotAllowedError');
        },
      }),
      code: 'write-failed',
      finalizeStarted: true,
    },
    {
      name: 'memory runs out while sending a picture to the graphics card',
      hooks: () => ({
        onUpload: () => {
          throw new RangeError('Array buffer allocation failed');
        },
      }),
      code: 'out-of-memory',
    },
    {
      name: 'memory runs out while mixing the sound',
      hooks: () => ({ audioReadError: new RangeError('Invalid typed array length: 99999999999') }),
      code: 'out-of-memory',
    },
    {
      name: 'a video file stops decoding in the middle of a clip',
      hooks: () => ({ failDecodeAfter: 3 }),
      code: 'decode-failed',
    },
    {
      name: 'a sound file cannot be read',
      hooks: () => ({ audioReadError: new Error('bad packet') }),
      code: 'unknown',
    },
    {
      name: 'drawing fails',
      hooks: () => ({
        onRender: () => {
          throw new Error('context lost');
        },
      }),
      code: 'unknown',
    },
    {
      name: 'the browser cannot encode this format',
      hooks: () => ({
        onVideo: (i) => {
          if (i === 0) throw named('NotSupportedError');
        },
      }),
      code: 'unsupported-codec',
    },
  ];

  for (const { name, hooks, code, finalizeStarted } of cases) {
    it(`${name}: ${code}`, async () => {
      const parts = setup(hooks());
      const outcome = await parts.run();
      expect(outcome).toBeInstanceOf(AppError);
      const error = outcome as AppError;
      expect(error.code).toBe(code);
      expect(error.message).not.toMatch(
        /raw internal text|secret-internal-detail|allocation failed|0x/i,
      );
      expect(error.message.length).toBeGreaterThan(5);
      expectNothingLeftBehind(parts, finalizeStarted ?? false);
    });
  }

  it('a clean export abandons nothing and frees what it made', async () => {
    const parts = setup();
    const outcome = await parts.run();
    expect(outcome).toBeInstanceOf(Blob);
    expect(parts.log.cancelled).toBe(0);
    expect(parts.log.finalizeCalls).toBe(1);
    expect(parts.log.video).toBe(FRAMES);
    expect(parts.log.audio).toBe(AUDIO_BLOCKS);
    for (const frame of parts.frames) expect(frame.closed).toBe(1);
    for (const id of parts.log.uploaded) expect(parts.log.deleted.has(id)).toBe(true);
    expect(parts.log.generatorsEnded).toBe(parts.log.generatorsStarted);
  });
});

describe('cancelling at any stage ends in "cancelled", delivers nothing and leaves nothing behind', () => {
  it('before the first picture', async () => {
    const parts = setup();
    parts.controller.abort();
    const outcome = await parts.run();
    expect(outcome).toMatchObject({ code: 'cancelled' });
    expect(parts.log.video).toBe(0);
    expect(parts.frames).toHaveLength(0);
    expectNothingLeftBehind(parts);
  });

  it('in the middle of the pictures', async () => {
    const parts = setup({
      onVideo: (i) => {
        if (i === 10) parts.controller.abort();
      },
    });
    const outcome = await parts.run();
    expect(outcome).toMatchObject({ code: 'cancelled' });
    expect(parts.log.video).toBeLessThan(FRAMES);
    expectNothingLeftBehind(parts);
  });

  it('while the first block of sound is being written', async () => {
    const parts = setup({
      onAudio: (i) => {
        if (i === 0) parts.controller.abort();
      },
    });
    const outcome = await parts.run();
    expect(outcome).toMatchObject({ code: 'cancelled' });
    expect(parts.log.video).toBeLessThan(FRAMES);
    expectNothingLeftBehind(parts);
  });

  it('while the last picture is being written (nothing is finished or delivered)', async () => {
    const parts = setup({
      onVideo: (i) => {
        if (i === FRAMES - 1) parts.controller.abort();
      },
    });
    const outcome = await parts.run();
    expect(outcome).toMatchObject({ code: 'cancelled' });
    expectNothingLeftBehind(parts);
  });

  it('while the file is being finished (the finished file is thrown away)', async () => {
    const parts = setup({ onFinalize: () => parts.controller.abort() });
    const outcome = await parts.run();
    expect(outcome).toMatchObject({ code: 'cancelled' });
    expectNothingLeftBehind(parts, true);
  });
});
