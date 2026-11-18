import { AppError, secondsToTime } from '@media-studio/core';
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny';

/** One decoded picture and where it sits in its source file (microseconds). */
export interface DecodedFrame {
  frame: ImageBitmap;
  timestamp: number;
}

/**
 * A video file opened for playback. Pictures come out as `ImageBitmap` copies, so the decoder's own frame objects
 * are closed immediately and never held (the decoder has a small hard limit on live frames).
 */
export class VideoSource {
  private constructor(
    private readonly input: Input,
    private readonly sink: VideoSampleSink,
    readonly width: number,
    readonly height: number,
  ) {}

  static async open(blob: Blob): Promise<VideoSource> {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('no video track');
      return new VideoSource(
        input,
        new VideoSampleSink(track),
        track.displayWidth,
        track.displayHeight,
      );
    } catch (error) {
      input.dispose();
      throw new AppError({
        code: 'decode-failed',
        message: 'This video could not be opened for playback.',
        hint: 'The file may be damaged. Remove it and import it again.',
        cause: error,
      });
    }
  }

  private static async toBitmap(sample: VideoSample): Promise<DecodedFrame> {
    const frame = sample.toVideoFrame();
    try {
      return { frame: await createImageBitmap(frame), timestamp: secondsToTime(sample.timestamp) };
    } finally {
      frame.close();
      sample.close();
    }
  }

  /** The picture showing at `timeUs` (the last one that is not after it). The caller closes the bitmap. */
  async frameAt(timeUs: number): Promise<DecodedFrame | null> {
    const sample = await this.sink.getSample(timeUs / 1_000_000);
    return sample ? VideoSource.toBitmap(sample) : null;
  }

  /** Pictures in order, starting with the one showing at `startUs`. Stops decoding when the consumer stops. */
  async *frames(startUs: number): AsyncGenerator<DecodedFrame, void, undefined> {
    for await (const sample of this.sink.samples(startUs / 1_000_000)) {
      yield await VideoSource.toBitmap(sample);
    }
  }

  close(): void {
    this.input.dispose();
  }
}
