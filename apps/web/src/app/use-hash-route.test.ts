import { describe, expect, it } from 'vitest';
import { parseRoute } from './use-hash-route';

describe('parseRoute', () => {
  it('maps known hashes', () => {
    expect(parseRoute('#/image')).toEqual({ name: 'preview', kind: 'image' });
    expect(parseRoute('#/video')).toEqual({ name: 'preview', kind: 'video' });
    expect(parseRoute('#/')).toEqual({ name: 'home' });
    expect(parseRoute('#/project/3f2a-9c')).toEqual({ name: 'project', id: '3f2a-9c' });
  });

  it('falls back to home for empty, unknown or hostile hashes', () => {
    for (const hash of [
      '',
      '#/settings',
      '#/image/../../x',
      '#javascript:alert(1)',
      '#/project/',
      '#/project/../etc',
      '#/project/a/b',
      `#/project/${'a'.repeat(65)}`,
    ]) {
      expect(parseRoute(hash)).toEqual({ name: 'home' });
    }
  });
});
