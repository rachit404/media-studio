import { z } from 'zod';
import { createOrdered, type Ordered } from './ordered';
import { idSchema, orderedSchema } from './schema-common';
import { FPS_30, MAX_TIME_US, frameRateSchema } from './time';

/** Largest picture we accept for a sequence (8K). */
export const MAX_SEQUENCE_SIZE = 8192;
/** Most clips on one track and in the whole sequence; keeps validation and rendering bounded. */
export const MAX_CLIPS = 20_000;
export const MAX_TRACKS = 32;

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
});
export type Track = z.infer<typeof trackSchema>;

const timeSchema = z.number().int().min(0).max(MAX_TIME_US);

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
});
export type Clip = z.infer<typeof clipSchema>;

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
