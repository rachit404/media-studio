import {
  clipGainAt,
  sortedTracks,
  type Clip,
  type Track,
  type VideoContent,
} from '@media-studio/core';

/**
 * Whether an audio track is heard: not muted, and, when any audio track is soloed, soloed itself. (A muted track
 * stays silent even when it is also soloed.) Video tracks make no sound of their own.
 */
export function isAudible(content: VideoContent, track: Track): boolean {
  if (track.kind !== 'audio' || track.muted) return false;
  const anySolo = sortedTracks(content).some((t) => t.kind === 'audio' && t.solo === true);
  return !anySolo || track.solo === true;
}

/** The audio tracks that are heard, bottom to top. */
export function audibleTracks(content: VideoContent): Track[] {
  return sortedTracks(content).filter((track) => isAudible(content, track));
}

/**
 * The gain of one clip on the timeline: track volume times clip volume and fades. Returns a function of timeline
 * time so the live player and the offline mix share exactly the same envelope.
 */
export function clipGainOnTimeline(track: Track, clip: Clip): (timelineUs: number) => number {
  const trackVolume = track.volume ?? 1;
  return (timelineUs) => trackVolume * clipGainAt(clip, timelineUs - clip.start);
}

/** True when the gain of this clip is the same everywhere (no fades), so the mix can use one number. */
export function hasFades(clip: Pick<Clip, 'fadeIn' | 'fadeOut'>): boolean {
  return (clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0;
}
