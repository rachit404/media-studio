import type { Channels, JournalRecord, ProjectDocument } from '@media-studio/core';
import {
  OpfsFileSystem,
  ProjectStore,
  probeWriteCapacity,
  type FileSystemPort,
  type OpenResult,
  type ProjectListing,
  type StoreStats,
  type WriteProbeResult,
} from '@media-studio/storage';

export interface StorageUsage {
  usedBytes: number | null;
  quotaBytes: number | null;
  persisted: boolean | null;
}

/** The API the main thread can call. Runs inside the storage worker (one writer per file). */
export class StorageApi {
  private readonly fs: FileSystemPort;
  private readonly store: ProjectStore;

  constructor(appVersion: string, fs: FileSystemPort = new OpfsFileSystem()) {
    this.fs = fs;
    this.store = new ProjectStore(fs, { appVersion });
  }

  probeWrite(): Promise<WriteProbeResult> {
    return probeWriteCapacity(this.fs);
  }

  async usage(): Promise<StorageUsage> {
    const estimate = await navigator.storage.estimate();
    const persisted = await navigator.storage.persisted().catch(() => null);
    return {
      usedBytes: estimate.usage ?? null,
      quotaBytes: estimate.quota ?? null,
      persisted,
    };
  }

  list(): Promise<ProjectListing> {
    return this.store.list();
  }
  create(project: ProjectDocument): Promise<void> {
    return this.store.create(project);
  }
  open(id: string): Promise<OpenResult> {
    return this.store.open(id);
  }
  appendJournal(id: string, records: JournalRecord[]): Promise<void> {
    return this.store.appendJournal(id, records);
  }
  checkpoint(id: string, project: ProjectDocument, seq: number): Promise<void> {
    return this.store.checkpoint(id, project, seq);
  }
  discardJournal(id: string): Promise<void> {
    return this.store.discardJournal(id);
  }
  putFile(id: string, path: string, data: Uint8Array): Promise<void> {
    return this.store.putFile(id, path, data);
  }
  putBlob(id: string, path: string, blob: Blob): Promise<void> {
    return this.store.putBlob(id, path, blob);
  }
  getBlob(id: string, path: string): Promise<Blob | null> {
    return this.store.getBlob(id, path);
  }
  getFile(id: string, path: string): Promise<Uint8Array | null> {
    return this.store.getFile(id, path);
  }
  putPixels(
    id: string,
    contentId: string,
    channels: Channels,
    entries: { key: string; id: string }[],
    newTiles: { id: string; data: Uint8Array }[],
  ): Promise<void> {
    return this.store.putPixels(id, contentId, channels, entries, newTiles);
  }
  getPixels(id: string, contentId: string) {
    return this.store.getPixels(id, contentId);
  }
  deleteProject(id: string): Promise<void> {
    return this.store.deleteProject(id);
  }
  stats(): Promise<StoreStats> {
    return this.store.stats();
  }
  clearAll(): Promise<void> {
    return this.store.clearAll();
  }
  exportArchive(id: string): Promise<Uint8Array> {
    return this.store.exportArchive(id);
  }
  importArchive(bytes: Uint8Array, newId: string): Promise<string> {
    return this.store.importArchive(bytes, newId);
  }
}
