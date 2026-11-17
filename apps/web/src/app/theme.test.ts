import { describe, expect, it } from 'vitest';
import { nextTheme, parseTheme, resolveTheme } from './theme';

describe('parseTheme', () => {
  it('accepts only known themes', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('sepia')).toBeNull();
    expect(parseTheme(null)).toBeNull();
    expect(parseTheme(undefined)).toBeNull();
    expect(parseTheme(42)).toBeNull();
  });
});

describe('resolveTheme', () => {
  it('prefers a valid stored value over the OS preference', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('ignores corrupted stored values', () => {
    expect(resolveTheme('<script>', true)).toBe('light');
    expect(resolveTheme('<script>', false)).toBe('dark');
  });

  it('defaults to dark when nothing is stored and the OS has no light preference', () => {
    expect(resolveTheme(null, false)).toBe('dark');
  });

  it('follows the OS light preference when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('light');
  });
});

describe('nextTheme', () => {
  it('toggles between the two themes', () => {
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
  });
});
