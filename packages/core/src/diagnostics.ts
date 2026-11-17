export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly id: number;
  readonly time: number;
  readonly level: LogLevel;
  readonly source: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

export interface DiagnosticsLog {
  log(level: LogLevel, source: string, message: string, data?: Record<string, unknown>): void;
  entries(): readonly LogEntry[];
  clear(): void;
  /** Notified after every change. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Plain-text export for the user to review before sharing. Nothing is sent anywhere automatically. */
  toText(): string;
}

export interface DiagnosticsOptions {
  capacity?: number;
  now?: () => number;
}

/** Local-only ring buffer of diagnostic events (OBS-1). */
export function createDiagnosticsLog(options: DiagnosticsOptions = {}): DiagnosticsLog {
  const capacity = Math.max(1, options.capacity ?? 500);
  const now = options.now ?? Date.now;
  let nextId = 1;
  let items: readonly LogEntry[] = [];
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    log(level, source, message, data) {
      const entry: LogEntry = {
        id: nextId++,
        time: now(),
        level,
        source,
        message,
        ...(data ? { data } : {}),
      };
      // Immutable snapshots keep useSyncExternalStore consumers correct.
      items = [...items, entry].slice(-capacity);
      notify();
    },
    entries: () => items,
    clear() {
      items = [];
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    toText() {
      return items
        .map((e) => {
          const time = new Date(e.time).toISOString();
          const detail = e.data ? ` ${safeStringify(e.data)}` : '';
          return `${time} ${e.level.toUpperCase()} [${e.source}] ${e.message}${detail}`;
        })
        .join('\n');
    },
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserialisable data]';
  }
}
