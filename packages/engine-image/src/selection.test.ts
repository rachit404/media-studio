import { readPixel, type PixelGrid } from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import {
  combineSelections,
  ellipseSelection,
  emptySelection,
  featherSelection,
  invertSelection,
  isEmptySelection,
  polygonSelection,
  rectSelection,
  sampleSelection,
  selectAll,
  selectionBounds,
  selectionOutline,
  selectionToMaskTiles,
  type Selection,
} from './selection';

const W = 64;
const H = 48;
const area = (s: Selection) => s.data.reduce((sum, v) => sum + v, 0) / 255;
const at = (s: Selection, x: number, y: number) => s.data[y * s.width + x];

describe('shapes', () => {
  it('a whole-pixel rectangle covers exactly its pixels', () => {
    const s = rectSelection(W, H, 10, 5, 30, 25);
    expect(area(s)).toBe(20 * 20);
    expect(at(s, 10, 5)).toBe(255);
    expect(at(s, 29, 24)).toBe(255);
    expect(at(s, 30, 24)).toBe(0);
    expect(at(s, 9, 5)).toBe(0);
  });

  it('a fractional edge is anti-aliased in proportion', () => {
    const s = rectSelection(W, H, 10.5, 5, 30, 25);
    expect(at(s, 10, 10)).toBeGreaterThan(120);
    expect(at(s, 10, 10)).toBeLessThan(135);
    expect(at(s, 11, 10)).toBe(255);
  });

  it('an ellipse has the right area and leaves the box corners empty', () => {
    const s = ellipseSelection(200, 200, 20, 40, 180, 140);
    expect(area(s)).toBeGreaterThan(Math.PI * 80 * 50 * 0.99);
    expect(area(s)).toBeLessThan(Math.PI * 80 * 50 * 1.01);
    expect(at(s, 21, 41)).toBe(0);
    expect(at(s, 100, 90)).toBe(255);
  });

  it('a lasso fills a triangle by the even-odd rule', () => {
    const s = polygonSelection(100, 100, [
      [10, 10],
      [90, 10],
      [10, 90],
    ]);
    expect(area(s)).toBeGreaterThan(3200 * 0.98);
    expect(area(s)).toBeLessThan(3200 * 1.02);
    expect(at(s, 20, 20)).toBe(255);
    expect(at(s, 80, 80)).toBe(0);
  });

  it('shapes are clipped to the document and degenerate lassos select nothing', () => {
    expect(area(rectSelection(W, H, -10, -10, 1000, 1000))).toBe(W * H);
    expect(
      isEmptySelection(
        polygonSelection(W, H, [
          [1, 1],
          [5, 5],
        ]),
      ),
    ).toBe(true);
  });
});

describe('selection algebra', () => {
  const a = rectSelection(W, H, 0, 0, 40, 40);
  const b = rectSelection(W, H, 20, 20, 60, 46);

  it('union, intersection and difference behave like sets', () => {
    const union = combineSelections(a, b, 'add');
    const both = combineSelections(a, b, 'intersect');
    const onlyA = combineSelections(a, b, 'subtract');
    expect(area(union)).toBe(area(a) + area(b) - area(both));
    expect(area(both)).toBe(20 * 20);
    expect(area(onlyA)).toBe(area(a) - area(both));
    expect(area(union)).toBeGreaterThanOrEqual(Math.max(area(a), area(b)));
    expect(area(both)).toBeLessThanOrEqual(Math.min(area(a), area(b)));
  });

  it('add and intersect do not depend on the order', () => {
    expect(combineSelections(a, b, 'add').data).toEqual(combineSelections(b, a, 'add').data);
    expect(combineSelections(a, b, 'intersect').data).toEqual(
      combineSelections(b, a, 'intersect').data,
    );
  });

  it('replace discards the old selection; with no selection, subtract and intersect give nothing', () => {
    expect(combineSelections(a, b, 'replace').data).toEqual(b.data);
    expect(combineSelections(null, b, 'add').data).toEqual(b.data);
    expect(isEmptySelection(combineSelections(null, b, 'subtract'))).toBe(true);
    expect(isEmptySelection(combineSelections(null, b, 'intersect'))).toBe(true);
  });

  it('inverting twice gives back the selection, and a selection plus its inverse is everything', () => {
    expect(invertSelection(invertSelection(a)).data).toEqual(a.data);
    expect(area(combineSelections(a, invertSelection(a), 'add'))).toBe(W * H);
    expect(area(combineSelections(a, invertSelection(a), 'intersect'))).toBe(0);
  });

  it('select all and nothing', () => {
    expect(area(selectAll(W, H))).toBe(W * H);
    expect(isEmptySelection(emptySelection(W, H))).toBe(true);
  });
});

describe('feather', () => {
  it('softens the edge and keeps the total about the same', () => {
    const hard = rectSelection(100, 100, 30, 30, 70, 70);
    const soft = featherSelection(hard, 8);
    expect(Math.abs(area(soft) - area(hard)) / area(hard)).toBeLessThan(0.02);
    expect(at(soft, 50, 50)).toBe(255);
    const edge = at(soft, 30, 50) ?? 0;
    expect(edge).toBeGreaterThan(60);
    expect(edge).toBeLessThan(200);
    expect(at(soft, 26, 50)).toBeGreaterThan(0);
    expect(at(soft, 5, 5)).toBe(0);
  });

  it('a radius of zero changes nothing', () => {
    const s = rectSelection(W, H, 10, 10, 20, 20);
    expect(featherSelection(s, 0)).toBe(s);
  });
});

describe('queries', () => {
  it('bounds, sampling and outline', () => {
    const s = rectSelection(W, H, 10, 5, 30, 25);
    expect(selectionBounds(s)).toEqual({ x: 10, y: 5, width: 20, height: 20 });
    expect(selectionBounds(emptySelection(W, H))).toBeNull();
    expect(sampleSelection(s, 15.5, 10.5)).toBe(1);
    expect(sampleSelection(s, 5, 5)).toBe(0);
    expect(sampleSelection(s, -3, 5)).toBe(0);
    const outline = selectionOutline(s);
    expect(outline).toHaveLength(4 * 4); // four merged sides
    let length = 0;
    for (let i = 0; i < outline.length; i += 4) {
      length += Math.hypot(
        (outline[i + 2] ?? 0) - (outline[i] ?? 0),
        (outline[i + 3] ?? 0) - (outline[i + 1] ?? 0),
      );
    }
    expect(length).toBe(80);
  });
});

describe('save as mask', () => {
  const grid: PixelGrid = { width: W, height: H, channels: 1 };
  let n = 0;
  const id = () => `m${String(n++)}`;

  it('copies the selection into mask pixels when the layer sits at the origin', () => {
    const s = rectSelection(W, H, 10, 5, 30, 25);
    const tiles = selectionToMaskTiles(s, [1, 0, 0, 1, 0, 0], W, H, id);
    expect(readPixel(tiles, grid, 15, 10)).toEqual([255]);
    expect(readPixel(tiles, grid, 5, 10)).toEqual([0]);
    expect(readPixel(tiles, grid, 40, 40)).toEqual([0]);
  });

  it('follows the layer transform', () => {
    const s = rectSelection(W, H, 10, 10, 30, 30);
    // The layer is shifted right and down by 8 in the document: its pixel (2, 2) sits on document (10, 10).
    const tiles = selectionToMaskTiles(s, [1, 0, 0, 1, 8, 8], 40, 40, id);
    const small: PixelGrid = { width: 40, height: 40, channels: 1 };
    expect(readPixel(tiles, small, 2, 2)).toEqual([255]);
    expect(readPixel(tiles, small, 1, 1)).toEqual([0]);
  });

  it('a selection of everything leaves the mask empty (everything shows)', () => {
    const tiles = selectionToMaskTiles(selectAll(W, H), [1, 0, 0, 1, 0, 0], W, H, id);
    expect(tiles.size).toBe(0);
  });
});
