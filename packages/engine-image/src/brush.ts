import {
  TILE_SIZE,
  cloneTile,
  createTile,
  defaultFill,
  isDefaultTile,
  tileInside,
  tileKey,
  type PixelGrid,
  type Tile,
  type TileMap,
} from '@media-studio/core';

export interface BrushSettings {
  /** Diameter in surface pixels. */
  size: number;
  /** 0 = soft edge across the whole radius, 1 = hard edge (with a one pixel anti-aliased rim). */
  hardness: number;
  /** Cap on how opaque the whole stroke can get, 0..1. */
  opacity: number;
  /** How quickly overlapping dabs build up inside one stroke, 0..1. */
  flow: number;
}

export const DEFAULT_BRUSH: BrushSettings = { size: 24, hardness: 0.8, opacity: 1, flow: 1 };

/** What a stroke does to the pixels. */
export type BrushTarget =
  /** Paint a colour (0..255 per channel) onto a paint layer, or erase it to transparent. */
  | { channels: 4; color: readonly [number, number, number]; erase: boolean }
  /** Move a mask toward `value`: 255 reveals the layer, 0 hides it. */
  | { channels: 1; value: number };

export interface StrokeInit {
  grid: PixelGrid;
  /** The surface before the stroke. Its tiles are never modified. */
  base: TileMap;
  /** Hands out ids for the tiles this stroke creates. */
  newTileId: () => string;
  settings: BrushSettings;
  target: BrushTarget;
  /** 0..1 coverage at a surface pixel; the stroke only paints where this is above zero. */
  selection?: (x: number, y: number) => number;
}

export interface StrokeResult {
  /** Tiles to put in the new version; null removes a tile that ended up empty. Empty when nothing changed. */
  changes: Map<string, Tile | null>;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * One brush stroke. Dabs are placed along the path; each dab adds coverage to a per-stroke accumulation buffer
 * (so `flow` builds up and `opacity` caps the total), and the touched pixels are recomputed from the untouched base.
 * The same input always gives the same output.
 */
export class Stroke {
  /** The surface as it looks right now, including the stroke so far. Hand this to the renderer while painting. */
  readonly live: Map<string, Tile>;
  private readonly working = new Map<string, Tile>();
  private readonly coverage = new Map<string, Float32Array>();
  private readonly touched = new Set<string>();
  private last: { x: number; y: number } | null = null;
  private carry = 0;
  private readonly settings: BrushSettings;

  constructor(private readonly init: StrokeInit) {
    this.live = new Map(init.base);
    this.settings = {
      size: Math.max(1, init.settings.size),
      hardness: clamp01(init.settings.hardness),
      opacity: clamp01(init.settings.opacity),
      flow: clamp01(init.settings.flow),
    };
  }

  /** Extend the stroke to a point (surface pixels). `pressure` 0..1 scales size and flow (1 for a mouse). */
  addPoint(x: number, y: number, pressure = 1): void {
    const p = Math.min(1, Math.max(0.05, pressure));
    const diameter = this.settings.size * (0.3 + 0.7 * p);
    const spacing = Math.max(1, diameter * 0.15);
    if (this.last === null) {
      this.dab(x, y, diameter, p);
    } else {
      const dx = x - this.last.x;
      const dy = y - this.last.y;
      const length = Math.hypot(dx, dy);
      let travelled = spacing - this.carry;
      while (travelled <= length) {
        const t = length === 0 ? 0 : travelled / length;
        this.dab(this.last.x + dx * t, this.last.y + dy * t, diameter, p);
        travelled += spacing;
      }
      this.carry = length - (travelled - spacing);
    }
    this.last = { x, y };
    for (const key of this.touched) {
      const tile = this.working.get(key);
      if (tile) tile.rev += 1;
    }
    this.touched.clear();
  }

  /** Finish: the changed tiles, with tiles that ended up completely empty removed. */
  end(): StrokeResult {
    const changes = new Map<string, Tile | null>();
    for (const [key, tile] of this.working) {
      if (isDefaultTile(tile, this.init.grid.channels)) {
        changes.set(key, null);
        this.live.delete(key);
      } else {
        changes.set(key, tile);
      }
    }
    // A removed tile that was never in the base is not a change at all.
    for (const [key, tile] of [...changes]) {
      if (tile === null && !this.init.base.has(key)) changes.delete(key);
    }
    return { changes };
  }

  private tileFor(key: string): { tile: Tile; coverage: Float32Array } {
    let tile = this.working.get(key);
    if (!tile) {
      const { channels } = this.init.grid;
      const original = this.init.base.get(key);
      const id = this.init.newTileId();
      tile = original ? cloneTile(id, original) : createTile(id, channels, defaultFill(channels));
      this.working.set(key, tile);
      this.live.set(key, tile);
    }
    let coverage = this.coverage.get(key);
    if (!coverage) {
      coverage = new Float32Array(TILE_SIZE * TILE_SIZE);
      this.coverage.set(key, coverage);
    }
    return { tile, coverage };
  }

  private dab(cx: number, cy: number, diameter: number, pressure: number): void {
    const { grid, target, selection } = this.init;
    const { hardness, opacity, flow } = this.settings;
    const radius = diameter / 2;
    const soft = Math.max(1, radius * (1 - hardness));
    const reach = radius + 1;
    const x0 = Math.max(0, Math.floor(cx - reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const x1 = Math.min(grid.width - 1, Math.ceil(cx + reach));
    const y1 = Math.min(grid.height - 1, Math.ceil(cy + reach));
    const dabFlow = flow * (0.4 + 0.6 * pressure);
    const channels = grid.channels;

    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const edge = clamp01((radius - distance) / soft);
        if (edge <= 0) continue;
        const gate = selection ? selection(x, y) : 1;
        if (gate <= 0) continue;
        const tx = Math.floor(x / TILE_SIZE);
        const ty = Math.floor(y / TILE_SIZE);
        if (!tileInside(grid, tx, ty)) continue;
        const key = tileKey(tx, ty);
        const { tile, coverage } = this.tileFor(key);
        this.touched.add(key);
        const index = (y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE);
        const a = smooth(edge) * dabFlow;
        const accumulated = coverage[index] ?? 0;
        const next = accumulated + a - accumulated * a;
        coverage[index] = next;
        const strength = next * opacity * gate;

        const original = this.init.base.get(key);
        const offset = index * channels;
        const source = original ? original.data : null;
        if (target.channels === 1) {
          const before = source ? (source[offset] ?? 255) : 255;
          tile.data[offset] = Math.round(before * (1 - strength) + target.value * strength);
        } else {
          const br = source ? (source[offset] ?? 0) : 0;
          const bg = source ? (source[offset + 1] ?? 0) : 0;
          const bb = source ? (source[offset + 2] ?? 0) : 0;
          const ba = (source ? (source[offset + 3] ?? 0) : 0) / 255;
          if (target.erase) {
            const alpha = Math.round(ba * (1 - strength) * 255);
            // Fully transparent pixels are stored as zeros so empty tiles can be recognised and dropped.
            tile.data[offset] = alpha === 0 ? 0 : br;
            tile.data[offset + 1] = alpha === 0 ? 0 : bg;
            tile.data[offset + 2] = alpha === 0 ? 0 : bb;
            tile.data[offset + 3] = alpha;
          } else {
            const alpha = strength + ba * (1 - strength);
            const mix = (colour: number, before: number): number =>
              alpha <= 0 ? 0 : (colour * strength + before * ba * (1 - strength)) / alpha;
            tile.data[offset] = Math.round(mix(target.color[0], br));
            tile.data[offset + 1] = Math.round(mix(target.color[1], bg));
            tile.data[offset + 2] = Math.round(mix(target.color[2], bb));
            tile.data[offset + 3] = Math.round(alpha * 255);
          }
        }
      }
    }
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
