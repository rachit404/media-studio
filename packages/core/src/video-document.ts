import { z } from 'zod';
import { textSpecSchema, type TextSpec } from './image-document';
import {
  KEYFRAME_PROPERTIES,
  keyframesSchema,
  valueAt,
  type KeyframeProperty,
  type Keyframes,
} from './keyframes';
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

/** Slowest and fastest constant playback speed of a clip. */
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

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

export type { Keyframes };
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

/** A box drawn behind a text clip's text (keeps subtitles readable on any picture). */
export const clipBackdropSchema = z.strictObject({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  opacity: z.number().min(0).max(1),
});
export type ClipBackdrop = z.infer<typeof clipBackdropSchema>;

export const clipSchema = z.strictObject({
  id: idSchema,
  trackId: idSchema,
  /** The media file this clip plays, or null for a text clip (which has `text` instead). */
  assetId: idSchema.nullable(),
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
  /**
   * Media clips: playback speed, 0.25 to 4 (absent = 1). The clip lasts `duration` on the timeline and uses
   * `duration * speed` of the file; sound changes pitch with speed.
   */
  speed: z.number().min(MIN_SPEED).max(MAX_SPEED).optional(),
  /**
   * Properties that change over time (VID-12). A property with keyframes follows them, and the fixed value of the
   * same property (`transform`, `opacity`, `volume`) is only the fallback.
   */
  keyframes: keyframesSchema.optional(),
  /** Text clips (no media): what to write and how. Its size is in sequence pixels. */
  text: textSpecSchema.optional(),
  /** Text clips: a box behind the text (absent = none). */
  backdrop: clipBackdropSchema.optional(),
});
export type Clip = z.infer<typeof clipSchema>;

/** A text clip: titles and subtitles. It has no media, so it can be as long as the user likes. */
export type TextClip = Clip & { assetId: null; text: TextSpec };

export function isTextClip(clip: Clip): clip is TextClip {
  return clip.assetId === null && clip.text !== undefined;
}

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

/** The values a keyframed property may take; keyframes are held to the same ranges as the fixed values. */
export const KEYFRAME_RANGES: Readonly<Record<KeyframeProperty, { min: number; max: number }>> = {
  x: { min: -4, max: 4 },
  y: { min: -4, max: 4 },
  scale: { min: 0.01, max: 16 },
  rotation: { min: -360, max: 360 },
  opacity: { min: 0, max: 1 },
  volume: { min: 0, max: MAX_VOLUME },
};

/** The picture properties are for video tracks, volume is for audio tracks. */
export function keyframePropertyFits(property: KeyframeProperty, trackKind: TrackKind): boolean {
  return property === 'volume' ? trackKind === 'audio' : trackKind === 'video';
}

/** The placement of a picture or text clip `offset` microseconds after its start, with any keyframes applied. */
export function clipTransformAt(
  clip: Pick<Clip, 'transform' | 'keyframes'>,
  offset: number,
): ClipTransform {
  const base = clipTransform(clip);
  const frames = clip.keyframes;
  if (!frames?.x && !frames?.y && !frames?.scale && !frames?.rotation) return base;
  return {
    ...base,
    x: valueAt(frames.x, offset, base.x),
    y: valueAt(frames.y, offset, base.y),
    scale: valueAt(frames.scale, offset, base.scale),
    rotation: valueAt(frames.rotation, offset, base.rotation),
  };
}

/** The opacity of a picture or text clip `offset` microseconds after its start, with any keyframes applied. */
export function clipOpacityAt(clip: Pick<Clip, 'opacity' | 'keyframes'>, offset: number): number {
  return valueAt(clip.keyframes?.opacity, offset, clipOpacity(clip));
}
export function clipSpeed(clip: Pick<Clip, 'speed'>): number {
  return clip.speed ?? 1;
}

/** How much of its file a stretch of `duration` timeline microseconds uses at `speed`. */
export function sourceSpan(duration: number, speed: number): number {
  return Math.round(duration * speed);
}

/** Where in its file a media clip is at `offset` microseconds after its start. */
export function clipSourceAt(clip: Pick<Clip, 'sourceIn' | 'speed'>, offset: number): number {
  return clip.sourceIn + sourceSpan(offset, clipSpeed(clip));
}

export function clipColour(clip: Pick<Clip, 'colour'>): ClipColour {
  return clip.colour ?? NEUTRAL_COLOUR;
}

/**
 * Linear gain of a clip at `offset` microseconds from its start: clip volume times the fade ramps (straight lines;
 * the fades never overlap because they are limited to the clip length when set and again here).
 */
export function clipGainAt(
  clip: Pick<Clip, 'duration' | 'volume' | 'fadeIn' | 'fadeOut' | 'keyframes'>,
  offset: number,
): number {
  const base = valueAt(clip.keyframes?.volume, offset, clip.volume ?? 1);
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

export const MAX_MARKERS = 1000;

/** A named point on the timeline. */
export const markerSchema = z.strictObject({
  id: idSchema,
  time: timeSchema,
  name: z.string().max(60),
});
export type Marker = z.infer<typeof markerSchema>;

export const videoContentSchema = z
  .strictObject({
    kind: z.literal('video'),
    sequence: sequenceSchema,
    tracks: orderedSchema(trackSchema),
    clips: z.record(idSchema, clipSchema),
    /** Markers in time order, one per time (absent = none). */
    markers: z.array(markerSchema).max(MAX_MARKERS).optional(),
    /** The range between these two points is what export can be limited to (absent = not set). */
    inPoint: timeSchema.optional(),
    outPoint: timeSchema.optional(),
  })
  .superRefine((content, ctx) => {
    const fail = (message: string) => {
      ctx.addIssue({ code: 'custom', message });
    };
    if (Object.keys(content.tracks.byId).length > MAX_TRACKS) fail('too many tracks');
    if (Object.keys(content.clips).length > MAX_CLIPS) fail('too many clips');
    if (content.inPoint !== undefined && content.outPoint !== undefined) {
      if (content.inPoint >= content.outPoint) fail('the in point must be before the out point');
    }
    const markers = content.markers ?? [];
    for (let i = 1; i < markers.length; i += 1) {
      if ((markers[i]?.time ?? 0) <= (markers[i - 1]?.time ?? 0))
        fail('markers must be in time order');
    }
    if (new Set(markers.map((marker) => marker.id)).size !== markers.length) {
      fail('two markers have the same id');
    }
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
      const clip = content.clips[id];
      if (clip?.id !== id) fail('clip id mismatch');
      if (!listed.has(id)) fail(`clip ${id} is on no track`);
      if (!clip) continue;
      if ((clip.assetId === null) !== (clip.text !== undefined)) {
        fail(`clip ${id} must have either media or text`);
      }
      if (clip.text === undefined && clip.backdrop !== undefined) fail(`clip ${id} has no text`);
      for (const property of KEYFRAME_PROPERTIES) {
        const frames = clip.keyframes?.[property] ?? [];
        const range = KEYFRAME_RANGES[property];
        if (
          frames.length > 0 &&
          !keyframePropertyFits(property, content.tracks.byId[clip.trackId]?.kind ?? 'video')
        ) {
          fail(`clip ${id} cannot animate ${property}`);
        }
        for (let i = 0; i < frames.length; i += 1) {
          const frame = frames[i];
          if (!frame) continue;
          if (frame.value < range.min || frame.value > range.max)
            fail(`${property} keyframe out of range`);
          if (i > 0 && frame.time <= (frames[i - 1]?.time ?? 0))
            fail(`${property} keyframes must be in time order`);
        }
      }
      if (clip.text !== undefined) {
        if (content.tracks.byId[clip.trackId]?.kind !== 'video')
          fail(`text clip ${id} is on sound`);
        if (clip.transitionIn !== undefined) fail(`text clip ${id} has a transition`);
      }
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
