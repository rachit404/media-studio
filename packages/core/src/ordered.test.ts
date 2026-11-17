import { describe, expect, it } from 'vitest';
import {
  appendItems,
  createOrdered,
  insertAt,
  moveTo,
  orderedSize,
  removeItem,
  sortedItems,
  type OrderedItem,
} from './ordered';

interface Item extends OrderedItem {
  name: string;
}

const ids = (c: ReturnType<typeof createOrdered<Item>>) => sortedItems(c).map((i) => i.id);

function build(...names: string[]) {
  const c = createOrdered<Item>();
  appendItems(
    c,
    names.map((id) => ({ id, name: id.toUpperCase() })),
  );
  return c;
}

describe('ordered collection', () => {
  it('keeps insertion order when appending', () => {
    expect(ids(build('a', 'b', 'c', 'd'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('inserts at the start, middle and end', () => {
    const c = build('a', 'b');
    insertAt(c, { id: 'first', name: 'F' }, 0);
    insertAt(c, { id: 'mid', name: 'M' }, 2);
    insertAt(c, { id: 'last', name: 'L' }, 99);
    expect(ids(c)).toEqual(['first', 'a', 'mid', 'b', 'last']);
  });

  it('moves an item to any position, interpreted in the resulting list', () => {
    const c = build('a', 'b', 'c', 'd');
    moveTo(c, 'd', 0);
    expect(ids(c)).toEqual(['d', 'a', 'b', 'c']);
    moveTo(c, 'd', 2);
    expect(ids(c)).toEqual(['a', 'b', 'd', 'c']);
    moveTo(c, 'a', 99);
    expect(ids(c)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('changes exactly one item when moving', () => {
    const c = build('a', 'b', 'c', 'd');
    const before = Object.fromEntries(Object.entries(c.byId).map(([id, item]) => [id, item.key]));
    moveTo(c, 'c', 0);
    const changed = Object.entries(c.byId).filter(([id, item]) => before[id] !== item.key);
    expect(changed.map(([id]) => id)).toEqual(['c']);
  });

  it('removes items and reports errors for unknown ids', () => {
    const c = build('a', 'b', 'c');
    removeItem(c, 'b');
    expect(ids(c)).toEqual(['a', 'c']);
    expect(orderedSize(c)).toBe(2);
    expect(() => removeItem(c, 'zzz')).toThrow(RangeError);
    expect(() => moveTo(c, 'zzz', 0)).toThrow(RangeError);
    expect(() => insertAt(c, { id: 'a', name: 'dup' }, 0)).toThrow(RangeError);
    expect(() => appendItems(c, [{ id: 'c', name: 'dup' }])).toThrow(RangeError);
  });

  it('stays consistent after many random operations', () => {
    const c = createOrdered<Item>();
    const model: string[] = [];
    let seed = 12345;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 400; i += 1) {
      const op = random(3);
      if (op === 0 || model.length === 0) {
        const id = `i${String(i)}`;
        const index = random(model.length + 1);
        insertAt(c, { id, name: id }, index);
        model.splice(index, 0, id);
      } else if (op === 1) {
        const from = random(model.length);
        const [id] = model.splice(from, 1) as [string];
        const to = random(model.length + 1);
        moveTo(c, id, to);
        model.splice(to, 0, id);
      } else {
        const at = random(model.length);
        const [id] = model.splice(at, 1) as [string];
        removeItem(c, id);
      }
    }
    expect(ids(c)).toEqual(model);
  });
});
