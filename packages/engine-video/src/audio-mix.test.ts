import {
  History,
  addAssets,
  addMediaToTimeline,
  addTrack,
  createProject,
  setTrackState,
  type NewAsset,
  type VideoContent,
} from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { mixAudioBlock, type AudioReader } from './audio-mix';

const S = 1_000_000;
const RATE = 1000; // a tiny rate keeps the arrays small: 1 sample per millisecond

const song = (id: string): NewAsset => ({
  id,
  kind: 'audio',
  name: `${id}.wav`,
  mime: 'audio/wav',
  size: 1,
  duration: 20 * S,
  audio: { sampleRate: RATE, channels: 2, codec: 'pcm' },
  file: `media/${id}.wav`,
  peaks: null,
});

/** A reader whose sound is a constant level per file, and which records what it was asked for. */
function readers(levels: Record<string, number>) {
  const calls: { id: string; startUs: number; frames: number }[] = [];
  const readerFor = (id: string): AudioReader => ({
    read: (startUs, frames) => {
      calls.push({ id, startUs, frames });
      const level = levels[id] ?? 0;
      return Promise.resolve([
        new Float32Array(frames).fill(level),
        new Float32Array(frames).fill(-level),
      ]);
    },
  });
  return { readerFor, calls };
}

function sequence() {
  const history = new History(
    createProject({ id: 'p', name: 'M', type: 'video', createdAt: '2026-11-18T10:00:00.000Z' }),
  );
  history.execute(addAssets([song('a'), song('b')]));
  const content = (): VideoContent => {
    if (history.state.content.kind !== 'video') throw new Error('video');
    return history.state.content;
  };
  const add = (assetId: string, start: number, track?: string, extra = {}) =>
    history.execute(
      addMediaToTimeline({
        assetId,
        start,
        clipId: `c-${assetId}-${String(start)}`,
        audioClipId: 'unused',
        linkId: 'l',
        ...(track ? { audioTrackId: track } : {}),
        ...extra,
      }),
    );
  return { history, content, add };
}

describe('offline audio mix', () => {
  it('places a clip at its timeline position and leaves the rest silent', async () => {
    const { history, content, add } = sequence();
    add('a', 2 * S, undefined, { duration: 1 * S }); // 2 s .. 3 s
    const { readerFor, calls } = readers({ a: 0.5 });
    // A block from 1.5 s to 2.5 s (1000 samples at 1 kHz, starting at sample 1500).
    const [left, right] = await mixAudioBlock(
      content(),
      history.state.assets.byId,
      readerFor,
      1500,
      1000,
      RATE,
    );
    expect(left.slice(0, 500).every((v) => v === 0)).toBe(true);
    expect(left.slice(500, 1000).every((v) => v === 0.5)).toBe(true);
    expect(right[600]).toBe(-0.5);
    expect(calls).toEqual([{ id: 'a', startUs: 0, frames: 500 }]);
  });

  it('asks for the right part of the file when the block starts inside the clip', async () => {
    const { history, content, add } = sequence();
    add('a', 0, undefined, { sourceIn: 3 * S, duration: 5 * S });
    const { readerFor, calls } = readers({ a: 0.1 });
    await mixAudioBlock(content(), history.state.assets.byId, readerFor, 2000, 1000, RATE); // 2 s .. 3 s
    expect(calls).toEqual([{ id: 'a', startUs: 5 * S, frames: 1000 }]); // 3 s in + 2 s into the clip
  });

  it('sums clips on different tracks and limits the result', async () => {
    const { history, content, add } = sequence();
    history.execute(addTrack('audio', 'A2'));
    add('a', 0, 'A1');
    add('b', 0, 'A2');
    const { readerFor } = readers({ a: 0.4, b: 0.3 });
    const [left] = await mixAudioBlock(
      content(),
      history.state.assets.byId,
      readerFor,
      0,
      100,
      RATE,
    );
    expect(left[10]).toBeCloseTo(0.7, 6);
    const loud = readers({ a: 0.8, b: 0.9 });
    const [clipped, clippedRight] = await mixAudioBlock(
      content(),
      history.state.assets.byId,
      loud.readerFor,
      0,
      100,
      RATE,
    );
    expect(clipped[10]).toBe(1);
    expect(clippedRight[10]).toBe(-1);
  });

  it('skips muted tracks without decoding them', async () => {
    const { history, content, add } = sequence();
    add('a', 0);
    history.execute(setTrackState('A1', { muted: true }));
    const { readerFor, calls } = readers({ a: 1 });
    const [left] = await mixAudioBlock(
      content(),
      history.state.assets.byId,
      readerFor,
      0,
      100,
      RATE,
    );
    expect(left.every((v) => v === 0)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('continues across block borders without gaps or overlaps', async () => {
    const { history, content, add } = sequence();
    add('a', 0, undefined, { duration: 2 * S });
    const { readerFor, calls } = readers({ a: 0.2 });
    const total = [0, 0, 0];
    for (const [index, start] of [0, 700, 1400].entries()) {
      const frames = index === 2 ? 600 : 700;
      const [left] = await mixAudioBlock(
        content(),
        history.state.assets.byId,
        readerFor,
        start,
        frames,
        RATE,
      );
      total[index] = left.filter((v) => v === Math.fround(0.2)).length;
    }
    expect(total.reduce((a, b) => a + b, 0)).toBe(2000);
    // Each request starts exactly where the previous one ended.
    expect(calls.map((call) => call.startUs)).toEqual([0, 700_000, 1_400_000]);
  });
});
