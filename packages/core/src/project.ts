import { z } from 'zod';
import { AppError } from './errors';
import type { Command } from './history';
import { emptyImageContent, imageContentSchema } from './image-document';
import { appendItems, createOrdered, removeItem, type WithoutKey } from './ordered';
import { idSchema, orderedSchema, relativePathSchema } from './schema-common';
import { frameRateSchema, MAX_TIME_US } from './time';
import { emptyVideoContent, videoContentSchema } from './video-document';

export { idSchema, relativePathSchema };

const assetBase = {
  id: idSchema,
  /** Fractional-index order key (see ordered.ts). */
  key: z.string().min(1),
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(100),
  size: z.number().int().nonnegative(),
  /** Original bytes, relative to the project folder. */
  file: relativePathSchema,
};

export const imageAssetSchema = z.strictObject({
  ...assetBase,
  kind: z.literal('image'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  thumb: relativePathSchema,
});
export type ImageAsset = z.infer<typeof imageAssetSchema>;

const durationSchema = z.number().int().min(1).max(MAX_TIME_US);

/** Audio facts about a media file. */
export const audioInfoSchema = z.strictObject({
  sampleRate: z.number().int().min(8000).max(192_000),
  channels: z.number().int().min(1).max(32),
  codec: z.string().max(40),
});
export type AudioInfo = z.infer<typeof audioInfoSchema>;

export const videoAssetSchema = z.strictObject({
  ...assetBase,
  kind: z.literal('video'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Length in microseconds. */
  duration: durationSchema,
  fps: frameRateSchema,
  codec: z.string().max(40),
  /** Average gap between keyframes in microseconds, or null when it was not measured. */
  keyframeInterval: z.number().int().positive().nullable(),
  audio: audioInfoSchema.nullable(),
  thumb: relativePathSchema,
  /** Waveform peaks of the audio (see media-io/peaks), or null without audio. */
  peaks: relativePathSchema.nullable(),
});
export type VideoAsset = z.infer<typeof videoAssetSchema>;

export const audioAssetSchema = z.strictObject({
  ...assetBase,
  kind: z.literal('audio'),
  duration: durationSchema,
  audio: audioInfoSchema,
  peaks: relativePathSchema.nullable(),
});
export type AudioAsset = z.infer<typeof audioAssetSchema>;

export const assetSchema = z.discriminatedUnion('kind', [
  imageAssetSchema,
  videoAssetSchema,
  audioAssetSchema,
]);
export type Asset = z.infer<typeof assetSchema>;

/** Every file inside the project folder that belongs to an asset (original, thumbnail, waveform peaks). */
export function assetFilePaths(asset: Asset): string[] {
  const paths = [asset.file];
  if ('thumb' in asset) paths.push(asset.thumb);
  if ('peaks' in asset && asset.peaks) paths.push(asset.peaks);
  return paths;
}

/** The thumbnail of an asset, or null for assets without one (audio). */
export function assetThumb(asset: Asset): string | null {
  return 'thumb' in asset ? asset.thumb : null;
}

const assetsSchema = orderedSchema(assetSchema);

/** Content of the editors: the image document or the video sequence. */
const contentSchema = z.discriminatedUnion('kind', [imageContentSchema, videoContentSchema]);

export const projectSchema = z
  .strictObject({
    id: idSchema,
    name: z.string().min(1).max(120),
    type: z.enum(['image', 'video']),
    createdAt: z.iso.datetime(),
    assets: assetsSchema,
    content: contentSchema,
  })
  .refine((p) => p.content.kind === p.type, 'content does not match project type');
export type ProjectDocument = z.infer<typeof projectSchema>;
export type ProjectType = ProjectDocument['type'];

export const CURRENT_FORMAT_VERSION = 10;
export const PROJECT_FORMAT = 'media-studio-project';

export const projectFileSchema = z.strictObject({
  format: z.literal(PROJECT_FORMAT),
  formatVersion: z.literal(CURRENT_FORMAT_VERSION),
  appVersion: z.string().max(40),
  modifiedAt: z.iso.datetime(),
  /** Highest journal sequence number already included in `project` (see journal.ts). */
  journalSeq: z.number().int().nonnegative(),
  project: projectSchema,
});
export type ProjectFile = z.infer<typeof projectFileSchema>;

/** Migration from version N to N+1, keyed by N. Pure: receives and returns plain JSON. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
/** v1 -> v2: image projects gain the image document (canvas size, background, layers). */
function migrateV1ToV2(raw: Record<string, unknown>): Record<string, unknown> {
  const project = raw['project'];
  if (typeof project === 'object' && project !== null) {
    const content = (project as { content?: { kind?: unknown } }).content;
    if (content?.kind === 'image') {
      (project as { content: unknown }).content = emptyImageContent();
    }
  }
  return raw;
}

/** v2 -> v3: text and shape layers (and later layer kinds) became valid; existing data is unchanged. */
const migrateV2ToV3: Migration = (raw) => raw;
/** v4 only adds optional fields (layer masks, clipping) and raster layers, so existing documents stay valid. */
const migrateV3ToV4: Migration = (raw) => raw;

/** v5: video projects get a sequence with tracks and clips; video and audio assets exist. */
const migrateV4ToV5: Migration = (raw) => {
  const project = raw['project'];
  if (typeof project === 'object' && project !== null) {
    const content = (project as { content?: { kind?: unknown } }).content;
    if (content?.kind === 'video' && !('sequence' in content)) {
      (project as { content: unknown }).content = emptyVideoContent();
    }
  }
  return raw;
};

/** v6 only adds optional clip and track fields (transform, opacity, colour, volume, fades, solo), so v5 stays valid. */
const migrateV5ToV6: Migration = (raw) => raw;

/** v7 only adds the optional clip `transitionIn`, so v6 stays valid. */
const migrateV6ToV7: Migration = (raw) => raw;

/** v8 lets a clip have text instead of media (`assetId` may be null); every v7 clip still has its media. */
const migrateV7ToV8: Migration = (raw) => raw;

/** v9 only adds the optional clip speed, so v8 stays valid. */
const migrateV8ToV9: Migration = (raw) => raw;

/** v10 only adds optional markers and in/out points to a sequence, so v9 stays valid. */
const migrateV9ToV10: Migration = (raw) => raw;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
  3: migrateV3ToV4,
  4: migrateV4ToV5,
  5: migrateV5ToV6,
  6: migrateV6ToV7,
  7: migrateV7ToV8,
  8: migrateV8ToV9,
  9: migrateV9ToV10,
};

function invalidProject(cause?: unknown): AppError {
  return new AppError({
    code: 'invalid-project',
    message: 'This project file is damaged or not a Media Studio project.',
    hint: 'Restore it from a backup, or open a different project.',
    cause,
  });
}

/** Run migrations until `target`. Works on a copy; never mutates the input. */
export function migrateToVersion(
  raw: unknown,
  target: number,
  migrations: Readonly<Record<number, Migration>>,
): { data: Record<string, unknown>; from: number } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalidProject();
  let data = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  const from = data['formatVersion'];
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) throw invalidProject();
  if (from > target) {
    throw new AppError({
      code: 'invalid-project',
      message: 'This project was saved by a newer version of Media Studio.',
      hint: 'Update the app to open it. Your file was not changed.',
    });
  }
  for (let version = from; version < target; version += 1) {
    const step = migrations[version];
    if (!step) throw invalidProject(`no migration from version ${String(version)}`);
    data = { ...step(data), formatVersion: version + 1 };
  }
  return { data, from };
}

/** Validate untrusted project data (loaded file, archive, journal replay result) and migrate it to the current format. */
export function parseProjectFile(raw: unknown): { file: ProjectFile; migratedFrom: number | null } {
  const { data, from } = migrateToVersion(raw, CURRENT_FORMAT_VERSION, MIGRATIONS);
  const result = projectFileSchema.safeParse(data);
  if (!result.success) throw invalidProject(result.error);
  return { file: result.data, migratedFrom: from < CURRENT_FORMAT_VERSION ? from : null };
}

/** Validate a project document alone (for example after replaying a journal). */
export function parseProject(raw: unknown): ProjectDocument {
  const result = projectSchema.safeParse(raw);
  if (!result.success) throw invalidProject(result.error);
  return result.data;
}

export interface NewProjectInit {
  id: string;
  name: string;
  type: ProjectType;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

export function createProject(init: NewProjectInit): ProjectDocument {
  return parseProject({
    id: init.id,
    name: normalizeName(init.name, 120),
    type: init.type,
    createdAt: init.createdAt,
    assets: createOrdered<Asset>(),
    content: init.type === 'image' ? emptyImageContent() : emptyVideoContent(),
  });
}

export function normalizeName(name: string, max: number): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new AppError({
      code: 'invalid-project',
      message: `Names must be between 1 and ${String(max)} characters.`,
    });
  }
  return trimmed;
}

// Commands ----------------------------------------------------------------------------------------------

export function renameProject(name: string): Command<ProjectDocument> {
  const next = normalizeName(name, 120);
  return {
    label: 'Rename project',
    coalesceKey: 'rename-project',
    apply(draft) {
      draft.name = next;
    },
  };
}

export type NewAsset = WithoutKey<Asset>;

export function addAssets(assets: readonly NewAsset[]): Command<ProjectDocument> {
  return {
    label: assets.length === 1 ? 'Import asset' : `Import ${String(assets.length)} assets`,
    apply(draft) {
      appendItems<Asset>(draft.assets, assets);
    },
  };
}

export function removeAsset(id: string): Command<ProjectDocument> {
  return {
    label: 'Remove asset',
    apply(draft) {
      removeItem(draft.assets, id);
    },
  };
}

export function renameAsset(id: string, name: string): Command<ProjectDocument> {
  const next = normalizeName(name, 255);
  return {
    label: 'Rename asset',
    coalesceKey: `rename-asset:${id}`,
    apply(draft) {
      const asset = draft.assets.byId[id];
      if (!asset) throw new RangeError(`Asset ${id} does not exist`);
      asset.name = next;
    },
  };
}
