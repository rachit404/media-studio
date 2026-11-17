import {
  AppError,
  createProject,
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
    return Promise.resolve();
  }
  checkpoint(_id: string, project: ProjectDocument, seq: number): Promise<void> {
    this.checkpoints.push({ project, seq });
    this.journal = this.journal.filter((record) => record.seq > seq);
    return Promise.resolve();
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
