import {
  PixelStore,
  TILE_SIZE,
  readPixel,
  type PixelGrid,
  type Tile,
  type TileMap,
} from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { Stroke, type BrushSettings, type BrushTarget } from './brush';

const rgba: PixelGrid = { width: 1000, height: 600, channels: 4 };
const maskGrid: PixelGrid = { width: 1000, height: 600, channels: 1 };
const red: BrushTarget = { channels: 4, color: [255, 0, 0], erase: false };
const hard: BrushSettings = { size: 20, hardness: 1, opacity: 1, flow: 1 };

function counter() {
  let n = 0;
  return () => `t${String(n++)}`;
}

function paint(
  base: TileMap,
  points: readonly [number, number][],
  options: {
    grid?: PixelGrid;
    settings?: BrushSettings;
    target?: BrushTarget;
    selection?: (x: number, y: number) => number;
  } = {},
) {
  const stroke = new Stroke({
    grid: options.grid ?? rgba,
    base,
    newTileId: counter(),
    settings: options.settings ?? hard,
    target: options.target ?? red,
    selection: options.selection,
  });
  for (const [x, y] of points) stroke.addPoint(x, y);
  return { stroke, result: stroke.end() };
}

function apply(base: TileMap, changes: ReadonlyMap<string, Tile | null>): TileMap {
  const store = new PixelStore();
  return store.commit(
    'x',
    null,
    new Map([...base, ...changes].filter(([, t]) => t !== null) as never),
  );
}

describe('brush stroke', () => {
  it('paints a disc: opaque colour inside, untouched outside', () => {
    const { stroke } = paint(new Map(), [[100, 100]]);
    expect(readPixel(stroke.live, rgba, 100, 100)).toEqual([255, 0, 0, 255]);
    expect(readPixel(stroke.live, rgba, 105, 100)).toEqual([255, 0, 0, 255]);
    expect(readPixel(stroke.live, rgba, 130, 100)).toEqual([0, 0, 0, 0]);
    expect(readPixel(stroke.live, rgba, 100, 130)).toEqual([0, 0, 0, 0]);
  });

  it('is deterministic: the same input gives the same bytes', () => {
    const points: [number, number][] = [
      [30, 30],
      [90, 55],
      [140, 20],
      [200, 120],
    ];
    const a = paint(new Map(), points, {
      settings: { size: 30, hardness: 0.4, opacity: 0.7, flow: 0.5 },
    });
    const b = paint(new Map(), points, {
      settings: { size: 30, hardness: 0.4, opacity: 0.7, flow: 0.5 },
    });
    expect([...a.result.changes.keys()]).toEqual([...b.result.changes.keys()]);
    for (const [key, tile] of a.result.changes) {
      expect(tile?.data).toEqual(b.result.changes.get(key)?.data);
    }
  });

  it('never exceeds the opacity cap, however often dabs overlap', () => {
    const wiggle: [number, number][] = Array.from({ length: 60 }, (_, i) => [100 + (i % 3), 100]);
    const { stroke } = paint(new Map(), wiggle, { settings: { ...hard, size: 40, opacity: 0.5 } });
    const [, , , alpha] = readPixel(stroke.live, rgba, 100, 100);
    expect(alpha).toBeLessThanOrEqual(Math.round(0.5 * 255));
    expect(alpha).toBeGreaterThanOrEqual(Math.round(0.5 * 255) - 1);
  });

  it('builds up with flow: overlapping dabs get stronger than one dab', () => {
    const settings = { ...hard, size: 40, hardness: 1, flow: 0.2 };
    const one = paint(new Map(), [[100, 100]], { settings });
    const many = paint(
      new Map(),
      Array.from({ length: 30 }, (_, i) => [100 + (i % 2), 100] as [number, number]),
      { settings },
    );
    const single = readPixel(one.stroke.live, rgba, 100, 100)[3] ?? 0;
    const built = readPixel(many.stroke.live, rgba, 100, 100)[3] ?? 0;
    expect(single).toBeGreaterThan(0);
    expect(built).toBeGreaterThan(single);
  });

  it('a soft brush fades toward the edge', () => {
    const { stroke } = paint(new Map(), [[100, 100]], {
      settings: { ...hard, size: 60, hardness: 0 },
    });
    const centre = readPixel(stroke.live, rgba, 100, 100)[3] ?? 0;
    const middle = readPixel(stroke.live, rgba, 115, 100)[3] ?? 0;
    const rim = readPixel(stroke.live, rgba, 128, 100)[3] ?? 0;
    expect(centre).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(rim);
  });

  it('never changes the tiles it started from, so older versions stay exact', () => {
    const first = paint(new Map(), [[100, 100]]);
    const base = apply(new Map(), first.result.changes);
    const snapshot = [...base.values()].map((t) => t.data.slice());
    const second = paint(base, [[100, 100]], {
      target: { channels: 4, color: [0, 0, 255], erase: false },
    });
    expect(second.result.changes.size).toBeGreaterThan(0);
    [...base.values()].forEach((tile, i) => expect(tile.data).toEqual(snapshot[i]));
    expect(readPixel(base, rgba, 100, 100)).toEqual([255, 0, 0, 255]);
    expect(readPixel(second.stroke.live, rgba, 100, 100)).toEqual([0, 0, 255, 255]);
  });

  it('erases to transparent and drops tiles that end up empty', () => {
    const painted = apply(new Map(), paint(new Map(), [[100, 100]]).result.changes);
    const erased = paint(painted, [[100, 100]], {
      settings: { ...hard, size: 60 },
      target: { channels: 4, color: [0, 0, 0], erase: true },
    });
    expect(readPixel(erased.stroke.live, rgba, 100, 100)[3]).toBe(0);
    expect(erased.result.changes.get('0,0')).toBeNull();
  });

  it('only paints where the selection allows', () => {
    const { stroke } = paint(new Map(), [[100, 100]], {
      settings: { ...hard, size: 60 },
      selection: (x) => (x >= 100 ? 1 : 0),
    });
    expect(readPixel(stroke.live, rgba, 110, 100)).toEqual([255, 0, 0, 255]);
    expect(readPixel(stroke.live, rgba, 90, 100)).toEqual([0, 0, 0, 0]);
  });

  it('crosses tile boundaries and clips at the surface edge', () => {
    const { result } = paint(new Map(), [
      [TILE_SIZE - 3, 10],
      [TILE_SIZE + 30, 10],
      [-5, 10],
    ]);
    expect([...result.changes.keys()].sort()).toEqual(['0,0', '1,0']);
    const edge = paint(new Map(), [[999, 599]]);
    expect(readPixel(edge.stroke.live, rgba, 999, 599)[3]).toBe(255);
  });

  it('paints masks toward hide and reveal', () => {
    const hide = paint(new Map(), [[50, 50]], {
      grid: maskGrid,
      target: { channels: 1, value: 0 },
    });
    expect(readPixel(hide.stroke.live, maskGrid, 50, 50)).toEqual([0]);
    expect(readPixel(hide.stroke.live, maskGrid, 500, 500)).toEqual([255]);
    const base = apply(new Map(), hide.result.changes);
    const reveal = paint(base, [[50, 50]], { grid: maskGrid, target: { channels: 1, value: 255 } });
    expect(readPixel(reveal.stroke.live, maskGrid, 50, 50)).toEqual([255]);
  });

  it('pen pressure makes the brush smaller and lighter', () => {
    const light = new Stroke({
      grid: rgba,
      base: new Map(),
      newTileId: counter(),
      settings: { ...hard, size: 60 },
      target: red,
    });
    light.addPoint(100, 100, 0.1);
    const firm = new Stroke({
      grid: rgba,
      base: new Map(),
      newTileId: counter(),
      settings: { ...hard, size: 60 },
      target: red,
    });
    firm.addPoint(100, 100, 1);
    expect(readPixel(light.live, rgba, 120, 100)[3]).toBe(0);
    expect(readPixel(firm.live, rgba, 120, 100)[3]).toBe(255);
  });
});

describe('history memory (ADR-0015)', () => {
  const growth = (grid: PixelGrid, strokes: number) => {
    const store = new PixelStore();
    let version: string | null = null;
    for (let i = 0; i < strokes; i += 1) {
      const stroke = new Stroke({
        grid,
        base: store.get(version),
        newTileId: counter(),
        settings: { ...hard, size: 40 },
        target: red,
      });
      stroke.addPoint(20 + i, 100);
      stroke.addPoint(60 + i, 130);
      const id = `v${String(i)}`;
      store.commit(id, version, stroke.end().changes);
      version = id;
    }
    return store.stats();
  };

  it('grows with the area touched, not with the size of the surface', () => {
    const small = growth({ width: 512, height: 512, channels: 4 }, 100);
    const huge = growth({ width: 8192, height: 8192, channels: 4 }, 100);
    expect(huge.bytes).toBe(small.bytes);
    // 100 strokes inside one tile keep one new tile version each: 100 x 256 KiB, nothing more.
    expect(small.tiles).toBeLessThanOrEqual(100);
    expect(small.bytes).toBeLessThanOrEqual(100 * TILE_SIZE * TILE_SIZE * 4);
  });
});
