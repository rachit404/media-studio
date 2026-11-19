// Performance budgets for the video editor's hot paths (M8): each one is a measured cost with a limit several times
// above what a normal machine needs, so the test only fails when something gets much slower (an accidental
// quadratic loop, a copy of the whole document on every frame), not when the computer is a little busy.
// Budgets are listed in docs/engineering/perf-budgets.md.
import { describe, expect, it } from 'vitest';
import {
  History,
  addAssets,
  addMediaToTimeline,
  createProject,
  parseSubtitles,
  valueAt,
} from '../packages/core/src/index.ts';
import {
  audioSegments,
  buildPreviewScene,
  exportFingerprint,
  previewPlan,
} from '../packages/engine-video/src/index.ts';

const S = 1_000_000;

/** Median of a few runs, in milliseconds. */
function measure(run, times = 5) {
  const samples = [];
  for (let i = 0; i < times; i += 1) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  return samples.sort((a, b) => a - b)[Math.floor(times / 2)] ?? 0;
}

/** 8 video and 8 audio tracks and 2,000 clips in all (the size VID-3 and PERF-5 talk about). */
function bigSequence() {
  const history = new History(
    createProject({ id: 'p', name: 'Big', type: 'video', createdAt: '2026-11-19T10:00:00.000Z' }),
  );
  history.execute(
    addAssets([
      {
        id: 'vid',
        kind: 'video',
        name: 'v.mp4',
        mime: 'video/mp4',
        size: 1,
        width: 1920,
        height: 1080,
        duration: 60 * S,
        fps: { num: 30, den: 1 },
        codec: 'avc1',
        keyframeInterval: S,
        audio: { sampleRate: 48_000, channels: 2, codec: 'aac' },
        file: 'media/v.mp4',
        thumb: 'thumbs/v.webp',
        peaks: null,
      },
    ]),
  );
  for (let i = 0; i < 1000; i += 1) {
    history.execute(
      addMediaToTimeline({
        assetId: 'vid',
        start: i * 2 * S,
        duration: 2 * S,
        clipId: `c${String(i)}`,
        audioClipId: `a${String(i)}`,
        linkId: `l${String(i)}`,
      }),
    );
  }
  const content = history.state.content;
  if (content.kind !== 'video') throw new Error('video');
  return { content, assets: history.state.assets.byId };
}

const metrics = { measure: () => ({ width: 100, height: 40 }) };

describe('video editor performance budgets', () => {
  const { content, assets } = bigSequence();

  it('finds what is on screen in a 2,000-clip sequence in under 5 ms', () => {
    const ms = measure(() => previewPlan(content, assets, 1000 * S));
    expect(ms).toBeLessThan(5);
  });

  it('builds the scene for a frame of a 2,000-clip sequence in under 10 ms', () => {
    const sizes = new Map([['c500', { width: 1920, height: 1080 }]]);
    const ms = measure(() => buildPreviewScene(content, assets, 1000 * S + 1, sizes, metrics));
    expect(ms).toBeLessThan(10);
  });

  it('plans the sound of a two second window in under 10 ms', () => {
    const ms = measure(() => audioSegments(content, assets, 1000 * S, 1002 * S));
    expect(ms).toBeLessThan(10);
  });

  it('evaluates a million keyframed values in under 600 ms', () => {
    const frames = Array.from({ length: 200 }, (_, i) => ({
      time: i * 100_000,
      value: i % 2,
      easing: 'ease-in-out',
    }));
    const ms = measure(() => {
      let total = 0;
      for (let i = 0; i < 1_000_000; i += 1) total += valueAt(frames, (i * 37) % 20_000_000, 0);
      return total;
    }, 3);
    expect(ms).toBeLessThan(600);
  });

  it('reads a 20,000-cue subtitle file in under 800 ms', () => {
    let file = 'WEBVTT\n\n';
    for (let i = 0; i < 20_000; i += 1) {
      const t = i * 2;
      const stamp = (s) =>
        `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000`;
      file += `${stamp(t)} --> ${stamp(t + 1)}\nLine ${String(i)}\n\n`;
    }
    const ms = measure(() => parseSubtitles(file), 3);
    expect(ms).toBeLessThan(800);
  });

  it('fingerprints a 2,000-clip project for an export in under 300 ms', () => {
    const ms = measure(
      () => exportFingerprint({ content, assets, settings: { width: 1920 }, range: null }),
      3,
    );
    expect(ms).toBeLessThan(300);
  });
});
