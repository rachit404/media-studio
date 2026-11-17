import type { Transform } from './image-document';

/** 2D affine matrix [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Matrix product `first` then `second` (applies `first` to a point, then `second`). */
export function multiplyAffine(second: Affine, first: Affine): Affine {
  return [
    second[0] * first[0] + second[2] * first[1],
    second[1] * first[0] + second[3] * first[1],
    second[0] * first[2] + second[2] * first[3],
    second[1] * first[2] + second[3] * first[3],
    second[0] * first[4] + second[2] * first[5] + second[4],
    second[1] * first[4] + second[3] * first[5] + second[5],
  ];
}

/**
 * Maps a layer's own pixel coordinates (origin top-left, size width x height) to document coordinates:
 * scale and rotate around the layer centre, then place the centre at (x, y).
 */
export function layerMatrix(transform: Transform, width: number, height: number): Affine {
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const a = cos * transform.scaleX;
  const b = sin * transform.scaleX;
  const c = -sin * transform.scaleY;
  const d = cos * transform.scaleY;
  return [
    a,
    b,
    c,
    d,
    transform.x - (a * width) / 2 - (c * height) / 2,
    transform.y - (b * width) / 2 - (d * height) / 2,
  ];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Normalise an angle to (-180, 180]. */
export function normalizeDegrees(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}
