import { describe, expect, it } from 'vitest';
import { buildArchive, isAllowedEntryName, readArchive } from './archive';
import { MemoryFileSystem } from './memory-fs';
import { probeWriteCapacity } from './probe';

describe('probeWriteCapacity', () => {
  it('passes on a working file system and leaves no probe file behind', async () => {
    const fs = new MemoryFileSystem();
    expect(await probeWriteCapacity(fs, 64 * 1024)).toEqual({ ok: true, bytes: 64 * 1024 });
    expect(fs.files.size).toBe(0);
  });

  it('fails with the error name when writes are rejected (quota exceeded despite a large estimate)', async () => {
    const fs = new MemoryFileSystem();
    fs.write = () =>
      Promise.reject(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
    expect(await probeWriteCapacity(fs)).toEqual({ ok: false, reason: 'QuotaExceededError' });
  });

  it('fails when data does not read back identically', async () => {
    const fs = new MemoryFileSystem();
    fs.read = () => Promise.resolve(new Uint8Array(10));
    const result = await probeWriteCapacity(fs, 8192);
    expect(result.ok).toBe(false);
  });
});

describe('archive entry names', () => {
  it('allows only project.json and single files under media/ or thumbs/', () => {
    for (const ok of ['project.json', 'media/a.png', 'thumbs/b-1.webp'])
      expect(isAllowedEntryName(ok)).toBe(true);
    for (const bad of [
      '../x',
      'media/../x',
      '/etc/passwd',
      'media/sub/a.png',
      'media/',
      'a.txt',
      'media/.hidden',
      'media\\a.png',
      'Project.json',
    ]) {
      expect(isAllowedEntryName(bad)).toBe(false);
    }
  });

  it('round-trips entries and refuses to build illegal ones', () => {
    const data = { 'project.json': new Uint8Array([1, 2]), 'media/a.bin': new Uint8Array([3]) };
    expect(readArchive(buildArchive(data))).toEqual(data);
    expect(() => buildArchive({ '../x': new Uint8Array([1]) })).toThrow(RangeError);
  });
});
