import type { FileSystemPort, FsEntry } from './fs-port';

/** Subset of FileSystemSyncAccessHandle (worker-only API, not in the DOM typings). */
interface SyncAccessHandle {
  truncate(size: number): void;
  write(data: Uint8Array, options?: { at: number }): number;
  getSize(): number;
  flush(): void;
  close(): void;
}

interface SyncCapableFileHandle {
  createSyncAccessHandle(): Promise<SyncAccessHandle>;
}

function split(path: string): { parents: string[]; name: string } {
  const parts = path.split('/').filter((part) => part !== '');
  const name = parts.pop();
  if (name === undefined) throw new RangeError('Empty path');
  return { parents: parts, name };
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')
  );
}

/**
 * Origin Private File System implementation. Must run in a dedicated worker: writes use synchronous access
 * handles (fast, supported by Chrome, Firefox and Safari). Operations on the same path are serialised because
 * a file can have only one open sync handle (ADR-0005: one writer per file).
 */
export class OpfsFileSystem implements FileSystemPort {
  private rootPromise: Promise<FileSystemDirectoryHandle> | undefined;
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly rootName = 'ms') {}

  private root(): Promise<FileSystemDirectoryHandle> {
    this.rootPromise ??= navigator.storage
      .getDirectory()
      .then((opfs) => opfs.getDirectoryHandle(this.rootName, { create: true }));
    return this.rootPromise;
  }

  private async directory(
    parents: readonly string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    let dir = await this.root();
    for (const part of parents) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }

  private serialized<T>(path: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(path) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    this.chains.set(path, tail);
    void tail.then(() => {
      if (this.chains.get(path) === tail) this.chains.delete(path);
    });
    return run;
  }

  read(path: string): Promise<Uint8Array | null> {
    return this.serialized(path, async () => {
      const { parents, name } = split(path);
      try {
        const dir = await this.directory(parents, false);
        const file = await (await dir.getFileHandle(name)).getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    });
  }

  write(path: string, data: Uint8Array): Promise<void> {
    return this.serialized(path, async () => {
      const { parents, name } = split(path);
      const dir = await this.directory(parents, true);
      const handle = await dir.getFileHandle(name, { create: true });
      const access = await (handle as unknown as SyncCapableFileHandle).createSyncAccessHandle();
      try {
        access.truncate(0);
        access.write(data, { at: 0 });
        access.flush();
      } finally {
        access.close();
      }
    });
  }

  readBlob(path: string): Promise<Blob | null> {
    return this.serialized(path, async () => {
      const { parents, name } = split(path);
      try {
        const dir = await this.directory(parents, false);
        // A File backed by the file on disk: it is read in slices when asked for, not up front.
        return await (await dir.getFileHandle(name)).getFile();
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    });
  }

  writeBlob(path: string, blob: Blob): Promise<void> {
    return this.serialized(path, async () => {
      const { parents, name } = split(path);
      const dir = await this.directory(parents, true);
      const handle = await dir.getFileHandle(name, { create: true });
      const access = await (handle as unknown as SyncCapableFileHandle).createSyncAccessHandle();
      try {
        access.truncate(0);
        let at = 0;
        const reader = blob.stream().getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          access.write(value, { at });
          at += value.length;
        }
        access.flush();
      } catch (error) {
        // Never leave a half-copied file behind.
        access.close();
        await dir.removeEntry(name).catch(() => undefined);
        throw error;
      }
      access.close();
    });
  }

  append(path: string, data: Uint8Array): Promise<void> {
    return this.serialized(path, async () => {
      const { parents, name } = split(path);
      const dir = await this.directory(parents, true);
      const handle = await dir.getFileHandle(name, { create: true });
      const access = await (handle as unknown as SyncCapableFileHandle).createSyncAccessHandle();
      try {
        access.write(data, { at: access.getSize() });
        access.flush();
      } finally {
        access.close();
      }
    });
  }

  remove(path: string): Promise<void> {
    return this.serialized(path, async () => {
      const { parents, name } = split(path);
      try {
        const dir = await this.directory(parents, false);
        await dir.removeEntry(name, { recursive: true });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    });
  }

  async list(path: string): Promise<FsEntry[]> {
    const parents = path.split('/').filter((part) => part !== '');
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await this.directory(parents, false);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const entries: FsEntry[] = [];
    for await (const handle of dir.values()) {
      if (handle.kind === 'directory') {
        entries.push({ name: handle.name, kind: 'directory', size: 0 });
      } else {
        const file = await handle.getFile();
        entries.push({ name: handle.name, kind: 'file', size: file.size });
      }
    }
    return entries;
  }
}
