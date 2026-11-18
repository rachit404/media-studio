import { sortedItems } from './ordered';
import {
  clipEnd,
  type Clip,
  type TransitionDirection,
  type TransitionKind,
  type Track,
  type TrackKind,
  type VideoContent,
} from './video-document';

/** Read-only queries over a video sequence. Pure; the commands in video-commands.ts build on them. */

export function sortedTracks(content: VideoContent): Track[] {
  return sortedItems(content.tracks);
}

export function tracksOfKind(content: VideoContent, kind: TrackKind): Track[] {
  return sortedTracks(content).filter((track) => track.kind === kind);
}

export function trackClips(content: VideoContent, trackId: string): Clip[] {
  const track = content.tracks.byId[trackId];
  if (!track) return [];
  return track.clipIds.flatMap((id) => {
    const clip = content.clips[id];
    return clip ? [clip] : [];
  });
}

/** The clip on the same track that ends exactly where `clip` starts (what a transition comes from), if any. */
export function outgoingClip(content: VideoContent, clip: Clip): Clip | undefined {
  const clips = trackClips(content, clip.trackId);
  const index = clips.findIndex((other) => other.id === clip.id);
  const previous = index > 0 ? clips[index - 1] : undefined;
  // Text has no footage to carry on, so a transition only comes from a picture clip.
  return previous && previous.assetId !== null && clipEnd(previous) === clip.start
    ? previous
    : undefined;
}

/**
 * The transition that is in effect on `clip`: it needs a clip right before it on a video track. The duration is
 * limited to the clip's own length. A stored transition that no longer has a clip before it is dormant (undefined).
 */
export function activeTransition(
  content: VideoContent,
  clip: Clip,
):
  | { kind: TransitionKind; direction: TransitionDirection; duration: number; from: Clip }
  | undefined {
  const { transitionIn } = clip;
  if (!transitionIn || content.tracks.byId[clip.trackId]?.kind !== 'video') return undefined;
  const from = outgoingClip(content, clip);
  if (!from) return undefined;
  return {
    kind: transitionIn.kind,
    direction: transitionIn.direction ?? 'left',
    duration: Math.min(transitionIn.duration, clip.duration),
    from,
  };
}

/** Where the last clip ends (0 for an empty sequence). */
export function sequenceDuration(content: VideoContent): number {
  let end = 0;
  for (const clip of Object.values(content.clips)) end = Math.max(end, clipEnd(clip));
  return end;
}

/** The clip with the same link as `clip` (the picture and sound of one file), including `clip` itself. */
export function linkedGroup(content: VideoContent, clipId: string): Clip[] {
  const clip = content.clips[clipId];
  if (!clip) return [];
  if (clip.linkId === null) return [clip];
  const { linkId } = clip;
  return Object.values(content.clips)
    .filter((other) => other.linkId === linkId)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Expand a selection so that linked clips are always included. */
export function expandLinked(content: VideoContent, clipIds: readonly string[]): Clip[] {
  const seen = new Map<string, Clip>();
  for (const id of clipIds) {
    for (const clip of linkedGroup(content, id)) seen.set(clip.id, clip);
  }
  return [...seen.values()];
}

/** The clip showing at `time` on a track (start inclusive, end exclusive), if any. */
export function clipAt(content: VideoContent, trackId: string, time: number): Clip | undefined {
  const clips = trackClips(content, trackId);
  // Binary search: clips are sorted and do not overlap.
  let low = 0;
  let high = clips.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const clip = clips[mid];
    if (!clip) return undefined;
    if (time < clip.start) high = mid - 1;
    else if (time >= clipEnd(clip)) low = mid + 1;
    else return clip;
  }
  return undefined;
}

/** All clips showing at `time`, one entry per track that has one: video tracks bottom to top, then audio. */
export function clipsAt(content: VideoContent, time: number): { track: Track; clip: Clip }[] {
  const out: { track: Track; clip: Clip }[] = [];
  for (const track of sortedTracks(content)) {
    const clip = clipAt(content, track.id, time);
    if (clip) out.push({ track, clip });
  }
  return out;
}

/** Whether `[start, start + duration)` is free on a track, ignoring the clips in `ignore`. */
export function isFree(
  content: VideoContent,
  trackId: string,
  start: number,
  duration: number,
  ignore: ReadonlySet<string> = new Set(),
): boolean {
  if (start < 0) return false;
  const end = start + duration;
  for (const clip of trackClips(content, trackId)) {
    if (ignore.has(clip.id)) continue;
    if (clip.start < end && clipEnd(clip) > start) return false;
  }
  return true;
}

/** The earliest time at or after `from` where `duration` fits on the track. */
export function firstFreeStart(
  content: VideoContent,
  trackId: string,
  from: number,
  duration: number,
): number {
  let start = Math.max(0, from);
  for (const clip of trackClips(content, trackId)) {
    if (clipEnd(clip) <= start) continue;
    if (clip.start >= start + duration) break;
    start = clipEnd(clip);
  }
  return start;
}

/**
 * The shift closest to `desired` at which the clips of `group` overlap no clip outside the group and none
 * starts before 0, or null when there is no such shift. `targetTrackId` is where `primaryId` is dropped (it
 * may differ from its current track); the other members stay on their tracks. Whether another clip counts as
 * before or after a moved clip is decided at the desired position, so a clip can be dragged past others.
 */
export function clampMoveDelta(
  content: VideoContent,
  group: readonly Clip[],
  primaryId: string,
  targetTrackId: string,
  desired: number,
): number | null {
  const inGroup = new Set(group.map((clip) => clip.id));
  let min = Number.NEGATIVE_INFINITY;
  let max = Number.POSITIVE_INFINITY;
  for (const clip of group) {
    min = Math.max(min, -clip.start);
    const trackId = clip.id === primaryId ? targetTrackId : clip.trackId;
    const middle = clip.start + desired + clip.duration / 2;
    for (const other of trackClips(content, trackId)) {
      if (inGroup.has(other.id)) continue;
      if (other.start + other.duration / 2 <= middle)
        min = Math.max(min, clipEnd(other) - clip.start);
      else max = Math.min(max, other.start - clipEnd(clip));
    }
  }
  if (min > max) return null;
  // + 0 turns a negative zero into 0.
  return Math.min(Math.max(desired, min), max) + 0;
}
