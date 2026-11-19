import { AppError, FPS_30, type Asset, type VideoContent } from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import type { AudioReader } from './audio-mix';
import {
  createAudioWriter,
  exportFingerprint,
  exportInParts,
  framesPerPart,
  planParts,
  type PartStore,
} from './export-parts';

const S = 1_000_000;

/** A store in memory that, like the disk, outlives one run of the export. */
function memoryStore() {
  let init: { fingerprint: string; totalFrames: number; segmentFrames: number } | null = null;
  const parts = new Map<number, Blob>();
  const log = { cleared: 0 };
  const store: PartStore = {
    begin(next) {
      const same =
        init &&
        init.fingerprint === next.fingerprint &&
        init.totalFrames === next.totalFrames &&
        init.segmentFrames === next.segmentFrames;
      if (!same) {
        parts.clear();
        init = next;
      }
      return Promise.resolve({
        state: { done: [...parts.keys()].sort() },
        resumed: parts.size > 0,
      });
    },
    saveSegment(state, index, blob) {
      parts.set(index, blob);
      return Promise.resolve({ done: [...new Set([...state.done, index])].sort() });
    },
    readSegment(index) {
      const blob = parts.get(index);
      return blob ? Promise.resolve(blob) : Promise.reject(new Error('missing part'));
    },
    clear() {
      log.cleared += 1;
      parts.clear();
      init = null;
      return Promise.resolve();
    },
  };
  return { store, parts, log };
}

const params = (extra = {}) => ({
  fingerprint: 'fp',
  totalFrames: 250,
  partFrames: 100,
  fps: FPS_30,
  audio: null,
  ...extra,
});

describe('planning parts', () => {
  it('cuts the frames into parts of the same length with a shorter last one', () => {
    expect(planParts(250, 100)).toEqual([
      { index: 0, firstFrame: 0, frames: 100 },
      { index: 1, firstFrame: 100, frames: 100 },
      { index: 2, firstFrame: 200, frames: 50 },
    ]);
    expect(planParts(100, 100)).toHaveLength(1);
    expect(planParts(0, 100)).toEqual([]);
    expect(planParts(7, 1)).toHaveLength(7);
  });

  it('turns a length in seconds into frames, at least one', () => {
    expect(framesPerPart(FPS_30, 20)).toBe(600);
    expect(framesPerPart({ num: 30000, den: 1001 }, 20)).toBe(599);
    expect(framesPerPart(FPS_30, 0)).toBe(1);
  });
});

describe('fingerprint', () => {
  const content = { kind: 'video', clips: { a: { id: 'a', start: 0 } } } as unknown as VideoContent;
  const base = {
    content,
    assets: {} as Record<string, Asset>,
    settings: { width: 320 },
    range: null,
  };

  it('is the same for the same export whatever the order of keys', () => {
    const reordered = {
      range: null,
      settings: { width: 320 },
      assets: {} as Record<string, Asset>,
      content: { clips: { a: { start: 0, id: 'a' } }, kind: 'video' } as unknown as VideoContent,
    };
    expect(exportFingerprint(reordered)).toBe(exportFingerprint(base));
  });

  it('changes with the project, the settings and the range', () => {
    const first = exportFingerprint(base);
    const moved = { ...content, clips: { a: { id: 'a', start: 1 } } } as unknown as VideoContent;
    expect(exportFingerprint({ ...base, content: moved })).not.toBe(first);
    expect(exportFingerprint({ ...base, settings: { width: 640 } })).not.toBe(first);
    expect(exportFingerprint({ ...base, range: { start: 0, end: S } })).not.toBe(first);
  });
});

describe('exporting in parts', () => {
  it('makes every part once, joins them in order with their start times, and cleans up', async () => {
    const { store, parts, log } = memoryStore();
    const made: [number, number][] = [];
    const progress: number[] = [];
    const joined: { index: number; startUs: number }[] = [];
    const result = await exportInParts(
      params({ onProgress: (done: number) => progress.push(done) }),
      {
        store,
        encodePart: (first, count) => {
          made.push([first, count]);
          return Promise.resolve(new Blob([`part ${String(first)}`]));
        },
        assemble: async (finished) => {
          for (const part of finished) joined.push({ index: part.index, startUs: part.startUs });
          return new Blob([
            (await Promise.all(finished.map((part) => part.blob.text()))).join('+'),
          ]);
        },
      },
    );
    expect(made).toEqual([
      [0, 100],
      [100, 100],
      [200, 50],
    ]);
    expect(progress).toEqual([100, 200, 250]);
    expect(joined).toEqual([
      { index: 0, startUs: 0 },
      { index: 1, startUs: 3_333_333 },
      { index: 2, startUs: 6_666_667 },
    ]);
    expect(await result.text()).toBe('part 0+part 100+part 200');
    expect(log.cleared).toBe(1);
    expect(parts.size).toBe(0);
  });

  it('after a failure keeps the finished parts, and the next run makes only what is missing', async () => {
    const { store, parts, log } = memoryStore();
    const made: number[] = [];
    let failAt: number | null = 200;
    const deps = {
      store,
      encodePart: (first: number) => {
        made.push(first);
        if (first === failAt) {
          return Promise.reject(
            new AppError({ code: 'encoder-error', message: 'The encoder stopped.' }),
          );
        }
        return Promise.resolve(new Blob([`part ${String(first)}`]));
      },
      assemble: (finished: { blob: Blob }[]) =>
        Promise.resolve(new Blob([String(finished.length)])),
    };
    await expect(exportInParts(params(), deps)).rejects.toMatchObject({ code: 'encoder-error' });
    expect([...parts.keys()]).toEqual([0, 1]);
    expect(log.cleared).toBe(0); // a failure is not wiped: the parts are what makes a second try quick

    made.length = 0;
    failAt = null;
    const result = await exportInParts(params(), deps);
    expect(made).toEqual([200]); // only the part that was missing
    expect(await result.text()).toBe('3');
    expect(parts.size).toBe(0);
  });

  it('starts again from nothing when the export is a different one', async () => {
    const { store, parts } = memoryStore();
    const made: number[] = [];
    const deps = {
      store,
      encodePart: (first: number) => {
        made.push(first);
        return first === 100
          ? Promise.reject(new AppError({ code: 'encoder-error', message: 'x' }))
          : Promise.resolve(new Blob(['p']));
      },
      assemble: () => Promise.resolve(new Blob(['done'])),
    };
    await expect(exportInParts(params(), deps)).rejects.toBeDefined();
    expect(parts.size).toBe(1);
    made.length = 0;
    await expect(exportInParts(params({ fingerprint: 'other' }), deps)).rejects.toBeDefined();
    expect(made).toEqual([0, 100]); // the first part was made again
  });

  it('cancelling removes everything, whether it is noticed between parts or inside one', async () => {
    const between = memoryStore();
    const controller = new AbortController();
    let count = 0;
    await expect(
      exportInParts(params({ signal: controller.signal }), {
        store: between.store,
        encodePart: () => {
          count += 1;
          if (count === 2) controller.abort();
          return Promise.resolve(new Blob(['p']));
        },
        assemble: () => Promise.resolve(new Blob(['done'])),
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(between.log.cleared).toBe(1);
    expect(between.parts.size).toBe(0);
    expect(count).toBe(2); // the third part was never started

    const inside = memoryStore();
    await expect(
      exportInParts(params(), {
        store: inside.store,
        encodePart: () =>
          Promise.reject(new AppError({ code: 'cancelled', message: 'The export was cancelled.' })),
        assemble: () => Promise.resolve(new Blob(['done'])),
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(inside.log.cleared).toBe(1);
  });

  it('a failure while joining keeps the parts', async () => {
    const { store, parts } = memoryStore();
    await expect(
      exportInParts(params(), {
        store,
        encodePart: () => Promise.resolve(new Blob(['p'])),
        assemble: () => Promise.reject(new AppError({ code: 'write-failed', message: 'No room.' })),
      }),
    ).rejects.toMatchObject({ code: 'write-failed' });
    expect(parts.size).toBe(3);
  });
});

describe('sound for the whole export', () => {
  it('is written in blocks of one second, in order, and only as far as asked', async () => {
    const written: { start: number; frames: number }[] = [];
    const reader: AudioReader = {
      read: (_s, frames) => Promise.resolve([new Float32Array(frames), new Float32Array(frames)]),
    };
    const empty = {
      clips: {},
      tracks: { byId: {}, order: [] },
      sequence: {},
    } as unknown as VideoContent;
    const writer = createAudioWriter(empty, {}, () => reader, {
      sampleRate: 1000,
      start: 5 * S,
      duration: 2.5 * S,
    });
    const add = (channels: [Float32Array, Float32Array], ts: number) => {
      written.push({ start: ts, frames: channels[0].length });
      return Promise.resolve();
    };
    await writer.writeUntil(0.5 * S, add);
    expect(written).toEqual([{ start: 0, frames: 1000 }]);
    await writer.writeUntil(0.7 * S, add); // already covered by the first block
    expect(written).toHaveLength(1);
    await writer.writeUntil(10 * S, add); // far past the end: stops at the end of the export
    expect(written).toEqual([
      { start: 0, frames: 1000 },
      { start: S, frames: 1000 },
      { start: 2 * S, frames: 500 },
    ]);
  });
});
