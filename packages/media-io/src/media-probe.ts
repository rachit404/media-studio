import { AppError, frameRateFromNumber, secondsToTime, type FrameRate } from '@media-studio/core';
import {
  ALL_FORMATS,
  BlobSource,
  EncodedPacketSink,
  Input,
  type InputVideoTrack,
} from 'mediabunny';

/** What a media file contains, as far as the editor needs to know (ASSET-3). */
export interface MediaInfo {
  kind: 'video' | 'audio';
  mime: string;
  /** Microseconds. */
  duration: number;
  video: {
    width: number;
    height: number;
    fps: FrameRate;
    codec: string;
    /** Average microseconds between keyframes, or null when it could not be measured. */
    keyframeInterval: number | null;
  } | null;
  audio: { sampleRate: number; channels: number; codec: string } | null;
}

/** Largest file we import: the original is copied into project storage. */
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024 * 1024;
/** Longest picture side we try to decode for preview. */
const MAX_PICTURE_SIDE = 8192;
/** How many keyframes are sampled to estimate the keyframe interval. */
const KEYFRAME_SAMPLES = 16;

const EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
};

/** File extension for a probed MIME type (without the codecs part), or null when we do not handle it. */
export function extensionForMime(mime: string): string | null {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return EXTENSIONS[base] ?? null;
}

function unsupported(message: string, cause?: unknown): AppError {
  return new AppError({
    code: 'unsupported-codec',
    message,
    hint: 'Use MP4, MOV or WebM with H.264, VP9 or AV1 video, or convert the file first.',
    cause,
  });
}

async function keyframeInterval(
  track: InputVideoTrack,
  durationSeconds: number,
): Promise<number | null> {
  try {
    const sink = new EncodedPacketSink(track);
    let packet = await sink.getFirstKeyPacket({ metadataOnly: true });
    if (!packet) return null;
    const first = packet.timestamp;
    let last = first;
    let count = 1;
    while (count < KEYFRAME_SAMPLES) {
      const next = await sink.getNextKeyPacket(packet, { metadataOnly: true });
      if (!next) break;
      packet = next;
      last = next.timestamp;
      count += 1;
    }
    if (count === 1) return secondsToTime(durationSeconds);
    return Math.max(1, secondsToTime((last - first) / (count - 1)));
  } catch {
    return null;
  }
}

/**
 * Read a media file's facts without decoding it fully. Throws an AppError with a plain explanation when the file is
 * not a media file, is damaged, or uses a codec this browser cannot decode.
 */
export async function probeMedia(blob: Blob): Promise<MediaInfo> {
  if (blob.size > MAX_MEDIA_BYTES) {
    throw new AppError({
      code: 'out-of-memory',
      message: 'This file is larger than the 8 GB limit.',
      hint: 'Cut it into shorter files first.',
    });
  }
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    let video: InputVideoTrack | null;
    let audioTrack;
    try {
      video = await input.getPrimaryVideoTrack();
      audioTrack = await input.getPrimaryAudioTrack();
    } catch (error) {
      throw unsupported('This file is not a media file Media Studio can read.', error);
    }
    if (!video && !audioTrack) throw unsupported('This file has no video or audio.');

    const mime = await input.getMimeType();
    const seconds = (await input.getDurationFromMetadata()) ?? (await input.computeDuration());
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw unsupported('This file has no playable length.');
    }
    const duration = secondsToTime(seconds);

    let videoInfo: MediaInfo['video'] = null;
    if (video) {
      if (!(await video.canDecode())) {
        throw new AppError({
          code: 'unsupported-codec',
          message: `This browser cannot decode this video (${video.codec ?? 'unknown codec'}).`,
          hint: 'Convert it to H.264 (MP4) or VP9 (WebM), or open the project in Chrome or Edge.',
        });
      }
      const width = video.displayWidth;
      const height = video.displayHeight;
      if (width < 1 || height < 1 || width > MAX_PICTURE_SIDE || height > MAX_PICTURE_SIDE) {
        throw unsupported('The picture size of this video is not supported.');
      }
      const metrics = await video.computeFrameRateMetrics();
      videoInfo = {
        width,
        height,
        fps: frameRateFromNumber(metrics.bestGuessFrameRate),
        codec: video.codec ?? 'unknown',
        keyframeInterval: await keyframeInterval(video, seconds),
      };
    }

    let audioInfo: MediaInfo['audio'] = null;
    if (audioTrack) {
      if (await audioTrack.canDecode()) {
        audioInfo = {
          sampleRate: audioTrack.sampleRate,
          channels: audioTrack.numberOfChannels,
          codec: audioTrack.codec ?? 'unknown',
        };
      } else if (!video) {
        throw new AppError({
          code: 'unsupported-codec',
          message: `This browser cannot decode this audio (${audioTrack.codec ?? 'unknown codec'}).`,
          hint: 'Convert it to WAV, MP3 or AAC first.',
        });
      }
      // A video whose sound cannot be decoded is still usable: it is imported without sound.
    }
    return { kind: video ? 'video' : 'audio', mime, duration, video: videoInfo, audio: audioInfo };
  } finally {
    input.dispose();
  }
}
