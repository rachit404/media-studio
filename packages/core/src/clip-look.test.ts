import { describe, expect, it } from 'vitest';
import { History } from './history';
import { addAssets, createProject, parseProjectFile, CURRENT_FORMAT_VERSION } from './project';
import type { NewAsset, ProjectDocument } from './project';
import { addMediaToTimeline, setClipLook, setTrackState, splitClip } from './video-commands';
import {
  IDENTITY_TRANSFORM,
  clipColour,
  clipGainAt,
  clipOpacity,
  clipTransform,
  videoContentSchema,
  type VideoContent,
} from './video-document';

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

function setup() {
  const history = new History(
    createProject({ id: 'p', name: 'V', type: 'video', createdAt: '2026-11-18T10:00:00.000Z' }),
    { autoFreeze: true },
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
  return history;
}

function content(history: History<ProjectDocument>): VideoContent {
  if (history.state.content.kind !== 'video') throw new Error('video');
  return history.state.content;
}

describe('clip look', () => {
  it('reads defaults for a clip that has no look', () => {
    const clip = content(setup()).clips['pic'];
    if (!clip) throw new Error('clip');
    expect(clipTransform(clip)).toEqual(IDENTITY_TRANSFORM);
    expect(clipOpacity(clip)).toBe(1);
    expect(clipColour(clip)).toEqual({ brightness: 0, contrast: 0, saturation: 0, temperature: 0 });
  });

  it('sets and resets properties, and undo restores them exactly', () => {
    const history = setup();
    const transform = { ...IDENTITY_TRANSFORM, x: 0.25, scale: 0.5, rotation: 15 };
    history.execute(setClipLook(['pic'], { transform, opacity: 0.4 }));
    expect(content(history).clips['pic']).toMatchObject({ transform, opacity: 0.4 });
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);

    history.execute(setClipLook(['pic'], { opacity: null }));
    expect(content(history).clips['pic']?.opacity).toBeUndefined();
    expect(content(history).clips['pic']?.transform).toEqual(transform);

    history.undo();
    expect(content(history).clips['pic']?.opacity).toBe(0.4);
    history.undo();
    expect(content(history).clips['pic']?.transform).toBeUndefined();
  });

  it('merges repeated edits of the same property into one undo step', () => {
    const history = setup();
    for (const opacity of [0.9, 0.8, 0.7]) history.execute(setClipLook(['pic'], { opacity }));
    expect(content(history).clips['pic']?.opacity).toBe(0.7);
    history.undo();
    expect(content(history).clips['pic']?.opacity).toBeUndefined();
  });

  it('refuses values outside the allowed range and leaves the clip alone', () => {
    const history = setup();
    expect(() => history.execute(setClipLook(['pic'], { opacity: 1.5 }))).toThrow();
    expect(() => history.execute(setClipLook(['snd'], { volume: 9 }))).toThrow();
    expect(() => history.execute(setClipLook(['pic'], { fadeIn: -1 }))).toThrow();
    expect(content(history).clips['pic']?.opacity).toBeUndefined();
  });

  it('refuses edits on a locked track', () => {
    const history = setup();
    history.execute(setTrackState('V1', { locked: true }));
    expect(() => history.execute(setClipLook(['pic'], { opacity: 0.5 }))).toThrow(/locked/i);
  });

  it('changes only the clips named (picture and sound of one file are separate)', () => {
    const history = setup();
    history.execute(setClipLook(['snd'], { volume: 0.5 }));
    expect(content(history).clips['snd']?.volume).toBe(0.5);
    expect(content(history).clips['pic']?.volume).toBeUndefined();
  });

  it('keeps the look through a split, with the fade in on the left and the fade out on the right', () => {
    const history = setup();
    history.execute(setClipLook(['snd'], { volume: 0.5, fadeIn: S, fadeOut: 2 * S }));
    let n = 0;
    history.execute(splitClip(content(history), 'snd', 4 * S, () => `s${String(n++)}`));
    const left = content(history).clips['snd'];
    const right = Object.values(content(history).clips).find(
      (clip) => clip.trackId === 'A1' && clip.start === 4 * S,
    );
    expect(left).toMatchObject({ volume: 0.5, fadeIn: S });
    expect(left?.fadeOut).toBeUndefined();
    expect(right).toMatchObject({ volume: 0.5, fadeOut: 2 * S });
    expect(right?.fadeIn).toBeUndefined();
  });

  it('tracks get a volume and a solo flag; defaults are stored as absent', () => {
    const history = setup();
    history.execute(setTrackState('A1', { volume: 0.5, solo: true }));
    expect(content(history).tracks.byId['A1']).toMatchObject({ volume: 0.5, solo: true });
    history.execute(setTrackState('A1', { volume: 1, solo: false }));
    const track = content(history).tracks.byId['A1'];
    expect(track?.volume).toBeUndefined();
    expect(track?.solo).toBeUndefined();
    expect(() => history.execute(setTrackState('A1', { volume: -1 }))).toThrow();
  });

  it('saves and loads at the current format version, and a v5 file still opens', () => {
    const history = setup();
    history.execute(setClipLook(['pic'], { opacity: 0.5 }));
    const file = {
      format: 'media-studio-project',
      formatVersion: CURRENT_FORMAT_VERSION,
      appVersion: 'test',
      modifiedAt: '2026-11-18T10:00:00.000Z',
      journalSeq: 0,
      project: history.state,
    };
    expect(parseProjectFile(file).file.project.content).toEqual(history.state.content);

    const v5 = { ...file, formatVersion: 5, project: setup().state };
    expect(parseProjectFile(v5).migratedFrom).toBe(5);
  });
});

describe('clip gain', () => {
  const clip = { duration: 10 * S, volume: 0.8, fadeIn: 2 * S, fadeOut: 4 * S };

  it('is the volume in the middle and ramps in straight lines at both ends', () => {
    expect(clipGainAt(clip, 5 * S)).toBeCloseTo(0.8);
    expect(clipGainAt(clip, 0)).toBe(0);
    expect(clipGainAt(clip, S)).toBeCloseTo(0.4);
    expect(clipGainAt(clip, 8 * S)).toBeCloseTo(0.4);
    expect(clipGainAt(clip, 10 * S)).toBe(0);
  });

  it('is 1 for a clip with no volume or fades', () => {
    expect(clipGainAt({ duration: S }, 0)).toBe(1);
    expect(clipGainAt({ duration: S }, S / 2)).toBe(1);
  });

  it('never goes negative or above the volume, even when the fades overlap', () => {
    const overlapping = { duration: 4 * S, volume: 1, fadeIn: 4 * S, fadeOut: 4 * S };
    for (let t = 0; t <= 4 * S; t += S / 4) {
      const gain = clipGainAt(overlapping, t);
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(1);
    }
  });
});
