import { describe, expect, it } from 'vitest';
import { History } from './history';
import { addAssets, createProject, parseProjectFile, CURRENT_FORMAT_VERSION } from './project';
import type { NewAsset, ProjectDocument } from './project';
import {
  addMediaToTimeline,
  addTextClip,
  joinClips,
  moveClips,
  setClipSpeed,
  setTrackState,
  splitClip,
  trimClip,
} from './video-commands';
import {
  clipSourceAt,
  clipSpeed,
  sourceSpan,
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

/** A picture clip with its sound at 0 (10 s of the file unless told otherwise), and a 2 s clip at 30 s. */
function setup(options: { duration?: number; sourceIn?: number } = {}) {
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
      ...options,
    }),
  );
  history.execute(
    addMediaToTimeline({
      assetId: 'vid',
      start: 30 * S,
      clipId: 'pic2',
      audioClipId: 'snd2',
      linkId: 'lk2',
      duration: 2 * S,
    }),
  );
  return history;
}
function content(history: History<ProjectDocument>): VideoContent {
  if (history.state.content.kind !== 'video') throw new Error('video');
  return history.state.content;
}
const clipOf = (history: History<ProjectDocument>, id: string) => {
  const clip = content(history).clips[id];
  if (!clip) throw new Error(id);
  return clip;
};

describe('clip speed', () => {
  it('defaults to 1 and maps timeline time to file time', () => {
    expect(clipSpeed(clipOf(setup(), 'pic'))).toBe(1);
    expect(clipSourceAt({ sourceIn: 3 * S }, 2 * S)).toBe(5 * S);
    expect(clipSourceAt({ sourceIn: 3 * S, speed: 2 }, 2 * S)).toBe(7 * S);
    expect(clipSourceAt({ sourceIn: 0, speed: 0.5 }, 3 * S)).toBe(1.5 * S);
    expect(sourceSpan(S, 0.25)).toBe(250_000);
  });

  it('faster makes the clip shorter and slower makes it longer, picture and sound together', () => {
    const history = setup({ duration: 8 * S });
    history.execute(setClipSpeed('pic', 2));
    expect(clipOf(history, 'pic')).toMatchObject({ speed: 2, duration: 4 * S, sourceIn: 0 });
    expect(clipOf(history, 'snd')).toMatchObject({ speed: 2, duration: 4 * S });
    history.execute(setClipSpeed('pic', 0.5));
    expect(clipOf(history, 'pic')).toMatchObject({ speed: 0.5, duration: 16 * S });
    expect(clipOf(history, 'snd')).toMatchObject({ speed: 0.5, duration: 16 * S });
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);
  });

  it('keeps the stretch of the file: the same part plays, only faster or slower', () => {
    const history = setup({ duration: 8 * S, sourceIn: 1 * S });
    history.execute(setClipSpeed('pic', 4));
    const clip = clipOf(history, 'pic');
    expect(clip.duration).toBe(2 * S);
    expect(clipSourceAt(clip, clip.duration)).toBe(9 * S); // 1 s + 8 s of file
  });

  it('removes the setting at speed 1, and repeated edits are one undo step', () => {
    const history = setup({ duration: 8 * S });
    history.execute(setClipSpeed('pic', 2));
    history.execute(setClipSpeed('pic', 1));
    expect(clipOf(history, 'pic').speed).toBeUndefined();
    expect(clipOf(history, 'pic').duration).toBe(8 * S);
    history.undo();
    expect(clipOf(history, 'pic').speed).toBeUndefined();
    expect(clipOf(history, 'pic').duration).toBe(8 * S);
    expect(clipOf(history, 'snd').duration).toBe(8 * S);
  });

  it('refuses speeds outside 0.25 to 4, text clips, locked tracks and a clip that would hit the next one', () => {
    const history = setup({ duration: 8 * S });
    for (const speed of [0, 0.2, 4.1, Number.NaN, -1]) {
      expect(() => history.execute(setClipSpeed('pic', speed))).toThrow();
    }
    history.execute(
      addTextClip({
        clipId: 't',
        newTrackId: 'V2',
        start: 0,
        duration: S,
        text: {
          text: 'x',
          fontFamily: 'sans-serif',
          fontSize: 20,
          fontWeight: 400,
          color: '#ffffff',
          align: 'center',
          lineHeight: 1.2,
          letterSpacing: 0,
        },
      }),
    );
    expect(() => history.execute(setClipSpeed('t', 2))).toThrow(/text/i);
    // pic2 starts at 30 s: at 0.25 times the 8 s clip would last 32 s and run into it.
    expect(() => history.execute(setClipSpeed('pic', 0.25))).toThrow(/no room/i);
    expect(clipOf(history, 'pic').duration).toBe(8 * S);
    history.execute(setTrackState('V1', { locked: true }));
    expect(() => history.execute(setClipSpeed('pic', 2))).toThrow(/locked/i);
  });

  it('never uses more of the file than there is, whatever the rounding', () => {
    const history = setup({ duration: 10 * S }); // the whole 10 s file
    history.execute(setClipSpeed('pic', 3)); // 3.333333 s
    const clip = clipOf(history, 'pic');
    expect(clip.sourceIn + sourceSpan(clip.duration, 3)).toBeLessThanOrEqual(10 * S);
    expect(clip.duration).toBeGreaterThanOrEqual(3_333_333);
  });

  it('trims by timeline time and moves the file by speed times that', () => {
    const history = setup({ duration: 8 * S });
    history.execute(setClipSpeed('pic', 2)); // 4 s on the timeline, 8 s of file
    history.execute(trimClip('pic', 'start', 1 * S));
    expect(clipOf(history, 'pic')).toMatchObject({ start: S, duration: 3 * S, sourceIn: 2 * S });
    history.execute(trimClip('pic', 'end', 3 * S)); // 2 s on the timeline = 4 s of file
    expect(clipOf(history, 'pic')).toMatchObject({ duration: 2 * S, sourceIn: 2 * S });
    // 2 s in, so 8 s of file are left: 4 s on the timeline, which makes the clip end at 5 s at the latest.
    history.execute(trimClip('pic', 'end', 5 * S));
    expect(() => history.execute(trimClip('pic', 'end', 5 * S + 1000))).toThrow();
  });

  it('cannot be trimmed longer than the file allows at a slow speed', () => {
    const history = setup({ duration: 4 * S, sourceIn: 6 * S });
    history.execute(setClipSpeed('pic', 0.5)); // 8 s on the timeline, still 4 s of file
    expect(clipOf(history, 'pic').duration).toBe(8 * S);
    expect(() => history.execute(trimClip('pic', 'end', 8 * S + 100_000))).toThrow();
  });

  it('splits at a timeline time, with the right half starting at the matching place in the file', () => {
    const history = setup({ duration: 8 * S });
    history.execute(setClipSpeed('pic', 2)); // 4 s long
    let n = 0;
    history.execute(splitClip(content(history), 'pic', 1 * S, () => `s${String(n++)}`));
    const right = Object.values(content(history).clips).find(
      (clip) => clip.trackId === 'V1' && clip.start === S,
    );
    expect(right).toMatchObject({ speed: 2, sourceIn: 2 * S, duration: 3 * S });
    expect(clipOf(history, 'pic')).toMatchObject({ speed: 2, duration: S });
  });

  it('joins two halves again, but not halves of different speeds', () => {
    const history = setup({ duration: 8 * S });
    history.execute(setClipSpeed('pic', 2));
    let n = 0;
    history.execute(splitClip(content(history), 'pic', 1 * S, () => `s${String(n++)}`));
    history.execute(joinClips('pic'));
    expect(clipOf(history, 'pic')).toMatchObject({ speed: 2, duration: 4 * S, sourceIn: 0 });

    history.execute(splitClip(content(history), 'pic', 1 * S, () => `t${String(n++)}`));
    const right = Object.values(content(history).clips).find(
      (clip) => clip.trackId === 'V1' && clip.start === S,
    );
    if (!right) throw new Error('right half');
    history.execute(setClipSpeed(right.id, 1));
    expect(() => history.execute(joinClips('pic'))).toThrow();
  });

  it('moves like any other clip', () => {
    const history = setup({ duration: 8 * S });
    history.execute(setClipSpeed('pic', 2));
    history.execute(moveClips('pic', 5 * S));
    expect(clipOf(history, 'pic')).toMatchObject({ start: 5 * S, speed: 2 });
  });

  it('saves at the current format version, and a v8 file still opens', () => {
    const history = setup({ duration: 8 * S });
    history.execute(setClipSpeed('pic', 1.5));
    const file = {
      format: 'media-studio-project',
      formatVersion: CURRENT_FORMAT_VERSION,
      appVersion: 'test',
      modifiedAt: '2026-11-18T10:00:00.000Z',
      journalSeq: 0,
      project: history.state,
    };
    expect(parseProjectFile(file).file.project.content).toEqual(history.state.content);
    const v8 = { ...file, formatVersion: 8, project: setup().state };
    expect(parseProjectFile(v8).migratedFrom).toBe(8);
  });
});
