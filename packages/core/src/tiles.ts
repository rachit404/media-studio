/**
 * Sparse pixel storage for painted layers and masks (ADR-0015).
 *
 * A pixel surface is a grid of 256 x 256 tiles. Missing tiles hold the surface's default value (transparent for a
 * paint layer, fully visible for a mask). Tiles are immutable once committed: a stroke copies the tiles it touches,
 * so older versions stay valid for undo and structure is shared between versions.
 */
export const TILE_SIZE = 256;

/** 4 = straight-alpha RGBA, 1 = a single mask channel (255 shows the layer, 0 hides it). */
export type Channels = 1 | 4;

export interface Tile {
  readonly id: string;
  /** Rows of TILE_SIZE pixels, row 0 at the top. Edge tiles are full-size; pixels beyond the surface are unused. */
  readonly data: Uint8Array;
  /** Bumped when a stroke still in progress changes `data`, so a renderer knows to upload it again. */
  rev: number;
}

export type TileMap = ReadonlyMap<string, Tile>;

export interface PixelGrid {
  width: number;
  height: number;
  channels: Channels;
}

/** Value of every channel of a pixel with no stored tile: transparent paint, or a fully visible mask. */
export const defaultFill = (channels: Channels): number => (channels === 1 ? 255 : 0);

export const tileBytes = (channels: Channels): number => TILE_SIZE * TILE_SIZE * channels;

export const tileKey = (tx: number, ty: number): string => `${String(tx)},${String(ty)}`;

export function parseTileKey(key: string): { tx: number; ty: number } | null {
  const match = /^(\d{1,4}),(\d{1,4})$/.exec(key);
  if (!match) return null;
  return { tx: Number(match[1]), ty: Number(match[2]) };
}

export const tilesAcross = (size: number): number => Math.ceil(size / TILE_SIZE);

/** Whether a tile key lies inside a surface of this size. */
export function tileInside(grid: PixelGrid, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < tilesAcross(grid.width) && ty < tilesAcross(grid.height);
}

export function createTile(id: string, channels: Channels, fill = defaultFill(channels)): Tile {
  const data = new Uint8Array(tileBytes(channels));
  if (fill !== 0) data.fill(fill);
  return { id, data, rev: 0 };
}

/** A copy that can be edited without touching the original. */
export function cloneTile(id: string, tile: Tile): Tile {
  return { id, data: tile.data.slice(), rev: 0 };
}

/** True when every byte equals the default, so the tile can be dropped. */
export function isDefaultTile(tile: Tile, channels: Channels): boolean {
  const fill = defaultFill(channels);
  const { data } = tile;
  for (let i = 0; i < data.length; i += 1) if (data[i] !== fill) return false;
  return true;
}

/** Read one pixel (channels as an array), or the default when its tile is missing or outside the surface. */
export function readPixel(
  tiles: TileMap,
  grid: PixelGrid,
  x: number,
  y: number,
): readonly number[] {
  const fill = defaultFill(grid.channels);
  const blank = Array.from({ length: grid.channels }, () => fill);
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return blank;
  const tile = tiles.get(tileKey(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)));
  if (!tile) return blank;
  const offset = ((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * grid.channels;
  return Array.from(tile.data.subarray(offset, offset + grid.channels));
}

export const EMPTY_TILES: TileMap = new Map();

/**
 * Every version of every pixel surface in this session, by content id. A content id names an immutable tile map;
 * a document layer refers to one, so undo is just pointing the layer back at an older id.
 */
export class PixelStore {
  private readonly contents = new Map<string, TileMap>();

  /** Tiles for a content id. Null means "no pixels yet"; unknown ids also read as empty. */
  get(contentId: string | null): TileMap {
    if (contentId === null) return EMPTY_TILES;
    return this.contents.get(contentId) ?? EMPTY_TILES;
  }

  has(contentId: string): boolean {
    return this.contents.has(contentId);
  }

  /** Register a tile map under an id (used when loading from disk). */
  set(contentId: string, tiles: TileMap): void {
    this.contents.set(contentId, tiles);
  }

  /**
   * A new version made of `base` with some tiles replaced (or removed, when null). Shares every untouched tile with
   * the base, so memory grows with the touched area only.
   */
  commit(
    contentId: string,
    base: string | null,
    changes: ReadonlyMap<string, Tile | null>,
  ): TileMap {
    const next = new Map(this.get(base));
    for (const [key, tile] of changes) {
      if (tile === null) next.delete(key);
      else next.set(key, tile);
    }
    this.contents.set(contentId, next);
    return next;
  }

  /** How much pixel memory is held, counting each distinct tile once. */
  stats(): { contents: number; tiles: number; bytes: number } {
    const distinct = new Set<Tile>();
    for (const tiles of this.contents.values())
      for (const tile of tiles.values()) distinct.add(tile);
    let bytes = 0;
    for (const tile of distinct) bytes += tile.data.byteLength;
    return { contents: this.contents.size, tiles: distinct.size, bytes };
  }

  /** Forget versions that nothing refers to any more (older than the undo history, or unreachable). */
  retainOnly(keep: ReadonlySet<string>): void {
    for (const id of [...this.contents.keys()]) if (!keep.has(id)) this.contents.delete(id);
  }
}
