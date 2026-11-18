import {
  clipEnd,
  clipSourceAt,
  clipSpeed,
  type Asset,
  type VideoContent,
} from '@media-studio/core';
import { audibleTracks, clipGainOnTimeline } from './audio-gain';

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
  /** Playback speed (the sound is played this much faster, which raises its pitch). */
  speed: number;
  /** Linear gain at a timeline time: track volume, clip volume and fades. */
  gainAt: (timelineUs: number) => number;
}

/**
 * The sound to schedule for timeline window `[from, to)`: every clip on an audible audio track (not muted; only
 * soloed tracks when any is soloed), cut to the window, each with its gain envelope. The player turns these into scheduled audio buffers.
 */
export function audioSegments(
  content: VideoContent,
  assets: Readonly<Record<string, Asset>>,
  from: number,
  to: number,
): AudioSegment[] {
  const segments: AudioSegment[] = [];
  for (const track of audibleTracks(content)) {
    for (const id of track.clipIds) {
      const clip = content.clips[id];
      if (!clip || clipEnd(clip) <= from) continue;
      if (clip.start >= to) break;
      const asset = clip.assetId === null ? undefined : assets[clip.assetId];
      if (asset?.kind !== 'audio' && asset?.kind !== 'video') continue;
      const start = Math.max(clip.start, from);
      const end = Math.min(clipEnd(clip), to);
      segments.push({
        clipId: clip.id,
        assetId: asset.id,
        start,
        end,
        clipEnd: clipEnd(clip),
        sourceStart: clipSourceAt(clip, start - clip.start),
        speed: clipSpeed(clip),
        gainAt: clipGainOnTimeline(track, clip),
      });
    }
  }
  return segments;
}
