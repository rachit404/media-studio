import {
  History,
  FPS_30,
  addAssets,
  addMediaToTimeline,
  addTrack,
  createProject,
  setTrackState,
  trimClip,
  type NewAsset,
  type ProjectDocument,
  type VideoContent,
} from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { audioSegments } from './audio-plan';
import { isTrimChange, trimRange } from './drag-limits';
import { FrameCache, type Closable } from './frame-cache';
import { buildPreviewScene, containMatrix, previewPlan } from './preview';
import {
  fitScale,
  rulerTicks,
  snapClipStart,
  snapEdge,
  snapPoints,
  snapTime,
  timeToX,
  xToTime,
  zoomAround,
} from './timeline-view';
import { placeAsset } from './placement';
import { Transport } from './transport';

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
  audio: { sampleRate: 48_000, channels: 2, codec: 'aac' },
  file: 'media/vid.mp4',
  thumb: 'thumbs/vid.webp',
  peaks: null,
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
      clipId: 'c1',
      audioClipId: 'a1',
      linkId: 'l1',
    }),
  );
  return history;
}
const content = (history: History<ProjectDocument>): VideoContent => {
  if (history.state.content.kind !== 'video') throw new Error('video');
  return history.state.content;
};

describe('preview plan', () => {
  it('finds what is under the playhead, with source times', () => {
    const history = project();
    const plan = previewPlan(content(history), history.state.assets.byId, 5 * S);
    expect(plan.video).toEqual([
      { clipId: 'c1', assetId: 'vid', trackId: 'V1', sourceTime: 3 * S },
    ]);
    expect(plan.audio.map((entry) => entry.clipId)).toEqual(['a1']);
    expect(previewPlan(content(history), history.state.assets.byId, 1 * S)).toEqual({
      video: [],
      audio: [],
    });
  });

  it('leaves out muted tracks', () => {
    const history = project();
    history.execute(setTrackState('V1', { muted: true }));
    history.execute(setTrackState('A1', { muted: true }));
    expect(previewPlan(content(history), history.state.assets.byId, 5 * S)).toEqual({
      video: [],
      audio: [],
    });
  });

  it('orders pictures by track, higher tracks on top', () => {
    const history = project();
    history.execute(addAssets([{ ...VIDEO, id: 'mute', audio: null, file: 'media/mute.mp4' }]));
    history.execute(addTrack('video', 'V2'));
    history.execute(
      addMediaToTimeline({
        assetId: 'mute',
        start: 2 * S,
        clipId: 'c2',
        audioClipId: 'unused',
        linkId: 'l2',
        videoTrackId: 'V2',
      }),
    );
    const plan = previewPlan(content(history), history.state.assets.byId, 5 * S);
    expect(plan.video.map((layer) => layer.trackId).sort()).toEqual(['V1', 'V2']);
    const sizes = new Map([
      ['c1', { width: 640, height: 480 }],
      ['c2', { width: 640, height: 480 }],
    ]);
    const scene = buildPreviewScene(content(history), history.state.assets.byId, 5 * S, sizes);
    expect(scene.nodes.map((node) => node.id)).toEqual(['c1', 'c2']);
  });

  it('fits a picture inside the frame without stretching', () => {
    expect(containMatrix(640, 480, 1920, 1080)).toEqual([2.25, 0, 0, 2.25, 240, 0]);
    expect(containMatrix(1920, 1080, 1920, 1080)).toEqual([1, 0, 0, 1, 0, 0]);
    const wide = containMatrix(2000, 500, 1000, 1000);
    expect(wide[0]).toBe(0.5);
    expect(wide[5]).toBe(375);
  });
});

describe('scene', () => {
  it('draws the visible clip with its picture size and a black background', () => {
    const history = project();
    const scene = buildPreviewScene(
      content(history),
      history.state.assets.byId,
      5 * S,
      new Map([['c1', { width: 640, height: 480 }]]),
    );
    expect(scene).toMatchObject({ width: 640, height: 480, background: { r: 0, g: 0, b: 0 } });
    expect(scene.nodes).toHaveLength(1);
    expect(scene.nodes[0]).toMatchObject({ id: 'c1', textureId: 'clip:c1' });
    expect(
      buildPreviewScene(content(history), history.state.assets.byId, 5 * S, new Map()).nodes,
    ).toHaveLength(0);
  });
});

describe('audio segments', () => {
  it('cuts the sound to a window of the timeline', () => {
    const history = project();
    const segments = audioSegments(content(history), history.state.assets.byId, 3 * S, 4 * S);
    expect(segments).toEqual([
      {
        clipId: 'a1',
        assetId: 'vid',
        start: 3 * S,
        end: 4 * S,
        clipEnd: 12 * S,
        sourceStart: 1 * S,
        gainAt: expect.any(Function) as unknown,
      },
    ]);
    expect(segments[0]?.gainAt(3 * S)).toBe(1);
    expect(audioSegments(content(history), history.state.assets.byId, 0, 1 * S)).toEqual([]);
    expect(audioSegments(content(history), history.state.assets.byId, 13 * S, 14 * S)).toEqual([]);
  });
});

describe('transport', () => {
  function make() {
    let now = 0;
    const transport = new Transport({ clock: () => now }, FPS_30);
    transport.setDuration(10 * S);
    return {
      transport,
      advance: (us: number) => {
        now += us;
      },
    };
  }

  it('follows the clock while playing and stops at the end', () => {
    const { transport, advance } = make();
    transport.seek(2 * S);
    transport.play();
    advance(1.5 * S);
    expect(transport.tick()).toBe(3.5 * S);
    advance(20 * S);
    expect(transport.tick()).toBe(10 * S);
    expect(transport.playing).toBe(false);
  });

  it('pause keeps the time, seek while playing restarts from the new place', () => {
    const { transport, advance } = make();
    transport.play();
    advance(1 * S);
    transport.pause();
    expect(transport.time).toBe(1 * S);
    advance(5 * S);
    expect(transport.tick()).toBe(1 * S);
    transport.play();
    advance(1 * S);
    transport.seek(8 * S);
    advance(0.5 * S);
    expect(transport.tick()).toBe(8.5 * S);
  });

  it('steps by whole frames and never goes below zero', () => {
    const { transport } = make();
    transport.stepFrames(3);
    expect(transport.time).toBe(100_000);
    transport.stepFrames(-10);
    expect(transport.time).toBe(0);
    transport.seek(-5);
    expect(transport.time).toBe(0);
    transport.seek(99 * S);
    expect(transport.time).toBe(10 * S);
  });

  it('plays again from the start after the end, and counts dropped frames', () => {
    const { transport, advance } = make();
    transport.seek(10 * S);
    transport.play();
    expect(transport.time).toBe(0);
    advance(33_334);
    transport.tick();
    advance(100_000); // three frames skipped in one tick
    transport.tick();
    expect(transport.stats.presented).toBe(2);
    expect(transport.stats.dropped).toBe(2);
    expect(transport.droppedPercent).toBe(50);
  });

  it('shortening the sequence moves the playhead inside it', () => {
    const { transport } = make();
    transport.seek(9 * S);
    transport.setDuration(4 * S);
    expect(transport.time).toBe(4 * S);
  });
});

describe('timeline view', () => {
  const scale = { pxPerSecond: 100, originUs: 2 * S };

  it('converts between time and x', () => {
    expect(timeToX(scale, 3 * S)).toBe(100);
    expect(xToTime(scale, 100)).toBe(3 * S);
    expect(xToTime(scale, timeToX(scale, 7_654_321))).toBe(7_654_321);
  });

  it('zooms around a point without moving it', () => {
    const next = zoomAround(scale, 2, 300);
    expect(next.pxPerSecond).toBe(200);
    expect(xToTime(next, 300)).toBe(xToTime(scale, 300));
    expect(zoomAround(scale, 1e9, 0).pxPerSecond).toBe(2000);
    expect(zoomAround(scale, 1e-9, 0).pxPerSecond).toBe(2);
  });

  it('fits a duration into the width', () => {
    const fitted = fitScale(60 * S, 1050);
    expect(fitted.originUs).toBe(0);
    expect(fitted.pxPerSecond * 63).toBeCloseTo(1050, 5);
  });

  it('makes ruler marks about 80 px apart', () => {
    const ticks = rulerTicks({ pxPerSecond: 100, originUs: 0 }, 1000);
    expect(ticks[0]).toMatchObject({ time: 0, major: true });
    expect(ticks[1]?.x).toBe(100); // one second per mark
    expect(ticks.every((tick) => tick.x <= 1000)).toBe(true);
  });

  it('snaps to nearby points only', () => {
    const history = project();
    const points = snapPoints(content(history), new Set(), 5 * S);
    expect(points).toEqual([0, 2 * S, 5 * S, 12 * S]);
    expect(snapTime(2.05 * S, points, 0.1 * S)).toEqual({ time: 2 * S, to: 2 * S });
    expect(snapTime(3 * S, points, 0.1 * S)).toEqual({ time: 3 * S, to: null });
    expect(snapPoints(content(history), new Set(['c1', 'a1']), 5 * S)).toEqual([0, 5 * S]);
  });

  it('snaps a dragged clip by either edge, otherwise to a frame', () => {
    const points = [0, 10 * S];
    // End edge near 10 s: the clip moves so its end lands on it.
    expect(snapClipStart(6.98 * S, 3 * S, points, 0.1 * S, FPS_30)).toEqual({
      time: 7 * S,
      to: 10 * S,
    });
    expect(snapClipStart(0.02 * S, 3 * S, points, 0.1 * S, FPS_30)).toEqual({ time: 0, to: 0 });
    expect(snapClipStart(4.01 * S, 1 * S, points, 0.1 * S, FPS_30).to).toBeNull();
    expect(snapEdge(4.01 * S, points, 0.1 * S, FPS_30).time).toBe(4 * S);
  });
});

describe('frame cache', () => {
  const picture = (log: string[], name: string): Closable => ({ close: () => log.push(name) });

  it('evicts the least recently used picture and closes everything exactly once', () => {
    const log: string[] = [];
    const cache = new FrameCache<Closable>({ maxEntries: 2, maxBytes: 1000 });
    cache.set('a', picture(log, 'a'), 10);
    cache.set('b', picture(log, 'b'), 10);
    expect(cache.get('a')).toBeDefined(); // a is now newer than b
    cache.set('c', picture(log, 'c'), 10);
    expect(log).toEqual(['b']);
    expect(cache.has('a') && cache.has('c')).toBe(true);
    cache.set('a', picture(log, 'a2'), 10); // replaced: the old one is closed
    expect(log).toEqual(['b', 'a']);
    cache.clear();
    expect(log.sort()).toEqual(['a', 'a2', 'b', 'c']);
    expect(cache.alive).toBe(0);
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });

  it('respects the byte budget but always keeps the newest picture', () => {
    const log: string[] = [];
    const cache = new FrameCache<Closable>({ maxEntries: 100, maxBytes: 25 });
    cache.set('a', picture(log, 'a'), 10);
    cache.set('b', picture(log, 'b'), 10);
    cache.set('c', picture(log, 'c'), 10);
    expect(log).toEqual(['a']);
    cache.set('huge', picture(log, 'huge'), 500);
    expect(cache.size).toBe(1);
    expect(cache.has('huge')).toBe(true);
    cache.removeWhere((key) => key === 'huge');
    expect(cache.alive).toBe(0);
  });
});

describe('placing assets', () => {
  it('puts a file after what is there, on a track that fits the picture and the sound', () => {
    const history = project(); // a clip from 2 s to 12 s on V1 and A1
    const asset = history.state.assets.byId['vid'];
    if (!asset) throw new Error('asset');
    const first = placeAsset(content(history), asset, 0);
    // 10 s do not fit before the clip at 2 s, so it goes after it.
    expect(first).toEqual({ start: 12 * S, videoTrackId: 'V1', audioTrackId: 'A1' });
    expect(placeAsset(content(history), asset, 20 * S)?.start).toBe(20 * S);
  });

  it('skips locked tracks and returns null when nothing can take the file', () => {
    const history = project();
    const asset = history.state.assets.byId['vid'];
    if (!asset) throw new Error('asset');
    history.execute(addTrack('video', 'V2'));
    history.execute(setTrackState('V1', { locked: true }));
    expect(placeAsset(content(history), asset, 0)?.videoTrackId).toBe('V2');
    history.execute(setTrackState('V2', { locked: true }));
    expect(placeAsset(content(history), asset, 0)).toBeNull();
  });
});

describe('trim limits', () => {
  it('stop at neighbours, the ends of the file, and one frame from the other edge', () => {
    const history = project(); // clip 2 s..12 s, whole 10 s file
    history.execute(addAssets([{ ...VIDEO, id: 'other', file: 'media/other.mp4' }]));
    history.execute(
      addMediaToTimeline({
        assetId: 'other',
        start: 14 * S,
        clipId: 'c9',
        audioClipId: 'a9',
        linkId: 'l9',
      }),
    );
    const assets = history.state.assets.byId;
    const frame = 33_334;
    // Start edge: cannot go before the timeline start-of-file (clip is at the start of its file) nor past the end.
    const start = trimRange(content(history), assets, 'c1', 'start', FPS_30);
    expect(start.min).toBe(2 * S);
    expect(start.max).toBe(12 * S - frame);
    // End edge: the file has no more material; the neighbour at 14 s does not matter.
    const end = trimRange(content(history), assets, 'c1', 'end', FPS_30);
    expect(end.min).toBe(2 * S + frame);
    expect(end.max).toBe(12 * S);
    // After shortening the clip there is room to extend again, up to the next clip.
    history.execute(trimClip('c1', 'end', 6 * S));
    const again = trimRange(content(history), assets, 'c1', 'end', FPS_30);
    expect(again.max).toBe(12 * S);
    expect(isTrimChange(content(history), 'c1', 'end', 6 * S)).toBe(false);
    expect(isTrimChange(content(history), 'c1', 'end', 7 * S)).toBe(true);
  });
});
