import {
  clipEnd,
  samplesToTime,
  sortedTracks,
  timeToSamples,
  type Asset,
  type VideoContent,
} from '@media-studio/core';

/** Decodes the sound of one file as stereo at a given rate (the adapter does decoding, mixing down and resampling). */
export interface AudioReader {
  /**
   * `frames` samples per channel, planar stereo, starting at `startUs` in the file, at `sampleRate`. Anything past
   * the end of the file is silence. Calls usually continue where the last one ended (sequential decoding).
   */
  read(startUs: number, frames: number, sampleRate: number): Promise<[Float32Array, Float32Array]>;
}

/**
 * The mixed sound of the sequence for `frames` samples starting at sample `startFrame`: every unmuted audio track,
 * clips placed by their timeline position, summed and limited to -1..1 (a hard clip; there is no limiter in v1).
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

  for (const track of sortedTracks(content)) {
    if (track.kind !== 'audio' || track.muted) continue;
    for (const id of track.clipIds) {
      const clip = content.clips[id];
      if (!clip || clipEnd(clip) <= blockStart) continue;
      if (clip.start >= blockEnd) break;
      const asset = assets[clip.assetId];
      if (asset?.kind !== 'audio' && asset?.kind !== 'video') continue;

      const overlapStart = Math.max(clip.start, blockStart);
      const overlapEnd = Math.min(clipEnd(clip), blockEnd);
      const first = timeToSamples(overlapStart, sampleRate);
      const offset = first - startFrame;
      const count = Math.min(timeToSamples(overlapEnd, sampleRate) - first, frames - offset);
      if (count <= 0 || offset < 0) continue;

      const [sourceLeft, sourceRight] = await readerFor(asset.id).read(
        clip.sourceIn + (overlapStart - clip.start),
        count,
        sampleRate,
      );
      for (let i = 0; i < count; i += 1) {
        left[offset + i] = (left[offset + i] ?? 0) + (sourceLeft[i] ?? 0);
        right[offset + i] = (right[offset + i] ?? 0) + (sourceRight[i] ?? 0);
      }
    }
  }
  for (let i = 0; i < frames; i += 1) {
    left[i] = Math.max(-1, Math.min(1, left[i] ?? 0));
    right[i] = Math.max(-1, Math.min(1, right[i] ?? 0));
  }
  return [left, right];
}
