import {
  AppError,
  History,
  PixelStore,
  createTile,
  toAppError,
  type Channels,
  type JournalRecord,
  type ProjectDocument,
  type Tile,
  type TileMap,
} from '@media-studio/core';

export type SaveStatus = 'saved' | 'saving' | 'error';

/** The storage calls a session needs. The storage worker client satisfies this. */
export interface SessionStorage {
  appendJournal(id: string, records: JournalRecord[]): Promise<void>;
  checkpoint(id: string, project: ProjectDocument, seq: number): Promise<void>;
  putPixels(
    id: string,
    contentId: string,
    channels: Channels,
    entries: { key: string; id: string }[],
    newTiles: { id: string; data: Uint8Array }[],
  ): Promise<void>;
  getPixels(
    id: string,
    contentId: string,
  ): Promise<{
    channels: Channels;
    tiles: { key: string; id: string; data: Uint8Array }[];
  } | null>;
}

interface PendingPixels {
  contentId: string;
  channels: Channels;
  tiles: TileMap;
}

export interface SessionOptions {
  /** Wait this long after a change before writing it to the journal. REL-1 allows up to 5 s of loss. */
  journalDelayMs?: number;
  /** Write a full checkpoint after this many journaled changes. */
  checkpointEvery?: number;
  /** Write a checkpoint after this long without further changes. */
  checkpointIdleMs?: number;
  autoFreeze?: boolean;
  onError?: (error: AppError) => void;
}

/**
 * One open project: its undo history plus autosave. Every change is appended to a write-ahead journal shortly
 * after it happens and folded into a checkpoint now and then, so a crash loses at most the last moments of work.
 */
export class ProjectSession {
  readonly history: History<ProjectDocument>;
  /** Every version of every painted surface in this session (paint layers and masks), by content id. */
  readonly pixels = new PixelStore();
  /** Tile files already on disk (or on their way), so each tile is written once. */
  private readonly savedTiles = new Set<string>();
  /** Pixel writes in flight; the journal and checkpoints wait for them so they never refer to missing pixels. */
  private readonly barriers = new Set<Promise<void>>();
  private readonly failedPixels = new Map<string, PendingPixels>();
  private pending: JournalRecord[] = [];
  private chain: Promise<void> = Promise.resolve();
  private journalTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private sinceCheckpoint = 0;
  private statusValue: SaveStatus = 'saved';
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private readonly journalDelayMs: number;
  private readonly checkpointEvery: number;
  private readonly checkpointIdleMs: number;

  constructor(
    readonly id: string,
    initial: ProjectDocument,
    startSeq: number,
    private readonly storage: SessionStorage,
    private readonly options: SessionOptions = {},
  ) {
    this.journalDelayMs = options.journalDelayMs ?? 250;
    this.checkpointEvery = options.checkpointEvery ?? 50;
    this.checkpointIdleMs = options.checkpointIdleMs ?? 30_000;
    this.history = new History(initial, {
      startSeq,
      autoFreeze: options.autoFreeze ?? false,
      onRecord: (record) => this.onRecord(record),
    });
  }

  get status(): SaveStatus {
    return this.statusValue;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setStatus(next: SaveStatus): void {
    if (this.statusValue === next) return;
    this.statusValue = next;
    for (const listener of this.listeners) listener();
  }

  private onRecord(record: JournalRecord): void {
    if (this.disposed) return;
    this.pending.push(record);
    this.sinceCheckpoint += 1;
    this.setStatus('saving');
    this.journalTimer ??= setTimeout(() => {
      this.journalTimer = undefined;
      void this.flush();
    }, this.journalDelayMs);
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.checkpoint(), this.checkpointIdleMs);
  }

  /**
   * Make a new version of a painted surface from `base` with some tiles replaced. The pixels are available at once;
   * the disk write is queued and everything that records the change waits for it.
   */
  createPixelVersion(
    base: string | null,
    channels: Channels,
    changes: ReadonlyMap<string, Tile | null>,
  ): string {
    const contentId = crypto.randomUUID();
    const tiles = this.pixels.commit(contentId, base, changes);
    this.track(this.writePixels({ contentId, channels, tiles }));
    return contentId;
  }

  private track(write: Promise<void>): void {
    const tracked = write.finally(() => this.barriers.delete(tracked));
    this.barriers.add(tracked);
    tracked.catch((error: unknown) => {
      this.setStatus('error');
      this.options.onError?.(toAppError(error));
    });
  }

  private async writePixels(pending: PendingPixels): Promise<void> {
    const fresh = [...pending.tiles.values()].filter((tile) => !this.savedTiles.has(tile.id));
    for (const tile of fresh) this.savedTiles.add(tile.id);
    try {
      await this.storage.putPixels(
        this.id,
        pending.contentId,
        pending.channels,
        [...pending.tiles].map(([key, tile]) => ({ key, id: tile.id })),
        fresh.map((tile) => ({ id: tile.id, data: tile.data })),
      );
      this.failedPixels.delete(pending.contentId);
    } catch (error) {
      for (const tile of fresh) this.savedTiles.delete(tile.id);
      this.failedPixels.set(pending.contentId, pending);
      throw error;
    }
  }

  /** Wait for pixel writes, retrying any that failed earlier. Throws when pixels still cannot be saved. */
  private async settlePixels(): Promise<void> {
    await Promise.allSettled([...this.barriers]);
    for (const pending of [...this.failedPixels.values()]) await this.writePixels(pending);
  }

  /** Load the saved pixels for these content ids into memory (used when a project is opened). */
  async loadPixels(contentIds: Iterable<string>): Promise<void> {
    for (const contentId of new Set(contentIds)) {
      if (this.pixels.has(contentId)) continue;
      const saved = await this.storage.getPixels(this.id, contentId);
      if (!saved) {
        throw new AppError({
          code: 'invalid-project',
          message: 'Some painted pixels are missing from this project.',
          hint: 'Restore the project from a backup or an exported .msproj file.',
        });
      }
      const tiles = new Map<string, Tile>();
      for (const entry of saved.tiles) {
        const tile = createTile(entry.id, saved.channels, 0);
        tile.data.set(entry.data);
        tiles.set(entry.key, tile);
        this.savedTiles.add(entry.id);
      }
      this.pixels.set(contentId, tiles);
    }
  }

  /** Write pending changes to the journal now. */
  flush(): Promise<void> {
    clearTimeout(this.journalTimer);
    this.journalTimer = undefined;
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return this.chain;
    this.chain = this.chain.then(async () => {
      try {
        await this.settlePixels();
        await this.storage.appendJournal(this.id, batch);
        if (this.pending.length === 0) this.setStatus('saved');
        if (this.sinceCheckpoint >= this.checkpointEvery) await this.writeCheckpoint();
      } catch (error) {
        // Keep the records so the next flush retries them in order.
        this.pending = [...batch, ...this.pending];
        this.setStatus('error');
        this.options.onError?.(toAppError(error));
      }
    });
    return this.chain;
  }

  private async writeCheckpoint(): Promise<void> {
    await this.settlePixels();
    const seq = this.history.lastSeq;
    const state = this.history.state;
    await this.storage.checkpoint(this.id, state, seq);
    this.sinceCheckpoint = this.history.lastSeq - seq;
  }

  /** Flush, then write a full checkpoint including everything so far. */
  checkpoint(): Promise<void> {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    const flushed = this.flush();
    this.chain = flushed.then(async () => {
      if (this.pending.length > 0) return; // flush failed; do not checkpoint over unsaved records
      try {
        await this.writeCheckpoint();
        this.setStatus('saved');
      } catch (error) {
        this.setStatus('error');
        this.options.onError?.(toAppError(error));
      }
    });
    return this.chain;
  }

  /** Save everything and stop. Call when the project is closed. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.checkpoint();
    this.disposed = true;
    clearTimeout(this.journalTimer);
    clearTimeout(this.idleTimer);
  }
}
