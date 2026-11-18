import { describe, expect, it } from 'vitest';
import { levelToDb, peakLevel } from './audio-player';

describe('master meter maths', () => {
  it('takes the largest absolute sample, positive or negative', () => {
    expect(peakLevel([])).toBe(0);
    expect(peakLevel([0, 0.2, -0.7, 0.5])).toBe(0.7);
    expect(peakLevel(Float32Array.from([0.1, -1.5]))).toBe(1.5); // over full scale is reported, not hidden
  });

  it('turns a level into decibels, with silence at the floor', () => {
    expect(levelToDb(1)).toBeCloseTo(0);
    expect(levelToDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(levelToDb(2)).toBeCloseTo(6.02, 1);
    expect(levelToDb(0)).toBe(-60);
    expect(levelToDb(0.0001)).toBe(-60);
    expect(levelToDb(0, -90)).toBe(-90);
    expect(levelToDb(Number.NaN)).toBe(-60);
  });
});
