import { AppError, toAppError, type Asset, type VideoContent } from '@media-studio/core';
import {
  FramePump,
  Transport,
  audioSegments,
  buildPreviewScene,
  frameTextureId,
  previewPlan,
  type FrameStreamSource,
  type TimedFrame,
} from '@media-studio/engine-video';
import { AudioPlayer, VideoSource } from '@media-studio/media-io';
import type { CanvasRenderer } from '@media-studio/render';
import { diagnostics } from '../../diagnostics';
import { getStorage } from '../../storage-client';

/** Most pictures decoded at the same time (hardware decoders are limited; see the M5 risk spikes). */
const MAX_DECODERS = 4;
/** Clips that start within this long are decoded ahead, so they are ready at the cut. */
const PREROLL_US = 600_000;

interface ClipStream {
  clipId: string;
  assetId: string;
  pump: FramePump<ImageBitmap>;
  /** Timestamp of the picture last uploaded to the GPU. */
  uploaded: number | null;
}

export interface PreviewState {
  playing: boolean;
  /** Changes on seeks and when playback stops; during playback use `onTime`. */
  time: number;
  /** A message for the user when something cannot be shown (missing file, decode failure). */
  problem: string | null;
}

export interface PreviewDocument {
  content: VideoContent;
  assets: Readonly<Record<string, Asset>>;
}

/**
 * Drives the video preview: the transport, the decoded pictures of the clips under the playhead, their upload to the
 * compositor, and the sound. The document is read through `getDocument`, so it always reflects the latest edit.
 * Everything is on demand: nothing runs while paused and idle.
 */
export class PreviewPlayer {
  private readonly audio: AudioPlayer | null;
  readonly transport: Transport;
  private readonly streams = new Map<string, ClipStream>();
  private readonly sources = new Map<string, Promise<VideoSource>>();
  private readonly blobs = new Map<string, Promise<Blob>>();
  private readonly sizes = new Map<string, { width: number; height: number }>();
  private readonly listeners = new Set<() => void>();
  private readonly timeListeners = new Set<(time: number) => void>();
  private frame: number | undefined;
  private disposed = false;
  private problemText: string | null = null;
  private snapshot: PreviewState = { playing: false, time: 0, problem: null };
  /** Whether the audio clock drives the picture (it does once the audio context is running). */
  private audioClock = false;
  /** Increases whenever playback is (re)started, so an older start that finishes late is ignored. */
  private begun = 0;

  constructor(
    private readonly projectId: string,
    private readonly renderer: CanvasRenderer,
    private readonly getDocument: () => PreviewDocument,
  ) {
    try {
      this.audio = new AudioPlayer();
    } catch {
      this.audio = null; // No audio output: the picture follows the page clock.
    }
    this.transport = new Transport(
      {
        clock: () =>
          this.audioClock && this.audio ? this.audio.clockUs() : performance.now() * 1000,
      },
      getDocument().content.sequence.fps,
    );
    this.refresh();
  }

  // Observation ------------------------------------------------------------------------------------------

  /** React-friendly snapshot (a new object only when something worth re-rendering changed). */
  getState = (): PreviewState => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Called on every displayed frame with the current time (for the playhead and the clock; no React updates). */
  onTime(listener: (time: number) => void): () => void {
    this.timeListeners.add(listener);
    listener(this.transport.time);
    return () => {
      this.timeListeners.delete(listener);
    };
  }

  private publish(): void {
    const next = {
      playing: this.transport.playing,
      time: this.transport.time,
      problem: this.problemText,
    };
    const old = this.snapshot;
    if (old.playing === next.playing && old.time === next.time && old.problem === next.problem)
      return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  private report(error: unknown): void {
    const appError = toAppError(error);
    diagnostics.log('error', 'preview', appError.message, { code: appError.code });
    this.problemText = appError.hint ? `${appError.message} ${appError.hint}` : appError.message;
    this.publish();
  }

  // Document ---------------------------------------------------------------------------------------------

  /** The document changed (an edit, undo or redo): follow its length and frame rate and show the new state. */
  refresh(): void {
    const { content, assets } = this.getDocument();
    this.transport.setFrameRate(content.sequence.fps);
    let end = 0;
    for (const clip of Object.values(content.clips))
      end = Math.max(end, clip.start + clip.duration);
    this.transport.setDuration(end);
    for (const [clipId, stream] of [...this.streams]) {
      const clip = content.clips[clipId];
      if (!clip || clip.assetId !== stream.assetId || !assets[clip.assetId]) this.release(clipId);
    }
    this.problemText = null;
    this.restart();
  }

  // Transport --------------------------------------------------------------------------------------------

  play(): void {
    if (this.transport.playing) return;
    void this.begin(true);
  }

  pause(): void {
    if (!this.transport.playing) return;
    this.begun += 1;
    this.transport.pause();
    this.audio?.stop();
    this.publish();
    this.schedule();
  }

  toggle(): void {
    if (this.transport.playing) this.pause();
    else this.play();
  }

  seek(time: number): void {
    this.transport.seek(time);
    this.restart();
  }

  step(frames: number): void {
    this.begun += 1;
    this.audio?.stop();
    this.transport.stepFrames(frames);
    this.restart();
  }

  /** After a jump or an edit: continue playing from here if we were playing, and decode again from here. */
  private restart(): void {
    if (this.transport.playing) void this.begin(false);
    else this.restartStreams();
    this.publish();
    this.schedule();
  }

  /**
   * (Re)start playback at the current time: stop the sound, wait until the new sound is scheduled, then let the
   * picture follow the moment it is heard. Only the latest call has an effect.
   */
  private async begin(fromStopped: boolean): Promise<void> {
    const generation = ++this.begun;
    if (!fromStopped) this.transport.pause(); // hold still while the sound is prepared
    this.audio?.stop();
    try {
      await this.audio?.resume();
    } catch {
      // Sound is optional; the picture then follows the page clock.
    }
    this.audioClock = this.audio?.running === true;
    const startAt = this.transport.time;
    let anchor: number | undefined;
    try {
      anchor = await this.startSound(startAt);
    } catch (error) {
      this.report(error);
    }
    if (generation !== this.begun || this.disposed) return;
    this.transport.play(anchor);
    this.restartStreams();
    this.publish();
    this.schedule();
  }

  // Sound ------------------------------------------------------------------------------------------------

  private blobFor(asset: Asset): Promise<Blob> {
    let blob = this.blobs.get(asset.id);
    if (!blob) {
      const created = getStorage()
        .getBlob(this.projectId, asset.file)
        .then((found) => {
          if (!found) {
            throw new AppError({
              code: 'invalid-project',
              message: `The file for "${asset.name}" is missing from this project.`,
              hint: 'Remove its clips and import the file again.',
            });
          }
          return found;
        });
      created.catch(() => this.blobs.delete(asset.id));
      this.blobs.set(asset.id, created);
      blob = created;
    }
    return blob;
  }

  /** Schedule the sound from `from`; resolves to the audio-clock time at which `from` is heard. */
  private async startSound(from: number): Promise<number | undefined> {
    const audio = this.audio;
    if (!audio || !this.audioClock) return undefined;
    const { content, assets } = this.getDocument();
    const wanted = new Map<string, Asset>();
    for (const clip of Object.values(content.clips)) {
      const asset = assets[clip.assetId];
      if (asset && (asset.kind === 'audio' || (asset.kind === 'video' && asset.audio))) {
        wanted.set(asset.id, asset);
      }
    }
    const entries = await Promise.all(
      [...wanted.values()].map(async (asset) => [asset.id, await this.blobFor(asset)] as const),
    );
    const blobsById = new Map(entries);
    return audio.play(from, (start, end) =>
      audioSegments(content, assets, start, end).flatMap((segment) => {
        const blob = blobsById.get(segment.assetId);
        return blob
          ? [
              {
                clipId: segment.clipId,
                blob,
                start: segment.start,
                end: segment.end,
                sourceStart: segment.sourceStart,
              },
            ]
          : [];
      }),
    );
  }

  // Pictures ---------------------------------------------------------------------------------------------

  private source(asset: Asset): Promise<VideoSource> {
    let source = this.sources.get(asset.id);
    if (!source) {
      const created = this.blobFor(asset).then((blob) => VideoSource.open(blob));
      created.catch(() => this.sources.delete(asset.id));
      this.sources.set(asset.id, created);
      source = created;
    }
    return source;
  }

  private async *framesOf(
    asset: Asset,
    startUs: number,
  ): AsyncGenerator<TimedFrame<ImageBitmap>, void, undefined> {
    const source = await this.source(asset);
    for await (const decoded of source.frames(startUs)) {
      yield { frame: decoded.frame, timestamp: decoded.timestamp };
    }
  }

  private streamFor(clipId: string, asset: Asset, startUs: number): ClipStream | null {
    const existing = this.streams.get(clipId);
    if (existing) return existing;
    if (this.streams.size >= MAX_DECODERS) return null;
    const frames: FrameStreamSource<ImageBitmap> = {
      frames: (start: number) => this.framesOf(asset, start),
    };
    const stream: ClipStream = {
      clipId,
      assetId: asset.id,
      pump: new FramePump(frames, 6),
      uploaded: null,
    };
    this.streams.set(clipId, stream);
    stream.pump.start(startUs);
    return stream;
  }

  private release(clipId: string): void {
    const stream = this.streams.get(clipId);
    if (!stream) return;
    stream.pump.stop();
    this.streams.delete(clipId);
    this.renderer.deleteTexture(frameTextureId(clipId));
    this.sizes.delete(clipId);
  }

  /** Decode again from the current time for every clip that is showing or about to. */
  private restartStreams(): void {
    const { content } = this.getDocument();
    const time = this.transport.time;
    for (const stream of [...this.streams.values()]) {
      const clip = content.clips[stream.clipId];
      if (!clip || time < clip.start - PREROLL_US || time >= clip.start + clip.duration) {
        this.release(stream.clipId);
      } else {
        stream.uploaded = null;
        stream.pump.start(Math.max(0, clip.sourceIn + Math.max(0, time - clip.start)));
      }
    }
  }

  // Frame loop -------------------------------------------------------------------------------------------

  private schedule(): void {
    if (this.disposed || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.drawFrame();
    });
  }

  private drawFrame(): void {
    if (this.disposed) return;
    const wasPlaying = this.transport.playing;
    const time = this.transport.tick();
    const { content, assets } = this.getDocument();
    let waiting = false;

    const plan = previewPlan(content, assets, time);
    const active = new Set(plan.video.map((layer) => layer.clipId));

    for (const layer of plan.video) {
      const asset = assets[layer.assetId];
      if (!asset) continue;
      const stream = this.streamFor(layer.clipId, asset, layer.sourceTime);
      if (!stream) continue;
      if (stream.pump.error !== null) {
        this.report(stream.pump.error);
        continue;
      }
      const picture = stream.pump.frameFor(layer.sourceTime);
      if (!picture) {
        waiting = waiting || !stream.pump.finished;
        continue;
      }
      if (stream.uploaded !== picture.timestamp) {
        this.renderer.uploadFrame(frameTextureId(layer.clipId), picture.frame);
        this.sizes.set(layer.clipId, { width: picture.frame.width, height: picture.frame.height });
        stream.uploaded = picture.timestamp;
      }
    }

    // Decode ahead for clips that begin soon, and release clips we have left behind.
    if (this.transport.playing) {
      for (const clip of Object.values(content.clips)) {
        const asset = assets[clip.assetId];
        if (asset?.kind !== 'video' || content.tracks.byId[clip.trackId]?.kind !== 'video')
          continue;
        if (active.has(clip.id)) continue;
        if (clip.start > time && clip.start - time <= PREROLL_US) {
          this.streamFor(clip.id, asset, clip.sourceIn);
        }
      }
    }
    for (const clipId of [...this.streams.keys()]) {
      const clip = content.clips[clipId];
      const upcoming = clip && clip.start > time && clip.start - time <= PREROLL_US;
      if (!active.has(clipId) && !upcoming) this.release(clipId);
    }

    this.renderer.setScene(buildPreviewScene(content, assets, time, this.sizes));
    for (const listener of this.timeListeners) listener(time);

    if (wasPlaying && !this.transport.playing) {
      // Reached the end.
      this.begun += 1;
      this.audio?.stop();
      this.publish();
    }
    if (this.transport.playing || waiting) this.schedule();
    else this.publish();
  }

  /** Release decoders, pictures and the audio output. */
  dispose(): void {
    this.disposed = true;
    this.begun += 1;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    for (const clipId of [...this.streams.keys()]) this.release(clipId);
    for (const source of this.sources.values()) {
      void source.then((open) => open.close()).catch(() => undefined);
    }
    this.sources.clear();
    this.blobs.clear();
    void this.audio?.dispose();
    this.listeners.clear();
    this.timeListeners.clear();
  }
}
