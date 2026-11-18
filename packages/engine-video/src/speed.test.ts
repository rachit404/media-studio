import {
  History,
  FPS_30,
  addAssets,
  addMediaToTimeline,
  createProject,
  moveClips,
  setClipSpeed,
  setTransition,
  type NewAsset,
  type ProjectDocument,
  type VideoContent,
} from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { mixAudioBlock, type AudioReader } from './audio-mix';
import { audioSegments } from './audio-plan';
import { trimRange } from './drag-limits';
import { previewPlan } from './preview';

const S = 1_000_000;
const RATE = 1000; // 1 sample per millisecond keeps the arrays small
const VIDEO: NewAsset = {
  id: 'vid',
  kind: 'video',
  name: 'a.mp4',
  mime: 'video/mp4',
  size: 1,
  width: 640,
  height: 480,
  duration: 30 * S,
  fps: FPS_30,
  codec: 'avc1',
  keyframeInterval: S,
  audio: { sampleRate: RATE, channels: 2, codec: 'pcm' },
  file: 'media/vid.mp4',
  thumb: 'thumbs/vid.webp',
  peaks: null,
};

/** Clip a: 10 s of the file at 0 to 10 s. Clip b: the next 10 s of the file, at 10 to 20 s. */
function project() {
  const history = new History(
    createProject({ id: 'p', name: 'V', type: 'video', createdAt: '2026-11-18T10:00:00.000Z' }),
  );
  history.execute(addAssets([VIDEO]));
  for (const [id, start, sourceIn] of [
    ['a', 0, 0],
    ['b', 10 * S, 10 * S],
  ] as const) {
    history.execute(
      addMediaToTimeline({
        assetId: 'vid',
        start,
        sourceIn,
        duration: 10 * S,
        clipId: id,
        audioClipId: `${id}-sound`,
        linkId: `${id}-link`,
      }),
    );
  }
  return history;
}
const content = (history: History<ProjectDocument>): VideoContent => {
  if (history.state.content.kind !== 'video') throw new Error('video');
  return history.state.content;
};
const videoAt = (history: History<ProjectDocument>, time: number, clipId: string) =>
  previewPlan(content(history), history.state.assets.byId, time).video.find(
    (layer) => layer.clipId === clipId,
  );

describe('speed in the preview plan', () => {
  it('asks for the picture at the place in the file that matches the timeline time', () => {
    const history = project();
    history.execute(setClipSpeed('a', 2)); // 5 s on the timeline, 10 s of file
    expect(videoAt(history, 0, 'a')?.sourceTime).toBe(0);
    expect(videoAt(history, 2 * S, 'a')?.sourceTime).toBe(4 * S);
    expect(videoAt(history, 5 * S - 1, 'a')?.sourceTime).toBe(10 * S - 2);
  });

  it('shows a slower clip for longer, through the same part of the file', () => {
    const history = project();
    history.execute(setClipSpeed('b', 0.5)); // 20 s on the timeline: 10 s to 30 s, over file 10 s to 20 s
    expect(videoAt(history, 15 * S, 'b')?.sourceTime).toBe(12.5 * S);
    expect(videoAt(history, 30 * S - 1, 'b')).toBeDefined();
    expect(videoAt(history, 30 * S, 'b')).toBeUndefined();
  });

  it('keeps the clip going out of a transition at its own speed', () => {
    const history = project();
    history.execute(setClipSpeed('a', 2)); // a now ends at 5 s
    history.execute(moveClips('b', -5 * S)); // b follows right after it
    history.execute(setTransition('b', { kind: 'crossfade', duration: 2 * S }));
    // 1 s into the transition, a is 6 s past its start on the timeline: 12 s into the file (past its 10 s).
    // It holds the file's picture at that point, which is inside the file, so no clamping applies here.
    expect(videoAt(history, 6 * S, 'a')?.sourceTime).toBe(12 * S);
    expect(videoAt(history, 6 * S, 'b')).toMatchObject({ sourceTime: 10 * S + 1 * S });
  });
});

describe('speed in the sound', () => {
  it('schedules the sound with the speed and the matching place in the file', () => {
    const history = project();
    history.execute(setClipSpeed('a', 2));
    const [segment] = audioSegments(content(history), history.state.assets.byId, S, 2 * S);
    expect(segment).toMatchObject({
      clipId: 'a-sound',
      speed: 2,
      start: S,
      end: 2 * S,
      clipEnd: 5 * S,
      sourceStart: 2 * S,
    });
  });
});

/** A reader whose sample number n has the value n / 100000, so what was read tells where it was read from. */
function rampReader(calls: { startUs: number; frames: number }[] = []): AudioReader {
  return {
    read: (startUs, frames, rate) => {
      calls.push({ startUs, frames });
      const first = Math.round((startUs * rate) / 1_000_000);
      const ramp = Float32Array.from({ length: frames }, (_, i) => (first + i) / 100_000);
      return Promise.resolve([ramp, ramp.map((v) => -v)]);
    },
  };
}

describe('speed in the offline mix', () => {
  const mix = (history: History<ProjectDocument>, start: number, frames: number, calls?: never[]) =>
    mixAudioBlock(
      content(history),
      history.state.assets.byId,
      () => rampReader(calls),
      start,
      frames,
      RATE,
    );

  it('reads the file at the matching place and resamples it: twice as fast takes every other sample', async () => {
    const history = project();
    history.execute(setClipSpeed('a', 2));
    const calls: { startUs: number; frames: number }[] = [];
    const [left] = await mixAudioBlock(
      content(history),
      history.state.assets.byId,
      () => rampReader(calls),
      1000, // from 1 s
      100,
      RATE,
    );
    // At 1 s on the timeline the file is at 2 s (sample 2000), and each output sample moves 2 file samples.
    expect(calls[0]?.startUs).toBe(2 * S);
    expect(calls[0]?.frames).toBeGreaterThanOrEqual(200);
    for (const i of [0, 1, 50, 99]) expect(left[i]).toBeCloseTo((2000 + 2 * i) / 100_000, 6);
  });

  it('half speed stretches the sound: it moves through the file half as fast, between samples', async () => {
    const history = project();
    history.execute(setClipSpeed('b', 0.5));
    const [left] = await mix(history, 12_000, 100); // 2 s into b on the timeline is 1 s into its part of the file
    for (const i of [0, 1, 2, 3, 99]) expect(left[i]).toBeCloseTo((11_000 + i / 2) / 100_000, 6);
  });

  it('continues without a step from one block to the next', async () => {
    const history = project();
    history.execute(setClipSpeed('a', 1.5));
    const [first] = await mix(history, 1000, 100);
    const [second] = await mix(history, 1100, 100);
    const step = (first[99] ?? 0) - (first[98] ?? 0);
    expect((second[0] ?? 0) - (first[99] ?? 0)).toBeCloseTo(step, 5);
  });

  it('is silent after the end of a sped-up clip', async () => {
    const history = project();
    history.execute(setClipSpeed('a', 2)); // a now ends at 5 s, and b only starts at 10 s
    const [left] = await mix(history, 6000, 100);
    expect(Array.from(left).every((v) => v === 0)).toBe(true);
  });

  it('plays at normal speed exactly as before', async () => {
    const history = project();
    const calls: { startUs: number; frames: number }[] = [];
    const [left] = await mixAudioBlock(
      content(history),
      history.state.assets.byId,
      () => rampReader(calls),
      1000,
      50,
      RATE,
    );
    expect(calls).toEqual([{ startUs: S, frames: 50 }]);
    expect(left[10]).toBeCloseTo(1010 / 100_000, 6);
  });
});

describe('speed in the trim limits', () => {
  it('measures the room in the file in timeline time', () => {
    const history = project();
    history.execute(setClipSpeed('b', 2)); // b: 5 s on the timeline, file 10 s .. 20 s; 10 s of file remain after
    const assets = history.state.assets.byId;
    // Its end can grow by the 20 s of file left, which is 10 s of timeline.
    const end = trimRange(content(history), assets, 'b', 'end', FPS_30);
    expect(end.max).toBe(20 * S);
    // Its start could go back by the 10 s of file before it (5 s of timeline), but clip a ends where it starts.
    const start = trimRange(content(history), assets, 'b', 'start', FPS_30);
    expect(start.min).toBe(10 * S);
  });
});
