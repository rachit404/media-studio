// THROWAWAY: sequential H.264 decode via Mediabunny (WebCodecs VideoDecoder) into a small bounded VideoFrame queue.
import { Input, BlobSource, ALL_FORMATS, VideoSampleSink } from 'mediabunny';

export class VideoFeed {
  frames: VideoFrame[] = [];
  private waiters: (() => void)[] = [];
  private space: (() => void) | null = null;
  private stopped = false;
  ended = false;
  decodedCount = 0;
  constructor(private sink: VideoSampleSink, private maxQueue: number) {}
  static async open(url: string, maxQueue = 6) {
    const blob = await (await fetch(url)).blob();
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track');
    return new VideoFeed(new VideoSampleSink(track), maxQueue);
  }
  start() { void this.loop(); }
  private async loop() {
    for await (const s of this.sink.samples()) {
      if (this.stopped) { s.close(); break; }
      while (this.frames.length >= this.maxQueue && !this.stopped) await new Promise<void>(r => (this.space = r));
      if (this.stopped) { s.close(); break; }
      this.frames.push(s.toVideoFrame()); s.close(); this.decodedCount++;
      this.waiters.splice(0).forEach(w => w());
    }
    this.ended = true;
    this.waiters.splice(0).forEach(w => w());
  }
  /** Wall-clock playback: returns the frame whose time <= t (seconds), dropping older frames. */
  take(t: number): VideoFrame | null {
    while (this.frames.length >= 2 && this.frames[1]!.timestamp / 1e6 <= t) { this.frames.shift()!.close(); this.space?.(); this.space = null; }
    return this.frames[0] ?? null;
  }
  /** Export-style sequential pull; caller owns (must close) the returned frame. */
  async next(): Promise<VideoFrame | null> {
    while (!this.frames.length) { if (this.ended) return null; await new Promise<void>(r => this.waiters.push(r)); }
    const f = this.frames.shift()!; this.space?.(); this.space = null; return f;
  }
  stop() { this.stopped = true; this.space?.(); this.frames.splice(0).forEach(f => f.close()); }
}
