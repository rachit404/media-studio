import { describe, expect, it } from 'vitest';
import { ExportJobStore, segmentCount, type ExportJobInit } from './export-job';
import { MemoryFileSystem } from './memory-fs';

const INIT: ExportJobInit = { fingerprint: 'abc', totalFrames: 250, segmentFrames: 100 };
const part = (text: string) => new Blob([text]);

describe('export job store', () => {
  it('counts the parts', () => {
    expect(segmentCount(INIT)).toBe(3);
    expect(segmentCount({ totalFrames: 200, segmentFrames: 100 })).toBe(2);
    expect(segmentCount({ totalFrames: 1, segmentFrames: 100 })).toBe(1);
    expect(segmentCount({ totalFrames: 0, segmentFrames: 100 })).toBe(1);
  });

  it('starts empty, saves parts in any order and lists them sorted', async () => {
    const store = new ExportJobStore(new MemoryFileSystem(), 'project-1');
    expect(await store.load()).toBeNull();
    const { state, resumed } = await store.begin(INIT);
    expect(resumed).toBe(false);
    expect(state.done).toEqual([]);
    let next = await store.saveSegment(state, 2, part('two'));
    next = await store.saveSegment(next, 0, part('zero'));
    expect(next.done).toEqual([0, 2]);
    expect(await (await store.readSegment(2)).text()).toBe('two');
    expect((await store.load())?.done).toEqual([0, 2]);
  });

  it('carries on with the same export and offers what was already made', async () => {
    const fs = new MemoryFileSystem();
    const first = new ExportJobStore(fs, 'p');
    const { state } = await first.begin(INIT);
    await first.saveSegment(state, 0, part('zero'));
    // A new session (new store object, same disk) asks to start the same export.
    const second = new ExportJobStore(fs, 'p');
    const again = await second.begin(INIT);
    expect(again.resumed).toBe(true);
    expect(again.state.done).toEqual([0]);
  });

  it('throws the old parts away when the export is a different one', async () => {
    const fs = new MemoryFileSystem();
    const store = new ExportJobStore(fs, 'p');
    const { state } = await store.begin(INIT);
    await store.saveSegment(state, 0, part('zero'));
    for (const other of [
      { ...INIT, fingerprint: 'changed' },
      { ...INIT, totalFrames: 300 },
      { ...INIT, segmentFrames: 50 },
    ]) {
      const started = await store.begin(other);
      expect(started.resumed).toBe(false);
      expect(started.state.done).toEqual([]);
      expect([...fs.files.keys()].filter((key) => key.includes('part-'))).toEqual([]);
      await store.saveSegment(started.state, 0, part('zero')); // so the next round has something to throw away
    }
  });

  it('forgets a part whose file is missing, so it is made again', async () => {
    const fs = new MemoryFileSystem();
    const store = new ExportJobStore(fs, 'p');
    const { state } = await store.begin(INIT);
    const afterFirst = await store.saveSegment(state, 0, part('zero'));
    await store.saveSegment(afterFirst, 1, part('one'));
    fs.files.delete('p/part-1.bin');
    const again = await store.begin(INIT);
    expect(again.state.done).toEqual([0]);
    expect((await store.load())?.done).toEqual([0]);
    await expect(store.readSegment(1)).rejects.toMatchObject({ code: 'write-failed' });
  });

  it('treats a damaged manifest as no job, and clear removes everything', async () => {
    const fs = new MemoryFileSystem();
    const store = new ExportJobStore(fs, 'p');
    await fs.write('p/manifest.json', new TextEncoder().encode('{not json'));
    expect(await store.load()).toBeNull();
    await fs.write('p/manifest.json', new TextEncoder().encode('{"fingerprint":1}'));
    expect(await store.load()).toBeNull();
    const { state } = await store.begin(INIT);
    await store.saveSegment(state, 0, part('zero'));
    await store.clear();
    expect([...fs.files.keys()]).toEqual([]);
    expect(await store.load()).toBeNull();
  });

  it('keeps projects apart and refuses odd project ids', async () => {
    const fs = new MemoryFileSystem();
    const a = new ExportJobStore(fs, 'a');
    const b = new ExportJobStore(fs, 'b');
    const { state } = await a.begin(INIT);
    await a.saveSegment(state, 0, part('zero'));
    await b.begin(INIT);
    expect((await a.load())?.done).toEqual([0]);
    expect(() => new ExportJobStore(fs, '../escape')).toThrow(RangeError);
    expect(() => new ExportJobStore(fs, '')).toThrow(RangeError);
  });
});
