import {
  TILE_SIZE,
  applyAffine,
  createTile,
  invertAffine,
  isDefaultTile,
  tileKey,
  type Affine,
  type Tile,
} from '@media-studio/core';

/**
 * A selection: how much each document pixel is selected, 0 (not at all) to 255 (fully). It is a working state of
 * the editor, not part of the saved project, and is never modified in place.
 */
export interface Selection {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export type CombineMode = 'replace' | 'add' | 'subtract' | 'intersect';
export type Point = readonly [x: number, y: number];

export function emptySelection(width: number, height: number): Selection {
  return { width, height, data: new Uint8Array(width * height) };
}

export function selectAll(width: number, height: number): Selection {
  return { width, height, data: new Uint8Array(width * height).fill(255) };
}

/** True when nothing is selected. */
export function isEmptySelection(selection: Selection): boolean {
  return !selection.data.some((value) => value > 0);
}

/**
 * Fill a polygon (even-odd rule) with anti-aliasing: four sample lines per pixel row, exact coverage along each line.
 * Points are in document pixels; the polygon is closed automatically.
 */
export function polygonSelection(
  width: number,
  height: number,
  points: readonly Point[],
): Selection {
  const result = new Uint8Array(width * height);
  if (points.length < 3) return { width, height, data: result };

  interface Edge {
    x0: number;
    y0: number;
    y1: number;
    slope: number;
  }
  const edges: Edge[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i] as Point;
    const [bx, by] = points[(i + 1) % points.length] as Point;
    minY = Math.min(minY, ay);
    maxY = Math.max(maxY, ay);
    if (ay === by) continue;
    const [x0, y0, x1, y1] = ay < by ? [ax, ay, bx, by] : [bx, by, ax, ay];
    edges.push({ x0, y0, y1, slope: (x1 - x0) / (y1 - y0) });
  }
  edges.sort((p, q) => p.y0 - q.y0);

  const SAMPLES = 4;
  const rowCoverage = new Float32Array(width);
  const firstRow = Math.max(0, Math.floor(minY));
  const lastRow = Math.min(height - 1, Math.ceil(maxY));
  let next = 0;
  let active: Edge[] = [];

  for (let row = firstRow; row <= lastRow; row += 1) {
    rowCoverage.fill(0);
    let any = false;
    for (let s = 0; s < SAMPLES; s += 1) {
      const y = row + (s + 0.5) / SAMPLES;
      while (next < edges.length && (edges[next] as Edge).y0 <= y) {
        active.push(edges[next] as Edge);
        next += 1;
      }
      active = active.filter((edge) => edge.y1 > y);
      if (active.length < 2) continue;
      const crossings = active
        .map((edge) => edge.x0 + (y - edge.y0) * edge.slope)
        .sort((p, q) => p - q);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const from = Math.max(0, crossings[i] as number);
        const to = Math.min(width, crossings[i + 1] as number);
        if (to <= from) continue;
        any = true;
        const first = Math.floor(from);
        const last = Math.min(width - 1, Math.ceil(to) - 1);
        for (let x = first; x <= last; x += 1) {
          rowCoverage[x] =
            (rowCoverage[x] ?? 0) + (Math.min(to, x + 1) - Math.max(from, x)) / SAMPLES;
        }
      }
    }
    if (!any) continue;
    const offset = row * width;
    for (let x = 0; x < width; x += 1) {
      result[offset + x] = Math.round(Math.min(1, rowCoverage[x] ?? 0) * 255);
    }
  }
  return { width, height, data: result };
}

export function rectSelection(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Selection {
  const [left, right] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [top, bottom] = y0 < y1 ? [y0, y1] : [y1, y0];
  return polygonSelection(width, height, [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ]);
}

/** The ellipse inscribed in the box, approximated by a polygon fine enough to be indistinguishable. */
export function ellipseSelection(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Selection {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  const steps = Math.max(32, Math.min(720, Math.ceil(Math.max(rx, ry) * 1.5)));
  const points: Point[] = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return polygonSelection(width, height, points);
}

/** Combine a new shape with the current selection. */
export function combineSelections(
  current: Selection | null,
  shape: Selection,
  mode: CombineMode,
): Selection {
  if (mode === 'replace' || current === null) {
    return mode === 'subtract' || mode === 'intersect'
      ? emptySelection(shape.width, shape.height)
      : shape;
  }
  const out = new Uint8Array(shape.data.length);
  for (let i = 0; i < out.length; i += 1) {
    const a = current.data[i] ?? 0;
    const b = shape.data[i] ?? 0;
    if (mode === 'add') out[i] = Math.round(a + b - (a * b) / 255);
    else if (mode === 'subtract') out[i] = Math.round((a * (255 - b)) / 255);
    else out[i] = Math.round((a * b) / 255);
  }
  return { width: shape.width, height: shape.height, data: out };
}

export function invertSelection(selection: Selection): Selection {
  const out = new Uint8Array(selection.data.length);
  for (let i = 0; i < out.length; i += 1) out[i] = 255 - (selection.data[i] ?? 0);
  return { width: selection.width, height: selection.height, data: out };
}

/** Soften the edge: a blur of the given radius (pixels), done as three box blurs which approximate a Gaussian. */
export function featherSelection(selection: Selection, radius: number): Selection {
  if (radius <= 0) return selection;
  const { width, height } = selection;
  const sigma = radius / 2;
  const boxWidth = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1)));
  const half = Math.floor(boxWidth / 2);
  const current = Float32Array.from(selection.data);
  const scratch = new Float32Array(current.length);
  for (let pass = 0; pass < 3; pass += 1) {
    blurRows(current, scratch, width, height, half);
    blurColumns(scratch, current, width, height, half);
  }
  const out = new Uint8Array(current.length);
  for (let i = 0; i < out.length; i += 1)
    out[i] = Math.round(Math.min(255, Math.max(0, current[i] ?? 0)));
  return { width, height, data: out };
}

function blurRows(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  half: number,
) {
  const span = half * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let k = -half; k <= half; k += 1)
      sum += src[row + Math.min(width - 1, Math.max(0, k))] ?? 0;
    for (let x = 0; x < width; x += 1) {
      dst[row + x] = sum / span;
      sum +=
        (src[row + Math.min(width - 1, x + half + 1)] ?? 0) -
        (src[row + Math.max(0, x - half)] ?? 0);
    }
  }
}

function blurColumns(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  half: number,
) {
  const span = half * 2 + 1;
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let k = -half; k <= half; k += 1)
      sum += src[Math.min(height - 1, Math.max(0, k)) * width + x] ?? 0;
    for (let y = 0; y < height; y += 1) {
      dst[y * width + x] = sum / span;
      sum +=
        (src[Math.min(height - 1, y + half + 1) * width + x] ?? 0) -
        (src[Math.max(0, y - half) * width + x] ?? 0);
    }
  }
}

/** Smallest box containing every selected pixel, or null when nothing is selected. */
export function selectionBounds(
  selection: Selection,
): { x: number; y: number; width: number; height: number } | null {
  const { width, height, data } = selection;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[y * width + x] ?? 0) === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Selection amount at a document position, 0..1 (nearest pixel; outside the document is 0). */
export function sampleSelection(selection: Selection, x: number, y: number): number {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= selection.width || py >= selection.height) return 0;
  return (selection.data[py * selection.width + px] ?? 0) / 255;
}

/**
 * The outline of the selected area for the "marching ants" display: straight pieces along pixel edges where the
 * selection crosses 50 %. Neighbouring pieces are merged. Returns x1, y1, x2, y2 per piece, in document pixels.
 */
export function selectionOutline(selection: Selection): number[] {
  const { width, height, data } = selection;
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && (data[y * width + x] ?? 0) >= 128;
  const out: number[] = [];
  for (let y = 0; y <= height; y += 1) {
    let start = -1;
    for (let x = 0; x <= width; x += 1) {
      const edge = x < width && inside(x, y - 1) !== inside(x, y);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        out.push(start, y, x, y);
        start = -1;
      }
    }
  }
  for (let x = 0; x <= width; x += 1) {
    let start = -1;
    for (let y = 0; y <= height; y += 1) {
      const edge = y < height && inside(x - 1, y) !== inside(x, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) {
        out.push(x, start, x, y);
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Turn a selection into mask pixels for a layer: each pixel of the layer's own surface takes the selection value
 * at the document position it sits on. `toDocument` maps surface pixels to document pixels.
 */
export function selectionToMaskTiles(
  selection: Selection,
  toDocument: Affine,
  width: number,
  height: number,
  newTileId: () => string,
): Map<string, Tile> {
  const tiles = new Map<string, Tile>();
  if (invertAffine(toDocument) === null) return tiles;
  for (let ty = 0; ty * TILE_SIZE < height; ty += 1) {
    for (let tx = 0; tx * TILE_SIZE < width; tx += 1) {
      const tile = createTile(newTileId(), 1);
      for (let y = 0; y < TILE_SIZE; y += 1) {
        const py = ty * TILE_SIZE + y;
        if (py >= height) break;
        for (let x = 0; x < TILE_SIZE; x += 1) {
          const px = tx * TILE_SIZE + x;
          if (px >= width) break;
          const [dx, dy] = applyAffine(toDocument, px + 0.5, py + 0.5);
          tile.data[y * TILE_SIZE + x] = Math.round(sampleSelection(selection, dx, dy) * 255);
        }
      }
      if (!isDefaultTile(tile, 1)) tiles.set(tileKey(tx, ty), tile);
    }
  }
  return tiles;
}
