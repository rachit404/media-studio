import { fakeMetrics } from './fake-metrics';
import {
  History,
  IDENTITY_TRANSFORM,
  addAssets,
  addMediaToTimeline,
  addTrack,
  createProject,
  setClipLook,
  setTrackState,
  type NewAsset,
  type VideoContent,
} from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { audibleTracks, clipGainOnTimeline } from './audio-gain';
import { audioSegments } from './audio-plan';
import { mixAudioBlock, type AudioReader } from './audio-mix';
import { buildPreviewScene, clipMatrix } from './preview';

const S = 1_000_000;
const RATE = 1000; // 1 sample per millisecond

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

const constant = (level: number): AudioReader => ({
  read: (_start, frames) =>
    Promise.resolve([new Float32Array(frames).fill(level), new Float32Array(frames).fill(level)]),
});

/** Two audio tracks (A1, A2), one 4 s clip on each at time 0. */
function setup() {
  const history = new History(
    createProject({ id: 'p', name: 'M', type: 'video', createdAt: '2026-11-18T10:00:00.000Z' }),
  );
  history.execute(addAssets([song('a'), song('b')]));
  history.execute(addTrack('audio', 'A2'));
  for (const [assetId, trackId] of [
    ['a', 'A1'],
    ['b', 'A2'],
  ] as const) {
    history.execute(
      addMediaToTimeline({
        assetId,
        start: 0,
        clipId: `c-${assetId}`,
        audioClipId: `c-${assetId}`,
        linkId: `l-${assetId}`,
        audioTrackId: trackId,
        duration: 4 * S,
      }),
    );
  }
  const content = (): VideoContent => {
    if (history.state.content.kind !== 'video') throw new Error('video');
    return history.state.content;
  };
  return { history, content };
}

describe('solo and mute', () => {
  it('hears every unmuted audio track when nothing is soloed', () => {
    const { content } = setup();
    expect(audibleTracks(content()).map((t) => t.id)).toEqual(['A1', 'A2']);
  });

  it('hears only soloed tracks when any is soloed, and a muted track stays silent', () => {
    const { history, content } = setup();
    history.execute(setTrackState('A2', { solo: true }));
    expect(audibleTracks(content()).map((t) => t.id)).toEqual(['A2']);
    history.execute(setTrackState('A2', { muted: true }));
    expect(audibleTracks(content()).map((t) => t.id)).toEqual([]);
  });

  it('applies the same rule to the live plan and to the offline mix', async () => {
    const { history, content } = setup();
    history.execute(setTrackState('A1', { solo: true }));
    const plan = audioSegments(content(), history.state.assets.byId, 0, 4 * S);
    expect(plan.map((s) => s.assetId)).toEqual(['a']);
    const [left] = await mixAudioBlock(
      content(),
      history.state.assets.byId,
      (id) => constant(id === 'a' ? 0.25 : 0.5),
      0,
      1000,
      RATE,
    );
    expect(left[500]).toBe(0.25);
  });
});

describe('volume and fades in the mix', () => {
  it('scales by clip volume times track volume', async () => {
    const { history, content } = setup();
    history.execute(setTrackState('A2', { muted: true }));
    history.execute(setClipLook(['c-a'], { volume: 0.5 }));
    history.execute(setTrackState('A1', { volume: 0.5 }));
    const [left, right] = await mixAudioBlock(
      content(),
      history.state.assets.byId,
      () => constant(0.8),
      0,
      1000,
      RATE,
    );
    expect(left[100]).toBeCloseTo(0.2);
    expect(right[900]).toBeCloseTo(0.2);
  });

  it('ramps in a straight line over the fades and matches the live gain envelope', async () => {
    const { history, content } = setup();
    history.execute(setTrackState('A2', { muted: true }));
    history.execute(setClipLook(['c-a'], { fadeIn: S, fadeOut: S }));
    const [left] = await mixAudioBlock(
      content(),
      history.state.assets.byId,
      () => constant(1),
      0,
      4000,
      RATE,
    );
    const track = content().tracks.byId['A1'];
    const clip = content().clips['c-a'];
    if (!track || !clip) throw new Error('missing');
    const live = clipGainOnTimeline(track, clip);
    expect(left[0]).toBeCloseTo(0);
    expect(left[500]).toBeCloseTo(0.5);
    expect(left[2000]).toBeCloseTo(1);
    expect(left[3500]).toBeCloseTo(0.5);
    // Offline and live agree at every millisecond.
    for (let i = 0; i < 4000; i += 1) expect(left[i]).toBeCloseTo(live(i * 1000), 5);
  });

  it('mixes two tracks by adding and limits the sum to -1..1', async () => {
    const { history, content } = setup();
    history.execute(setClipLook(['c-a'], { volume: 4 }));
    const [left] = await mixAudioBlock(
      content(),
      history.state.assets.byId,
      (id) => constant(id === 'a' ? 0.5 : 0.25),
      0,
      10,
      RATE,
    );
    expect(left[0]).toBe(1);
  });
});

describe('picture placement', () => {
  it('keeps the fit when the transform is the identity', () => {
    expect(clipMatrix(IDENTITY_TRANSFORM, 1920, 1080, 1920, 1080)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('scales about the frame centre and moves by a fraction of the frame', () => {
    const m = clipMatrix(
      { ...IDENTITY_TRANSFORM, scale: 0.5, x: 0.25, y: -0.1 },
      1000,
      500,
      1000,
      500,
    );
    // Centre of the picture stays at the centre of the frame plus the offset.
    expect(m[0]).toBeCloseTo(0.5);
    expect(m[3]).toBeCloseTo(0.5);
    expect(m[0] * 500 + m[4]).toBeCloseTo(500 + 250);
    expect(m[3] * 250 + m[5]).toBeCloseTo(250 - 50);
  });

  it('rotates a quarter turn clockwise about the frame centre', () => {
    const m = clipMatrix({ ...IDENTITY_TRANSFORM, rotation: 90 }, 100, 100, 100, 100);
    // The top-left corner (0,0) goes to the top-right corner (100,0); the centre stays put.
    expect(m[4]).toBeCloseTo(100);
    expect(m[5]).toBeCloseTo(0);
    expect(m[0] * 50 + m[2] * 50 + m[4]).toBeCloseTo(50);
    expect(m[1] * 50 + m[3] * 50 + m[5]).toBeCloseTo(50);
  });
});

describe('preview scene with clip look', () => {
  it('carries opacity, crop and colour to the compositor and leaves them out when unchanged', () => {
    const history = new History(
      createProject({ id: 'p', name: 'M', type: 'video', createdAt: '2026-11-18T10:00:00.000Z' }),
    );
    history.execute(
      addAssets([
        {
          id: 'v',
          kind: 'video',
          name: 'v.mp4',
          mime: 'video/mp4',
          size: 1,
          width: 640,
          height: 360,
          duration: 10 * S,
          fps: { num: 25, den: 1 },
          codec: 'avc1',
          keyframeInterval: S,
          audio: null,
          file: 'media/v.mp4',
          thumb: 'thumbs/v.png',
          peaks: null,
        },
      ]),
    );
    history.execute(
      addMediaToTimeline({
        assetId: 'v',
        start: 0,
        clipId: 'pic',
        audioClipId: 'snd',
        linkId: 'l',
      }),
    );
    const content = (): VideoContent => {
      if (history.state.content.kind !== 'video') throw new Error('video');
      return history.state.content;
    };
    const sizes = new Map([['pic', { width: 640, height: 360 }]]);
    const plain = buildPreviewScene(content(), history.state.assets.byId, S, sizes, fakeMetrics)
      .nodes[0];
    expect(plain).toMatchObject({ opacity: 1 });
    expect(plain && 'crop' in plain).toBe(false);
    expect(plain && 'colour' in plain).toBe(false);

    history.execute(
      setClipLook(['pic'], {
        opacity: 0.5,
        transform: { ...IDENTITY_TRANSFORM, crop: { left: 0.1, top: 0, right: 0, bottom: 0.2 } },
        colour: { brightness: 0.1, contrast: 0, saturation: -0.5, temperature: 0 },
      }),
    );
    const node = buildPreviewScene(content(), history.state.assets.byId, S, sizes, fakeMetrics)
      .nodes[0];
    expect(node).toMatchObject({
      opacity: 0.5,
      crop: { left: 0.1, top: 0, right: 0, bottom: 0.2 },
      colour: { brightness: 0.1, saturation: -0.5 },
    });
  });
});
