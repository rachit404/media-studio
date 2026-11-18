import { clipEnd, sortedTracks, type Asset, type VideoContent } from '@media-studio/core';

/** A stretch of one clip's sound that falls inside a window of the timeline. */
export interface AudioSegment {
  clipId: string;
  assetId: string;
  /** Timeline time where this stretch starts and ends. */
  start: number;
  end: number;
  /** Where the whole clip ends on the timeline (the player feeds the clip to its end once it has started). */
  clipEnd: number;
  /** Where in the source file it starts. */
  sourceStart: number;
}

/**
 * The sound to schedule for timeline window `[from, to)`: every clip on an audio track that is not muted, cut to
 * the window. The player turns these into scheduled audio buffers.
 */
export function audioSegments(
  content: VideoContent,
  assets: Readonly<Record<string, Asset>>,
  from: number,
  to: number,
): AudioSegment[] {
  const segments: AudioSegment[] = [];
  for (const track of sortedTracks(content)) {
    if (track.kind !== 'audio' || track.muted) continue;
    for (const id of track.clipIds) {
      const clip = content.clips[id];
      if (!clip || clipEnd(clip) <= from) continue;
      if (clip.start >= to) break;
      const asset = assets[clip.assetId];
      if (asset?.kind !== 'audio' && asset?.kind !== 'video') continue;
      const start = Math.max(clip.start, from);
      const end = Math.min(clipEnd(clip), to);
      segments.push({
        clipId: clip.id,
        assetId: clip.assetId,
        start,
        end,
        clipEnd: clipEnd(clip),
        sourceStart: clip.sourceIn + (start - clip.start),
      });
    }
  }
  return segments;
}
