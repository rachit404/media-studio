import { describe, expect, it } from 'vitest';
import { History } from './history';
import {
  ease,
  isAnimated,
  joinKeyframes,
  keyframeAt,
  keyframesAfterStartMoved,
  scaleKeyframes,
  valueAt,
  type Keyframe,
} from './keyframes';
import { addAssets, createProject, parseProjectFile, CURRENT_FORMAT_VERSION } from './project';
import type { NewAsset, ProjectDocument } from './project';
import {
  addMediaToTimeline,
  clearKeyframes,
  joinClips,
  moveKeyframe,
  moveKeyframesAt,
  removeKeyframe,
  setClipLook,
  setClipSpeed,
  setKeyframe,
  setTrackState,
  setValuesAt,
  splitClip,
  trimClip,
} from './video-commands';
import {
  clipGainAt,
  clipOpacityAt,
  clipTransformAt,
  videoContentSchema,
  type VideoContent,
} from './video-document';

const S = 1_000_000;
const frame = (time: number, value: number, easing: Keyframe['easing'] = 'linear'): Keyframe => ({
  time,
  value,
  easing,
});

describe('interpolation', () => {
  it('gives the fixed value without keyframes, and the first and last value outside them', () => {
    expect(valueAt(undefined, 5 * S, 0.7)).toBe(0.7);
    expect(valueAt([], 5 * S, 0.7)).toBe(0.7);
    const frames = [frame(S, 10), frame(3 * S, 20)];
    expect(valueAt(frames, 0, 0)).toBe(10);
    expect(valueAt(frames, S, 0)).toBe(10);
    expect(valueAt(frames, 3 * S, 0)).toBe(20);
    expect(valueAt(frames, 9 * S, 0)).toBe(20);
  });

  it('moves in a straight line between keyframes, through several of them', () => {
    const frames = [frame(0, 0), frame(2 * S, 10), frame(4 * S, 0)];
    expect(valueAt(frames, S, 0)).toBeCloseTo(5);
    expect(valueAt(frames, 2 * S, 0)).toBe(10);
    expect(valueAt(frames, 3 * S, 0)).toBeCloseTo(5);
  });

  it('holds a value until the next keyframe, then jumps', () => {
    const frames = [frame(0, 1, 'hold'), frame(2 * S, 5)];
    expect(valueAt(frames, 2 * S - 1, 0)).toBe(1);
    expect(valueAt(frames, 2 * S, 0)).toBe(5);
  });

  it('eases: starts and ends at the keyframe values, and is slower or faster in between', () => {
    for (const easing of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
      expect(ease(easing, 0)).toBe(0);
      expect(ease(easing, 1)).toBe(1);
      expect(ease(easing, -3)).toBe(0); // limited to 0..1
      expect(ease(easing, 4)).toBe(1);
    }
    expect(ease('ease-in', 0.5)).toBeLessThan(0.5);
    expect(ease('ease-out', 0.5)).toBeGreaterThan(0.5);
    expect(ease('ease-in-out', 0.5)).toBeCloseTo(0.5);
    expect(ease('hold', 0.99)).toBe(0);
    // Never goes backwards.
    for (const easing of ['ease-in', 'ease-out', 'ease-in-out'] as const) {
      let last = 0;
      for (let t = 0; t <= 1; t += 0.05) {
        const value = ease(easing, t);
        expect(value).toBeGreaterThanOrEqual(last - 1e-12);
        last = value;
      }
    }
  });

  it('uses the easing of the keyframe a segment starts at', () => {
    const frames = [frame(0, 0, 'ease-in'), frame(2 * S, 10, 'linear'), frame(4 * S, 0)];
    expect(valueAt(frames, S, 0)).toBeCloseTo(2.5); // ease-in at 0.5 is 0.25
    expect(valueAt(frames, 3 * S, 0)).toBeCloseTo(5); // linear
  });

  it('finds a keyframe by exact time and tells whether a property is animated', () => {
    const clip = { keyframes: { x: [frame(S, 0.1)] } };
    expect(keyframeAt(clip, 'x', S)?.value).toBe(0.1);
    expect(keyframeAt(clip, 'x', S + 1)).toBeUndefined();
    expect(isAnimated(clip, 'x')).toBe(true);
    expect(isAnimated(clip, 'y')).toBe(false);
    expect(isAnimated({}, 'x')).toBe(false);
  });
});

describe('keyframes when a clip is cut', () => {
  const keyframes = { x: [frame(S, 0), frame(3 * S, 1), frame(5 * S, 0)] };

  it('moving the start later keeps the animation where it was on the timeline', () => {
    // 2 s cut off the start: at the new start x is 0.5, then it carries on to 1 at 1 s and 0 at 3 s.
    expect(keyframesAfterStartMoved(keyframes, 2 * S)).toEqual({
      x: [frame(0, 0.5), frame(S, 1), frame(3 * S, 0)],
    });
    // Exactly on a keyframe: nothing extra is needed.
    expect(keyframesAfterStartMoved(keyframes, 3 * S)?.x).toEqual([frame(0, 1), frame(2 * S, 0)]);
    // Past the last keyframe: the animation is over, so the property is held at its last value.
    expect(keyframesAfterStartMoved(keyframes, 9 * S)?.x).toEqual([frame(0, 0)]);
  });

  it('moving the start earlier shifts everything later', () => {
    expect(keyframesAfterStartMoved(keyframes, -S)?.x?.map((f) => f.time)).toEqual([
      2 * S,
      4 * S,
      6 * S,
    ]);
  });

  it('scales with the length when the speed changes', () => {
    expect(scaleKeyframes(keyframes, 0.5)?.x?.map((f) => f.time)).toEqual([
      0.5 * S,
      1.5 * S,
      2.5 * S,
    ]);
    // Two keyframes that land on the same time become one.
    expect(scaleKeyframes({ x: [frame(1, 0), frame(2, 1)] }, 0.1)?.x).toHaveLength(1);
  });

  it('joins two halves, dropping what is beyond the first and letting the second win at the seam', () => {
    const left = { x: [frame(0, 0), frame(2 * S, 1)] };
    const right = { x: [frame(0, 1), frame(S, 0)] };
    expect(joinKeyframes(left, right, 2 * S)?.keyframes).toEqual({
      x: [frame(0, 0), frame(2 * S, 1), frame(3 * S, 0)],
    });
    expect(joinKeyframes(undefined, undefined, S)).toEqual({ keyframes: undefined });
    // Animated differently: refused.
    expect(joinKeyframes(left, undefined, S)).toBeNull();
    expect(joinKeyframes(left, { y: [frame(0, 0)] }, S)).toBeNull();
  });
});

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
  audio: { sampleRate: 44_100, channels: 2, codec: 'mp4a.40.2' },
  file: 'media/vid.mp4',
  thumb: 'thumbs/vid.png',
  peaks: 'peaks/vid.bin',
};

/** A 10 s picture clip `pic` with its sound `snd`. */
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
      duration: 10 * S,
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
const clipOf = (history: History<ProjectDocument>, id: string) => {
  const clip = content(history).clips[id];
  if (!clip) throw new Error(id);
  return clip;
};

describe('keyframe commands', () => {
  it('animates position and opacity, and the values are read at any time', () => {
    const history = setup();
    history.execute(setKeyframe('pic', 'x', 0, -0.5));
    history.execute(setKeyframe('pic', 'x', 4 * S, 0.5));
    history.execute(setKeyframe('pic', 'opacity', 0, 0));
    history.execute(setKeyframe('pic', 'opacity', 2 * S, 1));
    const clip = clipOf(history, 'pic');
    expect(clipTransformAt(clip, 2 * S).x).toBeCloseTo(0);
    expect(clipTransformAt(clip, 8 * S).x).toBe(0.5);
    expect(clipTransformAt(clip, 0).y).toBe(0); // not animated: the fixed value
    expect(clipOpacityAt(clip, S)).toBeCloseTo(0.5);
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);
    history.undo();
    expect(clipOf(history, 'pic').keyframes?.opacity).toHaveLength(1);
  });

  it('animates the volume of a sound clip and the gain follows it, with fades on top', () => {
    const history = setup();
    history.execute(setKeyframe('snd', 'volume', 0, 0));
    history.execute(setKeyframe('snd', 'volume', 4 * S, 2));
    const clip = clipOf(history, 'snd');
    expect(clipGainAt(clip, 2 * S)).toBeCloseTo(1);
    expect(clipGainAt(clip, 6 * S)).toBe(2);
    history.execute(setClipLook(['snd'], { fadeOut: 2 * S }));
    expect(clipGainAt(clipOf(history, 'snd'), 9 * S)).toBeCloseTo(1); // 2 x the half way down the fade
  });

  it('changes the value and the easing of an existing keyframe, and merges drags into one undo step', () => {
    const history = setup();
    history.execute(setKeyframe('pic', 'scale', S, 1));
    history.execute(setKeyframe('pic', 'scale', S, 1.5));
    history.execute(setKeyframe('pic', 'scale', S, 2));
    expect(clipOf(history, 'pic').keyframes?.scale).toEqual([frame(S, 2)]);
    history.execute(setKeyframe('pic', 'scale', S, 2, 'hold'));
    expect(clipOf(history, 'pic').keyframes?.scale?.[0]?.easing).toBe('hold');
    history.execute(setKeyframe('pic', 'scale', S, 3)); // easing is kept when not given
    expect(clipOf(history, 'pic').keyframes?.scale?.[0]).toMatchObject({
      value: 3,
      easing: 'hold',
    });
  });

  it('refuses values out of range, times outside the clip, the wrong kind of clip and a locked track', () => {
    const history = setup();
    expect(() => history.execute(setKeyframe('pic', 'opacity', 0, 1.5))).toThrow();
    expect(() => history.execute(setKeyframe('pic', 'scale', 0, 0))).toThrow();
    expect(() => history.execute(setKeyframe('pic', 'x', -1, 0))).toThrow(/inside the clip/i);
    expect(() => history.execute(setKeyframe('pic', 'x', 11 * S, 0))).toThrow(/inside the clip/i);
    expect(() => history.execute(setKeyframe('pic', 'x', 0.5, 0))).toThrow();
    expect(() => history.execute(setKeyframe('pic', 'volume', 0, 1))).toThrow(/sound clips/i);
    expect(() => history.execute(setKeyframe('snd', 'x', 0, 0))).toThrow(/picture and text/i);
    expect(() => history.execute(setKeyframe('snd', 'volume', 0, 9))).toThrow();
    expect(() => history.execute(setKeyframe('nope', 'x', 0, 0))).toThrow();
    history.execute(setTrackState('V1', { locked: true }));
    expect(() => history.execute(setKeyframe('pic', 'x', 0, 0))).toThrow(/locked/i);
    expect(clipOf(history, 'pic').keyframes).toBeUndefined();
  });

  it('removes a keyframe; removing the last leaves the property fixed at its value', () => {
    const history = setup();
    history.execute(setKeyframe('pic', 'rotation', 0, 10));
    history.execute(setKeyframe('pic', 'rotation', 2 * S, 90));
    history.execute(removeKeyframe('pic', 'rotation', 0));
    expect(clipOf(history, 'pic').keyframes?.rotation).toEqual([frame(2 * S, 90)]);
    history.execute(removeKeyframe('pic', 'rotation', 2 * S));
    const clip = clipOf(history, 'pic');
    expect(clip.keyframes).toBeUndefined();
    expect(clip.transform?.rotation).toBe(90);
    expect(() => history.execute(removeKeyframe('pic', 'rotation', 2 * S))).toThrow(/no keyframe/i);
    history.undo();
    expect(clipOf(history, 'pic').keyframes?.rotation).toEqual([frame(2 * S, 90)]);
  });

  it('moves a keyframe but not onto another one or out of the clip', () => {
    const history = setup();
    history.execute(setKeyframe('pic', 'y', S, 0.1));
    history.execute(setKeyframe('pic', 'y', 5 * S, 0.9));
    history.execute(moveKeyframe('pic', 'y', S, 7 * S));
    expect(clipOf(history, 'pic').keyframes?.y?.map((f) => f.time)).toEqual([5 * S, 7 * S]);
    expect(() => history.execute(moveKeyframe('pic', 'y', 5 * S, 7 * S))).toThrow(/already/i);
    expect(() => history.execute(moveKeyframe('pic', 'y', 5 * S, 11 * S))).toThrow();
    expect(() => history.execute(moveKeyframe('pic', 'y', 2 * S, 3 * S))).toThrow(/no keyframe/i);
  });

  it('clears the animation of a property, keeping its first value', () => {
    const history = setup();
    history.execute(setKeyframe('snd', 'volume', 0, 0.25));
    history.execute(setKeyframe('snd', 'volume', 3 * S, 1));
    history.execute(clearKeyframes('snd', 'volume'));
    const clip = clipOf(history, 'snd');
    expect(clip.keyframes).toBeUndefined();
    expect(clip.volume).toBe(0.25);
    expect(() => history.execute(clearKeyframes('snd', 'volume'))).toThrow(/not animated/i);
  });

  it('keeps at most 200 keyframes on a property', () => {
    const history = setup();
    for (let i = 0; i < 200; i += 1) history.execute(setKeyframe('pic', 'x', i * 1000, 0));
    expect(() => history.execute(setKeyframe('pic', 'x', 5 * S, 0))).toThrow(/up to 200/);
    history.execute(setKeyframe('pic', 'x', 5000, 1)); // changing one is still fine
  });
});

describe('keyframes through editing', () => {
  function animated() {
    const history = setup();
    history.execute(setKeyframe('pic', 'x', 2 * S, 0));
    history.execute(setKeyframe('pic', 'x', 6 * S, 1));
    return history;
  }

  it('trimming the start keeps the animation in place on the timeline', () => {
    const history = animated();
    history.execute(trimClip('pic', 'start', 4 * S)); // x is 0.5 at 4 s
    const clip = clipOf(history, 'pic');
    expect(clip.start).toBe(4 * S);
    expect(clipTransformAt(clip, 0).x).toBeCloseTo(0.5);
    expect(clipTransformAt(clip, 2 * S).x).toBe(1); // 6 s on the timeline
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);
  });

  it('trimming the end leaves the animation and brings it back when extended again', () => {
    const history = animated();
    history.execute(trimClip('pic', 'end', 4 * S));
    expect(clipTransformAt(clipOf(history, 'pic'), 4 * S).x).toBeCloseTo(0.5);
    history.execute(trimClip('pic', 'end', 10 * S));
    expect(clipTransformAt(clipOf(history, 'pic'), 6 * S).x).toBe(1);
  });

  it('splitting gives both halves the same animation, and joining them gives it back', () => {
    const history = animated();
    let n = 0;
    history.execute(splitClip(content(history), 'pic', 4 * S, () => `s${String(n++)}`));
    const right = Object.values(content(history).clips).find(
      (clip) => clip.trackId === 'V1' && clip.start === 4 * S,
    );
    if (!right) throw new Error('right half');
    const left = clipOf(history, 'pic');
    for (const time of [0, S, 1.9 * S]) {
      expect(clipTransformAt(left, time).x).toBeCloseTo(time < 2 * S ? 0 : 0); // 0 until the animation starts
    }
    expect(clipTransformAt(left, 3.9 * S).x).toBeCloseTo(0.475);
    expect(clipTransformAt(right, 0).x).toBeCloseTo(0.5);
    expect(clipTransformAt(right, 2 * S).x).toBe(1);
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);

    history.execute(joinClips('pic'));
    const joined = clipOf(history, 'pic');
    expect(clipTransformAt(joined, 4 * S).x).toBeCloseTo(0.5);
    expect(clipTransformAt(joined, 8 * S).x).toBe(1);
    expect(videoContentSchema.safeParse(content(history)).success).toBe(true);
  });

  it('refuses to join clips animated differently', () => {
    const history = animated();
    let n = 0;
    history.execute(splitClip(content(history), 'pic', 4 * S, () => `s${String(n++)}`));
    const right = Object.values(content(history).clips).find(
      (clip) => clip.trackId === 'V1' && clip.start === 4 * S,
    );
    if (!right) throw new Error('right half');
    history.execute(clearKeyframes(right.id, 'x'));
    expect(() => history.execute(joinClips('pic'))).toThrow(/animated differently/i);
  });

  it('stretches with a speed change', () => {
    const history = animated();
    history.execute(setClipSpeed('pic', 2)); // 10 s becomes 5 s
    expect(clipOf(history, 'pic').keyframes?.x?.map((f) => f.time)).toEqual([S, 3 * S]);
  });
});

describe('keyframes in files', () => {
  it('saves at the current format version, and a v10 file still opens', () => {
    const history = setup();
    history.execute(setKeyframe('pic', 'opacity', 0, 0));
    history.execute(setKeyframe('pic', 'opacity', S, 1, 'ease-out'));
    const file = {
      format: 'media-studio-project',
      formatVersion: CURRENT_FORMAT_VERSION,
      appVersion: 'test',
      modifiedAt: '2026-11-18T10:00:00.000Z',
      journalSeq: 0,
      project: history.state,
    };
    expect(parseProjectFile(file).file.project.content).toEqual(history.state.content);
    const v10 = { ...file, formatVersion: 10, project: setup().state };
    expect(parseProjectFile(v10).migratedFrom).toBe(10);
  });

  it('is rejected by the schema when out of order, out of range, or on the wrong kind of clip', () => {
    const history = setup();
    history.execute(setKeyframe('pic', 'x', 0, 0));
    history.execute(setKeyframe('pic', 'x', S, 1));
    const good = content(history);
    const withKeyframes = (clipId: string, keyframes: object): VideoContent => ({
      ...good,
      clips: { ...good.clips, [clipId]: { ...clipOf(history, clipId), keyframes } },
    });
    expect(videoContentSchema.safeParse(good).success).toBe(true);
    expect(
      videoContentSchema.safeParse(withKeyframes('pic', { x: [frame(S, 0), frame(0, 1)] })).success,
    ).toBe(false);
    expect(
      videoContentSchema.safeParse(withKeyframes('pic', { x: [frame(0, 0), frame(0, 1)] })).success,
    ).toBe(false);
    expect(
      videoContentSchema.safeParse(withKeyframes('pic', { opacity: [frame(0, 2)] })).success,
    ).toBe(false);
    expect(
      videoContentSchema.safeParse(withKeyframes('pic', { volume: [frame(0, 1)] })).success,
    ).toBe(false);
    expect(videoContentSchema.safeParse(withKeyframes('snd', { x: [frame(0, 0)] })).success).toBe(
      false,
    );
    expect(videoContentSchema.safeParse(withKeyframes('pic', { x: [] })).success).toBe(false);
  });
});

describe('changing values at a moment of the clip', () => {
  it('writes keyframes for animated properties and fixed values for the others, in one undo step', () => {
    const history = setup();
    history.execute(setKeyframe('pic', 'x', 0, 0));
    history.execute(setKeyframe('pic', 'x', 4 * S, 1));
    history.execute(setValuesAt('pic', 2 * S, { x: 0.25, y: 0.1, scale: 2 }));
    const clip = clipOf(history, 'pic');
    expect(clip.keyframes?.x?.map((f) => [f.time, f.value])).toEqual([
      [0, 0],
      [2 * S, 0.25],
      [4 * S, 1],
    ]);
    expect(clip.keyframes?.y).toBeUndefined();
    expect(clip.transform).toMatchObject({ y: 0.1, scale: 2 });
    history.undo();
    const undone = clipOf(history, 'pic');
    expect(undone.keyframes?.x).toHaveLength(2);
    expect(undone.transform).toBeUndefined();
  });

  it('merges a drag into one undo step, keeps the easing, and refuses bad values', () => {
    const history = setup();
    history.execute(setKeyframe('pic', 'opacity', S, 1, 'ease-out'));
    for (const value of [0.9, 0.8, 0.7]) history.execute(setValuesAt('pic', S, { opacity: value }));
    expect(clipOf(history, 'pic').keyframes?.opacity).toEqual([frame(S, 0.7, 'ease-out')]);
    history.undo();
    expect(clipOf(history, 'pic').keyframes?.opacity).toEqual([frame(S, 1, 'ease-out')]);
    expect(() => history.execute(setValuesAt('pic', S, { opacity: 2 }))).toThrow();
    expect(() => history.execute(setValuesAt('pic', S, { volume: 1 }))).toThrow(/sound clips/i);
    history.execute(setKeyframe('pic', 'x', 0, 0));
    expect(() => history.execute(setValuesAt('pic', 11 * S, { x: 0.5 }))).toThrow(
      /inside the clip/i,
    );
  });
});

describe('moving the keyframes at one time together (F4)', () => {
  it('moves the keyframes of every property at that time in one undo step', () => {
    const history = setup();
    history.execute(setKeyframe('pic', 'x', 2 * S, 0.5));
    history.execute(setKeyframe('pic', 'opacity', 2 * S, 0.4));
    history.execute(setKeyframe('pic', 'x', 6 * S, 1));
    history.execute(moveKeyframesAt('pic', 2 * S, 3 * S));
    const clip = clipOf(history, 'pic');
    expect(clip.keyframes?.x?.map((f) => f.time)).toEqual([3 * S, 6 * S]);
    expect(clip.keyframes?.opacity?.map((f) => f.time)).toEqual([3 * S]);
    history.undo();
    expect(clipOf(history, 'pic').keyframes?.x?.map((f) => f.time)).toEqual([2 * S, 6 * S]);
    expect(clipOf(history, 'pic').keyframes?.opacity?.map((f) => f.time)).toEqual([2 * S]);
  });

  it('merges a drag into one undo step and keeps values and easings', () => {
    const history = setup();
    history.execute(setKeyframe('pic', 'scale', S, 2, 'ease-in'));
    for (const to of [1.1 * S, 1.2 * S, 1.3 * S])
      history.execute(moveKeyframesAt('pic', to - 0.1 * S, to));
    expect(clipOf(history, 'pic').keyframes?.scale).toEqual([frame(1.3 * S, 2, 'ease-in')]);
    history.undo();
    expect(clipOf(history, 'pic').keyframes?.scale).toEqual([frame(S, 2, 'ease-in')]);
  });

  it('can pass other keyframes of other properties, but never land on one of the same property', () => {
    const history = setup();
    history.execute(setKeyframe('pic', 'x', S, 0));
    history.execute(setKeyframe('pic', 'x', 2 * S, 1));
    history.execute(setKeyframe('pic', 'opacity', S, 1));
    history.execute(moveKeyframesAt('pic', S, 3 * S)); // x passes its own 2 s keyframe? no: x lands after it
    expect(clipOf(history, 'pic').keyframes?.x?.map((f) => f.time)).toEqual([2 * S, 3 * S]);
    expect(() => history.execute(moveKeyframesAt('pic', 3 * S, 2 * S))).toThrow(/already/i);
  });

  it('refuses a time outside the clip, a time with nothing to move, and a locked track', () => {
    const history = setup();
    history.execute(setKeyframe('pic', 'x', S, 0));
    expect(() => history.execute(moveKeyframesAt('pic', S, 11 * S))).toThrow(/inside the clip/i);
    expect(() => history.execute(moveKeyframesAt('pic', S, -1))).toThrow();
    expect(() => history.execute(moveKeyframesAt('pic', 5 * S, 6 * S))).toThrow(/no keyframe/i);
    expect(() => history.execute(moveKeyframesAt('nope', S, 2 * S))).toThrow();
    history.execute(moveKeyframesAt('pic', S, S)); // to the same place: nothing happens
    history.execute(setTrackState('V1', { locked: true }));
    expect(() => history.execute(moveKeyframesAt('pic', S, 2 * S))).toThrow(/locked/i);
  });
});
