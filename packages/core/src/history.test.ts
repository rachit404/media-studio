import { describe, expect, it } from 'vitest';
import { History, type Command, type JournalRecord } from './history';
import { replayRecords } from './journal';
import {
  appendItems,
  createOrdered,
  moveTo,
  sortedItems,
  type Ordered,
  type OrderedItem,
} from './ordered';

interface Item extends OrderedItem {
  name: string;
}
interface Doc {
  title: string;
  count: number;
  items: Ordered<Item>;
}

function doc(): Doc {
  const items = createOrdered<Item>();
  appendItems(
    items,
    ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id })),
  );
  return { title: 'Untitled', count: 0, items };
}

const setTitle = (title: string, coalesceKey?: string): Command<Doc> => ({
  label: `Title ${title}`,
  ...(coalesceKey ? { coalesceKey } : {}),
  apply(d) {
    d.title = title;
  },
});
const increment: Command<Doc> = {
  label: 'Increment',
  apply(d) {
    d.count += 1;
  },
};

describe('History', () => {
  it('undoes and redoes, exposing labels and flags', () => {
    const h = new History(doc(), { autoFreeze: true });
    expect(h.canUndo).toBe(false);
    h.execute(setTitle('A'));
    h.execute(increment);
    expect(h.state.title).toBe('A');
    expect(h.state.count).toBe(1);
    expect(h.undoLabel).toBe('Increment');

    expect(h.undo()).toBe(true);
    expect(h.state.count).toBe(0);
    expect(h.redoLabel).toBe('Increment');
    expect(h.redo()).toBe(true);
    expect(h.state.count).toBe(1);
    expect(h.redo()).toBe(false);
  });

  it('records nothing for a command that changes nothing', () => {
    const records: JournalRecord[] = [];
    const h = new History(doc(), { onRecord: (r) => records.push(r) });
    expect(h.execute(setTitle('Untitled'))).toBe(false);
    expect(h.canUndo).toBe(false);
    expect(records).toEqual([]);
  });

  it('discards the redo stack after a new edit', () => {
    const h = new History(doc());
    h.execute(increment);
    h.undo();
    h.execute(setTitle('B'));
    expect(h.canRedo).toBe(false);
  });

  it('never mutates earlier states', () => {
    const h = new History(doc(), { autoFreeze: true });
    const before = h.state;
    h.execute(increment);
    expect(before.count).toBe(0);
    expect(h.state).not.toBe(before);
  });

  describe('coalescing', () => {
    it('merges edits with the same key inside the window and undoes them as one', () => {
      let now = 0;
      const h = new History(doc(), { now: () => now, coalesceWindowMs: 500 });
      for (const t of ['A', 'AB', 'ABC']) {
        now += 100;
        h.execute(setTitle(t, 'title'));
      }
      expect(h.state.title).toBe('ABC');
      h.undo();
      expect(h.state.title).toBe('Untitled');
      expect(h.canUndo).toBe(false);
      h.redo();
      expect(h.state.title).toBe('ABC');
    });

    it('does not merge across the window, different keys, or after an undo', () => {
      let now = 0;
      const h = new History(doc(), { now: () => now, coalesceWindowMs: 500 });
      h.execute(setTitle('A', 'title'));
      now += 600;
      h.execute(setTitle('AB', 'title'));
      h.undo();
      expect(h.state.title).toBe('A');
      h.execute(setTitle('X', 'title')); // after undo: new entry
      h.execute(setTitle('Y', 'other'));
      h.undo();
      expect(h.state.title).toBe('X');
    });
  });

  it('limits the undo depth', () => {
    const h = new History(doc(), { maxEntries: 3 });
    for (let i = 0; i < 10; i += 1) h.execute(increment);
    let undone = 0;
    while (h.undo()) undone += 1;
    expect(undone).toBe(3);
    expect(h.state.count).toBe(7);
  });

  it('notifies subscribers and bumps the version on every change', () => {
    const h = new History(doc());
    let calls = 0;
    const off = h.subscribe(() => (calls += 1));
    h.execute(increment);
    h.undo();
    h.redo();
    off();
    h.execute(increment);
    expect(calls).toBe(3);
    expect(h.getVersion()).toBe(4);
  });

  it('moving an item produces only a few patches', () => {
    const records: JournalRecord[] = [];
    const h = new History(doc(), { onRecord: (r) => records.push(r) });
    h.execute({
      label: 'Move',
      apply(d) {
        moveTo(d.items, 'd', 0);
      },
    });
    expect(records[0]?.patches.length).toBeLessThanOrEqual(3);
    expect(sortedItems(h.state.items).map((i) => i.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('journal records replayed over the initial state reproduce the final state', () => {
    const initial = doc();
    const records: JournalRecord[] = [];
    const h = new History(initial, { onRecord: (r) => records.push(r) });
    h.execute(setTitle('One'));
    h.execute(increment);
    h.execute({
      label: 'Move',
      apply(d) {
        moveTo(d.items, 'a', 3);
      },
    });
    h.undo();
    h.redo();
    h.undo();
    h.execute(setTitle('Two'));

    expect(records.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const replay = replayRecords(initial, records, 0);
    expect(replay.state).toEqual(h.state);
    expect(replay.lastSeq).toBe(h.lastSeq);
  });
});
