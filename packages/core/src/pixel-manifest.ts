import { z } from 'zod';
import { idSchema } from './schema-common';
import { tileBytes, type Channels } from './tiles';

/** Most tiles a surface can have: a 16384 pixel side is 64 tiles. */
const MAX_TILES = 64 * 64;

/**
 * The list of tiles that make up one version of a painted surface. It is saved as `pixels/<contentId>.json`; each
 * tile's pixels are in `tiles/<tileId>.bin`. Tiles never change once written, so versions share files.
 */
export const pixelManifestSchema = z.strictObject({
  format: z.literal('media-studio-pixels'),
  version: z.literal(1),
  channels: z.union([z.literal(1), z.literal(4)]),
  tiles: z
    .record(z.string().regex(/^\d{1,2},\d{1,2}$/), idSchema)
    .refine((tiles) => Object.keys(tiles).length <= MAX_TILES, 'too many tiles'),
});
export type PixelManifest = z.infer<typeof pixelManifestSchema>;

export function createPixelManifest(
  channels: Channels,
  entries: ReadonlyMap<string, string>,
): PixelManifest {
  const tiles: Record<string, string> = {};
  for (const [key, id] of entries) tiles[key] = id;
  return { format: 'media-studio-pixels', version: 1, channels, tiles };
}

/** Paths of the manifest and tile files for a content id and tile ids. */
export const manifestPath = (contentId: string): string => `pixels/${contentId}.json`;
export const tilePath = (tileId: string): string => `tiles/${tileId}.bin`;

/** Size of one tile's raw bytes, for checking decoded data. */
export const rawTileBytes = (channels: Channels): number => tileBytes(channels);
