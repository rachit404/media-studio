import { Immer, enablePatches, type Draft, type Patch } from 'immer';

enablePatches();

/** The only way to change a document. Recorded as Immer patches so it can be undone, redone and journaled. */
export interface Command<D> {
  readonly label: string;
  /** Consecutive commands with the same key (slider drag, typing a name) merge into one history entry. */
  readonly coalesceKey?: string;
  apply(draft: Draft<D>): void;
}

/** One applied change, in the order it happened. Replaying records over a checkpoint reproduces the state. */
export interface JournalRecord {
  readonly seq: number;
  readonly label: string;
  readonly patches: readonly Patch[];
}

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  coalesceKey: string | undefined;
  time: number;
}

export interface HistoryOptions {
  /** Freeze states to catch accidental mutation. On in development and tests, off in production (faster). */
  autoFreeze?: boolean;
  /** Maximum time between two edits for them to coalesce. Default 1000 ms. */
  coalesceWindowMs?: number;
  /** Undo depth. Default 1000. */
  maxEntries?: number;
  now?: () => number;
  /** Called for every change to the state (execute, undo and redo) so a journal can persist it. */
  onRecord?: (record: JournalRecord) => void;
  /** Sequence number of the last record already included in `initial`. */
  startSeq?: number;
}

export class History<D extends object> {
  private current: D;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private seq: number;
  private version = 0;
  private readonly immer: Immer;
  private readonly listeners = new Set<() => void>();
  private readonly coalesceWindowMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly onRecord: ((record: JournalRecord) => void) | undefined;

  constructor(initial: D, options: HistoryOptions = {}) {
    this.current = initial;
    this.seq = options.startSeq ?? 0;
    this.immer = new Immer({ autoFreeze: options.autoFreeze ?? false });
    this.coalesceWindowMs = options.coalesceWindowMs ?? 1000;
    this.maxEntries = options.maxEntries ?? 1000;
    this.now = options.now ?? Date.now;
    this.onRecord = options.onRecord;
  }

  get state(): D {
    return this.current;
  }
  get lastSeq(): number {
    return this.seq;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }
  /** Changes on every state change; use as a useSyncExternalStore snapshot. */
  getVersion(): number {
    return this.version;
  }

  /** Apply a command. Returns false (and records nothing) when it changed nothing. */
  execute(command: Command<D>): boolean {
    const [next, patches, inverse] = this.immer.produceWithPatches(this.current, (draft) => {
      command.apply(draft);
    });
    if (patches.length === 0) return false;

    const time = this.now();
    const last = this.undoStack.at(-1);
    const canMerge =
      command.coalesceKey !== undefined &&
      last !== undefined &&
      last.coalesceKey === command.coalesceKey &&
      this.redoStack.length === 0 &&
      time - last.time <= this.coalesceWindowMs;

    if (canMerge && last) {
      last.patches = [...last.patches, ...patches];
      last.inverse = [...inverse, ...last.inverse];
      last.label = command.label;
      last.time = time;
    } else {
      this.undoStack.push({
        label: command.label,
        patches,
        inverse,
        coalesceKey: command.coalesceKey,
        time,
      });
      if (this.undoStack.length > this.maxEntries) this.undoStack.shift();
    }
    this.redoStack = [];
    this.commit(next, command.label, patches);
    return true;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push(entry);
    this.commit(
      this.immer.applyPatches(this.current, entry.inverse),
      `Undo ${entry.label}`,
      entry.inverse,
    );
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push(entry);
    this.commit(
      this.immer.applyPatches(this.current, entry.patches),
      `Redo ${entry.label}`,
      entry.patches,
    );
    return true;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private commit(next: D, label: string, patches: readonly Patch[]): void {
    this.current = next;
    this.seq += 1;
    this.version += 1;
    this.onRecord?.({ seq: this.seq, label, patches });
    for (const listener of this.listeners) listener();
  }
}
