import {
  AppError,
  addRasterLayer,
  commitPixels,
  createProject,
  createTile,
  renameProject,
  replayRecords,
  type JournalRecord,
  type ProjectDocument,
} from '@media-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSession, type SessionStorage } from './project-session';

class FakeStorage implements SessionStorage {
  journal: JournalRecord[] = [];
  checkpoints: { project: ProjectDocument; seq: number }[] = [];
  failAppends = 0;

  appendJournal(_id: string, records: JournalRecord[]): Promise<void> {
    if (this.failAppends > 0) {
      this.failAppends -= 1;
      return Promise.reject(new Error('disk full'));
    }
    this.journal.push(...records);
    this.events.push('journal');
    return Promise.resolve();
  }
  checkpoint(_id: string, project: ProjectDocument, seq: number): Promise<void> {
    this.checkpoints.push({ project, seq });
    this.journal = this.journal.filter((record) => record.seq > seq);
    return Promise.resolve();
  }
  events: string[] = [];
  failPixelWrites = 0;
  stored = new Map<
    string,
    { channels: 1 | 4; tiles: { key: string; id: string; data: Uint8Array }[] }
  >();

  putPixels(
    _id: string,
    contentId: string,
    channels: 1 | 4,
    entries: { key: string; id: string }[],
    newTiles: { id: string; data: Uint8Array }[],
  ): Promise<void> {
    if (this.failPixelWrites > 0) {
      this.failPixelWrites -= 1;
      return Promise.reject(new Error('disk full'));
    }
    this.events.push(`pixels:${contentId}:new=${String(newTiles.length)}`);
    const data = new Map(newTiles.map((t) => [t.id, t.data]));
    this.stored.set(contentId, {
      channels,
      tiles: entries.map((e) => ({ ...e, data: data.get(e.id) ?? new Uint8Array(0) })),
    });
    return Promise.resolve();
  }
  getPixels(_id: string, contentId: string) {
    return Promise.resolve(this.stored.get(contentId) ?? null);
  }
}

const base = () =>
  createProject({ id: 'p1', name: 'Start', type: 'image', createdAt: '2026-11-17T10:00:00.000Z' });

let storage: FakeStorage;
beforeEach(() => {
  vi.useFakeTimers();
  storage = new FakeStorage();
});
afterEach(() => {
  vi.useRealTimers();
});

const rename = (session: ProjectSession, name: string) =>
  session.history.execute(renameProject(name));

describe('ProjectSession autosave', () => {
  it('batches changes into the journal after the delay and reports status', async () => {
    const session = new ProjectSession('p1', base(), 0, storage, { journalDelayMs: 250 });
    expect(session.status).toBe('saved');
    rename(session, 'One');
    session.history.undo();
    expect(session.status).toBe('saving');
    expect(storage.journal).toEqual([]);

    await vi.advanceTimersByTimeAsync(250);
    expect(storage.journal.map((r) => r.seq)).toEqual([1, 2]);
    expect(session.status).toBe('saved');
  });

  it('journal records replay to the current state (recovery would succeed)', async () => {
    const session = new ProjectSession('p1', base(), 0, storage);
    for (const name of ['A', 'B', 'C']) rename(session, name);
    await session.flush();
    expect(replayRecords(base(), storage.journal, 0).state).toEqual(session.history.state);
  });

  it('writes a checkpoint after the configured number of changes and prunes the journal', async () => {
    const session = new ProjectSession('p1', base(), 0, storage, {
      checkpointEvery: 3,
      journalDelayMs: 10,
    });
    for (let i = 0; i < 3; i += 1) {
      session.history.execute({
        label: `edit ${String(i)}`,
        apply: (d) => void (d.name = `n${String(i)}`),
      });
    }
    await vi.advanceTimersByTimeAsync(10);
    expect(storage.checkpoints).toHaveLength(1);
    expect(storage.checkpoints[0]?.seq).toBe(3);
    expect(storage.journal).toEqual([]);
  });

  it('checkpoints after an idle period', async () => {
    const session = new ProjectSession('p1', base(), 0, storage, { checkpointIdleMs: 1000 });
    rename(session, 'Quiet');
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.checkpoints.at(-1)?.project.name).toBe('Quiet');
  });

  it('keeps records and retries in order after a failed write', async () => {
    const errors: AppError[] = [];
    const session = new ProjectSession('p1', base(), 0, storage, {
      onError: (e) => errors.push(e),
    });
    storage.failAppends = 1;
    rename(session, 'One');
    await session.flush();
    expect(session.status).toBe('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(AppError);

    rename(session, 'Two');
    await session.flush();
    expect(storage.journal.map((r) => r.seq)).toEqual([1, 2]);
    expect(session.status).toBe('saved');
  });

  it('dispose saves everything with a final checkpoint', async () => {
    const session = new ProjectSession('p1', base(), 5, storage);
    rename(session, 'Final');
    await session.dispose();
    expect(storage.checkpoints.at(-1)).toMatchObject({ seq: 6 });
    expect(storage.checkpoints.at(-1)?.project.name).toBe('Final');
    rename(session, 'After close');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(storage.journal).toEqual([]);
  });

  it('continues sequence numbers from the recovered state', async () => {
    const session = new ProjectSession('p1', base(), 41, storage);
    rename(session, 'Next');
    await session.flush();
    expect(storage.journal.map((r) => r.seq)).toEqual([42]);
  });
});

describe('ProjectSession painted pixels', () => {
  const stroke = (session: ProjectSession, base: string | null) => {
    const tile = createTile(`tile-${String(Math.random()).slice(2)}`, 4);
    tile.data[0] = 7;
    const id = session.createPixelVersion(base, 4, new Map([['0,0', tile]]));
    session.history.execute(commitPixels('R1', 'layer', id, 'Brush stroke'));
    return { id, tile };
  };

  it('writes the pixels before the journal record that refers to them', async () => {
    const session = new ProjectSession('p1', base(), 0, storage);
    session.history.execute(addRasterLayer('R1'));
    const { id } = stroke(session, null);
    await session.flush();
    expect(storage.events.indexOf(`pixels:${id}:new=1`)).toBeGreaterThanOrEqual(0);
    expect(storage.events.indexOf(`pixels:${id}:new=1`)).toBeLessThan(
      storage.events.indexOf('journal'),
    );
  });

  it('keeps the new version in memory at once and writes each tile only once', async () => {
    const session = new ProjectSession('p1', base(), 0, storage);
    session.history.execute(addRasterLayer('R1'));
    const first = stroke(session, null);
    expect(session.pixels.get(first.id).get('0,0')).toBe(first.tile);
    // A second version that reuses the first version's tile writes no tile data again.
    const reuse = session.createPixelVersion(first.id, 4, new Map());
    await session.flush();
    expect(storage.events).toContain(`pixels:${reuse}:new=0`);
  });

  it('does not record a change whose pixels could not be saved, and retries until they can', async () => {
    const session = new ProjectSession('p1', base(), 0, storage, { journalDelayMs: 100 });
    session.history.execute(addRasterLayer('R1'));
    storage.failPixelWrites = 1;
    const { id } = stroke(session, null);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    // The write failed once, so the journal must not have been written; the retry then saves everything in order.
    await session.flush();
    expect(session.status).toBe('saved');
    expect(storage.events.indexOf(`pixels:${id}:new=1`)).toBeLessThan(
      storage.events.indexOf('journal'),
    );
    expect(storage.journal.map((r) => r.seq)).toEqual([1, 2]);
  });

  it('loads saved pixels back by content id', async () => {
    const session = new ProjectSession('p1', base(), 0, storage);
    session.history.execute(addRasterLayer('R1'));
    const { id } = stroke(session, null);
    await session.flush();

    const reopened = new ProjectSession('p1', base(), 0, storage);
    await reopened.loadPixels([id]);
    expect(reopened.pixels.get(id).get('0,0')?.data[0]).toBe(7);
    await expect(reopened.loadPixels(['missing'])).rejects.toBeInstanceOf(AppError);
  });
});
