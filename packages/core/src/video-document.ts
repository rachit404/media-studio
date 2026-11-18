import { z } from 'zod';
import { createOrdered, type Ordered } from './ordered';
import { idSchema, orderedSchema } from './schema-common';
import { FPS_30, MAX_TIME_US, frameRateSchema } from './time';

/** Largest picture we accept for a sequence (8K). */
export const MAX_SEQUENCE_SIZE = 8192;
/** Most clips on one track and in the whole sequence; keeps validation and rendering bounded. */
export const MAX_CLIPS = 20_000;
export const MAX_TRACKS = 32;
/** Louder than this (+12 dB) is almost always a mistake and only clips the mix. */
export const MAX_VOLUME = 4;

export const SAMPLE_RATES = [44_100, 48_000] as const;

export const sequenceSchema = z.strictObject({
  width: z.number().int().min(16).max(MAX_SEQUENCE_SIZE),
  height: z.number().int().min(16).max(MAX_SEQUENCE_SIZE),
  fps: frameRateSchema,
  sampleRate: z.union([z.literal(44_100), z.literal(48_000)]),
});
export type Sequence = z.infer<typeof sequenceSchema>;

export const trackKindSchema = z.enum(['video', 'audio']);
export type TrackKind = z.infer<typeof trackKindSchema>;

export const trackSchema = z.strictObject({
  id: idSchema,
  /** Fractional-index order key. Video tracks: later = drawn on top. */
  key: z.string().min(1),
  kind: trackKindSchema,
  name: z.string().min(1).max(60),
  /** Video tracks: hidden. Audio tracks: silent. */
  muted: z.boolean(),
  /** A locked track cannot be edited. */
  locked: z.boolean(),
  /** Clips on this track, in time order. */
  clipIds: z.array(idSchema).max(MAX_CLIPS),
  /** Audio tracks: linear gain applied to every clip on the track (absent = 1). */
  volume: z.number().min(0).max(MAX_VOLUME).optional(),
  /** Audio tracks: when any track is soloed, only soloed tracks are heard (absent = false). */
  solo: z.boolean().optional(),
});
export type Track = z.infer<typeof trackSchema>;

const timeSchema = z.number().int().min(0).max(MAX_TIME_US);

/**
 * Where a picture sits in the sequence frame. `x` and `y` move its centre as a fraction of the frame width and
 * height; `scale` multiplies the "fit inside the frame" size; `rotation` is degrees clockwise about the centre;
 * `crop` removes a fraction of the picture from each side (before scale and rotation).
 */
export const clipTransformSchema = z.strictObject({
  x: z.number().min(-4).max(4),
  y: z.number().min(-4).max(4),
  scale: z.number().min(0.01).max(16),
  rotation: z.number().min(-360).max(360),
  crop: z.strictObject({
    left: z.number().min(0).max(0.95),
    top: z.number().min(0).max(0.95),
    right: z.number().min(0).max(0.95),
    bottom: z.number().min(0).max(0.95),
  }),
});
export type ClipTransform = z.infer<typeof clipTransformSchema>;

export const IDENTITY_TRANSFORM: ClipTransform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
};

/** Basic colour correction, each -1..1 where 0 changes nothing. */
export const clipColourSchema = z.strictObject({
  brightness: z.number().min(-1).max(1),
  contrast: z.number().min(-1).max(1),
  saturation: z.number().min(-1).max(1),
  temperature: z.number().min(-1).max(1),
});
export type ClipColour = z.infer<typeof clipColourSchema>;

export const NEUTRAL_COLOUR: ClipColour = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
};

export const TRANSITION_KINDS = ['crossfade', 'dip-black', 'dip-white', 'wipe', 'slide'] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];
/** The side the new picture comes in from (wipe and slide). */
export const TRANSITION_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

/**
 * A transition from the clip just before this one on its track (the one that ends exactly where this one starts)
 * into this clip. It runs for `duration` from this clip's start; the earlier clip's footage carries on underneath
 * (it holds its last picture if the file has no more).
 */
export const clipTransitionSchema = z.strictObject({
  kind: z.enum(TRANSITION_KINDS),
  duration: z.number().int().min(1).max(MAX_TIME_US),
  /** Wipe and slide only (absent = left). */
  direction: z.enum(TRANSITION_DIRECTIONS).optional(),
});
export type ClipTransition = z.infer<typeof clipTransitionSchema>;

export const clipSchema = z.strictObject({
  id: idSchema,
  trackId: idSchema,
  assetId: idSchema,
  /** Where the clip starts on the timeline (microseconds). */
  start: timeSchema,
  /** How long it plays on the timeline. */
  duration: z.number().int().min(1).max(MAX_TIME_US),
  /** Where in the source file it starts. */
  sourceIn: timeSchema,
  /** Clips that share a link (the picture and sound of one file) are edited together. */
  linkId: idSchema.nullable(),
  /** Picture clips: position, scale, rotation and crop (absent = identity). */
  transform: clipTransformSchema.optional(),
  /** Picture clips: 0..1 (absent = 1). */
  opacity: z.number().min(0).max(1).optional(),
  /** Picture clips: colour correction (absent = none). */
  colour: clipColourSchema.optional(),
  /** Sound: linear gain for this clip (absent = 1). */
  volume: z.number().min(0).max(MAX_VOLUME).optional(),
  /** Sound: ramp up from silence over this long at the clip start, and down to silence at its end (absent = 0). */
  fadeIn: timeSchema.optional(),
  fadeOut: timeSchema.optional(),
  /** Picture clips: how this clip comes in from the clip before it (absent = a plain cut). */
  transitionIn: clipTransitionSchema.optional(),
});
export type Clip = z.infer<typeof clipSchema>;

/** The properties a user can change on a clip without moving or cutting it. */
export type ClipLook = Pick<
  Clip,
  'transform' | 'opacity' | 'colour' | 'volume' | 'fadeIn' | 'fadeOut'
>;

export function clipTransform(clip: Pick<Clip, 'transform'>): ClipTransform {
  return clip.transform ?? IDENTITY_TRANSFORM;
}
export function clipOpacity(clip: Pick<Clip, 'opacity'>): number {
  return clip.opacity ?? 1;
}
export function clipColour(clip: Pick<Clip, 'colour'>): ClipColour {
  return clip.colour ?? NEUTRAL_COLOUR;
}

/**
 * Linear gain of a clip at `offset` microseconds from its start: clip volume times the fade ramps (straight lines;
 * the fades never overlap because they are limited to the clip length when set and again here).
 */
export function clipGainAt(
  clip: Pick<Clip, 'duration' | 'volume' | 'fadeIn' | 'fadeOut'>,
  offset: number,
): number {
  const base = clip.volume ?? 1;
  const fadeIn = Math.min(clip.fadeIn ?? 0, clip.duration);
  const fadeOut = Math.min(clip.fadeOut ?? 0, clip.duration);
  let gain = base;
  if (fadeIn > 0 && offset < fadeIn) gain *= Math.max(0, offset) / fadeIn;
  const untilEnd = clip.duration - offset;
  if (fadeOut > 0 && untilEnd < fadeOut) gain *= Math.max(0, untilEnd) / fadeOut;
  return gain;
}

export function clipEnd(clip: Pick<Clip, 'start' | 'duration'>): number {
  return clip.start + clip.duration;
}

export const videoContentSchema = z
  .strictObject({
    kind: z.literal('video'),
    sequence: sequenceSchema,
    tracks: orderedSchema(trackSchema),
    clips: z.record(idSchema, clipSchema),
  })
  .superRefine((content, ctx) => {
    const fail = (message: string) => {
      ctx.addIssue({ code: 'custom', message });
    };
    if (Object.keys(content.tracks.byId).length > MAX_TRACKS) fail('too many tracks');
    if (Object.keys(content.clips).length > MAX_CLIPS) fail('too many clips');
    const listed = new Set<string>();
    for (const track of Object.values(content.tracks.byId)) {
      let previousEnd = 0;
      for (const clipId of track.clipIds) {
        const clip = content.clips[clipId];
        if (!clip) {
          fail(`track ${track.id} lists a missing clip`);
          return;
        }
        if (listed.has(clipId)) fail(`clip ${clipId} is listed twice`);
        listed.add(clipId);
        if (clip.trackId !== track.id) fail(`clip ${clipId} is on the wrong track`);
        if (clip.start < previousEnd) fail(`clips overlap or are out of order on ${track.id}`);
        previousEnd = clip.start + clip.duration;
      }
    }
    for (const id of Object.keys(content.clips)) {
      if (content.clips[id]?.id !== id) fail('clip id mismatch');
      if (!listed.has(id)) fail(`clip ${id} is on no track`);
    }
  });
export type VideoContent = z.infer<typeof videoContentSchema>;

export const DEFAULT_SEQUENCE: Sequence = {
  width: 1920,
  height: 1080,
  fps: FPS_30,
  sampleRate: 48_000,
};

/** A new, empty sequence with one video and one audio track. */
export function emptyVideoContent(): VideoContent {
  const tracks: Ordered<Track> = createOrdered<Track>();
  tracks.byId['V1'] = {
    id: 'V1',
    key: 'a0',
    kind: 'video',
    name: 'Video 1',
    muted: false,
    locked: false,
    clipIds: [],
  };
  tracks.byId['A1'] = {
    id: 'A1',
    key: 'a1',
    kind: 'audio',
    name: 'Audio 1',
    muted: false,
    locked: false,
    clipIds: [],
  };
  return { kind: 'video', sequence: { ...DEFAULT_SEQUENCE }, tracks, clips: {} };
}
