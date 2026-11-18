import {
  clipEnd,
  clipSpeed,
  frameDuration,
  linkedGroup,
  trackClips,
  type Asset,
  type FrameRate,
  type TrimEdge,
  type VideoContent,
} from '@media-studio/core';

/**
 * How far an edge of a clip (and of its linked clips) can be dragged: not into a neighbour, not before the start
 * of the file or past its end, and not so far that less than one frame is left. Times are timeline microseconds.
 */
export function trimRange(
  content: VideoContent,
  assets: Readonly<Record<string, Asset>>,
  clipId: string,
  edge: TrimEdge,
  fps: FrameRate,
): { min: number; max: number } {
  const group = linkedGroup(content, clipId);
  const inGroup = new Set(group.map((clip) => clip.id));
  const frame = Math.ceil(frameDuration(fps));
  let min = Number.NEGATIVE_INFINITY;
  let max = Number.POSITIVE_INFINITY;
  for (const clip of group) {
    // Text has no file behind it, so only the neighbours and the timeline limit it.
    const asset = clip.assetId === null ? undefined : assets[clip.assetId];
    const fileLength =
      clip.assetId === null
        ? Number.POSITIVE_INFINITY
        : asset?.kind === 'video' || asset?.kind === 'audio'
          ? asset.duration
          : 0;
    // Timeline time the file can give before and after the clip: the file runs `speed` times faster than the timeline.
    const speed = clipSpeed(clip);
    const before = clip.assetId === null ? clip.start : Math.floor(clip.sourceIn / speed);
    const neighbours = trackClips(content, clip.trackId).filter((other) => !inGroup.has(other.id));
    if (edge === 'start') {
      const touching = neighbours.filter((other) => clipEnd(other) <= clip.start);
      min = Math.max(min, 0, clip.start - before, ...touching.map(clipEnd));
      max = Math.min(max, clipEnd(clip) - frame);
    } else {
      const after = neighbours.filter((other) => other.start >= clipEnd(clip));
      min = Math.max(min, clip.start + frame);
      max = Math.min(
        max,
        clip.start + Math.floor((fileLength - clip.sourceIn) / speed),
        ...after.map((other) => other.start),
      );
    }
  }
  return { min, max };
}

/** Whether a drag that ended at `time` would change anything. */
export function isTrimChange(
  content: VideoContent,
  clipId: string,
  edge: TrimEdge,
  time: number,
): boolean {
  const clip = content.clips[clipId];
  if (!clip) return false;
  return time !== (edge === 'start' ? clip.start : clipEnd(clip));
}
