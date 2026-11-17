import {
  AppError,
  History,
  addAssets,
  createProject,
  encodeRecord,
  renameProject,
  type JournalRecord,
  type NewAsset,
  type ProjectDocument,
} from '@media-studio/core';
import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { decodeText, encodeText } from './fs-port';
import { MemoryFileSystem } from './memory-fs';
import { ProjectStore } from './project-store';

const NOW = new Date('2026-11-17T10:00:00.000Z');
let clock = 0;
const tick = () => new Date(NOW.getTime() + clock++ * 1000);

let fs: MemoryFileSystem;
let store: ProjectStore;

beforeEach(() => {
  clock = 0;
  fs = new MemoryFileSystem();
  store = new ProjectStore(fs, { appVersion: '0.0.0-test', now: tick });
});

const project = (id = 'p1', name = 'Test project') =>
  createProject({ id, name, type: 'image', createdAt: NOW.toISOString() });

const asset = (id: string): NewAsset => ({
  id,
  kind: 'image',
  name: `${id}.png`,
  mime: 'image/png',
  size: 3,
  width: 8,
  height: 8,
  file: `media/${id}.png`,
  thumb: `thumbs/${id}.webp`,
});

async function withAsset(id: string, assetId: string, name?: string): Promise<ProjectDocument> {
  const history = new History(project(id, name));
  history.execute(addAssets([asset(assetId)]));
  await store.putFile(id, `media/${assetId}.png`, new Uint8Array([1, 2, 3]));
  await store.putFile(id, `thumbs/${assetId}.webp`, new Uint8Array([9]));
  return history.state;
}

/** Records produced by real History operations starting from `base`. */
function journalFrom(
  base: ProjectDocument,
  edits: string[],
): { records: JournalRecord[]; final: ProjectDocument } {
  const records: JournalRecord[] = [];
  const history = new History(base, { onRecord: (r) => records.push(r) });
  for (const name of edits)
    history.execute({ label: 'Rename', apply: (d) => void (d.name = name) });
  return { records, final: history.state };
}

describe('create, open, list', () => {
  it('round-trips a project through a checkpoint', async () => {
    await store.create(project());
    const opened = await store.open('p1');
    expect(opened.file.project.name).toBe('Test project');
    expect(opened.file.journalSeq).toBe(0);
    expect(opened.recovery).toBeNull();
    expect(fs.files.has('projects/p1/project.next.json')).toBe(false);
  });

  it('refuses duplicate ids, invalid ids and unknown projects', async () => {
    await store.create(project());
    await expect(store.create(project())).rejects.toThrow(AppError);
    await expect(store.open('../etc')).rejects.toThrow(AppError);
    await expect(store.open('missing')).rejects.toThrow(/could not be found/);
  });

  it('lists projects newest first and reports unreadable folders without failing', async () => {
    await store.create(project('a', 'First'));
    await store.create(project('b', 'Second'));
    await fs.write('projects/broken/project.json', encodeText('{not json'));
    const { projects, broken } = await store.list();
    expect(projects.map((p) => p.name)).toEqual(['Second', 'First']);
    expect(broken.map((b) => b.id)).toEqual(['broken']);
  });

  it('exposes the first asset thumbnail and asset count in the listing', async () => {
    await store.create(project('p1'));
    const state = await withAsset('p1', 'a1');
    await store.checkpoint('p1', state, 1);
    const [summary] = (await store.list()).projects;
    expect(summary?.assetCount).toBe(1);
    expect(summary?.thumbPath).toBe('thumbs/a1.webp');
  });
});

describe('crash safety of checkpoints', () => {
  it('falls back to the complete next-file when the main file was torn mid-write', async () => {
    await store.create(project('p1', 'Old name'));
    await store.checkpoint('p1', project('p1', 'New name'), 0);
    const complete = await fs.read('projects/p1/project.json');
    // Simulate a crash after writing project.next.json and while writing project.json.
    await fs.write('projects/p1/project.next.json', complete as Uint8Array);
    await fs.write('projects/p1/project.json', (complete as Uint8Array).slice(0, 40));
    expect((await store.open('p1')).file.project.name).toBe('New name');
  });

  it('keeps the previous checkpoint if the crash happened before the main write', async () => {
    await store.create(project('p1', 'Saved'));
    await fs.write('projects/p1/project.next.json', encodeText('{"half":'));
    expect((await store.open('p1')).file.project.name).toBe('Saved');
  });

  it('reports a damaged project when no complete copy exists', async () => {
    await store.create(project('p1'));
    await fs.write('projects/p1/project.json', encodeText('garbage'));
    await expect(store.open('p1')).rejects.toMatchObject({ code: 'invalid-project' });
  });
});

describe('journal and recovery', () => {
  it('re-applies unsaved changes found in the journal', async () => {
    const base = project();
    await store.create(base);
    const { records, final } = journalFrom(base, ['One', 'Two', 'Three']);
    await store.appendJournal('p1', records.slice(0, 2));
    await store.appendJournal('p1', records.slice(2));
    const opened = await store.open('p1');
    expect(opened.recovery?.project).toEqual(final);
    expect(opened.recovery).toMatchObject({ records: 3, lastSeq: 3 });
    expect(opened.journalDamaged).toBe(false);
  });

  it('removes included records at a checkpoint but keeps newer ones', async () => {
    const base = project();
    await store.create(base);
    const { records } = journalFrom(base, ['One', 'Two', 'Three']);
    await store.appendJournal('p1', records);
    const atTwo = journalFrom(base, ['One', 'Two']).final;
    await store.checkpoint('p1', atTwo, 2);
    const opened = await store.open('p1');
    expect(opened.file.journalSeq).toBe(2);
    expect(opened.recovery).toMatchObject({ records: 1, lastSeq: 3 });
    expect(opened.recovery?.project.name).toBe('Three');

    await store.checkpoint('p1', opened.recovery?.project as ProjectDocument, 3);
    expect(fs.files.has('projects/p1/journal.jsonl')).toBe(false);
    expect((await store.open('p1')).recovery).toBeNull();
  });

  it('does not double-apply records when a crash left the journal behind after a checkpoint', async () => {
    const base = project();
    await store.create(base);
    const { records, final } = journalFrom(base, ['One', 'Two']);
    await store.appendJournal('p1', records);
    // Crash after the checkpoint was written but before the journal was pruned.
    await fs.write(
      'projects/p1/project.json',
      await (async () => {
        await store.checkpoint('p1', final, 2);
        return (await fs.read('projects/p1/project.json')) as Uint8Array;
      })(),
    );
    await fs.write('projects/p1/journal.jsonl', encodeText(records.map(encodeRecord).join('')));
    expect((await store.open('p1')).recovery).toBeNull();
  });

  it('uses the intact part of a torn journal and flags the damage', async () => {
    const base = project();
    await store.create(base);
    const { records } = journalFrom(base, ['One', 'Two']);
    await fs.write(
      'projects/p1/journal.jsonl',
      encodeText(
        encodeRecord(records[0] as JournalRecord) +
          encodeRecord(records[1] as JournalRecord).slice(0, 25),
      ),
    );
    const opened = await store.open('p1');
    expect(opened.recovery?.project.name).toBe('One');
    expect(opened.journalDamaged).toBe(true);
  });

  it('refuses to recover a journal whose result is not a valid project', async () => {
    await store.create(project());
    const hostile: JournalRecord = {
      seq: 1,
      label: 'evil',
      patches: [{ op: 'replace', path: ['name'], value: '' }],
    };
    await fs.write('projects/p1/journal.jsonl', encodeText(encodeRecord(hostile)));
    const opened = await store.open('p1');
    expect(opened.recovery).toBeNull();
    expect(opened.journalDamaged).toBe(true);
    expect(opened.file.project.name).toBe('Test project');
  });

  it('discards the journal on request', async () => {
    const base = project();
    await store.create(base);
    await store.appendJournal('p1', journalFrom(base, ['One']).records);
    await store.discardJournal('p1');
    expect((await store.open('p1')).recovery).toBeNull();
  });
});

describe('asset files and housekeeping', () => {
  it('stores and returns files only at safe media/thumbs paths', async () => {
    await store.create(project());
    await store.putFile('p1', 'media/a.png', new Uint8Array([5]));
    expect(await store.getFile('p1', 'media/a.png')).toEqual(new Uint8Array([5]));
    expect(await store.getFile('p1', 'media/none.png')).toBeNull();
    for (const bad of [
      '../x',
      'media/../../x',
      '/abs',
      'project.json',
      'media/sub/dir.png',
      'journal.jsonl',
    ]) {
      await expect(store.putFile('p1', bad, new Uint8Array([1]))).rejects.toThrow(AppError);
      await expect(store.getFile('p1', bad)).rejects.toThrow(AppError);
    }
  });

  it('deletes projects, reports sizes and clears everything', async () => {
    await store.create(project('a'));
    await store.create(project('b'));
    await store.putFile('a', 'media/x.bin', new Uint8Array(1000));
    const stats = await store.stats();
    expect(stats.projects.find((p) => p.id === 'a')?.bytes).toBeGreaterThan(1000);
    await store.deleteProject('a');
    expect((await store.list()).projects.map((p) => p.id)).toEqual(['b']);
    await store.clearAll();
    expect((await store.list()).projects).toEqual([]);
    expect((await store.stats()).totalBytes).toBe(0);
  });

  it('serialises concurrent operations on one project', async () => {
    const base = project();
    await store.create(base);
    const { records } = journalFrom(base, ['A', 'B', 'C', 'D', 'E', 'F']);
    await Promise.all(records.map((record) => store.appendJournal('p1', [record])));
    expect((await store.open('p1')).recovery?.lastSeq).toBe(6);
  });
});

describe('archives', () => {
  it('exports and imports a project with its media under a new id', async () => {
    await store.create(project('p1', 'Holiday'));
    const state = await withAsset('p1', 'a1', 'Holiday');
    await store.checkpoint('p1', state, 1);

    const archive = await store.exportArchive('p1');
    const newId = await store.importArchive(archive, 'p2');
    expect(newId).toBe('p2');

    const imported = await store.open('p2');
    expect(imported.file.project.id).toBe('p2');
    expect(imported.file.project.name).toBe('Holiday');
    expect(await store.getFile('p2', 'media/a1.png')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.getFile('p2', 'thumbs/a1.webp')).toEqual(new Uint8Array([9]));
    await expect(store.importArchive(archive, 'p2')).rejects.toThrow(/already exists/);
  });

  it('refuses to export when a media file is missing', async () => {
    await store.create(project('p1'));
    const state = await withAsset('p1', 'a1');
    await store.checkpoint('p1', state, 1);
    await fs.remove('projects/p1/media/a1.png');
    await expect(store.exportArchive('p1')).rejects.toThrow(/missing/);
  });

  const projectJson = () => encodeText(JSON.stringify({ placeholder: true }));

  it('rejects hostile archives before writing anything', async () => {
    const hostile = [
      zipSync({ 'project.json': projectJson(), '../evil.txt': new Uint8Array([1]) }),
      zipSync({ 'project.json': projectJson(), 'media/../../evil.txt': new Uint8Array([1]) }),
      zipSync({ 'project.json': projectJson(), '/abs.txt': new Uint8Array([1]) }),
      zipSync({ 'project.json': projectJson(), 'other/file.txt': new Uint8Array([1]) }),
      zipSync({ 'media/a.png': new Uint8Array([1]) }),
      new Uint8Array([1, 2, 3, 4]),
    ];
    for (const archive of hostile) {
      await expect(store.importArchive(archive, 'evil')).rejects.toThrow(AppError);
    }
    expect([...fs.files.keys()].filter((key) => key.startsWith('projects/evil'))).toEqual([]);
  });

  it('rejects an archive whose project references files it does not contain', async () => {
    await store.create(project('p1'));
    const state = await withAsset('p1', 'a1');
    await store.checkpoint('p1', state, 1);
    const json = (await fs.read('projects/p1/project.json')) as Uint8Array;
    const incomplete = zipSync({ 'project.json': json });
    await expect(store.importArchive(incomplete, 'p3')).rejects.toThrow(/missing files/);
    expect([...fs.files.keys()].some((key) => key.startsWith('projects/p3'))).toBe(false);
  });

  it('keeps project.json readable text', async () => {
    await store.create(project('p1'));
    const text = decodeText((await fs.read('projects/p1/project.json')) as Uint8Array);
    expect(JSON.parse(text)).toMatchObject({ format: 'media-studio-project', formatVersion: 2 });
    void renameProject;
  });
});
