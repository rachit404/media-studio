import { describe, expect, it } from 'vitest';
import { parseSeen, stepIndex, WALKTHROUGHS, withSeen } from './walkthrough-steps';

describe('walkthroughs', () => {
  it('have three steps each, with a title and text', () => {
    for (const steps of Object.values(WALKTHROUGHS)) {
      expect(steps).toHaveLength(3);
      for (const step of steps) {
        expect(step.title.length).toBeGreaterThan(0);
        expect(step.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('read what was stored, and ignore anything unexpected', () => {
    expect(parseSeen(['home', 'video'])).toEqual(['home', 'video']);
    expect(parseSeen(['home', 'bogus', 3, null])).toEqual(['home']);
    expect(parseSeen('home')).toEqual([]);
    expect(parseSeen(null)).toEqual([]);
  });

  it('add an id once', () => {
    expect(withSeen([], 'image')).toEqual(['image']);
    expect(withSeen(['image'], 'image')).toEqual(['image']);
    expect(withSeen(['image'], 'video')).toEqual(['image', 'video']);
  });

  it('keep the step inside the list', () => {
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(1, 1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});
