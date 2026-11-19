import { describe, expect, it } from 'vitest';
import { filterEntries, moveActive, type PaletteEntry } from './command-palette';

const entry = (id: string, label: string): PaletteEntry => ({ id, label, keys: [] });
const entries = [
  entry('a', 'Go to the next marker'),
  entry('b', 'Add a marker at the playhead'),
  entry('c', 'Marker list'),
  entry('d', 'Undo'),
];

describe('filterEntries', () => {
  it('keeps everything, in order, for an empty search', () => {
    expect(filterEntries(entries, '  ').map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('needs every word, in any case and any order', () => {
    expect(filterEntries(entries, 'MARKER next').map((e) => e.id)).toEqual(['a']);
    expect(filterEntries(entries, 'zzz')).toEqual([]);
  });

  it('puts a label that starts with the word first, then a word start, then the rest', () => {
    expect(
      filterEntries([...entries, entry('e', 'Unmarkered')], 'marker').map((e) => e.id),
    ).toEqual(['c', 'a', 'b', 'e']);
  });
});

describe('moveActive', () => {
  it('wraps round at both ends', () => {
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(1, 1, 3)).toBe(2);
  });

  it('stays at 0 when there is nothing to choose', () => {
    expect(moveActive(0, 1, 0)).toBe(0);
  });
});
