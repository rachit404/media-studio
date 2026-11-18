import {
  History,
  FPS_30,
  addAssets,
  addMediaToTimeline,
  createProject,
  setTransition,
  type NewAsset,
  type ProjectDocument,
  type VideoContent,
} from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { buildPreviewScene, previewPlan, transitionLook } from './preview';

const S = 1_000_000;
const NO_CROP = { left: 0, top: 0, right: 0, bottom: 0 };

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

/** Clip `a` plays 0 to 10 s and clip `b` 10 to 20 s, both on V1, with the given transition into `b`. */
function project(kind: Parameters<typeof setTransition>[1]) {
  const history = new History(
    createProject({ id: 'p', name: 'V', type: 'video', createdAt: '2026-11-18T10:00:00.000Z' }),
  );
  history.execute(addAssets([VIDEO]));
  for (const [id, start] of [
    ['a', 0],
    ['b', 10 * S],
  ] as const) {
    history.execute(
      addMediaToTimeline({
        assetId: 'vid',
        start,
        clipId: id,
        audioClipId: `${id}-sound`,
        linkId: `${id}-link`,
      }),
    );
  }
  history.execute(setTransition('b', kind));
  return history;
}
const content = (history: History<ProjectDocument>): VideoContent => {
  if (history.state.content.kind !== 'video') throw new Error('video');
  return history.state.content;
};
const sizes = new Map([
  ['a', { width: 640, height: 480 }],
  ['b', { width: 640, height: 480 }],
]);

describe('transition plan', () => {
  it('keeps showing the clip going out, past its end, under the clip coming in', () => {
    const history = project({ kind: 'crossfade', duration: 2 * S });
    const plan = previewPlan(content(history), history.state.assets.byId, 11 * S);
    expect(plan.video).toEqual([
      {
        clipId: 'a',
        assetId: 'vid',
        trackId: 'V1',
        // Clip a used all 10 s of its file, so there is nothing after its end: it holds its last picture.
        sourceTime: 10 * S - 1,
        transition: { role: 'outgoing', kind: 'crossfade', direction: 'left', progress: 0.5 },
      },
      {
        clipId: 'b',
        assetId: 'vid',
        trackId: 'V1',
        sourceTime: S,
        transition: { role: 'incoming', kind: 'crossfade', direction: 'left', progress: 0.5 },
      },
    ]);
  });

  it('has only the plain clip before and after the transition', () => {
    const history = project({ kind: 'crossfade', duration: 2 * S });
    const at = (time: number) =>
      previewPlan(content(history), history.state.assets.byId, time).video.map((l) => l.clipId);
    expect(at(9 * S)).toEqual(['a']);
    expect(at(10 * S)).toEqual(['a', 'b']);
    expect(at(12 * S - 1)).toEqual(['a', 'b']);
    expect(at(12 * S)).toEqual(['b']);
  });
});

describe('transition scene', () => {
  const sceneAt = (history: History<ProjectDocument>, time: number) =>
    buildPreviewScene(content(history), history.state.assets.byId, time, sizes);

  it('cross-fades: the old picture stays solid and the new one fades in over it', () => {
    const history = project({ kind: 'crossfade', duration: 4 * S });
    const nodes = sceneAt(history, 11 * S).nodes;
    expect(nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(nodes.map((node) => (node.type === 'image' ? node.opacity : -1))).toEqual([1, 0.25]);
  });

  it('dips: the old picture goes dark in the first half, the new one comes back in the second', () => {
    const history = project({ kind: 'dip-black', duration: 4 * S });
    const first = sceneAt(history, 11 * S).nodes; // 25%
    expect(first.map((node) => node.id)).toEqual(['a']);
    expect(first[0]).toMatchObject({ dip: { colour: 'black', amount: 0.5 } });
    const middle = sceneAt(history, 12 * S).nodes; // 50%: only the new picture, fully dark
    expect(middle.map((node) => node.id)).toEqual(['b']);
    expect(middle[0]).toMatchObject({ dip: { colour: 'black', amount: 1 } });
    const last = sceneAt(history, 13 * S).nodes; // 75%
    expect(last[0]).toMatchObject({ dip: { amount: 0.5 } });
    expect(sceneAt(history, 14 * S).nodes[0]).not.toHaveProperty('dip');
  });

  it('dips to white', () => {
    const history = project({ kind: 'dip-white', duration: 4 * S });
    expect(sceneAt(history, 11 * S).nodes[0]).toMatchObject({ dip: { colour: 'white' } });
  });

  it('wipes by cropping the new picture from the side it comes in from', () => {
    const history = project({ kind: 'wipe', duration: 4 * S, direction: 'left' });
    const [, incoming] = sceneAt(history, 11 * S).nodes; // 25% revealed
    expect(incoming).toMatchObject({ id: 'b', crop: { ...NO_CROP, right: 0.75 } });
  });

  it('slides the new picture in from its side', () => {
    const history = project({ kind: 'slide', duration: 4 * S, direction: 'right' });
    const [outgoing, incoming] = sceneAt(history, 11 * S).nodes;
    if (outgoing?.type !== 'image' || incoming?.type !== 'image') throw new Error('images');
    // 480-tall picture fitted into a 640x480 frame: no offset on the outgoing clip, 75% of the frame width on the new one.
    expect(outgoing.matrix[4]).toBe(0);
    expect(incoming.matrix[4]).toBe(0.75 * 640);
    expect(incoming.matrix[5]).toBe(0);
  });

  it('draws nothing special once the transition is over', () => {
    const history = project({ kind: 'slide', duration: 2 * S });
    const nodes = sceneAt(history, 13 * S).nodes;
    expect(nodes.map((node) => node.id)).toEqual(['b']);
    expect(nodes[0]).toMatchObject({ matrix: [1, 0, 0, 1, 0, 0], opacity: 1 });
  });
});

describe('transitionLook', () => {
  it('combines a wipe with the clip’s own crop instead of undoing it', () => {
    const own = { ...NO_CROP, right: 0.5, left: 0.1 };
    const look = transitionLook(
      { role: 'incoming', kind: 'wipe', direction: 'left', progress: 0.9 },
      own,
      640,
      480,
    );
    if (look === 'hidden') throw new Error('shown');
    expect(look.crop?.right).toBe(0.5); // the clip's own crop is larger than the 10% still hidden
    expect(look.crop?.left).toBe(0.1);
  });

  it('is unchanged without a transition', () => {
    expect(transitionLook(undefined, NO_CROP, 640, 480)).toEqual({ opacity: 1, dx: 0, dy: 0 });
  });
});
