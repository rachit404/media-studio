import {
  History,
  FPS_30,
  addAssets,
  addMediaToTimeline,
  addTextClip,
  createProject,
  rasterKey,
  setClipLook,
  setTrackState,
  type NewAsset,
  type ProjectDocument,
  type TextSpec,
  type VideoContent,
} from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { fakeMetrics } from './fake-metrics';
import { buildPreviewScene, previewPlan } from './preview';
import { DEFAULT_BACKDROP, defaultTextSpec, subtitleStyle, textTrackFor } from './text-defaults';

const S = 1_000_000;
const VIDEO: NewAsset = {
  id: 'vid',
  kind: 'video',
  name: 'a.mp4',
  mime: 'video/mp4',
  size: 1,
  width: 640,
  height: 480,
  duration: 10 * S,
  fps: FPS_30,
  codec: 'avc1',
  keyframeInterval: S,
  audio: null,
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
      start: 0,
      clipId: 'pic',
      audioClipId: 'snd',
      linkId: 'lk',
    }),
  );
  history.execute(
    addTextClip({
      clipId: 'title',
      newTrackId: 'V2',
      start: 2 * S,
      duration: 3 * S,
      text: TEXT,
    }),
  );
  return history;
}
const content = (history: History<ProjectDocument>): VideoContent => {
  if (history.state.content.kind !== 'video') throw new Error('video');
  return history.state.content;
};
const sizes = new Map([['pic', { width: 640, height: 480 }]]);
const sceneAt = (history: History<ProjectDocument>, time: number) =>
  buildPreviewScene(content(history), history.state.assets.byId, time, sizes, fakeMetrics);

describe('text in the preview', () => {
  it('is on screen only while its clip is, above the picture below it', () => {
    const history = project();
    expect(sceneAt(history, S).nodes.map((node) => node.id)).toEqual(['pic']);
    expect(sceneAt(history, 3 * S).nodes.map((node) => node.id)).toEqual(['pic', 'title']);
    expect(sceneAt(history, 5 * S).nodes.map((node) => node.id)).toEqual(['pic']);
  });

  it('is in the plan with no media and nothing to decode', () => {
    const history = project();
    const plan = previewPlan(content(history), history.state.assets.byId, 3 * S);
    expect(plan.video.map((layer) => [layer.clipId, layer.assetId])).toEqual([
      ['pic', 'vid'],
      ['title', null],
    ]);
    expect(plan.audio).toEqual([]);
  });

  it('draws the text at its own size in the middle of the frame, from its description', () => {
    const history = project();
    const node = sceneAt(history, 3 * S).nodes.find((n) => n.id === 'title');
    if (node?.type !== 'image' || !node.raster) throw new Error('text node');
    // "Hi" at 40 px: 2 characters × 20 = 40 wide, 60 tall; the sequence is 640 × 480.
    expect(node).toMatchObject({
      width: 40,
      height: 60,
      matrix: [1, 0, 0, 1, 300, 210],
      opacity: 1,
      textureId: rasterKey({ kind: 'text', ...TEXT }),
    });
    expect(node.raster).toMatchObject({ kind: 'text', text: 'Hi' });
  });

  it('moves, fades and hides like any other clip', () => {
    const history = project();
    history.execute(
      setClipLook(['title'], {
        opacity: 0.5,
        transform: {
          x: 0.25,
          y: -0.5,
          scale: 1,
          rotation: 0,
          crop: { left: 0, top: 0, right: 0, bottom: 0 },
        },
      }),
    );
    const node = sceneAt(history, 3 * S).nodes.find((n) => n.id === 'title');
    if (node?.type !== 'image') throw new Error('text node');
    expect(node.opacity).toBe(0.5);
    expect(node.matrix[4]).toBe(300 + 0.25 * 640);
    expect(node.matrix[5]).toBe(210 - 0.5 * 480);

    history.execute(setTrackState('V2', { muted: true }));
    expect(sceneAt(history, 3 * S).nodes.map((n) => n.id)).toEqual(['pic']);
  });

  it('draws a box behind the text, a little bigger than it, with its own opacity', () => {
    const history = project();
    history.execute(
      addTextClip({
        clipId: 'boxed',
        newTrackId: 'V3',
        start: 0,
        duration: 2 * S,
        text: TEXT,
        backdrop: { color: '#102030', opacity: 0.6 },
      }),
    );
    const nodes = sceneAt(history, S).nodes;
    expect(nodes.map((n) => n.id)).toEqual(['pic', 'boxed:backdrop', 'boxed']);
    const [, box, text] = nodes;
    if (box?.type !== 'image' || text?.type !== 'image') throw new Error('nodes');
    expect(box.raster).toMatchObject({ kind: 'shape', shape: 'rectangle', fill: '#102030' });
    expect(box.opacity).toBeCloseTo(0.6);
    expect(box.width).toBeGreaterThan(text.width);
    expect(box.height).toBeGreaterThan(text.height);
    // Both are centred on the same point.
    expect(box.matrix[4] + box.width / 2).toBeCloseTo(text.matrix[4] + text.width / 2);
    expect(box.matrix[5] + box.height / 2).toBeCloseTo(text.matrix[5] + text.height / 2);
  });
});

describe('text defaults', () => {
  it('sizes a new title and subtitles to the picture', () => {
    expect(defaultTextSpec({ height: 1080 })).toMatchObject({ fontSize: 86, align: 'center' });
    const style = subtitleStyle({ height: 1080 });
    expect(style.text.fontSize).toBe(54);
    expect(style.backdrop).toEqual(DEFAULT_BACKDROP);
    expect(style.transform?.y).toBeGreaterThan(0.3);
  });

  it('puts a title on the highest track with room, and asks for a new one when there is none', () => {
    const history = project(); // V1 has a clip 0 to 10 s; V2 has a title 2 to 5 s
    expect(textTrackFor(content(history), 6 * S, 3 * S)).toBe('V2');
    expect(textTrackFor(content(history), 3 * S, S)).toBeNull(); // V2 busy there, and so is V1
    history.execute(setTrackState('V2', { locked: true }));
    expect(textTrackFor(content(history), 6 * S, S)).toBeNull(); // V1 is busy, V2 is locked
    expect(textTrackFor(content(history), 11 * S, S)).toBe('V1');
  });
});
