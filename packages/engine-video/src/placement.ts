import {
  firstFreeStart,
  tracksOfKind,
  type Asset,
  type TrackKind,
  type VideoContent,
} from '@media-studio/core';

export interface Placement {
  start: number;
  /** Set for video files. */
  videoTrackId?: string;
  /** Set for audio files and for video files that have sound. */
  audioTrackId?: string;
}

function firstOpenTrack(content: VideoContent, kind: TrackKind): string | undefined {
  return tracksOfKind(content, kind).find((track) => !track.locked)?.id;
}

/**
 * Where a file goes when it is added from the library: the first unlocked track of each kind it needs, at the
 * earliest time at or after `from` where it fits on all of them (a picture and its sound go in together). Returns
 * null when there is no unlocked track to put it on.
 */
export function placeAsset(content: VideoContent, asset: Asset, from: number): Placement | null {
  if (asset.kind === 'image') return null;
  const videoTrackId = asset.kind === 'video' ? firstOpenTrack(content, 'video') : undefined;
  const needsSound = asset.kind === 'audio' || (asset.kind === 'video' && asset.audio !== null);
  const audioTrackId = needsSound ? firstOpenTrack(content, 'audio') : undefined;
  if ((asset.kind === 'video' && !videoTrackId) || (needsSound && !audioTrackId)) return null;

  const tracks = [videoTrackId, audioTrackId].filter((id): id is string => id !== undefined);
  let start = Math.max(0, from);
  // Moving past a clip on one track can land on a clip on the other, so repeat until they agree.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const next = tracks.reduce(
      (candidate, id) => firstFreeStart(content, id, candidate, asset.duration),
      start,
    );
    if (next === start) break;
    start = next;
  }
  return {
    start,
    ...(videoTrackId ? { videoTrackId } : {}),
    ...(audioTrackId ? { audioTrackId } : {}),
  };
}
