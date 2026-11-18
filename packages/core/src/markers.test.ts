import { describe, expect, it } from 'vitest';
import { History } from './history';
import { addAssets, createProject, parseProjectFile, CURRENT_FORMAT_VERSION } from './project';
import type { NewAsset, ProjectDocument } from './project';
import { exportRange, nextMarker, previousMarker } from './timeline';
import {
  addMarker,
  addMediaToTimeline,
  removeMarker,
  renameMarker,
  setInOut,
} from './video-commands';
import { videoContentSchema, type VideoContent } from './video-document';

const S = 1_000_000;
const VIDEO: NewAsset = {
  id: 'vid',
  kind: 'video',
  name: 'clip.mp4',
  mime: 'video/mp4',
  size: 1000,
  width: 1280,
  height: 720,
  duration: 20 * S,
  fps: { num: 25, den: 1 },
  codec: 'avc1.64001f',
  keyframeInterval: 2 * S,
  audio: null,
  file: 'media/vid.mp4',
  thumb: 'thumbs/vid.png',
  peaks: null,
};

/** A sequence 20 s long. */
function setup() {
  const history = new History(
    createProject({ id: 'p', name: 'V', type: 'video', createdAt: '2026-11-18T10:00:00.000Z' }),
    { autoFreeze: true },
  );
  history.execute(addAssets([VIDEO]));
  history.execute(
    addMediaToTimeline({ assetId: 'vid', start: 0, clipId: 'pic', audioClipId: 'x', linkId: 'l' }),
  );
  return history;
}
function content(history: History<ProjectDocument>): VideoContent {
  if (history.state.content.kind !== 'video') throw new Error('video');
  return history.state.content;
}

describe('markers', () => {
  it('adds markers in time order, with undo', () => {
    const history = setup();
    history.execute(addMarker('b', 8 * S, 'Second'));
    history.execute(addMarker('a', 3 * S));
    expect(content(history).markers).toEqual([
      { id: 'a', time: 3 * S, name: '' },
      { id: 'b', time: 8 * S, name: 'Second' },
    ]);
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);
    history.undo();
    expect(content(history).markers?.map((m) => m.id)).toEqual(['b']);
    history.undo();
    expect(content(history).markers).toBeUndefined();
  });

  it('refuses a second marker at the same time, a repeated id and invalid times or names', () => {
    const history = setup();
    history.execute(addMarker('a', 3 * S));
    expect(() => history.execute(addMarker('b', 3 * S))).toThrow(/already a marker/i);
    expect(() => history.execute(addMarker('a', 4 * S))).toThrow(/already exists/i);
    expect(() => history.execute(addMarker('c', -1))).toThrow();
    expect(() => history.execute(addMarker('c', 1.5))).toThrow();
    expect(() => history.execute(addMarker('c', 1, 'x'.repeat(61)))).toThrow();
    expect(content(history).markers).toHaveLength(1);
  });

  it('renames (typing is one undo step) and removes', () => {
    const history = setup();
    history.execute(addMarker('a', 3 * S));
    for (const name of ['I', 'In', 'Intro']) history.execute(renameMarker('a', name));
    expect(content(history).markers?.[0]?.name).toBe('Intro');
    history.undo();
    expect(content(history).markers?.[0]?.name).toBe('');
    history.execute(removeMarker('a'));
    expect(content(history).markers).toBeUndefined();
    expect(() => history.execute(removeMarker('a'))).toThrow();
    expect(() => history.execute(renameMarker('a', 'x'))).toThrow();
  });

  it('finds the next and previous marker from a time, never the one it stands on', () => {
    const history = setup();
    for (const [id, time] of [
      ['a', 2 * S],
      ['b', 5 * S],
      ['c', 9 * S],
    ] as const) {
      history.execute(addMarker(id, time));
    }
    const c = content(history);
    expect(nextMarker(c, 0)?.id).toBe('a');
    expect(nextMarker(c, 2 * S)?.id).toBe('b');
    expect(nextMarker(c, 9 * S)).toBeUndefined();
    expect(previousMarker(c, 20 * S)?.id).toBe('c');
    expect(previousMarker(c, 5 * S)?.id).toBe('a');
    expect(previousMarker(c, 2 * S)).toBeUndefined();
    expect(nextMarker(content(setup()), 0)).toBeUndefined();
  });

  it('is rejected by the schema when out of order or repeated', () => {
    const history = setup();
    history.execute(addMarker('a', 2 * S));
    history.execute(addMarker('b', 5 * S));
    const good = content(history);
    const reversed: VideoContent = { ...good, markers: [...(good.markers ?? [])].reverse() };
    expect(videoContentSchema.safeParse(reversed).success).toBe(false);
    const sameTime: VideoContent = {
      ...good,
      markers: [
        { id: 'a', time: S, name: '' },
        { id: 'b', time: S, name: '' },
      ],
    };
    expect(videoContentSchema.safeParse(sameTime).success).toBe(false);
  });
});

describe('in and out points', () => {
  it('sets, replaces and clears each point, with undo', () => {
    const history = setup();
    history.execute(setInOut({ in: 4 * S }));
    history.execute(setInOut({ out: 9 * S }));
    expect(content(history)).toMatchObject({ inPoint: 4 * S, outPoint: 9 * S });
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);
    history.execute(setInOut({ in: 6 * S }));
    expect(content(history)).toMatchObject({ inPoint: 6 * S, outPoint: 9 * S });
    history.execute(setInOut({ in: null }));
    expect(content(history).inPoint).toBeUndefined();
    expect(content(history).outPoint).toBe(9 * S);
    history.execute(setInOut({ in: null, out: null }));
    expect(content(history).outPoint).toBeUndefined();
    history.undo();
    expect(content(history).outPoint).toBe(9 * S);
  });

  it('removes the other point when a new one lands on the wrong side of it', () => {
    const history = setup();
    history.execute(setInOut({ in: 4 * S, out: 9 * S }));
    history.execute(setInOut({ in: 12 * S })); // after the out point: the out point goes
    expect(content(history)).toMatchObject({ inPoint: 12 * S });
    expect(content(history).outPoint).toBeUndefined();
    history.execute(setInOut({ out: 3 * S })); // before the in point: the in point goes
    expect(content(history).inPoint).toBeUndefined();
    expect(content(history).outPoint).toBe(3 * S);
    history.execute(setInOut({ out: 3 * S })); // same as in is also wrong side
    expect(content(history).outPoint).toBe(3 * S);
  });

  it('refuses both given in the wrong order and invalid times', () => {
    const history = setup();
    expect(() => history.execute(setInOut({ in: 5 * S, out: 5 * S }))).toThrow();
    expect(() => history.execute(setInOut({ in: 6 * S, out: 5 * S }))).toThrow();
    expect(() => history.execute(setInOut({ in: -1 }))).toThrow();
    expect(() => history.execute(setInOut({ out: 0.5 }))).toThrow();
    expect(content(history).inPoint).toBeUndefined();
  });

  it('gives the range export is limited to', () => {
    const history = setup(); // 20 s
    expect(exportRange(content(history))).toBeNull();
    history.execute(setInOut({ in: 5 * S }));
    expect(exportRange(content(history))).toEqual({ start: 5 * S, end: 20 * S });
    history.execute(setInOut({ out: 12 * S }));
    expect(exportRange(content(history))).toEqual({ start: 5 * S, end: 12 * S });
    history.execute(setInOut({ in: null }));
    expect(exportRange(content(history))).toEqual({ start: 0, end: 12 * S });
    // An out point past the end of the sequence is limited to the end; an in point past it gives nothing.
    history.execute(setInOut({ out: 50 * S }));
    expect(exportRange(content(history))).toEqual({ start: 0, end: 20 * S });
    history.execute(setInOut({ in: 30 * S, out: null }));
    expect(exportRange(content(history))).toBeNull();
  });
});

describe('markers in files', () => {
  it('saves at the current format version, and a v9 file still opens', () => {
    const history = setup();
    history.execute(addMarker('a', 3 * S, 'Intro'));
    history.execute(setInOut({ in: S, out: 5 * S }));
    const file = {
      format: 'media-studio-project',
      formatVersion: CURRENT_FORMAT_VERSION,
      appVersion: 'test',
      modifiedAt: '2026-11-18T10:00:00.000Z',
      journalSeq: 0,
      project: history.state,
    };
    expect(parseProjectFile(file).file.project.content).toEqual(history.state.content);
    const v9 = { ...file, formatVersion: 9, project: setup().state };
    expect(parseProjectFile(v9).migratedFrom).toBe(9);
  });
});
