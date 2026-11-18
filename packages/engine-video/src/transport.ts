import { frameToTime, timeToFrame, type FrameRate } from '@media-studio/core';

export interface TransportOptions {
  /** A steady clock in microseconds (the audio clock while sound plays, otherwise the page clock). */
  clock: () => number;
}

/** Counters shown in diagnostics (PERF-2: dropped frames under 2% on the reference project). */
export interface PlaybackStats {
  presented: number;
  dropped: number;
}

/**
 * Play, pause and seek on the timeline. Pure logic: the owner calls `tick()` once per displayed frame and draws
 * what is at `time`. While playing, `time` follows the clock exactly, so a slow frame never slows the sound;
 * the picture simply skips ahead (the frames skipped are counted as dropped).
 */
export class Transport {
  private current = 0;
  private startedAtClock = 0;
  private startedAtTime = 0;
  private lastFrame = -1;
  private length = 0;
  private isPlaying = false;
  readonly stats: PlaybackStats = { presented: 0, dropped: 0 };

  constructor(
    private readonly options: TransportOptions,
    private fps: FrameRate,
  ) {}

  get time(): number {
    return this.current;
  }
  get playing(): boolean {
    return this.isPlaying;
  }
  get duration(): number {
    return this.length;
  }

  setFrameRate(fps: FrameRate): void {
    this.fps = fps;
  }

  /** The length of the sequence; playback stops there and seeking is clamped to it. */
  setDuration(duration: number): void {
    this.length = Math.max(0, Math.round(duration));
    if (this.current > this.length) this.seek(this.length);
  }

  seek(time: number): void {
    this.current = Math.min(Math.max(0, Math.round(time)), this.length);
    if (this.isPlaying) {
      this.startedAtClock = this.options.clock();
      this.startedAtTime = this.current;
    }
    this.lastFrame = timeToFrame(this.current, this.fps);
  }

  /** Move by whole frames (negative goes back), landing exactly on a frame start. */
  stepFrames(frames: number): void {
    this.pause();
    const frame = Math.max(0, timeToFrame(this.current, this.fps) + Math.trunc(frames));
    this.seek(frameToTime(frame, this.fps));
  }

  /**
   * Start (or, while playing, re-anchor) playback. `atClock` is the clock time at which the current time is
   * heard; sound is scheduled a moment ahead, so the picture is told when that moment is.
   */
  play(atClock?: number): void {
    if (this.isPlaying) {
      if (atClock !== undefined) {
        this.startedAtClock = atClock;
        this.startedAtTime = this.current;
      }
      return;
    }
    if (this.current >= this.length) this.current = 0;
    this.isPlaying = true;
    this.startedAtClock = atClock ?? this.options.clock();
    this.startedAtTime = this.current;
    this.lastFrame = timeToFrame(this.current, this.fps);
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.tick();
    this.isPlaying = false;
  }

  toggle(): void {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  /** Advance to the clock. Returns the time to draw. Stops itself at the end. */
  tick(): number {
    if (!this.isPlaying) return this.current;
    const elapsed = this.options.clock() - this.startedAtClock;
    const next = this.startedAtTime + Math.max(0, elapsed);
    if (next >= this.length) {
      this.current = this.length;
      this.isPlaying = false;
      return this.current;
    }
    this.current = Math.round(next);
    const frame = timeToFrame(this.current, this.fps);
    if (frame !== this.lastFrame) {
      this.stats.presented += 1;
      this.stats.dropped += Math.max(0, frame - this.lastFrame - 1);
      this.lastFrame = frame;
    }
    return this.current;
  }

  /** Percentage of frames the display could not show in time since playback started (0..100). */
  get droppedPercent(): number {
    const total = this.stats.presented + this.stats.dropped;
    return total === 0 ? 0 : (this.stats.dropped / total) * 100;
  }
}
