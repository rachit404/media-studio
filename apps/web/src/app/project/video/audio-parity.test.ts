import {
  History,
  addAssets,
  addMediaToTimeline,
  addTrack,
  clipEnd,
  createProject,
  setClipLook,
  setClipSpeed,
  setTrackState,
  type NewAsset,
  type VideoContent,
} from '@media-studio/core';
import { audioSegments, mixAudioBlock, type AudioReader } from '@media-studio/engine-video';
import { applyGain, placeBuffer } from '@media-studio/media-io';
import { describe, expect, it } from 'vitest';

/**
 * M6 acceptance: the sound heard while playing (preview) and the sound written by export agree.
 *
 * The preview side runs the REAL live-player code that does not need a browser (`audioSegments` for what plays and
 * where, `placeBuffer` for where each decoded buffer sits, `applyGain` for the gain curve of each buffer) and renders
 * what Web Audio would do with it: the file is played `speed` times as fast with straight-line resampling, times the
 * gain curve (straight lines between its points, as `setValueCurveAtTime` does), summed over tracks and limited to
 * -1..1. The export side is `mixAudioBlock`. Not covered, because it needs a browser: decoder chunk sizes, the real
 * resampler of `AudioBufferSourceNode` and scheduling jitter. The test file is a smooth sine, so the resampling
 * model is not what is being measured.
 */
const S = 1_000_000;
const RATE = 1000; // one sample per millisecond keeps the arrays small
/** Largest allowed difference per sample (full scale is 1). */
const TOLERANCE = 1e-3;

const FILE_SIGNALS: Record<string, (seconds: number) => number> = {
  a: (t) => 0.4 * Math.sin(2 * Math.PI * 5 * t),
  b: (t) => 0.3 * Math.cos(2 * Math.PI * 3 * t),
};

const song = (id: string): NewAsset => ({
  id,
  kind: 'audio',
  name: `${id}.wav`,
  mime: 'audio/wav',
  size: 1,
  duration: 30 * S,
  audio: { sampleRate: RATE, channels: 2, codec: 'pcm' },
  file: `media/${id}.wav`,
  peaks: null,
});

const reader = (assetId: string): AudioReader => ({
  read(startUs, frames, rate) {
    const signal = FILE_SIGNALS[assetId] ?? (() => 0);
    const samples = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) samples[i] = signal(startUs / S + i / rate);
    return Promise.resolve([samples, samples.slice()]);
  },
});

/** Two audio tracks, A1 and A2, with one 6 s clip each at time 0 (A2's file is a different sound). */
function setup() {
  const history = new History(
    createProject({ id: 'p', name: 'M', type: 'video', createdAt: '2026-11-19T10:00:00.000Z' }),
  );
  history.execute(addAssets([song('a'), song('b')]));
  history.execute(addTrack('audio', 'A2'));
  for (const [assetId, trackId] of [
    ['a', 'A1'],
    ['b', 'A2'],
  ] as const) {
    history.execute(
      addMediaToTimeline({
        assetId,
        start: 0,
        clipId: `c-${assetId}`,
        audioClipId: `c-${assetId}`,
        linkId: `l-${assetId}`,
        audioTrackId: trackId,
        duration: 6 * S,
      }),
    );
  }
  const content = (): VideoContent => {
    if (history.state.content.kind !== 'video') throw new Error('video');
    return history.state.content;
  };
  return { history, content };
}

interface GainCurve {
  at(timelineUs: number): number;
}

/** What `applyGain` leaves on a gain node, read back the way Web Audio evaluates it. */
function captureGain(
  gainAt: ((timelineUs: number) => number) | undefined,
  fromUs: number,
  seconds: number,
  when: number,
): GainCurve {
  let flat = 1;
  let curve: Float32Array | null = null;
  const node = {
    gain: {
      get value() {
        return flat;
      },
      set value(next: number) {
        flat = next;
      },
      setValueCurveAtTime(values: Float32Array) {
        curve = values;
      },
    },
  } as unknown as GainNode;
  applyGain(node, gainAt, fromUs, seconds, when);
  return {
    at(timelineUs) {
      if (!curve) return flat;
      const position = ((timelineUs - fromUs) / (seconds * S)) * (curve.length - 1);
      const index = Math.min(curve.length - 1, Math.max(0, Math.floor(position)));
      const next = Math.min(curve.length - 1, index + 1);
      const fraction = Math.min(1, Math.max(0, position - index));
      return (curve[index] ?? 0) * (1 - fraction) + (curve[next] ?? 0) * fraction;
    },
  };
}

/** The sound of `[fromUs, toUs)` as the live player would schedule and shape it, one sample per millisecond. */
function liveMix(
  content: VideoContent,
  assets: Parameters<typeof audioSegments>[1],
  fromUs: number,
  toUs: number,
  chunkSeconds: number,
): Float32Array {
  const frames = Math.round((toUs - fromUs) / 1000);
  const out = new Float32Array(frames);
  for (const segment of audioSegments(content, assets, fromUs, toUs)) {
    const signal = FILE_SIGNALS[segment.assetId] ?? (() => 0);
    const slice = { start: segment.start, sourceStart: segment.sourceStart, speed: segment.speed };
    // The player feeds the file from where it first meets the clip to the end of the clip.
    const fileEnd = segment.sourceStart + (segment.clipEnd - segment.start) * segment.speed;
    for (let sourceUs = segment.sourceStart; sourceUs < fileEnd; sourceUs += chunkSeconds * S) {
      const seconds = Math.min(chunkSeconds, (fileEnd - sourceUs) / S);
      const placed = placeBuffer(slice, sourceUs, seconds, fromUs, 0, 0);
      if (!placed) continue;
      const heardFrom = placed.timeline + placed.late * S;
      const gain = captureGain(segment.gainAt, heardFrom, placed.heardSeconds, placed.when);
      const first = Math.ceil((heardFrom - fromUs) / 1000);
      for (let i = first; i < frames; i += 1) {
        const timelineUs = fromUs + i * 1000;
        if (timelineUs >= heardFrom + placed.heardSeconds * S) break;
        const fileUs = sourceUs + placed.offset * S + (timelineUs - heardFrom) * segment.speed;
        out[i] = (out[i] ?? 0) + signal(fileUs / S) * gain.at(timelineUs);
      }
    }
  }
  return out.map((sample) => Math.max(-1, Math.min(1, sample)));
}

async function exportMix(
  content: VideoContent,
  assets: Parameters<typeof audioSegments>[1],
  fromUs: number,
  toUs: number,
): Promise<Float32Array> {
  const [left] = await mixAudioBlock(
    content,
    assets,
    reader,
    Math.round((fromUs * RATE) / S),
    Math.round((toUs - fromUs) / 1000),
    RATE,
  );
  return left;
}

function worstDifference(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i += 1)
    worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return worst;
}

const loudest = (samples: Float32Array) => samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Compares both mixes over `[fromUs, end of the last clip + 0.5 s)` and returns them for further checks. */
async function compare(
  setupResult: ReturnType<typeof setup>,
  fromUs = 0,
  chunkSeconds = 0.5,
): Promise<{ live: Float32Array; offline: Float32Array; worst: number }> {
  const { history, content } = setupResult;
  const assets = history.state.assets.byId;
  const end = Math.max(...Object.values(content().clips).map((clip) => clipEnd(clip))) + 0.5 * S;
  const live = liveMix(content(), assets, fromUs, end, chunkSeconds);
  const offline = await exportMix(content(), assets, fromUs, end);
  return { live, offline, worst: worstDifference(live, offline) };
}

describe('preview and export sound agree within 1e-3 per sample', () => {
  it('with no changes: two tracks summed', async () => {
    const result = await compare(setup());
    expect(loudest(result.offline)).toBeGreaterThan(0.3);
    expect(result.worst).toBeLessThan(TOLERANCE);
  });

  it('clip volume', async () => {
    const parts = setup();
    parts.history.execute(setClipLook(['c-a'], { volume: 0.5 }));
    parts.history.execute(setClipLook(['c-b'], { volume: 1.5 }));
    const result = await compare(parts);
    expect(result.worst).toBeLessThan(TOLERANCE);
  });

  it('track volume times clip volume', async () => {
    const parts = setup();
    parts.history.execute(setTrackState('A1', { volume: 0.5 }));
    parts.history.execute(setClipLook(['c-a'], { volume: 0.8 }));
    const result = await compare(parts);
    expect(result.worst).toBeLessThan(TOLERANCE);
  });

  it('fades in and out', async () => {
    const parts = setup();
    parts.history.execute(setTrackState('A2', { muted: true }));
    parts.history.execute(setClipLook(['c-a'], { fadeIn: S, fadeOut: 2 * S }));
    const result = await compare(parts);
    expect(result.worst).toBeLessThan(TOLERANCE);
    // The fade is really in the sound: the first moments are quiet and the middle is not.
    expect(loudest(result.offline.slice(0, 20))).toBeLessThan(0.05);
    expect(loudest(result.offline.slice(2000, 3000))).toBeGreaterThan(0.3);
  });

  it('solo: only the soloed track is heard, in both', async () => {
    const parts = setup();
    parts.history.execute(setTrackState('A2', { solo: true }));
    const solo = await compare(parts);
    expect(solo.worst).toBeLessThan(TOLERANCE);
    parts.history.execute(setTrackState('A2', { muted: true }));
    const silent = await compare(parts);
    expect(loudest(silent.offline)).toBe(0);
    expect(loudest(silent.live)).toBe(0);
  });

  it.each([0.5, 2, 4])('speed %s times (pitch follows speed)', async (speed) => {
    const parts = setup();
    parts.history.execute(setClipSpeed('c-a', speed));
    const result = await compare(parts);
    expect(loudest(result.offline)).toBeGreaterThan(0.3);
    expect(result.worst).toBeLessThan(TOLERANCE);
  });

  it('everything together: speed, fades, volumes, two tracks', async () => {
    const parts = setup();
    parts.history.execute(setClipSpeed('c-a', 2));
    parts.history.execute(setClipLook(['c-a'], { volume: 0.9, fadeIn: S / 2, fadeOut: S }));
    parts.history.execute(setClipSpeed('c-b', 0.5));
    parts.history.execute(setClipLook(['c-b'], { volume: 0.7, fadeOut: 2 * S }));
    parts.history.execute(setTrackState('A2', { volume: 0.6 }));
    const result = await compare(parts);
    expect(result.worst).toBeLessThan(TOLERANCE);
  });

  it('starting in the middle of a clip (a seek) and with small decoder buffers', async () => {
    const parts = setup();
    parts.history.execute(setClipSpeed('c-b', 2));
    parts.history.execute(setClipLook(['c-a', 'c-b'], { fadeIn: S, fadeOut: S }));
    for (const chunk of [0.021, 0.5, 1.37]) {
      const result = await compare(parts, 1_300_000, chunk);
      expect(result.worst).toBeLessThan(TOLERANCE);
    }
  });

  it('limits the sum to -1..1 in both', async () => {
    const parts = setup();
    parts.history.execute(setClipLook(['c-a', 'c-b'], { volume: 4 }));
    const result = await compare(parts);
    expect(loudest(result.offline)).toBeLessThanOrEqual(1);
    expect(loudest(result.live)).toBeLessThanOrEqual(1);
    expect(result.worst).toBeLessThan(TOLERANCE);
  });
});
