import { describe, expect, it } from 'vitest';
import { History } from './history';
import { addAssets, createProject, parseProjectFile, CURRENT_FORMAT_VERSION } from './project';
import type { NewAsset, ProjectDocument } from './project';
import { activeTransition, outgoingClip } from './timeline';
import {
  addMediaToTimeline,
  moveClips,
  setClipLook,
  setTrackState,
  setTransition,
  splitClip,
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
  duration: 10 * S,
  fps: { num: 25, den: 1 },
  codec: 'avc1.64001f',
  keyframeInterval: 2 * S,
  audio: null,
  file: 'media/vid.mp4',
  thumb: 'thumbs/vid.png',
  peaks: null,
};

/** Two clips of 10 s, one right after the other on V1, and a third one with a gap before it. */
function setup() {
  const history = new History(
    createProject({ id: 'p', name: 'V', type: 'video', createdAt: '2026-11-18T10:00:00.000Z' }),
    { autoFreeze: true },
  );
  history.execute(addAssets([VIDEO]));
  const place = (id: string, start: number) =>
    history.execute(
      addMediaToTimeline({
        assetId: 'vid',
        start,
        clipId: id,
        audioClipId: `${id}-sound`,
        linkId: `${id}-link`,
      }),
    );
  place('a', 0);
  place('b', 10 * S);
  place('c', 25 * S);
  return history;
}

function content(history: History<ProjectDocument>): VideoContent {
  if (history.state.content.kind !== 'video') throw new Error('video');
  return history.state.content;
}

describe('transitions', () => {
  it('sets a transition on a clip that follows another, and undo removes it', () => {
    const history = setup();
    history.execute(setTransition('b', { kind: 'wipe', duration: 2 * S, direction: 'up' }));
    expect(content(history).clips['b']?.transitionIn).toEqual({
      kind: 'wipe',
      duration: 2 * S,
      direction: 'up',
    });
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);
    history.undo();
    expect(content(history).clips['b']?.transitionIn).toBeUndefined();
  });

  it('drops the direction for kinds that have none', () => {
    const history = setup();
    history.execute(setTransition('b', { kind: 'crossfade', duration: S, direction: 'up' }));
    expect(content(history).clips['b']?.transitionIn).toEqual({ kind: 'crossfade', duration: S });
  });

  it('merges repeated edits of one clip into a single undo step and removes with null', () => {
    const history = setup();
    for (const duration of [S, 2 * S, 3 * S]) {
      history.execute(setTransition('b', { kind: 'crossfade', duration }));
    }
    expect(content(history).clips['b']?.transitionIn?.duration).toBe(3 * S);
    history.undo();
    expect(content(history).clips['b']?.transitionIn).toBeUndefined();
    history.redo();
    history.execute(setTransition('b', null));
    expect(content(history).clips['b']?.transitionIn).toBeUndefined();
  });

  it('refuses a clip with nothing right before it, a sound clip, a long transition and a locked track', () => {
    const history = setup();
    // 'a' is first; 'c' has a gap before it.
    expect(() => history.execute(setTransition('a', { kind: 'crossfade', duration: S }))).toThrow(
      /no clip right before/i,
    );
    expect(() => history.execute(setTransition('c', { kind: 'crossfade', duration: S }))).toThrow();
    expect(() =>
      history.execute(setTransition('b-sound', { kind: 'crossfade', duration: S })),
    ).toThrow();
    expect(() =>
      history.execute(setTransition('b', { kind: 'crossfade', duration: 11 * S })),
    ).toThrow(/longer than the clip/i);
    expect(() => history.execute(setTransition('b', { kind: 'crossfade', duration: 0 }))).toThrow();
    history.execute(setTrackState('V1', { locked: true }));
    expect(() => history.execute(setTransition('b', { kind: 'crossfade', duration: S }))).toThrow(
      /locked/i,
    );
  });

  it('is only in effect while a clip ends exactly where this one starts', () => {
    const history = setup();
    history.execute(setTransition('b', { kind: 'slide', duration: 2 * S }));
    const clip = content(history).clips['b'];
    if (!clip) throw new Error('clip');
    expect(outgoingClip(content(history), clip)?.id).toBe('a');
    expect(activeTransition(content(history), clip)).toMatchObject({
      kind: 'slide',
      direction: 'left',
      duration: 2 * S,
    });

    // Move the clip away: the stored transition is dormant, and it comes back when the clip does.
    history.execute(moveClips('b', 3 * S));
    const moved = content(history).clips['b'];
    if (!moved) throw new Error('clip');
    expect(moved.transitionIn).toBeDefined();
    expect(activeTransition(content(history), moved)).toBeUndefined();
    history.undo();
    const back = content(history).clips['b'];
    if (!back) throw new Error('clip');
    expect(activeTransition(content(history), back)).toBeDefined();
  });

  it('limits the duration to the length of a shortened clip', () => {
    const history = setup();
    history.execute(setTransition('b', { kind: 'crossfade', duration: 8 * S }));
    let n = 0;
    history.execute(splitClip(content(history), 'b', 13 * S, () => `s${String(n++)}`));
    const left = content(history).clips['b'];
    if (!left) throw new Error('clip');
    expect(left.transitionIn?.duration).toBe(8 * S);
    expect(activeTransition(content(history), left)?.duration).toBe(3 * S);
  });

  it('stays on the first half of a split and not on the second', () => {
    const history = setup();
    history.execute(setTransition('b', { kind: 'crossfade', duration: S }));
    history.execute(setClipLook(['b'], { opacity: 0.5 }));
    let n = 0;
    history.execute(splitClip(content(history), 'b', 15 * S, () => `s${String(n++)}`));
    const right = Object.values(content(history).clips).find(
      (clip) => clip.trackId === 'V1' && clip.start === 15 * S,
    );
    expect(content(history).clips['b']?.transitionIn).toBeDefined();
    expect(right?.opacity).toBe(0.5);
    expect(right?.transitionIn).toBeUndefined();
  });

  it('saves at the current format version, and a v6 file still opens', () => {
    const history = setup();
    history.execute(setTransition('b', { kind: 'dip-white', duration: S }));
    const file = {
      format: 'media-studio-project',
      formatVersion: CURRENT_FORMAT_VERSION,
      appVersion: 'test',
      modifiedAt: '2026-11-18T10:00:00.000Z',
      journalSeq: 0,
      project: history.state,
    };
    expect(parseProjectFile(file).file.project.content).toEqual(history.state.content);
    const v6 = { ...file, formatVersion: 6, project: setup().state };
    expect(parseProjectFile(v6).migratedFrom).toBe(6);
  });
});
