import { describe, expect, it } from 'vitest';
import { parseRoute } from './use-hash-route';

describe('parseRoute', () => {
  it('maps known hashes', () => {
    expect(parseRoute('#/image')).toBe('image');
    expect(parseRoute('#/video')).toBe('video');
    expect(parseRoute('#/')).toBe('home');
  });

  it('falls back to home for empty, unknown or hostile hashes', () => {
    expect(parseRoute('')).toBe('home');
    expect(parseRoute('#/settings')).toBe('home');
    expect(parseRoute('#/image/../../x')).toBe('home');
    expect(parseRoute('#javascript:alert(1)')).toBe('home');
  });
});
