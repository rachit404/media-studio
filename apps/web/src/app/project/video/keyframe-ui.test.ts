import { IDENTITY_TRANSFORM, type Clip } from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import {
  changedValues,
  diamondState,
  keyframeTimes,
  neighbourKeyframe,
  propertyValueAt,
} from './keyframe-ui';

const S = 1_000_000;

const clip = (extra: Partial<Clip> = {}): Clip => ({
  id: 'c',
  trackId: 'V1',
  assetId: 'a',
  start: 0,
  duration: 10 * S,
  sourceIn: 0,
  linkId: null,
  ...extra,
});

const animated = clip({
  transform: { ...IDENTITY_TRANSFORM, x: 0.5 },
  keyframes: {
    x: [
      { time: 0, value: 0, easing: 'linear' },
      { time: 4 * S, value: 0.4, easing: 'linear' },
    ],
    opacity: [{ time: 4 * S, value: 0.5, easing: 'linear' }],
  },
});

describe('keyframe diamonds', () => {
  it('is off without keyframes, animated between them and on at one', () => {
    expect(diamondState(animated, 'y', 0)).toBe('off');
    expect(diamondState(animated, 'x', 2 * S)).toBe('animated');
    expect(diamondState(animated, 'x', 4 * S)).toBe('on');
    expect(diamondState(animated, 'opacity', 0)).toBe('animated');
  });
});

describe('values at the playhead', () => {
  it('follows the keyframes, and uses the fixed value when not animated', () => {
    expect(propertyValueAt(animated, 'x', 2 * S)).toBeCloseTo(0.2);
    expect(propertyValueAt(animated, 'x', 9 * S)).toBeCloseTo(0.4);
    expect(propertyValueAt(animated, 'scale', 2 * S)).toBe(1);
    expect(propertyValueAt(animated, 'opacity', 0)).toBe(0.5);
    expect(propertyValueAt(clip({ opacity: 0.25 }), 'opacity', 3 * S)).toBe(0.25);
  });

  it('reads the volume of a sound clip, animated or fixed', () => {
    expect(propertyValueAt(clip(), 'volume', 0)).toBe(1);
    expect(propertyValueAt(clip({ volume: 0.5 }), 'volume', 0)).toBe(0.5);
    const faded = clip({
      keyframes: {
        volume: [
          { time: 0, value: 1, easing: 'linear' },
          { time: 2 * S, value: 0, easing: 'linear' },
        ],
      },
    });
    expect(propertyValueAt(faded, 'volume', S)).toBeCloseTo(0.5);
  });
});

describe('moving between keyframes', () => {
  it('merges the times of all properties, once each', () => {
    expect(keyframeTimes(animated)).toEqual([
      { time: 0, properties: ['x'] },
      { time: 4 * S, properties: ['x', 'opacity'] },
    ]);
    expect(keyframeTimes(clip())).toEqual([]);
  });

  it('finds the next and the previous, never the one it stands on', () => {
    expect(neighbourKeyframe(animated, 0, 'next')).toBe(4 * S);
    expect(neighbourKeyframe(animated, 4 * S, 'next')).toBeNull();
    expect(neighbourKeyframe(animated, 4 * S, 'previous')).toBe(0);
    expect(neighbourKeyframe(animated, 0, 'previous')).toBeNull();
    expect(neighbourKeyframe(animated, 2 * S, 'previous')).toBe(0);
    expect(neighbourKeyframe(clip(), 0, 'next')).toBeNull();
  });
});

describe('what a drag changed', () => {
  it('lists only the properties that differ', () => {
    const before = { x: 0, y: 0, scale: 1, rotation: 0 };
    expect(changedValues(before, { ...before, x: 0.1, y: -0.2 })).toEqual({ x: 0.1, y: -0.2 });
    expect(changedValues(before, { ...before, rotation: 15 })).toEqual({ rotation: 15 });
    expect(changedValues(before, before)).toEqual({});
  });
});
