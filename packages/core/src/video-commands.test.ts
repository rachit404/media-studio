import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { History } from './history';
import {
  addAssets,
  createProject,
  parseProject,
  parseProjectFile,
  CURRENT_FORMAT_VERSION,
} from './project';
import type { NewAsset, ProjectDocument } from './project';
import {
  clampMoveDelta,
  clipAt,
  clipsAt,
  expandLinked,
  firstFreeStart,
  isFree,
  linkedGroup,
  sequenceDuration,
  trackClips,
} from './timeline';
import {
  addMediaToTimeline,
  addTrack,
  deleteClips,
  joinClips,
  moveClips,
  removeTrack,
  setSequence,
  setTrackState,
  splitClip,
  splitClips,
  trimClip,
  unlinkClips,
} from './video-commands';
import { videoContentSchema, type VideoContent } from './video-document';

const NOW = '2026-11-18T10:00:00.000Z';
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
  audio: { sampleRate: 44_100, channels: 2, codec: 'mp4a.40.2' },
  file: 'media/vid.mp4',
  thumb: 'thumbs/vid.png',
  peaks: 'peaks/vid.bin',
};
const SILENT: NewAsset = { ...VIDEO, id: 'mute', audio: null, peaks: null, file: 'media/mute.mp4' };
const SONG: NewAsset = {
  id: 'song',
  kind: 'audio',
  name: 'song.wav',
  mime: 'audio/wav',
  size: 100,
  duration: 20 * S,
  audio: { sampleRate: 48_000, channels: 2, codec: 'pcm' },
  file: 'media/song.wav',
  peaks: 'peaks/song.bin',
};

let counter = 0;
const id = () => `n${String(counter++)}`;

function setup() {
  counter = 0;
  const history = new History(
    createProject({ id: 'p', name: 'V', type: 'video', createdAt: NOW }),
    {
      autoFreeze: true,
    },
  );
  history.execute(addAssets([VIDEO, SILENT, SONG]));
  return history;
}

function content(history: History<ProjectDocument>): VideoContent {
  if (history.state.content.kind !== 'video') throw new Error('video');
  return history.state.content;
}

function add(history: History<ProjectDocument>, assetId: string, start: number, extra = {}) {
  const clipId = id();
  history.execute(
    addMediaToTimeline({ assetId, start, clipId, audioClipId: id(), linkId: id(), ...extra }),
  );
  return clipId;
}

const starts = (history: History<ProjectDocument>, trackId: string) =>
  trackClips(content(history), trackId).map((clip) => [clip.start, clip.duration, clip.sourceIn]);

describe('adding media', () => {
  it('puts a video with sound on a video and an audio track, linked, and takes the picture settings from it', () => {
    const history = setup();
    const clipId = add(history, 'vid', 0);
    const c = content(history);
    expect(c.sequence).toMatchObject({
      width: 1280,
      height: 720,
      fps: { num: 25, den: 1 },
      sampleRate: 44_100,
    });
    expect(c.tracks.byId['V1']?.clipIds).toEqual([clipId]);
    expect(c.tracks.byId['A1']?.clipIds).toHaveLength(1);
    expect(linkedGroup(c, clipId)).toHaveLength(2);
    expect(sequenceDuration(c)).toBe(10 * S);
  });

  it('keeps the sequence settings once there are clips, and silent video makes one clip', () => {
    const history = setup();
    add(history, 'vid', 0);
    history.execute(setSequence({ width: 1920, height: 1080 }));
    const second = add(history, 'mute', 10 * S);
    expect(content(history).sequence.width).toBe(1920);
    expect(linkedGroup(content(history), second)).toHaveLength(1);
  });

  it('puts audio files on audio tracks only', () => {
    const history = setup();
    add(history, 'song', 2 * S);
    expect(content(history).tracks.byId['A1']?.clipIds).toHaveLength(1);
    expect(content(history).tracks.byId['V1']?.clipIds).toHaveLength(0);
  });

  it('refuses overlaps, missing room, locked tracks and unknown assets', () => {
    const history = setup();
    add(history, 'vid', 0);
    expect(() => add(history, 'mute', 5 * S)).toThrow(AppError);
    history.execute(setTrackState('V1', { locked: true }));
    expect(() => add(history, 'mute', 20 * S)).toThrow(AppError);
    expect(() => add(history, 'nope', 0)).toThrow(AppError);
    expect(() => add(history, 'vid', 0, { sourceIn: 9 * S })).toThrow(AppError);
  });

  it('is one undo step', () => {
    const history = setup();
    add(history, 'vid', 0);
    history.undo();
    expect(Object.keys(content(history).clips)).toHaveLength(0);
    expect(content(history).sequence.width).toBe(1920);
  });
});

describe('split, join and delete', () => {
  it('splits a clip and its linked sound, keeping source positions', () => {
    const history = setup();
    const clipId = add(history, 'vid', 1 * S);
    history.execute(splitClip(content(history), clipId, 4 * S, id));
    expect(starts(history, 'V1')).toEqual([
      [1 * S, 3 * S, 0],
      [4 * S, 7 * S, 3 * S],
    ]);
    expect(starts(history, 'A1')).toEqual(starts(history, 'V1'));
    // The halves are linked with their own partner, not across the cut.
    const [first, second] = trackClips(content(history), 'V1');
    expect(linkedGroup(content(history), first?.id ?? '')).toHaveLength(2);
    expect(linkedGroup(content(history), second?.id ?? '')).toHaveLength(2);
    expect(first?.linkId).not.toBe(second?.linkId);
  });

  it('refuses to split at the edges or outside the clip', () => {
    const history = setup();
    const clipId = add(history, 'vid', 1 * S);
    expect(() => history.execute(splitClip(content(history), clipId, 1 * S, id))).toThrow(AppError);
    expect(() => history.execute(splitClip(content(history), clipId, 11 * S, id))).toThrow(
      AppError,
    );
  });

  it('joins what was split, and refuses to join different material', () => {
    const history = setup();
    const clipId = add(history, 'vid', 0);
    history.execute(splitClip(content(history), clipId, 4 * S, id));
    history.execute(joinClips(clipId));
    expect(starts(history, 'V1')).toEqual([[0, 10 * S, 0]]);
    expect(starts(history, 'A1')).toEqual([[0, 10 * S, 0]]);
    const other = add(history, 'mute', 10 * S);
    expect(() => history.execute(joinClips(clipId))).toThrow(AppError);
    expect(other).toBeTruthy();
  });

  it('deletes with the linked clip; ripple closes the gap on the affected tracks', () => {
    const history = setup();
    const a = add(history, 'vid', 0);
    add(history, 'mute', 10 * S);
    history.execute(deleteClips([a], true));
    expect(starts(history, 'V1')).toEqual([[0, 10 * S, 0]]);
    expect(content(history).tracks.byId['A1']?.clipIds).toHaveLength(0);
    history.undo();
    expect(starts(history, 'V1')).toEqual([
      [0, 10 * S, 0],
      [10 * S, 10 * S, 0],
    ]);
    history.execute(deleteClips([a], false));
    expect(starts(history, 'V1')).toEqual([[10 * S, 10 * S, 0]]);
  });

  it('can unlink, so that the sound stays when the picture is deleted', () => {
    const history = setup();
    const a = add(history, 'vid', 0);
    history.execute(unlinkClips(a));
    history.execute(deleteClips([a], false));
    expect(content(history).tracks.byId['A1']?.clipIds).toHaveLength(1);
  });
});

describe('move', () => {
  it('moves a clip and its sound together, and re-sorts the track', () => {
    const history = setup();
    const a = add(history, 'vid', 0);
    add(history, 'mute', 10 * S);
    history.execute(moveClips(a, 25 * S));
    expect(trackClips(content(history), 'V1').map((clip) => clip.start)).toEqual([10 * S, 25 * S]);
    expect(content(history).clips[a]?.start).toBe(25 * S);
    expect(trackClips(content(history), 'A1')[0]?.start).toBe(25 * S);
  });

  it('refuses to land on another clip or before zero', () => {
    const history = setup();
    const a = add(history, 'vid', 0);
    add(history, 'mute', 12 * S);
    expect(() => history.execute(moveClips(a, 5 * S))).toThrow(AppError);
    expect(() => history.execute(moveClips(a, -1))).toThrow(AppError);
  });

  it('moves to another track of the same kind, not to a different kind', () => {
    const history = setup();
    history.execute(addTrack('video', 'V2'));
    const a = add(history, 'mute', 0);
    history.execute(moveClips(a, 0, 'V2'));
    expect(content(history).clips[a]?.trackId).toBe('V2');
    expect(content(history).tracks.byId['V1']?.clipIds).toEqual([]);
    expect(() => history.execute(moveClips(a, 0, 'A1'))).toThrow(AppError);
  });

  it('clampMoveDelta keeps a drag clear of neighbours', () => {
    const history = setup();
    const a = add(history, 'mute', 0);
    add(history, 'mute', 12 * S);
    const c = content(history);
    const group = linkedGroup(c, a);
    expect(clampMoveDelta(c, group, a, 'V1', 1 * S)).toBe(1 * S);
    expect(clampMoveDelta(c, group, a, 'V1', -3 * S)).toBe(0);
    // Dragged past the neighbour, it lands after it, not on it.
    expect(clampMoveDelta(c, group, a, 'V1', 14 * S)).toBe(22 * S);
    // Held against the neighbour when the pointer is only part way over it.
    expect(clampMoveDelta(c, group, a, 'V1', 1.5 * S)).toBe(1.5 * S);
  });
});

describe('trim', () => {
  it('trims the end, with the linked sound', () => {
    const history = setup();
    const a = add(history, 'vid', 0);
    history.execute(trimClip(a, 'end', 6 * S));
    expect(starts(history, 'V1')).toEqual([[0, 6 * S, 0]]);
    expect(starts(history, 'A1')).toEqual([[0, 6 * S, 0]]);
  });

  it('trimming the start moves the in-point, and can be extended back', () => {
    const history = setup();
    const a = add(history, 'vid', 2 * S);
    history.execute(trimClip(a, 'start', 5 * S));
    expect(starts(history, 'V1')).toEqual([[5 * S, 7 * S, 3 * S]]);
    history.execute(trimClip(a, 'start', 3 * S));
    expect(starts(history, 'V1')).toEqual([[3 * S, 9 * S, 1 * S]]);
  });

  it('cannot go past the file, onto a neighbour, or to nothing', () => {
    const history = setup();
    const a = add(history, 'vid', 0);
    history.execute(trimClip(a, 'end', 4 * S));
    expect(() => history.execute(trimClip(a, 'end', 11 * S))).toThrow(AppError);
    expect(() => history.execute(trimClip(a, 'start', -1 * S))).toThrow(AppError);
    expect(() => history.execute(trimClip(a, 'end', 0))).toThrow(AppError);
    add(history, 'mute', 6 * S);
    expect(() => history.execute(trimClip(a, 'end', 7 * S))).toThrow(AppError);
    history.execute(trimClip(a, 'end', 6 * S));
  });

  it('ripple shifts the clips after it', () => {
    const history = setup();
    const a = add(history, 'vid', 0);
    add(history, 'mute', 10 * S);
    history.execute(trimClip(a, 'end', 6 * S, { ripple: true }));
    expect(starts(history, 'V1')).toEqual([
      [0, 6 * S, 0],
      [6 * S, 10 * S, 0],
    ]);
  });

  it('coalesces drags into one undo step', () => {
    const history = setup();
    const a = add(history, 'vid', 0);
    history.execute(trimClip(a, 'end', 9 * S));
    history.execute(trimClip(a, 'end', 8 * S));
    history.execute(trimClip(a, 'end', 7 * S));
    history.undo();
    expect(starts(history, 'V1')).toEqual([[0, 10 * S, 0]]);
  });
});

describe('tracks and sequence', () => {
  it('adds, names, mutes, locks and removes tracks', () => {
    const history = setup();
    history.execute(addTrack('video', 'V2'));
    expect(content(history).tracks.byId['V2']?.name).toBe('Video 2');
    history.execute(setTrackState('V2', { muted: true, name: 'Titles' }));
    expect(content(history).tracks.byId['V2']).toMatchObject({ muted: true, name: 'Titles' });
    history.execute(removeTrack('V2'));
    expect(content(history).tracks.byId['V2']).toBeUndefined();
    expect(() => history.execute(removeTrack('V1'))).toThrow(AppError);
  });

  it('refuses to remove a track with clips, and locked tracks reject edits', () => {
    const history = setup();
    const a = add(history, 'mute', 0);
    expect(() => history.execute(removeTrack('V1'))).toThrow(AppError);
    history.execute(setTrackState('V1', { locked: true }));
    expect(() => history.execute(deleteClips([a], false))).toThrow(AppError);
    expect(() => history.execute(trimClip(a, 'end', 2 * S))).toThrow(AppError);
    expect(() => history.execute(moveClips(a, 1 * S))).toThrow(AppError);
  });

  it('validates the picture size', () => {
    const history = setup();
    expect(() => history.execute(setSequence({ width: 4, height: 100 }))).toThrow(AppError);
    history.execute(setSequence({ fps: { num: 60, den: 1 } }));
    expect(content(history).sequence.fps.num).toBe(60);
  });

  it('answers what is showing at a time', () => {
    const history = setup();
    add(history, 'vid', 2 * S);
    const c = content(history);
    expect(clipAt(c, 'V1', 1 * S)).toBeUndefined();
    expect(clipAt(c, 'V1', 2 * S)).toBeDefined();
    expect(clipAt(c, 'V1', 12 * S - 1)).toBeDefined();
    expect(clipAt(c, 'V1', 12 * S)).toBeUndefined();
    expect(clipsAt(c, 5 * S).map((entry) => entry.track.id)).toEqual(['V1', 'A1']);
  });
});

describe('format v5', () => {
  it('round-trips a project with clips and rejects broken timelines', () => {
    const history = setup();
    const a = add(history, 'vid', 0);
    history.execute(splitClip(content(history), a, 3 * S, id));
    expect(parseProject(JSON.parse(JSON.stringify(history.state)))).toEqual(history.state);

    const broken = JSON.parse(JSON.stringify(content(history))) as VideoContent;
    const [first, second] = broken.tracks.byId['V1']?.clipIds ?? [];
    const clip = broken.clips[second ?? ''];
    if (clip) clip.start = 1 * S; // overlaps the first piece
    expect(videoContentSchema.safeParse(broken).success).toBe(false);
    broken.tracks.byId['V1']?.clipIds.push(first ?? '');
    expect(videoContentSchema.safeParse(broken).success).toBe(false);
  });

  it('opens a v4 video project with the new empty sequence', () => {
    const v4 = {
      format: 'media-studio-project',
      formatVersion: 4,
      appVersion: '0.0.0',
      modifiedAt: NOW,
      journalSeq: 0,
      project: {
        id: 'p1',
        name: 'Old',
        type: 'video',
        createdAt: NOW,
        assets: { byId: {} },
        content: { kind: 'video' },
      },
    };
    const { file, migratedFrom } = parseProjectFile(v4);
    expect(migratedFrom).toBe(4);
    expect(file.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(
      file.project.content.kind === 'video' && Object.keys(file.project.content.tracks.byId),
    ).toEqual(['V1', 'A1']);
  });
});

/** A small deterministic random generator, so failures can be reproduced from the seed. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('properties: random editing keeps the timeline valid and undo exact', () => {
  for (const seed of Array.from({ length: 24 }, (_, i) => i + 1)) {
    it(`seed ${String(seed)}`, () => {
      const rand = random(seed);
      const history = setup();
      history.execute(addTrack('video', 'V2'));
      const pick = <T>(items: readonly T[]): T | undefined =>
        items[Math.floor(rand() * items.length)];
      const baseline = history.state;

      for (let step = 0; step < 120; step += 1) {
        const c = content(history);
        const clips = Object.values(c.clips);
        const choice = rand();
        const target = pick(clips);
        const before = history.state;
        try {
          if (choice < 0.25 || clips.length === 0) {
            history.execute(
              addMediaToTimeline({
                assetId: pick(['vid', 'mute', 'song']) ?? 'vid',
                start: Math.floor(rand() * 60) * S,
                clipId: id(),
                audioClipId: id(),
                linkId: id(),
                videoTrackId: pick(['V1', 'V2']),
              }),
            );
          } else if (choice < 0.45 && target) {
            history.execute(
              splitClip(
                c,
                target.id,
                target.start + 1 + Math.floor(rand() * (target.duration - 1)),
                id,
              ),
            );
          } else if (choice < 0.6 && target) {
            history.execute(moveClips(target.id, Math.floor((rand() - 0.5) * 30) * S));
          } else if (choice < 0.75 && target) {
            history.execute(
              trimClip(target.id, rand() < 0.5 ? 'start' : 'end', Math.floor(rand() * 70) * S, {
                ripple: rand() < 0.3,
              }),
            );
          } else if (choice < 0.85 && target) {
            history.execute(deleteClips([target.id], rand() < 0.5));
          } else if (target) {
            history.execute(joinClips(target.id));
          }
        } catch (error) {
          // An operation that is not possible must be refused without changing anything.
          expect(error).toBeInstanceOf(AppError);
          expect(history.state).toBe(before);
          continue;
        }
        // The result is always a valid timeline: sorted, no overlaps, no dangling references.
        const parsed = videoContentSchema.safeParse(content(history));
        expect(
          parsed.success
            ? 'valid'
            : `${history.undoLabel ?? ''}: ${JSON.stringify(parsed.error.issues)}`,
        ).toBe('valid');
        // Redo after undo gives back exactly this state.
        const after = history.state;
        history.undo();
        history.redo();
        expect(history.state).toEqual(after);
      }

      // Undoing everything gives back the starting document exactly.
      const text = JSON.stringify(baseline);
      while (history.canUndo && JSON.stringify(history.state) !== text) history.undo();
      expect(history.state).toEqual(baseline);
    });
  }
});

describe('splitClips (several clips at once)', () => {
  it('splits every clip under the playhead in one undo step, keeping each pair linked', () => {
    const history = setup();
    history.execute(addTrack('video', 'V2'));
    const a = add(history, 'vid', 0);
    const b = add(history, 'mute', 0, { videoTrackId: 'V2' });
    history.execute(splitClips(content(history), [a, b], 4 * S, id));
    expect(trackClips(content(history), 'V1')).toHaveLength(2);
    expect(trackClips(content(history), 'V2')).toHaveLength(2);
    expect(trackClips(content(history), 'A1')).toHaveLength(2);
    const [, secondHalf] = trackClips(content(history), 'V1');
    expect(linkedGroup(content(history), secondHalf?.id ?? '')).toHaveLength(2);
    history.undo();
    expect(trackClips(content(history), 'V1')).toHaveLength(1);
    expect(trackClips(content(history), 'V2')).toHaveLength(1);
  });

  it('refuses when any clip is not under the time, without changing anything', () => {
    const history = setup();
    history.execute(addTrack('video', 'V2'));
    const a = add(history, 'vid', 0);
    const b = add(history, 'mute', 5 * S, { videoTrackId: 'V2' });
    const before = history.state;
    expect(() => history.execute(splitClips(content(history), [a, b], 3 * S, id))).toThrow(
      AppError,
    );
    expect(history.state).toBe(before);
  });
});

describe('timeline queries', () => {
  it('finds free space and the first place a file fits', () => {
    const history = setup();
    add(history, 'mute', 2 * S); // 2 s .. 12 s on V1
    const c = content(history);
    expect(isFree(c, 'V1', 0, 2 * S)).toBe(true);
    expect(isFree(c, 'V1', 0, 2 * S + 1)).toBe(false);
    expect(isFree(c, 'V1', 12 * S, 5 * S)).toBe(true);
    expect(isFree(c, 'V1', -1, 5)).toBe(false);
    expect(firstFreeStart(c, 'V1', 0, 1 * S)).toBe(0);
    expect(firstFreeStart(c, 'V1', 0, 3 * S)).toBe(12 * S);
    expect(firstFreeStart(c, 'V1', 5 * S, 1 * S)).toBe(12 * S);
    expect(firstFreeStart(c, 'A1', 0, 99 * S)).toBe(0);
  });

  it('expands a selection to include linked clips once', () => {
    const history = setup();
    const a = add(history, 'vid', 0);
    const c = content(history);
    const expanded = expandLinked(c, [a, a]);
    expect(expanded.map((clip) => clip.trackId).sort()).toEqual(['A1', 'V1']);
    expect(expandLinked(c, ['missing'])).toEqual([]);
  });
});
