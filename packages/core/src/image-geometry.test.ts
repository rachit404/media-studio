import { describe, expect, it } from 'vitest';
import { applyAffine, layerMatrix, multiplyAffine, normalizeDegrees } from './image-geometry';

const near = (actual: readonly number[], expected: readonly number[]) =>
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 9));

describe('layerMatrix', () => {
  const t = (
    over: Partial<{ x: number; y: number; scaleX: number; scaleY: number; rotation: number }> = {},
  ) => ({
    x: 100,
    y: 50,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    ...over,
  });

  it('places the layer centre at (x, y) without rotation', () => {
    const m = layerMatrix(t(), 40, 20);
    near(applyAffine(m, 0, 0), [80, 40]); // top-left corner
    near(applyAffine(m, 20, 10), [100, 50]); // centre
    near(applyAffine(m, 40, 20), [120, 60]); // bottom-right corner
  });

  it('keeps the centre fixed when scaling, rotating and mirroring', () => {
    for (const over of [
      { scaleX: 2, scaleY: 0.5 },
      { rotation: 37 },
      { scaleX: -1 },
      { rotation: 90, scaleY: -3 },
    ]) {
      near(applyAffine(layerMatrix(t(over), 40, 20), 20, 10), [100, 50]);
    }
  });

  it('rotates clockwise on screen (y down) for positive angles', () => {
    const m = layerMatrix(t({ x: 0, y: 0, rotation: 90 }), 2, 2);
    // The top-right corner (1, -1) relative to the centre moves to the bottom-right (1, 1).
    near(applyAffine(m, 2, 0), [1, 1]);
    // The top-left corner (-1, -1) moves to the top-right (1, -1).
    near(applyAffine(m, 0, 0), [1, -1]);
  });

  it('mirrors with a negative scale', () => {
    const m = layerMatrix(t({ x: 0, y: 0, scaleX: -1 }), 2, 2);
    near(applyAffine(m, 0, 0), [1, -1]); // left edge goes right
  });
});

describe('multiplyAffine', () => {
  it('applies the first matrix and then the second', () => {
    const translate = [1, 0, 0, 1, 10, 0] as const;
    const scale = [2, 0, 0, 2, 0, 0] as const;
    near(applyAffine(multiplyAffine(scale, translate), 1, 1), [22, 2]);
    near(applyAffine(multiplyAffine(translate, scale), 1, 1), [12, 2]);
  });
});

describe('normalizeDegrees', () => {
  it('wraps to (-180, 180]', () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(270)).toBe(-90);
    expect(normalizeDegrees(-270)).toBe(90);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(720 + 45)).toBe(45);
  });
});
