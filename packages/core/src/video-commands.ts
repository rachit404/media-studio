import { current, type Draft } from 'immer';
import { z } from 'zod';
import { AppError } from './errors';
import type { Command } from './history';
import { textSpecSchema, type TextSpec } from './image-document';
import {
  KEYFRAME_PROPERTIES,
  MAX_KEYFRAMES,
  joinKeyframes,
  keyframeAt,
  keyframesAfterStartMoved,
  scaleKeyframes,
  valueAt,
  type Easing,
  type Keyframe,
  type KeyframeProperty,
} from './keyframes';
import { insertAt, removeItem, sortedItems } from './ordered';
import type { ProjectDocument } from './project';
import type { Cue } from './subtitles';
import {
  clampMoveDelta,
  expandLinked,
  firstFreeStart,
  isFree,
  linkedGroup,
  outgoingClip,
  trackClips,
  tracksOfKind,
} from './timeline';
import { MAX_TIME_US } from './time';
import {
  MAX_CLIPS,
  MAX_SEQUENCE_SIZE,
  MAX_TRACKS,
  MAX_VOLUME,
  clipBackdropSchema,
  MAX_MARKERS,
  MAX_SPEED,
  MIN_SPEED,
  clipColourSchema,
  clipEnd,
  clipSourceAt,
  clipSpeed,
  sourceSpan,
  KEYFRAME_RANGES,
  clipTransform,
  clipTransformSchema,
  clipTransitionSchema,
  isTextClip,
  keyframePropertyFits,
  type Clip,
  type ClipBackdrop,
  type ClipLook,
  type ClipTransform,
  type ClipTransition,
  type Sequence,
  type TextClip,
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

/** Add an empty track at the end (video tracks go on top, audio tracks below the others). */
function createTrack(
  content: Draft<VideoContent>,
  kind: TrackKind,
  id: string,
  name?: string,
): void {
  const snapshot = before(content);
  if (Object.keys(snapshot.tracks.byId).length >= MAX_TRACKS) {
    throw invalid(`A sequence can have up to ${String(MAX_TRACKS)} tracks.`);
  }
  const same = tracksOfKind(snapshot, kind);
  const label = name ?? `${kind === 'video' ? 'Video' : 'Audio'} ${String(same.length + 1)}`;
  insertAt<Track>(
    content.tracks,
    { id, kind, name: label, muted: false, locked: false, clipIds: [] },
    sortedItems(snapshot.tracks).length,
  );
}

export function addTrack(kind: TrackKind, id: string): Command<ProjectDocument> {
  return {
    label: kind === 'video' ? 'Add video track' : 'Add audio track',
    apply(draft) {
      createTrack(videoDraft(draft), kind, id);
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
        // Text has no file behind it: it can be any length, and its in-point stays 0.
        const limit = clip.assetId === null ? Infinity : sourceDuration(draft, clip.assetId);
        const start = edge === 'start' ? clip.start + delta : clip.start;
        const end = edge === 'end' ? clipEnd(clip) + delta : clipEnd(clip);
        // The file moves by `speed` times the timeline change.
        const speed = clipSpeed(clip);
        const sourceIn =
          edge === 'start' && clip.assetId !== null
            ? clip.sourceIn + sourceSpan(delta, speed)
            : clip.sourceIn;
        if (
          start < 0 ||
          end <= start ||
          sourceIn < 0 ||
          sourceIn + sourceSpan(end - start, speed) > limit
        ) {
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
          const moved = keyframesAfterStartMoved(clip.keyframes, delta);
          if (moved) target.keyframes = moved;
          else delete target.keyframes;
          if (clip.assetId !== null) {
            target.sourceIn = clip.sourceIn + sourceSpan(delta, clipSpeed(clip));
          }
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
          sourceIn: clip.assetId === null ? 0 : clipSourceAt(clip, time - clip.start),
          linkId: clip.linkId === null ? null : (rightLinks.get(clip.linkId) ?? null),
          ...(clip.speed === undefined ? {} : { speed: clip.speed }),
          ...(clip.keyframes === undefined
            ? {}
            : (() => {
                const rest = keyframesAfterStartMoved(clip.keyframes, time - clip.start);
                return rest ? { keyframes: rest } : {};
              })()),
          ...(clip.text === undefined ? {} : { text: clip.text }),
          ...(clip.backdrop === undefined ? {} : { backdrop: clip.backdrop }),
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

/**
 * Set (or with `null` remove) the transition into a picture clip from the clip right before it on the track.
 * Dragging the duration merges into one undo step.
 */
export function setTransition(
  clipId: string,
  transition: ClipTransition | null,
): Command<ProjectDocument> {
  return {
    label: transition ? 'Set transition' : 'Remove transition',
    apply(draft) {
      const content = videoDraft(draft);
      const snapshot = before(content);
      const clip = snapshot.clips[clipId];
      if (!clip) throw new RangeError(`Clip ${clipId} does not exist`);
      assertEditable(snapshot, [clip]);
      const target = clipDraft(content, clipId);
      if (transition === null) {
        delete target.transitionIn;
        return;
      }
      if (snapshot.tracks.byId[clip.trackId]?.kind !== 'video' || clip.assetId === null) {
        throw invalid('Only picture clips can have a transition.');
      }
      if (!outgoingClip(snapshot, clip)) {
        throw invalid(
          'There is no clip right before this one.',
          'Place the clip directly after another clip on the same track.',
        );
      }
      const parsed = clipTransitionSchema.safeParse(transition);
      if (!parsed.success) throw invalid('That transition is not valid.');
      if (parsed.data.duration > clip.duration) {
        throw invalid('The transition cannot be longer than the clip.');
      }
      const { kind, duration, direction } = parsed.data;
      const wipes = kind === 'wipe' || kind === 'slide';
      target.transitionIn = { kind, duration, ...(wipes && direction ? { direction } : {}) };
    },
    ...(transition ? { coalesceKey: `transition:${clipId}` } : {}),
  };
}

/**
 * Play clips (and the clips linked to them, so picture and sound stay together) at a constant `speed` from 0.25
 * to 4. The same stretch of the file is used, so the clip gets shorter when faster and longer when slower; a
 * clip that would then run into the next one is refused. Speed 1 removes the setting. Sound changes pitch with
 * speed. Repeated edits of one clip merge into one undo step.
 */
export function setClipSpeed(clipId: string, speed: number): Command<ProjectDocument> {
  return {
    label: 'Change speed',
    coalesceKey: `clip-speed:${clipId}`,
    apply(draft) {
      const content = videoDraft(draft);
      const snapshot = before(content);
      if (!snapshot.clips[clipId]) throw new RangeError(`Clip ${clipId} does not exist`);
      if (!(speed >= MIN_SPEED && speed <= MAX_SPEED)) {
        throw invalid(`Speed must be between ${String(MIN_SPEED)} and ${String(MAX_SPEED)} times.`);
      }
      const group = linkedGroup(snapshot, clipId);
      assertEditable(snapshot, group);
      const ids = new Set(group.map((clip) => clip.id));
      const changes = group.map((clip) => {
        if (clip.assetId === null) throw invalid('Text clips have no speed.');
        const limit = sourceDuration(draft, clip.assetId);
        const span = sourceSpan(clip.duration, clipSpeed(clip));
        let duration = Math.max(1, Math.round(span / speed));
        // Rounding must not make the clip use more of the file than there is.
        while (duration > 1 && clip.sourceIn + sourceSpan(duration, speed) > limit) duration -= 1;
        if (clip.start + duration > MAX_TIME_US)
          throw invalid('That is past the end of the longest sequence.');
        if (
          duration > clip.duration &&
          !isFree(snapshot, clip.trackId, clip.start, duration, ids)
        ) {
          throw invalid(
            'There is no room for the clip to get longer.',
            'Another clip is in the way.',
          );
        }
        return { clip, duration };
      });
      for (const { clip, duration } of changes) {
        const target = clipDraft(content, clip.id);
        target.duration = duration;
        const scaled = scaleKeyframes(clip.keyframes, duration / clip.duration);
        if (scaled) target.keyframes = scaled;
        else delete target.keyframes;
        if (speed === 1) delete target.speed;
        else target.speed = speed;
      }
    },
  };
}

// Keyframes ----------------------------------------------------------------------------------------------

/** The fixed value of a property takes over when its keyframes are removed. */
function setFixedValue(target: Draft<Clip>, property: KeyframeProperty, value: number): void {
  if (property === 'opacity') {
    if (value === 1) delete target.opacity;
    else target.opacity = value;
  } else if (property === 'volume') {
    if (value === 1) delete target.volume;
    else target.volume = value;
  } else {
    target.transform = { ...clipTransform(target), [property]: value };
  }
}

function keyframeTarget(
  snapshot: VideoContent,
  clipId: string,
  property: KeyframeProperty,
): { clip: Clip; frames: readonly Keyframe[] } {
  const clip = snapshot.clips[clipId];
  if (!clip) throw new RangeError(`Clip ${clipId} does not exist`);
  assertEditable(snapshot, [clip]);
  const kind = snapshot.tracks.byId[clip.trackId]?.kind ?? 'video';
  if (
    !(KEYFRAME_PROPERTIES as readonly string[]).includes(property) ||
    !keyframePropertyFits(property, kind)
  ) {
    throw invalid(
      property === 'volume'
        ? 'Only sound clips can have volume keyframes.'
        : 'Only picture and text clips can have position, scale, rotation or opacity keyframes.',
    );
  }
  return { clip, frames: clip.keyframes?.[property] ?? [] };
}

function storeKeyframes(
  target: Draft<Clip>,
  property: KeyframeProperty,
  frames: readonly Keyframe[],
): void {
  const next = { ...(target.keyframes ?? {}) };
  if (frames.length === 0) delete next[property];
  else next[property] = [...frames];
  if (Object.keys(next).length === 0) delete target.keyframes;
  else target.keyframes = next;
}

/**
 * Put a keyframe on a property at `time` (microseconds after the clip's start), or change the one that is there.
 * The first keyframe on a property starts its animation. `easing` shapes the move to the next keyframe; left out,
 * a new keyframe is linear and an existing one keeps its shape. Dragging a value merges into one undo step.
 */
export function setKeyframe(
  clipId: string,
  property: KeyframeProperty,
  time: number,
  value: number,
  easing?: Easing,
): Command<ProjectDocument> {
  return {
    label: 'Set keyframe',
    coalesceKey: `keyframe:${clipId}:${property}:${String(time)}`,
    apply(draft) {
      const content = videoDraft(draft);
      const snapshot = before(content);
      const { clip, frames } = keyframeTarget(snapshot, clipId, property);
      const range = KEYFRAME_RANGES[property];
      if (!Number.isSafeInteger(time) || time < 0 || time > clip.duration) {
        throw invalid('A keyframe has to be inside the clip.');
      }
      if (!(value >= range.min && value <= range.max)) {
        throw invalid(`That value is not allowed for ${property}.`);
      }
      const existing = frames.find((frame) => frame.time === time);
      if (!existing && frames.length >= MAX_KEYFRAMES) {
        throw invalid(`A property can have up to ${String(MAX_KEYFRAMES)} keyframes.`);
      }
      const frame: Keyframe = { time, value, easing: easing ?? existing?.easing ?? 'linear' };
      const next = existing
        ? frames.map((candidate) => (candidate.time === time ? frame : candidate))
        : [...frames, frame].sort((a, b) => a.time - b.time);
      storeKeyframes(clipDraft(content, clipId), property, next);
    },
  };
}

/** Remove the keyframe at `time`. Removing the last one leaves the property fixed at that value. */
export function removeKeyframe(
  clipId: string,
  property: KeyframeProperty,
  time: number,
): Command<ProjectDocument> {
  return {
    label: 'Remove keyframe',
    apply(draft) {
      const content = videoDraft(draft);
      const { clip, frames } = keyframeTarget(before(content), clipId, property);
      const existing = keyframeAt(clip, property, time);
      if (!existing) throw invalid('There is no keyframe there.');
      const target = clipDraft(content, clipId);
      const rest = frames.filter((frame) => frame.time !== time);
      storeKeyframes(target, property, rest);
      if (rest.length === 0) setFixedValue(target, property, existing.value);
    },
  };
}

/** Move a keyframe to another time in the clip (not onto another keyframe). Dragging merges into one undo step. */
export function moveKeyframe(
  clipId: string,
  property: KeyframeProperty,
  from: number,
  to: number,
): Command<ProjectDocument> {
  return {
    label: 'Move keyframe',
    coalesceKey: `keyframe-move:${clipId}:${property}`,
    apply(draft) {
      const content = videoDraft(draft);
      const { clip, frames } = keyframeTarget(before(content), clipId, property);
      const moving = keyframeAt(clip, property, from);
      if (!moving) throw invalid('There is no keyframe there.');
      if (!Number.isSafeInteger(to) || to < 0 || to > clip.duration) {
        throw invalid('A keyframe has to be inside the clip.');
      }
      if (to !== from && frames.some((frame) => frame.time === to)) {
        throw invalid('There is already a keyframe there.');
      }
      const next = frames
        .map((frame) => (frame.time === from ? { ...frame, time: to } : frame))
        .sort((a, b) => a.time - b.time);
      storeKeyframes(clipDraft(content, clipId), property, next);
    },
  };
}

/** Remove every keyframe of a property; it stays fixed at the value of the first one. */
export function clearKeyframes(
  clipId: string,
  property: KeyframeProperty,
): Command<ProjectDocument> {
  return {
    label: 'Remove animation',
    apply(draft) {
      const content = videoDraft(draft);
      const { frames } = keyframeTarget(before(content), clipId, property);
      const first = frames[0];
      if (!first) throw invalid('That property is not animated.');
      const target = clipDraft(content, clipId);
      storeKeyframes(target, property, []);
      setFixedValue(target, property, valueAt(frames, 0, first.value));
    },
  };
}

/**
 * Change values of a clip as they are at `offset` (microseconds after its start): a property that has keyframes gets
 * a keyframe at that moment (or the one there is changed), and a property without keyframes changes its fixed value.
 * This is what dragging a handle on the preview or moving a slider does, so it works the same for animated and plain
 * clips, in one undo step (repeated drags merge).
 */
export function setValuesAt(
  clipId: string,
  offset: number,
  values: Partial<Record<KeyframeProperty, number>>,
): Command<ProjectDocument> {
  const properties = KEYFRAME_PROPERTIES.filter((property) => values[property] !== undefined);
  return {
    label: 'Change clip',
    coalesceKey: `values-at:${clipId}:${properties.join(',')}:${String(offset)}`,
    apply(draft) {
      const content = videoDraft(draft);
      const snapshot = before(content);
      for (const property of properties) {
        const value = values[property];
        const { clip, frames } = keyframeTarget(snapshot, clipId, property);
        const range = KEYFRAME_RANGES[property];
        if (value === undefined || !(value >= range.min && value <= range.max)) {
          throw invalid(`That value is not allowed for ${property}.`);
        }
        const target = clipDraft(content, clipId);
        if (frames.length === 0) {
          setFixedValue(target, property, value);
          continue;
        }
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > clip.duration) {
          throw invalid('A keyframe has to be inside the clip.');
        }
        const current = (target.keyframes?.[property] ?? []) as readonly Keyframe[];
        const existing = current.find((frame) => frame.time === offset);
        if (!existing && current.length >= MAX_KEYFRAMES) {
          throw invalid(`A property can have up to ${String(MAX_KEYFRAMES)} keyframes.`);
        }
        const frame: Keyframe = { time: offset, value, easing: existing?.easing ?? 'linear' };
        storeKeyframes(
          target,
          property,
          existing
            ? current.map((candidate) => (candidate.time === offset ? frame : candidate))
            : [...current, frame].sort((a, b) => a.time - b.time),
        );
      }
    },
  };
}

// Markers and in/out ------------------------------------------------------------------------------------

function validTime(time: number): void {
  if (!Number.isSafeInteger(time) || time < 0 || time > MAX_TIME_US) {
    throw invalid('That time is not valid.');
  }
}

/** Put a marker at `time`. There can be one marker per time. */
export function addMarker(id: string, time: number, name = ''): Command<ProjectDocument> {
  return {
    label: 'Add marker',
    apply(draft) {
      const content = videoDraft(draft);
      validTime(time);
      const cleaned = name.trim();
      if (cleaned.length > 60) throw invalid('Marker names can have up to 60 characters.');
      const markers = content.markers ?? [];
      if (markers.length >= MAX_MARKERS) {
        throw invalid(`A sequence can have up to ${String(MAX_MARKERS)} markers.`);
      }
      if (markers.some((marker) => marker.time === time)) {
        throw invalid('There is already a marker there.');
      }
      if (markers.some((marker) => marker.id === id)) throw invalid('That marker already exists.');
      content.markers = [...markers, { id, time, name: cleaned }].sort((a, b) => a.time - b.time);
    },
  };
}

/** Rename a marker; typing merges into one undo step. */
export function renameMarker(id: string, name: string): Command<ProjectDocument> {
  return {
    label: 'Rename marker',
    coalesceKey: `marker-name:${id}`,
    apply(draft) {
      const marker = videoDraft(draft).markers?.find((candidate) => candidate.id === id);
      if (!marker) throw new RangeError(`Marker ${id} does not exist`);
      if (name.length > 60) throw invalid('Marker names can have up to 60 characters.');
      marker.name = name;
    },
  };
}

export function removeMarker(id: string): Command<ProjectDocument> {
  return {
    label: 'Remove marker',
    apply(draft) {
      const content = videoDraft(draft);
      const markers = content.markers ?? [];
      if (!markers.some((marker) => marker.id === id)) {
        throw new RangeError(`Marker ${id} does not exist`);
      }
      const rest = markers.filter((marker) => marker.id !== id);
      if (rest.length === 0) delete content.markers;
      else content.markers = rest;
    },
  };
}

/**
 * Set or clear (null) the in and out points. A point that would land on the wrong side of the other one clears the
 * other one: setting the in point after the out point removes the out point, and the other way round.
 */
export function setInOut(patch: {
  in?: number | null;
  out?: number | null;
}): Command<ProjectDocument> {
  return {
    label:
      patch.in === null && patch.out === null ? 'Clear in and out points' : 'Set in or out point',
    apply(draft) {
      const content = videoDraft(draft);
      if (typeof patch.in === 'number') validTime(patch.in);
      if (typeof patch.out === 'number') validTime(patch.out);
      if (typeof patch.in === 'number' && typeof patch.out === 'number' && patch.in >= patch.out) {
        throw invalid('The in point must be before the out point.');
      }
      let inPoint = patch.in === undefined ? content.inPoint : (patch.in ?? undefined);
      let outPoint = patch.out === undefined ? content.outPoint : (patch.out ?? undefined);
      if (inPoint !== undefined && outPoint !== undefined && inPoint >= outPoint) {
        if (typeof patch.in === 'number') outPoint = undefined;
        else inPoint = undefined;
      }
      if (inPoint === undefined) delete content.inPoint;
      else content.inPoint = inPoint;
      if (outPoint === undefined) delete content.outPoint;
      else content.outPoint = outPoint;
    },
  };
}

// Text and subtitles -------------------------------------------------------------------------------------

export interface AddTextParams {
  clipId: string;
  /** The video track to put the text on (it must have room), or ... */
  trackId?: string;
  /** ... the id of a new video track to create for it (on top of the others). */
  newTrackId?: string;
  start: number;
  duration: number;
  text: TextSpec;
  backdrop?: ClipBackdrop;
  transform?: ClipTransform;
}

function parseText(text: TextSpec): TextSpec {
  const parsed = textSpecSchema.safeParse(text);
  if (!parsed.success) throw invalid('That text is not valid.', 'Check the size and the colour.');
  return parsed.data;
}

function parseBackdrop(backdrop: ClipBackdrop): ClipBackdrop {
  const parsed = clipBackdropSchema.safeParse(backdrop);
  if (!parsed.success) throw invalid('That text box is not valid.');
  return parsed.data;
}

/** Put a title on the timeline: a clip with text instead of media. */
export function addTextClip(params: AddTextParams): Command<ProjectDocument> {
  return {
    label: 'Add text',
    apply(draft) {
      const content = videoDraft(draft);
      const text = parseText(params.text);
      if (
        !Number.isSafeInteger(params.start) ||
        !Number.isSafeInteger(params.duration) ||
        params.start < 0 ||
        params.duration < 1 ||
        params.start + params.duration > MAX_TIME_US
      ) {
        throw invalid('That time is not valid.');
      }
      if (Object.keys(before(content).clips).length >= MAX_CLIPS) {
        throw invalid(`A sequence can have up to ${String(MAX_CLIPS)} clips.`);
      }
      if (params.newTrackId) createTrack(content, 'video', params.newTrackId);
      const trackId = params.newTrackId ?? params.trackId;
      const track = trackId ? before(content).tracks.byId[trackId] : undefined;
      if (track?.kind !== 'video') throw invalid('Text goes on a video track.');
      if (track.locked) throw invalid('That track is locked.', 'Unlock the track first.');
      if (!isFree(before(content), track.id, params.start, params.duration)) {
        throw invalid('There is no room there.', 'Choose a free spot or another track.');
      }
      content.clips[params.clipId] = {
        id: params.clipId,
        trackId: track.id,
        assetId: null,
        start: params.start,
        duration: params.duration,
        sourceIn: 0,
        linkId: null,
        text,
        ...(params.backdrop ? { backdrop: parseBackdrop(params.backdrop) } : {}),
        ...(params.transform ? { transform: clipTransformSchema.parse(params.transform) } : {}),
      };
      content.tracks.byId[track.id]?.clipIds.push(params.clipId);
      resort(content, track.id);
    },
  };
}

export interface SubtitleStyle {
  /** Everything but the words. */
  text: Omit<TextSpec, 'text'>;
  backdrop?: ClipBackdrop;
  transform?: ClipTransform;
}

/**
 * Import subtitle cues as a new video track of text clips, one per cue (burned into the picture on export).
 * `clipIds` has one id per cue. The cues must be in order and must not overlap (what `parseSubtitles` gives).
 */
export function addSubtitleTrack(params: {
  trackId: string;
  name: string;
  cues: readonly Cue[];
  clipIds: readonly string[];
  style: SubtitleStyle;
}): Command<ProjectDocument> {
  return {
    label: 'Import subtitles',
    apply(draft) {
      const content = videoDraft(draft);
      const { cues, clipIds, style } = params;
      if (cues.length === 0 || cues.length !== clipIds.length) {
        throw invalid('There are no subtitles to add.');
      }
      if (Object.keys(before(content).clips).length + cues.length > MAX_CLIPS) {
        throw invalid(`A sequence can have up to ${String(MAX_CLIPS)} clips.`);
      }
      const name = params.name.trim().slice(0, 60);
      if (name === '') throw invalid('The track needs a name.');
      createTrack(content, 'video', params.trackId, name);
      const track = content.tracks.byId[params.trackId];
      const backdrop = style.backdrop ? parseBackdrop(style.backdrop) : undefined;
      const transform = style.transform ? clipTransformSchema.parse(style.transform) : undefined;
      let previousEnd = 0;
      cues.forEach((cue, index) => {
        const id = clipIds[index];
        if (id === undefined) return;
        if (cue.start < previousEnd || cue.end <= cue.start || cue.end > MAX_TIME_US) {
          throw invalid('The subtitles are out of order or overlap.');
        }
        previousEnd = cue.end;
        content.clips[id] = {
          id,
          trackId: params.trackId,
          assetId: null,
          start: cue.start,
          duration: cue.end - cue.start,
          sourceIn: 0,
          linkId: null,
          text: parseText({ ...style.text, text: cue.text }),
          ...(backdrop ? { backdrop } : {}),
          ...(transform ? { transform } : {}),
        };
        track?.clipIds.push(id);
      });
    },
  };
}

/** A change to text clips: the words and style, and the box behind (`null` removes it). */
export type ClipTextPatch = Partial<TextSpec> & { backdrop?: ClipBackdrop | null };

/** Change the text or style of text clips. Repeated edits of the same fields merge into one undo step. */
export function setClipText(
  clipIds: readonly string[],
  patch: ClipTextPatch,
): Command<ProjectDocument> {
  const keys = Object.keys(patch).sort();
  return {
    label: 'Change text',
    coalesceKey: `clip-text:${[...clipIds].sort().join(',')}:${keys.join(',')}`,
    apply(draft) {
      const content = videoDraft(draft);
      const snapshot = before(content);
      const clips = clipIds.map((id) => snapshot.clips[id]);
      const texts = clips.filter(
        (clip): clip is TextClip => clip !== undefined && isTextClip(clip),
      );
      if (texts.length !== clipIds.length) throw invalid('Only text clips have text to change.');
      assertEditable(snapshot, texts);
      const { backdrop, ...spec } = patch;
      const nextBackdrop =
        backdrop === undefined || backdrop === null ? backdrop : parseBackdrop(backdrop);
      for (const clip of texts) {
        const target = clipDraft(content, clip.id);
        target.text = parseText({ ...clip.text, ...spec });
        if (nextBackdrop === null) delete target.backdrop;
        else if (nextBackdrop !== undefined) target.backdrop = nextBackdrop;
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
          clip.assetId !== null &&
          next.assetId === clip.assetId &&
          next.start === clipEnd(clip) &&
          clipSpeed(next) === clipSpeed(clip) &&
          next.sourceIn === clip.sourceIn + sourceSpan(clip.duration, clipSpeed(clip));
        if (!joinable) throw invalid('These clips are not one continuous piece of the same file.');
        const joined = joinKeyframes(clip.keyframes, next.keyframes, clip.duration);
        if (!joined) {
          throw invalid('These clips are animated differently, so they cannot be joined.');
        }
        return { clip, next, keyframes: joined.keyframes };
      });
      for (const { clip, next, keyframes } of pairs) {
        const target = clipDraft(content, clip.id);
        target.duration = clip.duration + next.duration;
        if (keyframes) target.keyframes = keyframes;
        else delete target.keyframes;
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
