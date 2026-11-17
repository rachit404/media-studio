import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { History } from './history';
import { sortedItems } from './ordered';
import {
  CURRENT_FORMAT_VERSION,
  addAssets,
  createProject,
  migrateToVersion,
  parseProject,
  parseProjectFile,
  removeAsset,
  renameAsset,
  renameProject,
  type NewAsset,
  type ProjectFile,
} from './project';

const NOW = '2026-11-17T10:00:00.000Z';

function asset(id: string, name = `${id}.png`): NewAsset {
  return {
    id,
    kind: 'image',
    name,
    mime: 'image/png',
    size: 1234,
    width: 64,
    height: 32,
    file: `media/${id}.png`,
    thumb: `thumbs/${id}.webp`,
  };
}

const newProject = () =>
  createProject({ id: 'p1', name: '  My project  ', type: 'image', createdAt: NOW });

function fileFor(project = newProject()): ProjectFile {
  return {
    format: 'media-studio-project',
    formatVersion: CURRENT_FORMAT_VERSION,
    appVersion: '0.0.0',
    modifiedAt: NOW,
    journalSeq: 0,
    project,
  };
}

describe('createProject', () => {
  it('creates a valid project with a trimmed name and matching content', () => {
    const project = newProject();
    expect(project.name).toBe('My project');
    expect(project.content).toEqual({ kind: 'image' });
    expect(project.assets.byId).toEqual({});
  });

  it('rejects empty, oversized or unsafe input', () => {
    expect(() => createProject({ id: 'p', name: '   ', type: 'video', createdAt: NOW })).toThrow(
      AppError,
    );
    expect(() =>
      createProject({ id: 'p', name: 'x'.repeat(121), type: 'video', createdAt: NOW }),
    ).toThrow(AppError);
    expect(() => createProject({ id: '../etc', name: 'x', type: 'video', createdAt: NOW })).toThrow(
      AppError,
    );
    expect(() =>
      createProject({ id: 'p', name: 'x', type: 'image', createdAt: 'yesterday' }),
    ).toThrow(AppError);
  });
});

describe('project schema', () => {
  it('rejects unknown keys, mismatched content and traversal paths', () => {
    const base = newProject();
    expect(() => parseProject({ ...base, extra: 1 })).toThrow(AppError);
    expect(() => parseProject({ ...base, content: { kind: 'video' } })).toThrow(AppError);
    for (const bad of ['../x.png', '/abs.png', 'a//b.png', 'a/./b.png', 'a b.png', '']) {
      const history = new History(base);
      history.execute(addAssets([{ ...asset('x'), file: 'media/ok.png' }]));
      const tampered = JSON.parse(JSON.stringify(history.state)) as typeof base;
      const entry = Object.values(tampered.assets.byId)[0];
      if (!entry) throw new Error('expected an asset');
      entry.file = bad;
      expect(() => parseProject(tampered)).toThrow(AppError);
    }
  });

  it('rejects a project whose asset key does not match its id', () => {
    const history = new History(newProject());
    history.execute(addAssets([asset('a1')]));
    const tampered = JSON.parse(JSON.stringify(history.state)) as ReturnType<typeof newProject>;
    const entry = tampered.assets.byId['a1'];
    if (!entry) throw new Error('expected an asset');
    tampered.assets.byId['other'] = entry;
    expect(() => parseProject(tampered)).toThrow(AppError);
  });
});

describe('project commands', () => {
  it('imports, renames and removes assets with undo and redo', () => {
    const history = new History(newProject());
    history.execute(addAssets([asset('a1'), asset('a2'), asset('a3')]));
    expect(sortedItems(history.state.assets).map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    expect(history.undoLabel).toBe('Import 3 assets');

    history.execute(renameAsset('a2', 'Sunset'));
    history.execute(removeAsset('a1'));
    expect(sortedItems(history.state.assets).map((a) => a.name)).toEqual(['Sunset', 'a3.png']);

    history.undo();
    history.undo();
    expect(history.state.assets.byId['a2']?.name).toBe('a2.png');
    expect(() => parseProject(history.state)).not.toThrow();
  });

  it('coalesces typing a project name into one undo step', () => {
    const history = new History(newProject());
    for (const name of ['M', 'My', 'My p', 'My plan']) history.execute(renameProject(name));
    expect(history.state.name).toBe('My plan');
    history.undo();
    expect(history.state.name).toBe('My project');
    expect(history.canUndo).toBe(false);
  });

  it('refuses invalid names and duplicate or unknown assets', () => {
    expect(() => renameProject('  ')).toThrow(AppError);
    const history = new History(newProject());
    history.execute(addAssets([asset('a1')]));
    expect(() => history.execute(addAssets([asset('a1')]))).toThrow(RangeError);
    expect(() => history.execute(renameAsset('nope', 'x'))).toThrow(RangeError);
    expect(() => history.execute(removeAsset('nope'))).toThrow(RangeError);
  });
});

describe('project file parsing and migration', () => {
  it('accepts a valid current file', () => {
    const { file, migratedFrom } = parseProjectFile(fileFor());
    expect(file.project.id).toBe('p1');
    expect(migratedFrom).toBeNull();
  });

  it('rejects damaged data with a typed, user-readable error', () => {
    for (const bad of [
      null,
      'text',
      [],
      {},
      { ...fileFor(), format: 'other' },
      { ...fileFor(), journalSeq: -1 },
    ]) {
      try {
        parseProjectFile(bad);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('invalid-project');
      }
    }
  });

  it('refuses files from a newer version without altering anything', () => {
    const future = { ...fileFor(), formatVersion: CURRENT_FORMAT_VERSION + 1 };
    expect(() => parseProjectFile(future)).toThrow(/newer version/);
  });

  it('chains migrations in order and leaves the input untouched', () => {
    const input = { formatVersion: 1, data: ['x'] };
    const migrations = {
      1: (raw: Record<string, unknown>) => ({ ...raw, data: [...(raw['data'] as string[]), 'v2'] }),
      2: (raw: Record<string, unknown>) => ({ ...raw, data: [...(raw['data'] as string[]), 'v3'] }),
    };
    const { data, from } = migrateToVersion(input, 3, migrations);
    expect(data).toEqual({ formatVersion: 3, data: ['x', 'v2', 'v3'] });
    expect(from).toBe(1);
    expect(input).toEqual({ formatVersion: 1, data: ['x'] });
  });

  it('fails clearly when a migration step is missing', () => {
    expect(() => migrateToVersion({ formatVersion: 1 }, 3, { 1: (raw) => raw })).toThrow(AppError);
  });
});
