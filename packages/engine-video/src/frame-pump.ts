import type { Closable } from './frame-cache';

export interface TimedFrame<T> {
  frame: T;
  /** Position of the picture in its source file, microseconds. */
  timestamp: number;
}

/** Something that decodes a file's pictures in order, starting at (or just before) a time. */
export interface FrameStreamSource<T> {
  frames(startUs: number): AsyncGenerator<TimedFrame<T>, void, undefined>;
}

/**
 * Reads decoded pictures ahead of the playhead for one clip. `start` begins decoding at a source time and keeps a
 * short queue filled; `frameFor` hands out the picture that belongs at a time and closes the ones that are already
 * in the past. Starting again (a seek) abandons the old stream, so only the latest request matters, and every
 * picture is closed exactly once (`created - closed` is what is alive).
 */
export class FramePump<T extends Closable> {
  private queue: TimedFrame<T>[] = [];
  private generation = 0;
  private iterator: AsyncGenerator<TimedFrame<T>, void, undefined> | null = null;
  private ended = false;
  private failure: unknown = null;
  private onChange: (() => void)[] = [];
  private onSpace: (() => void) | null = null;
  created = 0;
  closed = 0;

  constructor(
    private readonly source: FrameStreamSource<T>,
    private readonly lookahead = 6,
  ) {}

  get alive(): number {
    return this.created - this.closed;
  }
  get queued(): number {
    return this.queue.length;
  }
  /** Set when decoding failed; the owner can show the clip as unavailable. */
  get error(): unknown {
    return this.failure;
  }
  get finished(): boolean {
    return this.ended;
  }

  /** Begin decoding at `startUs`, dropping everything from before. */
  start(startUs: number): void {
    this.stop();
    this.ended = false;
    this.failure = null;
    const generation = this.generation;
    this.iterator = this.source.frames(Math.max(0, startUs));
    void this.fill(generation, this.iterator);
  }

  /** Stop decoding and close every picture that is held. */
  stop(): void {
    this.generation += 1;
    for (const entry of this.queue) this.close(entry.frame);
    this.queue = [];
    const iterator = this.iterator;
    this.iterator = null;
    if (iterator) void iterator.return().catch(() => undefined);
    this.wakeFill();
    this.notify();
  }

  /** Resolves once a picture is ready, or decoding ended or failed. */
  ready(): Promise<void> {
    if (this.queue.length > 0 || this.ended || this.failure !== null) return Promise.resolve();
    return new Promise((resolve) => this.onChange.push(resolve));
  }

  /**
   * Resolves when the picture for `sourceUs` is certain: a later picture is already queued, or the file ended, or
   * decoding failed. Used by export, which must show exactly the right picture and cannot drop frames.
   */
  async settled(sourceUs: number): Promise<void> {
    while (
      this.failure === null &&
      !this.ended &&
      !((this.queue.at(-1)?.timestamp ?? -1) > sourceUs)
    ) {
      await new Promise<void>((resolve) => this.onChange.push(resolve));
      // Make room by discarding pictures that are already in the past, or reading would stop at the lookahead.
      this.frameFor(sourceUs);
    }
  }

  /**
   * The picture to show at `sourceUs`: the last one that is not after it. Pictures before that are closed. Returns
   * null while nothing is ready. The picture stays valid until the next call to `frameFor`, `start` or `stop`.
   */
  frameFor(sourceUs: number): TimedFrame<T> | null {
    let dropped = false;
    while (this.queue.length > 1 && (this.queue[1]?.timestamp ?? Infinity) <= sourceUs) {
      const old = this.queue.shift();
      if (old) this.close(old.frame);
      dropped = true;
    }
    if (dropped) this.wakeFill();
    return this.queue[0] ?? null;
  }

  private close(frame: T): void {
    frame.close();
    this.closed += 1;
  }

  private notify(): void {
    const waiting = this.onChange;
    this.onChange = [];
    for (const resolve of waiting) resolve();
  }

  private wakeFill(): void {
    const wake = this.onSpace;
    this.onSpace = null;
    wake?.();
  }

  private async fill(
    generation: number,
    iterator: AsyncGenerator<TimedFrame<T>, void, undefined>,
  ): Promise<void> {
    while (generation === this.generation) {
      if (this.queue.length >= this.lookahead) {
        await new Promise<void>((resolve) => {
          this.onSpace = resolve;
        });
        continue;
      }
      let next: IteratorResult<TimedFrame<T>, void>;
      try {
        next = await iterator.next();
      } catch (error) {
        if (generation === this.generation) {
          this.failure = error;
          this.notify();
        }
        return;
      }
      if (next.done) {
        if (generation === this.generation) {
          this.ended = true;
          this.notify();
        }
        return;
      }
      this.created += 1;
      if (generation !== this.generation) {
        this.close(next.value.frame);
        return;
      }
      this.queue.push(next.value);
      this.notify();
    }
  }
}
