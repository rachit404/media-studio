import {
  AppError,
  History,
  addRasterLayer,
  commitPixels,
  createProject,
  rawTileBytes,
  setLayerMask,
  type ProjectDocument,
} from '@media-studio/core';
import { deflateSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { isAllowedEntryName, isAssetPath } from './archive';
import { MemoryFileSystem } from './memory-fs';
import { ProjectStore } from './project-store';
import { decodeTile, encodeTile } from './tile-codec';

const NOW = new Date('2026-11-18T10:00:00.000Z');
let store: ProjectStore;
let fs: MemoryFileSystem;

beforeEach(() => {
  fs = new MemoryFileSystem();
  store = new ProjectStore(fs, { appVersion: '0.0.0-test', now: () => NOW });
});

const tileData = (seed: number, channels: 1 | 4 = 4) => {
  const data = new Uint8Array(rawTileBytes(channels));
  data[0] = seed;
  data[data.length - 1] = seed + 1;
  return data;
};

async function paintedProject(id: string): Promise<ProjectDocument> {
  const history = new History(
    createProject({ id, name: 'Painted', type: 'image', createdAt: NOW.toISOString() }),
  );
  history.execute(addRasterLayer('R1'));
  history.execute(commitPixels('R1', 'layer', 'c1', 'stroke'));
  history.execute(setLayerMask('R1', { width: 1920, height: 1080, pixels: 'm1' }));
  await store.create(history.state);
  await store.putPixels(
    id,
    'c1',
    4,
    [
      { key: '0,0', id: 't1' },
      { key: '1,0', id: 't2' },
    ],
    [
      { id: 't1', data: tileData(1) },
      { id: 't2', data: tileData(2) },
    ],
  );
  await store.putPixels(
    id,
    'm1',
    1,
    [{ key: '0,0', id: 'mt1' }],
    [{ id: 'mt1', data: tileData(9, 1) }],
  );
  return history.state;
}

describe('tile codec', () => {
  it('round-trips and compresses empty tiles a lot', () => {
    const data = tileData(5);
    const packed = encodeTile(data);
    expect(packed.length).toBeLessThan(data.length / 50);
    expect(decodeTile(packed, data.length)).toEqual(data);
  });

  it('rejects data that expands to the wrong size (zip bomb, truncation, garbage)', () => {
    const big = deflateSync(new Uint8Array(10_000_000));
    expect(() => decodeTile(big, rawTileBytes(4))).toThrow(AppError);
    expect(() => decodeTile(encodeTile(new Uint8Array(10)), rawTileBytes(4))).toThrow(AppError);
    expect(() => decodeTile(new Uint8Array([1, 2, 3, 4]), rawTileBytes(4))).toThrow(AppError);
  });
});

describe('storing painted pixels', () => {
  it('saves and loads a version, sharing tile files between versions', async () => {
    await paintedProject('p1');
    const loaded = await store.getPixels('p1', 'c1');
    expect(loaded?.channels).toBe(4);
    expect(loaded?.tiles.map((t) => t.key).sort()).toEqual(['0,0', '1,0']);
    expect(loaded?.tiles.find((t) => t.id === 't2')?.data[0]).toBe(2);

    // A second version only writes the one new tile, then lists the old one again.
    await store.putPixels(
      'p1',
      'c2',
      4,
      [
        { key: '0,0', id: 't3' },
        { key: '1,0', id: 't2' },
      ],
      [{ id: 't3', data: tileData(3) }],
    );
    const next = await store.getPixels('p1', 'c2');
    expect(next?.tiles.find((t) => t.key === '1,0')?.data[0]).toBe(2);
    expect(next?.tiles.find((t) => t.key === '0,0')?.data[0]).toBe(3);
    expect((await store.getPixels('p1', 'c1'))?.tiles.find((t) => t.key === '0,0')?.data[0]).toBe(
      1,
    );
  });

  it('returns null for a version that was never saved, and fails clearly when a tile is gone', async () => {
    await paintedProject('p1');
    expect(await store.getPixels('p1', 'nothing')).toBeNull();
    await fs.remove('projects/p1/tiles/t1.bin');
    await expect(store.getPixels('p1', 'c1')).rejects.toThrow(AppError);
  });

  it('refuses wrong-sized tiles and unsafe ids', async () => {
    await paintedProject('p1');
    await expect(
      store.putPixels(
        'p1',
        'c9',
        4,
        [{ key: '0,0', id: 'x' }],
        [{ id: 'x', data: new Uint8Array(5) }],
      ),
    ).rejects.toThrow(AppError);
    await expect(store.putPixels('p1', '../c9', 4, [], [])).rejects.toThrow(AppError);
    await expect(store.putPixels('p1', 'c9', 4, [{ key: 'zz', id: 'x' }], [])).rejects.toThrow();
  });

  it('only allows the pixel paths the format defines', () => {
    expect(isAssetPath('pixels/abc-123.json')).toBe(true);
    expect(isAssetPath('tiles/abc-123.bin')).toBe(true);
    expect(isAllowedEntryName('tiles/abc-123.bin')).toBe(true);
    for (const bad of [
      'tiles/../x.bin',
      'tiles/a/b.bin',
      'pixels/a.bin',
      'tiles/a.json',
      'tiles/.bin',
      '/tiles/a.bin',
    ]) {
      expect(isAssetPath(bad)).toBe(false);
    }
  });
});

describe('archives with painted pixels', () => {
  it('export then import brings the painted pixels along', async () => {
    await paintedProject('p1');
    const archive = await store.exportArchive('p1');
    await store.importArchive(archive, 'p2');
    const layer = await store.getPixels('p2', 'c1');
    expect(layer?.tiles.map((t) => t.data[0]).sort()).toEqual([1, 2]);
    expect((await store.getPixels('p2', 'm1'))?.tiles[0]?.data[0]).toBe(9);
  });

  it('export fails clearly when pixels are missing, and import rejects archives without them', async () => {
    await paintedProject('p1');
    const archive = await store.exportArchive('p1');
    await fs.remove('projects/p1/tiles/t2.bin');
    await expect(store.exportArchive('p1')).rejects.toThrow(AppError);

    const { readArchive, buildArchive } = await import('./archive');
    const files = readArchive(archive);
    const trimmed = Object.fromEntries(
      Object.entries(files).filter(([name]) => name !== 'tiles/t2.bin'),
    );
    await expect(store.importArchive(buildArchive(trimmed), 'p3')).rejects.toThrow(AppError);
  });
});
