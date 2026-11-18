import {
  KEYFRAME_PROPERTIES,
  clipOpacityAt,
  clipTransformAt,
  isAnimated,
  keyframeAt,
  valueAt,
  type Clip,
  type KeyframeProperty,
} from '@media-studio/core';

/**
 * What the diamond next to a property shows: `off` (not animated), `animated` (it has keyframes but none at the
 * playhead) or `on` (a keyframe sits exactly at the playhead).
 */
export type DiamondState = 'off' | 'animated' | 'on';

export function diamondState(clip: Clip, property: KeyframeProperty, offset: number): DiamondState {
  if (!isAnimated(clip, property)) return 'off';
  return keyframeAt(clip, property, offset) ? 'on' : 'animated';
}

/** The value of a property `offset` microseconds into the clip, with keyframes applied. */
export function propertyValueAt(clip: Clip, property: KeyframeProperty, offset: number): number {
  switch (property) {
    case 'opacity':
      return clipOpacityAt(clip, offset);
    case 'volume':
      return valueAt(clip.keyframes?.volume, offset, clip.volume ?? 1);
    case 'x':
    case 'y':
    case 'scale':
    case 'rotation':
      return clipTransformAt(clip, offset)[property];
  }
}

/** Where the clip has keyframes: each time once (offset from the clip start), with the properties that have one. */
export function keyframeTimes(
  clip: Clip,
): readonly { time: number; properties: readonly KeyframeProperty[] }[] {
  const byTime = new Map<number, KeyframeProperty[]>();
  for (const property of KEYFRAME_PROPERTIES) {
    for (const frame of clip.keyframes?.[property] ?? []) {
      const list = byTime.get(frame.time) ?? [];
      list.push(property);
      byTime.set(frame.time, list);
    }
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, properties]) => ({ time, properties }));
}

/** The nearest keyframe time after or before `offset` (never the one at `offset`), or null when there is none. */
export function neighbourKeyframe(
  clip: Clip,
  offset: number,
  direction: 'next' | 'previous',
): number | null {
  const times = keyframeTimes(clip).map((entry) => entry.time);
  const found =
    direction === 'next'
      ? times.find((time) => time > offset)
      : [...times].reverse().find((time) => time < offset);
  return found ?? null;
}

/** The properties to patch when a drag changed `after` from `before`: only the ones that differ. */
export function changedValues<T extends Partial<Record<KeyframeProperty, number>>>(
  before: T,
  after: T,
): Partial<Record<KeyframeProperty, number>> {
  const changed: Partial<Record<KeyframeProperty, number>> = {};
  for (const property of KEYFRAME_PROPERTIES) {
    const next = after[property];
    if (next !== undefined && next !== before[property]) changed[property] = next;
  }
  return changed;
}
