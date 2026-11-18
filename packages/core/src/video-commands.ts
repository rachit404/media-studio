import { current, type Draft } from 'immer';
import { z } from 'zod';
import { AppError } from './errors';
import type { Command } from './history';
import { textSpecSchema, type TextSpec } from './image-document';
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
  clipColourSchema,
  clipEnd,
  clipTransformSchema,
  clipTransitionSchema,
  isTextClip,
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
        const sourceIn =
          edge === 'start' && clip.assetId !== null ? clip.sourceIn + delta : clip.sourceIn;
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
          if (clip.assetId !== null) target.sourceIn = clip.sourceIn + delta;
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
          sourceIn: clip.assetId === null ? 0 : clip.sourceIn + (time - clip.start),
          linkId: clip.linkId === null ? null : (rightLinks.get(clip.linkId) ?? null),
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
