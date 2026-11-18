import {
  clipEnd,
  clipSourceAt,
  clipSpeed,
  samplesToTime,
  timeToSamples,
  type Asset,
  type VideoContent,
} from '@media-studio/core';
import { audibleTracks, clipGainOnTimeline, hasFades } from './audio-gain';

/** Decodes the sound of one file as stereo at a given rate (the adapter does decoding, mixing down and resampling). */
export interface AudioReader {
  /**
   * `frames` samples per channel, planar stereo, starting at `startUs` in the file, at `sampleRate`. Anything past
   * the end of the file is silence. Calls usually continue where the last one ended (sequential decoding).
   */
  read(startUs: number, frames: number, sampleRate: number): Promise<[Float32Array, Float32Array]>;
}

/**
 * `count` samples of a file played at `speed` times: the file is read `speed` times as fast and resampled by
 * straight-line interpolation, so pitch rises and falls with speed (as in the live player). Speed 1 reads directly.
 */
async function readSped(
  reader: AudioReader,
  startUs: number,
  count: number,
  sampleRate: number,
  speed: number,
): Promise<[Float32Array, Float32Array]> {
  if (speed === 1) return reader.read(startUs, count, sampleRate);
  const needed = Math.ceil(count * speed) + 2;
  const [sourceLeft, sourceRight] = await reader.read(startUs, needed, sampleRate);
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const position = i * speed;
    const index = Math.floor(position);
    const fraction = position - index;
    const nextIndex = index + 1;
    left[i] = (sourceLeft[index] ?? 0) * (1 - fraction) + (sourceLeft[nextIndex] ?? 0) * fraction;
    right[i] =
      (sourceRight[index] ?? 0) * (1 - fraction) + (sourceRight[nextIndex] ?? 0) * fraction;
  }
  return [left, right];
}

/**
 * The mixed sound of the sequence for `frames` samples starting at sample `startFrame`: every unmuted audio track,
 * clips placed by their timeline position, scaled by track and clip volume and fades, summed and limited to -1..1 (a hard clip; there is no limiter in v1).
 * This is the offline mix used by export; it follows the same placement rules as the preview.
 */
export async function mixAudioBlock(
  content: VideoContent,
  assets: Readonly<Record<string, Asset>>,
  readerFor: (assetId: string) => AudioReader,
  startFrame: number,
  frames: number,
  sampleRate: number,
): Promise<[Float32Array, Float32Array]> {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const blockStart = samplesToTime(startFrame, sampleRate);
  const blockEnd = samplesToTime(startFrame + frames, sampleRate);

  for (const track of audibleTracks(content)) {
    for (const id of track.clipIds) {
      const clip = content.clips[id];
      if (!clip || clipEnd(clip) <= blockStart) continue;
      if (clip.start >= blockEnd) break;
      const asset = clip.assetId === null ? undefined : assets[clip.assetId];
      if (asset?.kind !== 'audio' && asset?.kind !== 'video') continue;

      const overlapStart = Math.max(clip.start, blockStart);
      const overlapEnd = Math.min(clipEnd(clip), blockEnd);
      const first = timeToSamples(overlapStart, sampleRate);
      const offset = first - startFrame;
      const count = Math.min(timeToSamples(overlapEnd, sampleRate) - first, frames - offset);
      if (count <= 0 || offset < 0) continue;

      const speed = clipSpeed(clip);
      const [sourceLeft, sourceRight] = await readSped(
        readerFor(asset.id),
        clipSourceAt(clip, overlapStart - clip.start),
        count,
        sampleRate,
        speed,
      );
      const gainAt = clipGainOnTimeline(track, clip);
      // Without fades the gain is one number for the whole clip; with fades it follows the straight-line ramps.
      const flat = hasFades(clip) ? null : gainAt(clip.start);
      for (let i = 0; i < count; i += 1) {
        const gain = flat ?? gainAt(overlapStart + samplesToTime(i, sampleRate));
        left[offset + i] = (left[offset + i] ?? 0) + (sourceLeft[i] ?? 0) * gain;
        right[offset + i] = (right[offset + i] ?? 0) + (sourceRight[i] ?? 0) * gain;
      }
    }
  }
  for (let i = 0; i < frames; i += 1) {
    left[i] = Math.max(-1, Math.min(1, left[i] ?? 0));
    right[i] = Math.max(-1, Math.min(1, right[i] ?? 0));
  }
  return [left, right];
}
