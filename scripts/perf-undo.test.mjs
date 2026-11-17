// PERF-5: undo/redo/execute stay under 50 ms for structural commands on a 1,000-layer / 2,000-clip document.
// This re-runs spike S5 on the normalised data model (ordered collections with fractional keys).
import { describe, expect, it } from 'vitest';
import {
  History,
  appendItems,
  createOrdered,
  insertAt,
  moveTo,
  removeItem,
  sortedItems,
} from '../packages/core/src/index.ts';

function buildDocument() {
  const layers = createOrdered();
  const clips = createOrdered();
  appendItems(
    layers,
    Array.from({ length: 1000 }, (_, i) => ({
      id: `l${String(i)}`,
      name: `Layer ${String(i)}`,
      opacity: 1,
    })),
  );
  appendItems(
    clips,
    Array.from({ length: 2000 }, (_, i) => ({
      id: `c${String(i)}`,
      track: i % 8,
      start: i * 100,
      length: 90,
    })),
  );
  return { layers, clips };
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

describe('PERF-5 undo/redo latency on a large document', () => {
  it('stays under 50 ms for structural commands (p95 and max)', { timeout: 60_000 }, () => {
    const history = new History(buildDocument(), { autoFreeze: false, now: () => 0 });
    let seed = 42;
    const random = (n) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    let nextId = 100000;
    const timings = { execute: [], undo: [], redo: [] };

    const time = (bucket, fn) => {
      const start = performance.now();
      fn();
      timings[bucket].push(performance.now() - start);
    };

    const OPERATIONS = 800;
    for (let i = 0; i < OPERATIONS; i += 1) {
      const collection = random(2) === 0 ? 'layers' : 'clips';
      const kind = random(4);
      time('execute', () => {
        history.execute({
          label: 'structural',
          apply(draft) {
            const target = draft[collection];
            const ids = Object.keys(target.byId);
            const id = ids[random(ids.length)];
            if (kind === 0 && id) moveTo(target, id, random(ids.length));
            else if (kind === 1)
              insertAt(target, { id: `n${String(nextId++)}`, name: 'new' }, random(ids.length + 1));
            else if (kind === 2 && id && ids.length > 10) removeItem(target, id);
            else if (id) moveTo(target, id, 0);
          },
        });
      });
    }
    for (let i = 0; i < OPERATIONS; i += 1) time('undo', () => history.undo());
    for (let i = 0; i < OPERATIONS; i += 1) time('redo', () => history.redo());

    // Order must still be consistent after the full undo/redo cycle.
    expect(sortedItems(history.state.layers).length).toBeGreaterThan(900);

    const report = {};
    for (const [name, values] of Object.entries(timings)) {
      const sorted = [...values].sort((a, b) => a - b);
      report[name] = {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted.at(-1),
      };
    }
    console.log(
      'PERF-5 (ms):',
      JSON.stringify(report, (_k, v) => (typeof v === 'number' ? Number(v.toFixed(3)) : v)),
    );
    for (const { p95, max } of Object.values(report)) {
      expect(p95).toBeLessThan(10);
      expect(max).toBeLessThan(50);
    }
  });
});
