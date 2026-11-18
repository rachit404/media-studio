import { current, type Draft } from 'immer';
import { z } from 'zod';
import { AppError } from './errors';
import type { Command } from './history';
import { insertAt, removeItem, sortedItems } from './ordered';
import type { ProjectDocument } from './project';
import {
  clampMoveDelta,
  expandLinked,
  firstFreeStart,
  isFree,
  linkedGroup,
  trackClips,
  tracksOfKind,
} from './timeline';
import { MAX_TIME_US } from './time';
import {
  MAX_CLIPS,
  MAX_SEQUENCE_SIZE,
  MAX_TRACKS,
  MAX_VOLUME,
  clipColourSchema,
  clipEnd,
  clipTransformSchema,
  type Clip,
  type ClipLook,
  type Sequence,
  type Track,
  type TrackKind,
  type VideoContent,
} from './video-document';

function invalid(message: string, hint?: string): AppError {
  return new AppError({ code: 'invalid-project', message, hint });
}

function videoDraft(draft: Draft<ProjectDocument>): Draft<VideoContent> {
  if (draft.content.kind !== 'video') throw invalid('This action only works in video projects.');
  return draft.content;
}

/** The state before this command changes anything (cheap: an untouched draft returns its base). */
function before(content: Draft<VideoContent>): VideoContent {
  return current<VideoContent>(content);
}

function assertEditable(content: VideoContent, clips: readonly Clip[]): void {
  for (const clip of clips) {
    if (content.tracks.byId[clip.trackId]?.locked) {
      throw invalid('That track is locked.', 'Unlock the track to edit its clips.');
    }
  }
}

function resort(content: Draft<VideoContent>, trackId: string): void {
  const track = content.tracks.byId[trackId];
  if (!track) return;
  const starts = new Map<string, number>();
  for (const id of track.clipIds) starts.set(id, content.clips[id]?.start ?? 0);
  track.clipIds = [...track.clipIds].sort((a, b) => (starts.get(a) ?? 0) - (starts.get(b) ?? 0));
}

function clipDraft(content: Draft<VideoContent>, id: string): Draft<Clip> {
  const clip = content.clips[id];
  if (!clip) throw new RangeError(`Clip ${id} does not exist`);
  return clip;
}

function sourceDuration(doc: Draft<ProjectDocument>, assetId: string): number {
  const asset = doc.assets.byId[assetId];
  if (asset?.kind !== 'video' && asset?.kind !== 'audio') {
    throw invalid('The media for this clip is missing.');
  }
  return asset.duration;
}

// Sequence and tracks ------------------------------------------------------------------------------------

export function setSequence(patch: Partial<Sequence>): Command<ProjectDocument> {
  return {
    label: 'Change sequence settings',
    coalesceKey: 'set-sequence',
    apply(draft) {
      const content = videoDraft(draft);
      const next = { ...content.sequence, ...patch };
      if (
        next.width < 16 ||
        next.height < 16 ||
        next.width > MAX_SEQUENCE_SIZE ||
        next.height > MAX_SEQUENCE_SIZE
      ) {
        throw invalid(
          `The picture size must be between 16 and ${String(MAX_SEQUENCE_SIZE)} pixels.`,
        );
      }
      content.sequence = next;
    },
  };
}

export function addTrack(kind: TrackKind, id: string): Command<ProjectDocument> {
  return {
    label: kind === 'video' ? 'Add video track' : 'Add audio track',
    apply(draft) {
      const content = videoDraft(draft);
      const snapshot = before(content);
      if (Object.keys(snapshot.tracks.byId).length >= MAX_TRACKS) {
        throw invalid(`A sequence can have up to ${String(MAX_TRACKS)} tracks.`);
      }
      const same = tracksOfKind(snapshot, kind);
      const name = `${kind === 'video' ? 'Video' : 'Audio'} ${String(same.length + 1)}`;
      // Video: new tracks go on top (end of its group). Audio: below the others. Both append in key order.
      const all = sortedItems(snapshot.tracks);
      insertAt<Track>(
        content.tracks,
        { id, kind, name, muted: false, locked: false, clipIds: [] },
        all.length,
      );
    },
  };
}

export function removeTrack(id: string): Command<ProjectDocument> {
  return {
    label: 'Remove track',
    apply(draft) {
      const content = videoDraft(draft);
      const track = content.tracks.byId[id];
      if (!track) throw new RangeError(`Track ${id} does not exist`);
      if (track.clipIds.length > 0) {
        throw invalid('This track still has clips.', 'Delete or move its clips first.');
      }
      if (tracksOfKind(before(content), track.kind).length <= 1) {
        throw invalid('A sequence needs at least one video and one audio track.');
      }
      removeItem(content.tracks, id);
    },
  };
}

export interface TrackPatch {
  muted?: boolean;
  locked?: boolean;
  name?: string;
  solo?: boolean;
  volume?: number;
}

export function setTrackState(id: string, patch: TrackPatch): Command<ProjectDocument> {
  return {
    label: 'Change track',
    coalesceKey:
      patch.name !== undefined
        ? `track-name:${id}`
        : patch.volume !== undefined
          ? `track-volume:${id}`
          : undefined,
    apply(draft) {
      const track = videoDraft(draft).tracks.byId[id];
      if (!track) throw new RangeError(`Track ${id} does not exist`);
      if (patch.muted !== undefined) track.muted = patch.muted;
      if (patch.locked !== undefined) track.locked = patch.locked;
      if (patch.solo !== undefined) {
        if (patch.solo) track.solo = true;
        else delete track.solo;
      }
      if (patch.volume !== undefined) {
        if (!(patch.volume >= 0 && patch.volume <= MAX_VOLUME)) {
          throw invalid(`Track volume must be between 0 and ${String(MAX_VOLUME)}.`);
        }
        if (patch.volume === 1) delete track.volume;
        else track.volume = patch.volume;
      }
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (name.length === 0 || name.length > 60) {
          throw invalid('Track names must be between 1 and 60 characters.');
        }
        track.name = name;
      }
    },
  };
}

// Clips -------------------------------------------------------------------------------------------------

export interface AddMediaParams {
  assetId: string;
  /** Timeline position of the new clip(s). */
  start: number;
  /** Id for the picture clip (video assets) or the sound clip (audio assets). */
  clipId: string;
  /** Id for the sound clip of a video asset that has audio. */
  audioClipId: string;
  /** Link shared by the picture and sound clips. */
  linkId: string;
  /** Tracks to use; default is the first track of the right kind that is not locked. */
  videoTrackId?: string;
  audioTrackId?: string;
  /** Length in microseconds; default is the whole file. */
  duration?: number;
  sourceIn?: number;
}

/**
 * Put a video or audio file on the timeline. A video file with sound becomes two linked clips. When the
 * sequence is still empty it takes its picture size and frame rate from the first video (VID-2).
 */
export function addMediaToTimeline(params: AddMediaParams): Command<ProjectDocument> {
  return {
    label: 'Add to timeline',
    apply(draft) {
      const content = videoDraft(draft);
      const snapshot = before(content);
      const asset = draft.assets.byId[params.assetId];
      if (asset?.kind !== 'video' && asset?.kind !== 'audio') {
        throw invalid('Only video and audio files can be placed on the timeline.');
      }
      const sourceIn = params.sourceIn ?? 0;
      const duration = params.duration ?? asset.duration - sourceIn;
      if (
        !Number.isSafeInteger(params.start) ||
        params.start < 0 ||
        params.start + duration > MAX_TIME_US ||
        sourceIn < 0 ||
        duration < 1 ||
        sourceIn + duration > asset.duration
      ) {
        throw invalid('That part of the file is not available.');
      }
      if (Object.keys(snapshot.clips).length + 2 > MAX_CLIPS) {
        throw invalid(`A sequence can have up to ${String(MAX_CLIPS)} clips.`);
      }

      const pick = (kind: TrackKind, wanted: string | undefined): Track => {
        const track = wanted
          ? snapshot.tracks.byId[wanted]
          : tracksOfKind(snapshot, kind).find((candidate) => !candidate.locked);
        if (track?.kind !== kind) throw invalid(`There is no ${kind} track to put this on.`);
        if (track.locked) throw invalid('That track is locked.', 'Unlock the track first.');
        return track;
      };

      const place = (track: Track, id: string, linked: boolean) => {
        if (!isFree(snapshot, track.id, params.start, duration)) {
          throw invalid('There is no room there.', 'Choose a free spot or another track.');
        }
        content.clips[id] = {
          id,
          trackId: track.id,
          assetId: asset.id,
          start: params.start,
          duration,
          sourceIn,
          linkId: linked ? params.linkId : null,
        };
        const target = content.tracks.byId[track.id];
        if (!target) return;
        target.clipIds.push(id);
        resort(content, track.id);
      };

      if (asset.kind === 'audio') {
        place(pick('audio', params.audioTrackId), params.clipId, false);
        return;
      }
      const hasSound = asset.audio !== null;
      const videoTrack = pick('video', params.videoTrackId);
      const audioTrack = hasSound ? pick('audio', params.audioTrackId) : null;
      if (Object.keys(snapshot.clips).length === 0) {
        content.sequence.width = asset.width;
        content.sequence.height = asset.height;
        content.sequence.fps = asset.fps;
        if (asset.audio?.sampleRate === 44_100) content.sequence.sampleRate = 44_100;
      }
      place(videoTrack, params.clipId, hasSound);
      if (audioTrack) place(audioTrack, params.audioClipId, true);
    },
  };
}

/** Where a new file of `duration` would go on a track so that it does not overlap anything (after `from`). */
export function appendPosition(
  content: VideoContent,
  trackId: string,
  from: number,
  duration: number,
): number {
  return firstFreeStart(content, trackId, from, duration);
}

/**
 * Move clips (and the clips linked to them) in time by `delta`; `trackId` moves the primary clip to another
 * track of the same kind. Throws when that would overlap another clip.
 */
export function moveClips(
  primaryId: string,
  delta: number,
  trackId?: string,
): Command<ProjectDocument> {
  return {
    label: 'Move clip',
    apply(draft) {
      const content = videoDraft(draft);
      const snapshot = before(content);
      const primary = snapshot.clips[primaryId];
      if (!primary) throw new RangeError(`Clip ${primaryId} does not exist`);
      const target = trackId ?? primary.trackId;
      const targetTrack = snapshot.tracks.byId[target];
      const sourceTrack = snapshot.tracks.byId[primary.trackId];
      if (targetTrack?.kind !== sourceTrack?.kind) {
        throw invalid('Clips can only move to a track of the same kind.');
      }
      if (targetTrack?.locked) throw invalid('That track is locked.', 'Unlock the track first.');
      const group = linkedGroup(snapshot, primaryId);
      assertEditable(snapshot, group);
      const allowed = clampMoveDelta(snapshot, group, primaryId, target, delta);
      if (allowed !== delta) throw invalid('There is no room there.', 'Choose a free spot.');
      const touched = new Set<string>();
      for (const clip of group) {
        const moving = clipDraft(content, clip.id);
        moving.start = clip.start + delta;
        if (clip.id === primaryId && target !== clip.trackId) {
          const from = content.tracks.byId[clip.trackId];
          if (from) from.clipIds = from.clipIds.filter((id) => id !== clip.id);
          content.tracks.byId[target]?.clipIds.push(clip.id);
          moving.trackId = target;
        }
        touched.add(moving.trackId);
        touched.add(clip.trackId);
      }
      for (const id of touched) resort(content, id);
    },
  };
}

export type TrimEdge = 'start' | 'end';

/**
 * Trim one edge of a clip (and of its linked clips) to timeline time `time`. The start edge moves the source
 * in-point with it, so the picture stays where it was; it cannot go past the start of the file, onto another
 * clip, or past the other edge. `ripple` shifts the clips after the trimmed end by the change.
 */
export function trimClip(
  clipId: string,
  edge: TrimEdge,
  time: number,
  options: { ripple?: boolean } = {},
): Command<ProjectDocument> {
  return {
    label: 'Trim clip',
    coalesceKey: `trim:${clipId}:${edge}`,
    apply(draft) {
      const content = videoDraft(draft);
      const snapshot = before(content);
      const primary = snapshot.clips[clipId];
      if (!primary) throw new RangeError(`Clip ${clipId} does not exist`);
      if (!Number.isSafeInteger(time)) throw invalid('That time is not valid.');
      const group = linkedGroup(snapshot, clipId);
      assertEditable(snapshot, group);
      const delta = edge === 'start' ? time - primary.start : time - clipEnd(primary);
      const ids = new Set(group.map((clip) => clip.id));
      // Only the end edge ripples; dragging the start edge never moves other clips.
      const ripple = options.ripple === true && edge === 'end';

      for (const clip of group) {
        const limit = sourceDuration(draft, clip.assetId);
        const start = edge === 'start' ? clip.start + delta : clip.start;
        const end = edge === 'end' ? clipEnd(clip) + delta : clipEnd(clip);
        const sourceIn = edge === 'start' ? clip.sourceIn + delta : clip.sourceIn;
        if (start < 0 || end <= start || sourceIn < 0 || sourceIn + (end - start) > limit) {
          throw invalid('The clip cannot be trimmed that far.', 'There is no more of the file.');
        }
        if (end > MAX_TIME_US) throw invalid('That is past the end of the longest sequence.');
        const growing = edge === 'start' ? delta < 0 : delta > 0;
        if (growing && !ripple) {
          if (!isFree(snapshot, clip.trackId, start, end - start, ids)) {
            throw invalid('There is no room there.', 'Another clip is in the way.');
          }
        }
      }
      for (const clip of group) {
        const target = clipDraft(content, clip.id);
        if (edge === 'start') {
          target.start = clip.start + delta;
          target.sourceIn = clip.sourceIn + delta;
          target.duration = clip.duration - delta;
        } else {
          target.duration = clip.duration + delta;
          if (ripple && delta !== 0) {
            for (const later of trackClips(snapshot, clip.trackId)) {
              if (later.start >= clipEnd(clip) && !ids.has(later.id)) {
                const shifted = later.start + delta;
                if (shifted < 0 || shifted + later.duration > MAX_TIME_US) {
                  throw invalid('The clips after this one cannot move that far.');
                }
                clipDraft(content, later.id).start = shifted;
              }
            }
          }
        }
      }
    },
  };
}

/**
 * Split clips (and the clips linked to them) at timeline time `time`. `makeId` supplies the ids of the new second
 * halves and of the new links; the pieces after the cut keep their links among themselves.
 */
export function splitClips(
  content: VideoContent,
  clipIds: readonly string[],
  time: number,
  makeId: () => string,
): Command<ProjectDocument> {
  const group = expandLinked(content, clipIds);
  const rightIds = new Map(group.map((clip) => [clip.id, makeId()]));
  const rightLinks = new Map<string, string>();
  for (const clip of group) {
    if (clip.linkId !== null && !rightLinks.has(clip.linkId)) rightLinks.set(clip.linkId, makeId());
  }
  return {
    label: group.length > 1 ? 'Split clips' : 'Split clip',
    apply(draft) {
      const target = videoDraft(draft);
      const snapshot = before(target);
      const members = expandLinked(snapshot, clipIds);
      assertEditable(snapshot, members);
      if (Object.keys(snapshot.clips).length + members.length > MAX_CLIPS) {
        throw invalid(`A sequence can have up to ${String(MAX_CLIPS)} clips.`);
      }
      for (const clip of members) {
        if (time <= clip.start || time >= clipEnd(clip)) {
          throw invalid(
            'The playhead is not inside that clip.',
            'Move the playhead onto the clip.',
          );
        }
      }
      for (const clip of members) {
        const rightId = rightIds.get(clip.id);
        if (!rightId) throw invalid('Split changed while it was being applied.');
        const left = clipDraft(target, clip.id);
        left.duration = time - clip.start;
        target.clips[rightId] = {
          id: rightId,
          trackId: clip.trackId,
          assetId: clip.assetId,
          start: time,
          duration: clipEnd(clip) - time,
          sourceIn: clip.sourceIn + (time - clip.start),
          linkId: clip.linkId === null ? null : (rightLinks.get(clip.linkId) ?? null),
          ...splitLook(clip),
        };
        // The fade in stays with the left half and the fade out moves to the right half.
        delete left.fadeOut;
        const track = target.tracks.byId[clip.trackId];
        if (track) {
          track.clipIds.splice(track.clipIds.indexOf(clip.id) + 1, 0, rightId);
        }
      }
    },
  };
}

/** Split one clip (and its linked clips); see `splitClips`. */
export function splitClip(
  content: VideoContent,
  clipId: string,
  time: number,
  makeId: () => string,
): Command<ProjectDocument> {
  return splitClips(content, [clipId], time, makeId);
}

/** What the right half of a split inherits: every look property except the fade in. */
function splitLook(clip: Clip): Omit<ClipLook, 'fadeIn'> {
  const { transform, opacity, colour, volume, fadeOut } = clip;
  return {
    ...(transform === undefined ? {} : { transform }),
    ...(opacity === undefined ? {} : { opacity }),
    ...(colour === undefined ? {} : { colour }),
    ...(volume === undefined ? {} : { volume }),
    ...(fadeOut === undefined ? {} : { fadeOut }),
  };
}

/** A change to the look of clips: a value sets the property, `null` puts it back to its default. */
export type ClipLookPatch = { [K in keyof ClipLook]?: NonNullable<ClipLook[K]> | null };

const lookValidators: { [K in keyof ClipLook]-?: z.ZodType } = {
  transform: clipTransformSchema,
  opacity: z.number().min(0).max(1),
  colour: clipColourSchema,
  volume: z.number().min(0).max(MAX_VOLUME),
  fadeIn: z.number().int().min(0).max(MAX_TIME_US),
  fadeOut: z.number().int().min(0).max(MAX_TIME_US),
};
const LOOK_KEYS = Object.keys(lookValidators) as (keyof ClipLook)[];

/**
 * Change position, opacity, colour, volume or fades of clips (only the clips named; linked clips are separate
 * because picture and sound have different properties). Repeated edits of the same properties merge into one undo.
 */
export function setClipLook(
  clipIds: readonly string[],
  patch: ClipLookPatch,
): Command<ProjectDocument> {
  const keys = LOOK_KEYS.filter((key) => patch[key] !== undefined);
  return {
    label: 'Change clip',
    coalesceKey: `clip-look:${[...clipIds].sort().join(',')}:${keys.join(',')}`,
    apply(draft) {
      const content = videoDraft(draft);
      const snapshot = before(content);
      const clips = clipIds
        .map((id) => snapshot.clips[id])
        .filter((c): c is Clip => c !== undefined);
      if (clips.length !== clipIds.length) throw new RangeError('A clip to change does not exist');
      assertEditable(snapshot, clips);
      for (const key of keys) {
        const value = patch[key];
        if (value !== null && !lookValidators[key].safeParse(value).success) {
          throw invalid(`That value is not allowed for ${key}.`);
        }
      }
      for (const clip of clips) {
        const target = clipDraft(content, clip.id) as Record<string, unknown>;
        for (const key of keys) {
          const value = patch[key];
          if (value === null || value === undefined) delete target[key];
          else target[key] = value;
        }
      }
    },
  };
}

/** Delete clips and the clips linked to them. `ripple` closes the gaps they leave on their tracks. */
export function deleteClips(clipIds: readonly string[], ripple: boolean): Command<ProjectDocument> {
  return {
    label: ripple ? 'Ripple delete' : 'Delete clip',
    apply(draft) {
      const content = videoDraft(draft);
      const snapshot = before(content);
      const doomed = expandLinked(snapshot, clipIds);
      if (doomed.length === 0) return;
      assertEditable(snapshot, doomed);
      const gone = new Set(doomed.map((clip) => clip.id));
      const byTrack = new Map<string, Clip[]>();
      for (const clip of doomed)
        byTrack.set(clip.trackId, [...(byTrack.get(clip.trackId) ?? []), clip]);

      for (const [trackId, removed] of byTrack) {
        const track = content.tracks.byId[trackId];
        if (!track) continue;
        if (ripple) {
          const sorted = [...removed].sort((a, b) => a.start - b.start);
          for (const later of trackClips(snapshot, trackId)) {
            if (gone.has(later.id)) continue;
            // Shift left by the total length of the removed clips that were before it.
            const shift = sorted
              .filter((clip) => clipEnd(clip) <= later.start)
              .reduce((sum, clip) => sum + clip.duration, 0);
            if (shift > 0) clipDraft(content, later.id).start = later.start - shift;
          }
        }
        track.clipIds = track.clipIds.filter((id) => !gone.has(id));
      }
      for (const id of gone) Reflect.deleteProperty(content.clips, id);
    },
  };
}

/**
 * Join a clip with the clip right after it on the same track when they are two pieces of one continuous
 * stretch of the same file (the opposite of split). Linked clips are joined together.
 */
export function joinClips(clipId: string): Command<ProjectDocument> {
  return {
    label: 'Join clips',
    apply(draft) {
      const content = videoDraft(draft);
      const snapshot = before(content);
      const group = linkedGroup(snapshot, clipId);
      assertEditable(snapshot, group);
      const pairs = group.map((clip) => {
        const clips = trackClips(snapshot, clip.trackId);
        const next = clips[clips.findIndex((other) => other.id === clip.id) + 1];
        const joinable =
          next !== undefined &&
          next.assetId === clip.assetId &&
          next.start === clipEnd(clip) &&
          next.sourceIn === clip.sourceIn + clip.duration;
        if (!joinable) throw invalid('These clips are not one continuous piece of the same file.');
        return { clip, next };
      });
      for (const { clip, next } of pairs) {
        clipDraft(content, clip.id).duration = clip.duration + next.duration;
        const track = content.tracks.byId[clip.trackId];
        if (track) track.clipIds = track.clipIds.filter((id) => id !== next.id);
        Reflect.deleteProperty(content.clips, next.id);
      }
    },
  };
}

/** Remove the link between clips, so they can be edited separately. */
export function unlinkClips(clipId: string): Command<ProjectDocument> {
  return {
    label: 'Unlink clips',
    apply(draft) {
      const content = videoDraft(draft);
      for (const clip of linkedGroup(before(content), clipId))
        clipDraft(content, clip.id).linkId = null;
    },
  };
}

/** Ids of the clips that use an asset (an asset in use cannot be removed). */
export function clipsUsingAsset(content: VideoContent, assetId: string): string[] {
  return Object.values(content.clips)
    .filter((clip) => clip.assetId === assetId)
    .map((clip) => clip.id);
}
