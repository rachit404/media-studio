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
  /** Playback speed, 0.25 to 4 (absent = 1): the sound plays this much faster, so its pitch changes with it. */
  speed?: number;
  /** Linear gain at a timeline time (track volume, clip volume, fades). Absent = 1. */
  gainAt?: (timelineUs: number) => number;
}

/** Samples the meter looks at: about 40 ms at 48 kHz. */
const METER_WINDOW = 2048;

/** The largest absolute sample value. */
export function peakLevel(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.abs(samples[i] ?? 0);
    if (value > peak) peak = value;
  }
  return peak;
}

/** Level in decibels relative to full scale (0 dBFS = 1), with silence reported as `floor`. */
export function levelToDb(level: number, floor = -60): number {
  if (!(level > 0)) return floor;
  return Math.max(floor, 20 * Math.log10(level));
}

/** Where and how one decoded buffer of a slice is heard. */
export interface BufferPlacement {
  /** Timeline time of the start of the buffer, microseconds. */
  timeline: number;
  /** Audio-clock time to start it, seconds (now, when it is already late). */
  when: number;
  /** How far into the buffer to start, in file seconds (non-zero only when late). */
  offset: number;
  /** How late it is, in clock seconds. */
  late: number;
  /** How long what remains of it is heard, in clock seconds: the file runs `speed` times faster than the clock. */
  heardSeconds: number;
}

/**
 * Place a decoded buffer on the timeline and the audio clock. `sourceUs` is where in the file the buffer starts and
 * `seconds` how long it is (file seconds). `t0` is the clock time at which timeline time `startedUs` is heard. Null
 * when the buffer is already over.
 */
export function placeBuffer(
  slice: Pick<AudioSlice, 'start' | 'sourceStart' | 'speed'>,
  sourceUs: number,
  seconds: number,
  startedUs: number,
  t0: number,
  now: number,
): BufferPlacement | null {
  const speed = slice.speed ?? 1;
  const timeline = slice.start + (sourceUs - slice.sourceStart) / speed;
  let when = t0 + (timeline - startedUs) / 1_000_000;
  let late = 0;
  let offset = 0;
  if (when < now) {
    // Already late (start of a seek, or the clip began before the playhead): play from the middle.
    late = now - when;
    offset = late * speed;
    when = now;
    if (offset >= seconds) return null;
  }
  return { timeline, when, offset, late, heardSeconds: (seconds - offset) / speed };
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

  /** Everything is mixed here, then heard and measured (the master meter). */
  private readonly master: GainNode;
  private readonly meters: [AnalyserNode, AnalyserNode];
  private readonly meterData: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];

  constructor(context?: AudioContext) {
    this.context = context ?? new AudioContext({ latencyHint: 'interactive' });
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
    const splitter = this.context.createChannelSplitter(2);
    this.master.connect(splitter);
    const analyser = () => {
      const node = this.context.createAnalyser();
      node.fftSize = METER_WINDOW;
      return node;
    };
    this.meters = [analyser(), analyser()];
    this.meters.forEach((node, channel) => {
      splitter.connect(node, channel);
    });
    this.meterData = [new Float32Array(METER_WINDOW), new Float32Array(METER_WINDOW)];
  }

  /**
   * The loudest sample of the mix in each channel over the last moment (about 40 ms): 1 is full scale, and more
   * than 1 means the sound is too loud and clips (export clips it too). Zero while nothing plays.
   */
  levels(): { left: number; right: number } {
    const [left, right] = this.meters;
    const [leftData, rightData] = this.meterData;
    left.getFloatTimeDomainData(leftData);
    right.getFloatTimeDomainData(rightData);
    return { left: peakLevel(leftData), right: peakLevel(rightData) };
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
    const speed = slice.speed ?? 1;
    const from = slice.sourceStart / 1_000_000;
    // The file is used `speed` times as fast as the timeline runs.
    const to = (slice.sourceStart + (slice.clipEnd - slice.start) * speed) / 1_000_000;
    for await (const { buffer, timestamp } of sink.buffers(from, to)) {
      if (generation !== this.generation) return;
      const placed = placeBuffer(
        slice,
        secondsToTime(timestamp),
        buffer.duration,
        startedUs,
        t0,
        this.context.currentTime,
      );
      if (!placed) continue;
      const { timeline, offset, late, heardSeconds } = placed;
      const when = placed.when;
      // Stay about a second ahead of the clock; wait here while far enough in front.
      while (when - this.context.currentTime > AHEAD) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (generation !== this.generation) return;
      }
      const node = this.context.createBufferSource();
      node.buffer = buffer;
      const gain = this.context.createGain();
      node.playbackRate.value = speed;
      applyGain(gain, slice.gainAt, timeline + late * 1_000_000, heardSeconds, when);
      node.connect(gain).connect(this.master);
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
