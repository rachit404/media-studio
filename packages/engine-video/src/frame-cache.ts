/** Something that holds memory until it is closed (an ImageBitmap, a VideoFrame). */
export interface Closable {
  close(): void;
}

export interface FrameCacheOptions {
  /** Most entries kept. */
  maxEntries: number;
  /** Most bytes kept (entries report their own size). */
  maxBytes: number;
}

interface Entry<T> {
  value: T;
  bytes: number;
}

/**
 * Least-recently-used cache of decoded pictures. Every entry that leaves the cache (evicted, replaced, removed or
 * cleared) is closed exactly once, and the counters let tests and diagnostics prove nothing leaks: `created -
 * closed` is what is still alive.
 */
export class FrameCache<T extends Closable> {
  private readonly entries = new Map<string, Entry<T>>();
  private totalBytes = 0;
  created = 0;
  closed = 0;

  constructor(private readonly options: FrameCacheOptions) {}

  get size(): number {
    return this.entries.size;
  }
  get bytes(): number {
    return this.totalBytes;
  }
  /** Pictures handed in and not yet closed. */
  get alive(): number {
    return this.created - this.closed;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** The picture, marked as recently used. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /** Keep a picture. The cache owns it from now on. A picture already stored under the key is closed. */
  set(key: string, value: T, bytes: number): void {
    this.created += 1;
    this.remove(key);
    this.entries.set(key, { value, bytes });
    this.totalBytes += bytes;
    while (
      this.entries.size > 1 &&
      (this.entries.size > this.options.maxEntries || this.totalBytes > this.options.maxBytes)
    ) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.remove(oldest.value);
    }
  }

  remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
    entry.value.close();
    this.closed += 1;
  }

  /** Remove every entry whose key matches. */
  removeWhere(predicate: (key: string) => boolean): void {
    for (const key of [...this.entries.keys()]) if (predicate(key)) this.remove(key);
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) this.remove(key);
  }
}
