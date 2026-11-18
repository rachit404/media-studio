import {
  History,
  FPS_30,
  addAssets,
  addMediaToTimeline,
  addTextClip,
  createProject,
  setKeyframe,
  type NewAsset,
  type ProjectDocument,
  type TextSpec,
  type VideoContent,
} from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { mixAudioBlock, type AudioReader } from './audio-mix';
import { audioSegments } from './audio-plan';
import { fakeMetrics } from './fake-metrics';
import { buildPreviewScene } from './preview';

const S = 1_000_000;
const RATE = 1000;
const VIDEO: NewAsset = {
  id: 'vid',
  kind: 'video',
  name: 'a.mp4',
  mime: 'video/mp4',
  size: 1,
  width: 1000,
  height: 500,
  duration: 20 * S,
  fps: FPS_30,
  codec: 'avc1',
  keyframeInterval: S,
  audio: { sampleRate: RATE, channels: 2, codec: 'pcm' },
  file: 'media/vid.mp4',
  thumb: 'thumbs/vid.webp',
  peaks: null,
};
const TEXT: TextSpec = {
  text: 'Hi',
  fontFamily: 'sans-serif',
  fontSize: 40,
  fontWeight: 400,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.5,
  letterSpacing: 0,
};

function project() {
  const history = new History(
    createProject({ id: 'p', name: 'V', type: 'video', createdAt: '2026-11-18T10:00:00.000Z' }),
  );
  history.execute(addAssets([VIDEO]));
  history.execute(
    addMediaToTimeline({
      assetId: 'vid',
      start: 2 * S,
      duration: 10 * S,
      clipId: 'pic',
      audioClipId: 'snd',
      linkId: 'lk',
    }),
  );
  return history;
}
const content = (history: History<ProjectDocument>): VideoContent => {
  if (history.state.content.kind !== 'video') throw new Error('video');
  return history.state.content;
};
const sizes = new Map([['pic', { width: 1000, height: 500 }]]);
const nodeAt = (history: History<ProjectDocument>, time: number, id = 'pic') => {
  const node = buildPreviewScene(
    content(history),
    history.state.assets.byId,
    time,
    sizes,
    fakeMetrics,
  ).nodes.find((n) => n.id === id);
  if (node?.type !== 'image') throw new Error(`no node ${id}`);
  return node;
};

describe('keyframes in the preview', () => {
  it('moves the picture along its keyframes as time passes (offsets are from the clip start)', () => {
    const history = project(); // the sequence is 1000 x 500, the picture fits exactly
    history.execute(setKeyframe('pic', 'x', 0, -0.5));
    history.execute(setKeyframe('pic', 'x', 4 * S, 0.5));
    // At the start of the clip (2 s on the timeline) x = -50% of the frame width.
    expect(nodeAt(history, 2 * S).matrix[4]).toBeCloseTo(-500);
    expect(nodeAt(history, 4 * S).matrix[4]).toBeCloseTo(0); // half way
    expect(nodeAt(history, 6 * S).matrix[4]).toBeCloseTo(500);
    expect(nodeAt(history, 11 * S).matrix[4]).toBeCloseTo(500); // held after the last keyframe
  });

  it('scales and fades along keyframes, and a property without keyframes keeps its fixed value', () => {
    const history = project();
    history.execute(setKeyframe('pic', 'opacity', 0, 0));
    history.execute(setKeyframe('pic', 'opacity', 2 * S, 1));
    history.execute(setKeyframe('pic', 'scale', 0, 1));
    history.execute(setKeyframe('pic', 'scale', 4 * S, 2));
    expect(nodeAt(history, 3 * S).opacity).toBeCloseTo(0.5);
    expect(nodeAt(history, 5 * S).opacity).toBe(1);
    // Scale about the frame centre: at 2x the matrix scale doubles and the picture stays centred.
    expect(nodeAt(history, 2 * S).matrix[0]).toBeCloseTo(1);
    expect(nodeAt(history, 6 * S).matrix[0]).toBeCloseTo(2);
    expect(nodeAt(history, 6 * S).matrix[5]).toBeCloseTo(-250);
  });

  it('animates text clips too, box and all', () => {
    const history = project();
    history.execute(
      addTextClip({
        clipId: 'title',
        newTrackId: 'V2',
        start: 0,
        duration: 4 * S,
        text: TEXT,
        backdrop: { color: '#000000', opacity: 0.5 },
      }),
    );
    history.execute(setKeyframe('title', 'opacity', 0, 0));
    history.execute(setKeyframe('title', 'opacity', 4 * S, 1));
    expect(nodeAt(history, 2 * S, 'title').opacity).toBeCloseTo(0.5);
    expect(nodeAt(history, 2 * S, 'title:backdrop').opacity).toBeCloseTo(0.25); // 0.5 x the box's own 0.5
    history.execute(setKeyframe('title', 'y', 0, -0.25));
    history.execute(setKeyframe('title', 'y', 4 * S, 0.25));
    const text = nodeAt(history, 2 * S, 'title');
    const frameCentre = 250 - text.height / 2;
    expect(text.matrix[5]).toBeCloseTo(frameCentre); // y is 0 half way
  });
});

describe('keyframes in the sound', () => {
  it('the offline mix follows a volume ramp sample by sample, and the live gain agrees', async () => {
    const history = project();
    history.execute(setKeyframe('snd', 'volume', 0, 0));
    history.execute(setKeyframe('snd', 'volume', 4 * S, 1));
    const loud: AudioReader = {
      read: (_start, frames) =>
        Promise.resolve([new Float32Array(frames).fill(0.5), new Float32Array(frames).fill(0.5)]),
    };
    // 2 s to 3 s of the timeline is 0 to 1 s into the clip: the gain goes from 0 to 0.25.
    const [left] = await mixAudioBlock(
      content(history),
      history.state.assets.byId,
      () => loud,
      2000,
      1000,
      RATE,
    );
    expect(left[0]).toBeCloseTo(0);
    expect(left[500]).toBeCloseTo(0.5 * 0.125, 3);
    expect(left[999]).toBeCloseTo(0.5 * 0.25, 2);
    const [segment] = audioSegments(content(history), history.state.assets.byId, 2 * S, 3 * S);
    for (const index of [0, 250, 500, 999]) {
      const time = 2 * S + index * 1000;
      expect((segment?.gainAt(time) ?? 0) * 0.5).toBeCloseTo(left[index] ?? 0, 2);
    }
  });
});
