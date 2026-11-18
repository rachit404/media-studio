import type { FileSystemPort, FsEntry } from './fs-port';

/** In-memory file system for tests. Folders are implicit (derived from file paths). */
export class MemoryFileSystem implements FileSystemPort {
  readonly files = new Map<string, Uint8Array>();

  read(path: string): Promise<Uint8Array | null> {
    const data = this.files.get(path);
    return Promise.resolve(data ? data.slice() : null);
  }

  write(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data.slice());
    return Promise.resolve();
  }

  readBlob(path: string): Promise<Blob | null> {
    const data = this.files.get(path);
    return Promise.resolve(data ? new Blob([data.slice()]) : null);
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    this.files.set(path, new Uint8Array(await blob.arrayBuffer()));
  }

  append(path: string, data: Uint8Array): Promise<void> {
    const existing = this.files.get(path) ?? new Uint8Array(0);
    const merged = new Uint8Array(existing.length + data.length);
    merged.set(existing, 0);
    merged.set(data, existing.length);
    this.files.set(path, merged);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    const prefix = `${path}/`;
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(prefix)) this.files.delete(key);
    }
    return Promise.resolve();
  }

  list(path: string): Promise<FsEntry[]> {
    const prefix = path === '' ? '' : `${path}/`;
    const entries = new Map<string, FsEntry>();
    for (const [key, data] of this.files) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) entries.set(rest, { name: rest, kind: 'file', size: data.length });
      else
        entries.set(rest.slice(0, slash), {
          name: rest.slice(0, slash),
          kind: 'directory',
          size: 0,
        });
    }
    return Promise.resolve([...entries.values()]);
  }
}
