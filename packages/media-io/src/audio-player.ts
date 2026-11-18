import { secondsToTime } from '@media-studio/core';
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';

/** A stretch of a file to play at a place on the timeline. */
export interface AudioSlice {
  clipId: string;
  blob: Blob;
  /** Timeline time (microseconds) where the sound starts and ends. */
  start: number;
  end: number;
  /** Where the whole clip ends on the timeline; sound is played to there once the clip has started. */
  clipEnd: number;
  /** Where in the file it starts (microseconds). */
  sourceStart: number;
  /** Linear gain at a timeline time (track volume, clip volume, fades). Absent = 1. */
  gainAt?: (timelineUs: number) => number;
}

/** Curve points per second of sound; 200 keeps a fade smooth (5 ms steps). */
const GAIN_POINTS_PER_SECOND = 200;

/**
 * Set the gain of one scheduled buffer so it follows `gainAt` over the stretch that will be heard: starting at
 * timeline time `fromUs`, `seconds` long, beginning at audio-clock time `when`.
 */
export function applyGain(
  node: GainNode,
  gainAt: ((timelineUs: number) => number) | undefined,
  fromUs: number,
  seconds: number,
  when: number,
): void {
  if (!gainAt || seconds <= 0) return;
  const points = Math.max(2, Math.ceil(seconds * GAIN_POINTS_PER_SECOND) + 1);
  const curve = new Float32Array(points);
  let flat = true;
  for (let i = 0; i < points; i += 1) {
    curve[i] = gainAt(fromUs + (seconds * 1_000_000 * i) / (points - 1));
    if (curve[i] !== curve[0]) flat = false;
  }
  if (flat) node.gain.value = curve[0] ?? 1;
  else node.gain.setValueCurveAtTime(curve, when, seconds);
}

interface OpenFile {
  input: Input;
  sink: AudioBufferSink;
}

/** How far ahead of the clock sound is scheduled, seconds. */
const AHEAD = 1;
/** Start a little in the future so the first buffers are ready. */
const LEAD_IN = 0.06;

/**
 * Plays the timeline's sound with the Web Audio clock. The audio clock is also the master clock for the picture,
 * so sound never drifts or stalls: the picture follows it. Buffers are scheduled about a second ahead and stopped
 * when playback pauses or jumps.
 */
export class AudioPlayer {
  private readonly context: AudioContext;
  private readonly files = new Map<Blob, Promise<OpenFile>>();
  private nodes = new Set<AudioBufferSourceNode>();
  private generation = 0;

  constructor(context?: AudioContext) {
    this.context = context ?? new AudioContext({ latencyHint: 'interactive' });
  }

  /** The audio clock in microseconds. Steady and monotonic, also while nothing plays. */
  clockUs(): number {
    return this.context.currentTime * 1_000_000;
  }

  /** Whether the audio clock is running (it is not until the user has interacted with the page). */
  get running(): boolean {
    return this.context.state === 'running';
  }

  /** Browsers start audio contexts suspended until the user acts; call this from a click or key press. */
  async resume(): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
  }

  private open(blob: Blob): Promise<OpenFile> {
    let entry = this.files.get(blob);
    if (!entry) {
      entry = (async () => {
        const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        const track = await input.getPrimaryAudioTrack();
        if (!track) throw new Error('no audio track');
        return { input, sink: new AudioBufferSink(track) };
      })();
      this.files.set(blob, entry);
    }
    return entry;
  }

  /**
   * Start playing at timeline time `from`. `slices` returns the sound that falls in a window of the timeline.
   * Returns the audio-clock time (microseconds) at which timeline time `from` is heard, which the picture
   * transport uses to line itself up.
   */
  play(from: number, slices: (windowStart: number, windowEnd: number) => AudioSlice[]): number {
    this.stop();
    const generation = this.generation;
    const t0 = this.context.currentTime + LEAD_IN;
    const startedUs = from;
    const feeders = new Map<string, Promise<void>>();

    // Look for new sound every 250 ms (clips that begin later in the window are picked up as they come).
    const scheduleWindow = () => {
      if (generation !== this.generation) return;
      const elapsed = Math.max(0, this.context.currentTime - t0);
      const windowStart = startedUs + elapsed * 1_000_000;
      for (const slice of slices(windowStart, windowStart + (AHEAD + 0.5) * 1_000_000)) {
        // One feeder per clip: it plays the clip from where we first met it to its end.
        const key = slice.clipId;
        if (feeders.has(key)) continue;
        feeders.set(
          key,
          this.feed(slice, startedUs, t0, generation).catch(() => undefined),
        );
      }
      window.setTimeout(scheduleWindow, 250);
    };
    scheduleWindow();
    return t0 * 1_000_000;
  }

  private async feed(
    slice: AudioSlice,
    startedUs: number,
    t0: number,
    generation: number,
  ): Promise<void> {
    const { sink } = await this.open(slice.blob);
    const from = slice.sourceStart / 1_000_000;
    const to = (slice.sourceStart + (slice.clipEnd - slice.start)) / 1_000_000;
    for await (const { buffer, timestamp } of sink.buffers(from, to)) {
      if (generation !== this.generation) return;
      // Where this buffer belongs on the timeline, and on the audio clock.
      const timeline = slice.start + secondsToTime(timestamp) - slice.sourceStart;
      let when = t0 + (timeline - startedUs) / 1_000_000;
      let offset = 0;
      if (when < this.context.currentTime) {
        // Already late (start of a seek, or the clip began before the playhead): play from the middle.
        offset = this.context.currentTime - when;
        when = this.context.currentTime;
        if (offset >= buffer.duration) continue;
      }
      // Stay about a second ahead of the clock; wait here while far enough in front.
      while (when - this.context.currentTime > AHEAD) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (generation !== this.generation) return;
      }
      const node = this.context.createBufferSource();
      node.buffer = buffer;
      const gain = this.context.createGain();
      applyGain(gain, slice.gainAt, timeline + offset * 1_000_000, buffer.duration - offset, when);
      node.connect(gain).connect(this.context.destination);
      node.addEventListener('ended', () => {
        this.nodes.delete(node);
        gain.disconnect();
      });
      this.nodes.add(node);
      node.start(when, offset);
    }
  }

  /** Stop all sound now and forget what was scheduled. */
  stop(): void {
    this.generation += 1;
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        // Already stopped.
      }
    }
    this.nodes.clear();
  }

  /** Release the files and the audio context. */
  async dispose(): Promise<void> {
    this.stop();
    for (const entry of this.files.values()) {
      void entry.then(({ input }) => input.dispose()).catch(() => undefined);
    }
    this.files.clear();
    await this.context.close().catch(() => undefined);
  }
}
