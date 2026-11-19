import { z } from 'zod';
import { MAX_TIME_US } from './time';

/** The clip properties that can change over time (VID-12). Position, scale, rotation and opacity are for picture and text clips, volume for sound clips. */
export const KEYFRAME_PROPERTIES = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'] as const;
export type KeyframeProperty = (typeof KEYFRAME_PROPERTIES)[number];

/** How the value moves from one keyframe to the next. `hold` keeps the value until the next keyframe, then jumps. */
export const EASINGS = ['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export type Easing = (typeof EASINGS)[number];

/** Most keyframes on one property of one clip. */
export const MAX_KEYFRAMES = 200;

export const keyframeSchema = z.strictObject({
  /** Microseconds after the start of the clip, on the timeline. */
  time: z.number().int().min(0).max(MAX_TIME_US),
  value: z.number().min(-1e9).max(1e9),
  /** The shape of the move from this keyframe to the next one. */
  easing: z.enum(EASINGS),
});
export type Keyframe = z.infer<typeof keyframeSchema>;

const track = z.array(keyframeSchema).min(1).max(MAX_KEYFRAMES).optional();

/** Per property, the keyframes in time order with one per time. A property without keyframes is absent. */
export const keyframesSchema = z.strictObject({
  x: track,
  y: track,
  scale: track,
  rotation: track,
  opacity: track,
  volume: track,
});
export type Keyframes = z.infer<typeof keyframesSchema>;

/** The shape of a move: 0..1 in, 0..1 out. */
export function ease(easing: Easing, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (easing) {
    case 'linear':
      return x;
    case 'hold':
      return 0;
    case 'ease-in':
      return x * x;
    case 'ease-out':
      return 1 - (1 - x) * (1 - x);
    case 'ease-in-out':
      return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
  }
}

/**
 * The value of an animated property `offset` microseconds into the clip. Before the first keyframe it is the first
 * value and after the last it is the last value. With no keyframes it is `fallback`, the clip's fixed value.
 */
export function valueAt(
  frames: readonly Keyframe[] | undefined,
  offset: number,
  fallback: number,
): number {
  const first = frames?.[0];
  if (!frames || !first) return fallback;
  if (offset <= first.time) return first.value;
  // The first keyframe after `offset`, by bisection (keyframes are in time order): a clip can have 200 of them.
  let low = 1;
  let high = frames.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offset < (frames[middle]?.time ?? Infinity)) high = middle;
    else low = middle + 1;
  }
  const next = frames[low];
  const previous = frames[low - 1];
  if (next && previous) {
    const progress = (offset - previous.time) / (next.time - previous.time);
    return previous.value + (next.value - previous.value) * ease(previous.easing, progress);
  }
  return frames[frames.length - 1]?.value ?? fallback;
}

/** Whether a clip has keyframes on a property. */
export function isAnimated(
  clip: { keyframes?: Keyframes | undefined },
  property: KeyframeProperty,
): boolean {
  return (clip.keyframes?.[property]?.length ?? 0) > 0;
}

/** The keyframe exactly at `offset`, if any. */
export function keyframeAt(
  clip: { keyframes?: Keyframes | undefined },
  property: KeyframeProperty,
  offset: number,
): Keyframe | undefined {
  return clip.keyframes?.[property]?.find((frame) => frame.time === offset);
}

/** Keyframes as a new list after changing the clip's length or start: `map` gives the new time of each one. */
export function remapKeyframes(
  keyframes: Keyframes | undefined,
  map: (property: KeyframeProperty, frame: Keyframe) => Keyframe | null,
): Keyframes | undefined {
  if (!keyframes) return undefined;
  const next: Keyframes = {};
  for (const property of KEYFRAME_PROPERTIES) {
    const frames = keyframes[property];
    if (!frames) continue;
    const mapped = frames
      .map((frame) => map(property, frame))
      .filter((frame): frame is Keyframe => frame !== null)
      .sort((a, b) => a.time - b.time)
      .filter((frame, index, all) => index === 0 || frame.time !== all[index - 1]?.time);
    if (mapped.length > 0) next[property] = mapped;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * The keyframes of a clip whose start moved by `delta` microseconds (later when positive): times are measured from
 * the start, so they all shift back by `delta` and the animation stays where it was on the timeline. Cutting into an
 * animation keeps the value at the new start by putting a keyframe there. Used for trimming the start and for the
 * second half of a split.
 */
export function keyframesAfterStartMoved(
  keyframes: Keyframes | undefined,
  delta: number,
): Keyframes | undefined {
  if (!keyframes || delta === 0) return keyframes;
  const next: Keyframes = {};
  for (const property of KEYFRAME_PROPERTIES) {
    const frames = keyframes[property];
    if (!frames) continue;
    const kept = frames
      .filter((frame) => frame.time >= delta)
      .map((frame) => ({ ...frame, time: frame.time - delta }));
    if (delta > 0 && kept[0]?.time !== 0) {
      // The animation started before the new start: begin with the value it had there, on the same curve.
      const before = [...frames].reverse().find((frame) => frame.time < delta);
      kept.unshift({
        time: 0,
        value: valueAt(frames, delta, 0),
        easing: before?.easing ?? 'linear',
      });
    }
    if (kept.length > 0) next[property] = kept;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/** The keyframes of a clip whose length changed by `ratio` (a speed change): every time scales with it. */
export function scaleKeyframes(
  keyframes: Keyframes | undefined,
  ratio: number,
): Keyframes | undefined {
  return remapKeyframes(keyframes, (_property, frame) => ({
    ...frame,
    time: Math.round(frame.time * ratio),
  }));
}

/**
 * The keyframes of two clips joined into one, where the first lasted `leftDuration`: the second one's times move
 * later by that much, and the first one's keyframes beyond its end are left out. Null when the clips are animated
 * on different properties (the joined clip could not be right for both).
 */
export function joinKeyframes(
  left: Keyframes | undefined,
  right: Keyframes | undefined,
  leftDuration: number,
): { keyframes: Keyframes | undefined } | null {
  for (const property of KEYFRAME_PROPERTIES) {
    if ((left?.[property] !== undefined) !== (right?.[property] !== undefined)) return null;
  }
  if (!left || !right) return { keyframes: undefined };
  const next: Keyframes = {};
  for (const property of KEYFRAME_PROPERTIES) {
    const first = left[property];
    const second = right[property];
    if (!first || !second) continue;
    const shifted = second.map((frame) => ({ ...frame, time: frame.time + leftDuration }));
    // At the seam both halves have a keyframe (the split made them): the second one's wins.
    const before = first.filter((frame) => frame.time < leftDuration);
    next[property] = [...before, ...shifted].slice(0, MAX_KEYFRAMES);
  }
  return { keyframes: next };
}
