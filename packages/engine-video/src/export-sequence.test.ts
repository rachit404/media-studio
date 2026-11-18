import { fakeMetrics } from './fake-metrics';
import {
  AppError,
  FPS_30,
  History,
  addAssets,
  addMediaToTimeline,
  addTrack,
  createProject,
  type FrameRate,
  type NewAsset,
  type VideoContent,
} from '@media-studio/core';
import type { RenderScene } from '@media-studio/render';
import { describe, expect, it } from 'vitest';
import type { AudioReader } from './audio-mix';
import {
  exportFrameCount,
  exportSequence,
  hasExportAudio,
  type ExportDependencies,
  type ExportFrame,
  type ExportSink,
} from './export-sequence';
import type { FrameStreamSource, TimedFrame } from './frame-pump';

const S = 1_000_000;
const RATE = 1000;

const VIDEO: NewAsset = {
  id: 'vid',
  kind: 'video',
  name: 'v.mp4',
  mime: 'video/mp4',
  size: 1,
  width: 64,
  height: 48,
  duration: 10 * S,
  fps: FPS_30,
  codec: 'avc1',
  keyframeInterval: S,
  audio: { sampleRate: RATE, channels: 2, codec: 'aac' },
  file: 'media/v.mp4',
  thumb: 'thumbs/v.webp',
  peaks: null,
};
const SILENT: NewAsset = { ...VIDEO, id: 'mute', audio: null, file: 'media/m.mp4' };

interface Frame extends ExportFrame {
  id: number;
  closed: number;
}

/** Fakes for everything outside the sequence: decoding, drawing and encoding. */
function fakes(
  options: { failDecode?: boolean; cancelAfter?: number; controller?: AbortController } = {},
) {
  const frames: Frame[] = [];
  const log = {
    uploads: [] as string[],
    deleted: [] as string[],
    scenes: [] as RenderScene[],
    video: [] as { t: number; d: number }[],
    audio: [] as { t: number; frames: number }[],
    finalized: 0,
    cancelled: 0,
  };
  const fps = 25;
  const deps: ExportDependencies<Frame> = {
    metrics: fakeMetrics,
    frameSource: (): FrameStreamSource<Frame> => ({
      async *frames(startUs: number): AsyncGenerator<TimedFrame<Frame>, void, undefined> {
        const first = Math.floor((startUs * fps) / S);
        for (let index = first; index < first + 2000; index += 1) {
          await Promise.resolve();
          if (options.failDecode && index >= first + 3) throw new Error('decoder crashed');
          const frame: Frame = {
            id: frames.length,
            width: 64,
            height: 48,
            closed: 0,
            close() {
              this.closed += 1;
            },
          };
          frames.push(frame);
          yield { frame, timestamp: Math.round((index * S) / fps) };
        }
      },
    }),
    audioReader: (): AudioReader => ({
      read: (_start, count) =>
        Promise.resolve([new Float32Array(count).fill(0.25), new Float32Array(count).fill(0.25)]),
    }),
    renderer: {
      uploadFrame: (id) => log.uploads.push(id),
      deleteTexture: (id) => log.deleted.push(id),
      render: (scene) => log.scenes.push(scene),
    },
    sink: {
      addVideoFrame: (t, d) => {
        log.video.push({ t, d });
        if (options.cancelAfter !== undefined && log.video.length === options.cancelAfter) {
          options.controller?.abort();
        }
        return Promise.resolve();
      },
      addAudio: (_channels, t) => {
        log.audio.push({ t, frames: _channels[0].length });
        return Promise.resolve();
      },
      finalize: () => {
        log.finalized += 1;
        return Promise.resolve(new Blob(['done']));
      },
      cancel: () => {
        log.cancelled += 1;
        return Promise.resolve();
      },
    } satisfies ExportSink,
  };
  return { deps, frames, log };
}

function sequence(...adds: { asset: string; start: number; track?: string }[]) {
  const history = new History(
    createProject({ id: 'p', name: 'E', type: 'video', createdAt: '2026-11-18T10:00:00.000Z' }),
  );
  history.execute(addAssets([VIDEO, SILENT]));
  history.execute(addTrack('video', 'V2'));
  adds.forEach((add, index) =>
    history.execute(
      addMediaToTimeline({
        assetId: add.asset,
        start: add.start,
        clipId: `c${String(index)}`,
        audioClipId: `a${String(index)}`,
        linkId: `l${String(index)}`,
        ...(add.track ? { videoTrackId: add.track } : {}),
        duration: 2 * S,
      }),
    ),
  );
  const content = (): VideoContent => {
    if (history.state.content.kind !== 'video') throw new Error('video');
    return history.state.content;
  };
  return { history, content };
}

const options = (fps: FrameRate = FPS_30, extra = {}) => ({ fps, sampleRate: RATE, ...extra });

describe('exportSequence', () => {
  it('writes every frame once, in order, and the sound to the exact length', async () => {
    const { history, content } = sequence({ asset: 'vid', start: 0 });
    const { deps, frames, log } = fakes();
    const progress: number[] = [];
    const blob = await exportSequence(content(), history.state.assets.byId, deps, {
      ...options(),
      onProgress: (done) => progress.push(done),
    });
    expect(await blob.text()).toBe('done');
    expect(log.video).toHaveLength(60); // 2 s at 30 fps
    expect(log.video.map((entry) => entry.t)).toEqual(
      [...log.video.map((entry) => entry.t)].sort((a, b) => a - b),
    );
    expect(log.video.at(-1)).toEqual({ t: 1_966_667, d: 33_333 });
    expect(log.video.reduce((sum, entry) => sum + entry.d, 0)).toBe(2 * S);
    // 2 s of sound at 1 kHz: blocks of 1 s, 2000 samples in all, back to back.
    expect(log.audio).toEqual([
      { t: 0, frames: 1000 },
      { t: S, frames: 1000 },
    ]);
    expect(progress).toHaveLength(60);
    expect(progress.at(-1)).toBe(60);
    expect(log.finalized).toBe(1);
    expect(log.cancelled).toBe(0);
    // Nothing left open, and the texture of the clip was freed at the end.
    expect(frames.every((frame) => frame.closed === 1)).toBe(true);
    expect(log.deleted).toContain('clip:c0');
  });

  it('draws overlapping clips together and frees each texture when its clip is over', async () => {
    const { history, content } = sequence(
      { asset: 'mute', start: 0 },
      { asset: 'mute', start: 1 * S, track: 'V2' },
    );
    const { deps, log } = fakes();
    await exportSequence(content(), history.state.assets.byId, deps, options());
    const counts = log.scenes.map((scene) => scene.nodes.length);
    expect(counts[0]).toBe(1);
    expect(counts[45]).toBe(2); // at 1.5 s both clips are showing
    expect(counts.at(-1)).toBe(1);
    expect(log.audio).toHaveLength(0); // no sound anywhere: no audio blocks
    expect(log.deleted.filter((id) => id === 'clip:c0').length).toBeGreaterThanOrEqual(1);
  });

  it('exports only a range: the file starts at 0, and picture and sound come from the range', async () => {
    const { history, content } = sequence({ asset: 'vid', start: 0 }); // 2 s of picture and sound
    const { deps, log } = fakes();
    const pictureStarts: number[] = [];
    const soundStarts: number[] = [];
    const frameSource = deps.frameSource.bind(deps);
    const ranged: ExportDependencies<Frame> = {
      ...deps,
      frameSource: (id) => {
        const source = frameSource(id);
        return {
          frames: (startUs) => {
            pictureStarts.push(startUs);
            return source.frames(startUs);
          },
        };
      },
      audioReader: () => ({
        read: (startUs, count) => {
          soundStarts.push(startUs);
          return Promise.resolve([new Float32Array(count), new Float32Array(count)]);
        },
      }),
    };
    await exportSequence(content(), history.state.assets.byId, ranged, {
      ...options(),
      range: { start: 0.5 * S, end: 1.5 * S },
    });
    expect(log.video).toHaveLength(30); // 1 s at 30 fps
    expect(log.video[0]).toEqual({ t: 0, d: 33_333 });
    expect(log.video.reduce((sum, entry) => sum + entry.d, 0)).toBe(1 * S);
    // The first picture is the one at 0.5 s in the file, and the sound is read from 0.5 s on.
    expect(pictureStarts[0]).toBe(0.5 * S);
    expect(soundStarts[0]).toBe(0.5 * S);
    // The sound is written from the start of the new file, exactly as long as the range.
    expect(log.audio).toEqual([{ t: 0, frames: 1000 }]);
  });

  it('limits a range that runs past the end of the sequence to the end', async () => {
    const { history, content } = sequence({ asset: 'mute', start: 0 });
    const { deps, log } = fakes();
    await exportSequence(content(), history.state.assets.byId, deps, {
      ...options(),
      range: { start: 1 * S, end: 50 * S },
    });
    expect(log.video).toHaveLength(30); // 1 s to the end at 2 s
  });

  it('turns 29.97 fps into the right number of frames', () => {
    const ntsc = { num: 30000, den: 1001 };
    expect(exportFrameCount(1 * S, ntsc)).toBe(30);
    expect(exportFrameCount(1_001_000, ntsc)).toBe(30);
    expect(exportFrameCount(1_001_001, ntsc)).toBe(31);
    expect(exportFrameCount(0, ntsc)).toBe(0);
  });

  it('finds out whether there is anything to hear', () => {
    const withSound = sequence({ asset: 'vid', start: 0 });
    expect(hasExportAudio(withSound.content(), withSound.history.state.assets.byId)).toBe(true);
    const silent = sequence({ asset: 'mute', start: 0 });
    expect(hasExportAudio(silent.content(), silent.history.state.assets.byId)).toBe(false);
  });

  it('stops when cancelled, abandons the output and closes every picture', async () => {
    const { history, content } = sequence({ asset: 'vid', start: 0 });
    const controller = new AbortController();
    const { deps, frames, log } = fakes({ cancelAfter: 10, controller });
    await expect(
      exportSequence(content(), history.state.assets.byId, deps, {
        ...options(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(log.video).toHaveLength(10);
    expect(log.cancelled).toBe(1);
    expect(log.finalized).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(frames.every((frame) => frame.closed === 1)).toBe(true);
  });

  it('reports a decoding failure as a typed error and leaves nothing behind', async () => {
    const { history, content } = sequence({ asset: 'vid', start: 0 });
    const { deps, frames, log } = fakes({ failDecode: true });
    const error = await exportSequence(content(), history.state.assets.byId, deps, options()).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'decode-failed' });
    expect(log.cancelled).toBe(1);
    expect(log.finalized).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(frames.every((frame) => frame.closed === 1)).toBe(true);
  });

  it('refuses an empty sequence', async () => {
    const { history, content } = sequence();
    const { deps } = fakes();
    await expect(
      exportSequence(content(), history.state.assets.byId, deps, options()),
    ).rejects.toMatchObject({
      code: 'invalid-project',
    });
  });
});
