import { describe, expect, it } from 'vitest';
import {
  BLEND_MODES,
  applyAdjustment,
  blendChannel,
  compositeOver,
  defaultAdjustment,
  linearToSrgb,
  srgbToLinear,
  type Rgba,
} from './color';

const close = (actual: readonly number[], expected: readonly number[], digits = 6) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, digits));
};

describe('blendChannel (W3C formulas)', () => {
  it('matches known values', () => {
    expect(blendChannel('normal', 0.3, 0.8)).toBe(0.8);
    expect(blendChannel('multiply', 0.5, 0.5)).toBe(0.25);
    expect(blendChannel('screen', 0.5, 0.5)).toBe(0.75);
    expect(blendChannel('overlay', 0.25, 0.5)).toBeCloseTo(0.25); // multiply branch: 0.5 * 2 * 0.25
    expect(blendChannel('overlay', 0.75, 0.5)).toBeCloseTo(0.75); // screen branch: 0.5 + 0.5 - 0.25
  });

  it('has the expected identities for every mode', () => {
    for (const mode of BLEND_MODES) {
      for (const v of [0, 0.2, 0.5, 0.9, 1]) {
        const result = blendChannel(mode, v, v);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      }
    }
    expect(blendChannel('multiply', 0.7, 1)).toBeCloseTo(0.7); // white is neutral
    expect(blendChannel('screen', 0.7, 0)).toBeCloseTo(0.7); // black is neutral
    expect(blendChannel('overlay', 0.6, 0.5)).toBeCloseTo(0.6); // mid grey is neutral
    expect(blendChannel('multiply', 0.7, 0)).toBe(0);
    expect(blendChannel('screen', 0.7, 1)).toBe(1);
  });
});

describe('compositeOver', () => {
  const opaque = (r: number, g: number, b: number): Rgba => [r, g, b, 1];

  it('normal mode with opaque source and full opacity replaces the backdrop', () => {
    close(
      compositeOver(opaque(0.1, 0.2, 0.3), opaque(0.9, 0.8, 0.7), 'normal', 1),
      [0.9, 0.8, 0.7, 1],
    );
  });

  it('opacity mixes linearly for opaque layers', () => {
    close(compositeOver(opaque(0, 0, 0), opaque(1, 1, 1), 'normal', 0.25), [0.25, 0.25, 0.25, 1]);
  });

  it('multiply at full opacity multiplies channels', () => {
    close(
      compositeOver(opaque(0.5, 1, 0.2), opaque(0.5, 0.5, 0.5), 'multiply', 1),
      [0.25, 0.5, 0.1, 1],
    );
  });

  it('a fully transparent source leaves the backdrop untouched, for every mode', () => {
    for (const mode of BLEND_MODES) {
      close(compositeOver(opaque(0.3, 0.6, 0.9), [1, 0, 0, 0], mode, 1), [0.3, 0.6, 0.9, 1]);
    }
  });

  it('over a transparent backdrop the result is the source, whatever the blend mode', () => {
    for (const mode of BLEND_MODES) {
      close(compositeOver([0, 0, 0, 0], [0.4, 0.5, 0.6, 0.5], mode, 1), [0.4, 0.5, 0.6, 0.5]);
    }
  });

  it('combines alpha as source-over', () => {
    const result = compositeOver([0.2, 0.2, 0.2, 0.5], [1, 1, 1, 0.5], 'normal', 1);
    expect(result[3]).toBeCloseTo(0.75);
    // premultiplied: 0.5*1 + 0.5*0.5*0.2 = 0.55 -> straight 0.55 / 0.75
    expect(result[0]).toBeCloseTo(0.55 / 0.75);
  });

  it('returns transparent for a fully transparent result', () => {
    expect(compositeOver([0, 0, 0, 0], [1, 1, 1, 0], 'normal', 1)).toEqual([0, 0, 0, 0]);
  });
});

describe('colour transfer functions', () => {
  it('round-trips sRGB and linear values', () => {
    for (const v of [0, 0.001, 0.04, 0.18, 0.5, 0.9, 1]) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 9);
    }
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);
  });
});

describe('applyAdjustment', () => {
  const sample: Rgba = [0.8, 0.4, 0.2, 0.6];

  it('defaults are identity and alpha is never touched', () => {
    for (const kind of ['brightness-contrast', 'exposure', 'saturation'] as const) {
      close(applyAdjustment(sample, defaultAdjustment(kind)), sample);
    }
    expect(applyAdjustment(sample, { kind: 'exposure', exposure: 2 })[3]).toBe(0.6);
  });

  it('brightness shifts and contrast scales around mid grey', () => {
    close(
      applyAdjustment([0.5, 0.5, 0.5, 1], {
        kind: 'brightness-contrast',
        brightness: 0.1,
        contrast: 0,
      }),
      [0.6, 0.6, 0.6, 1],
    );
    close(
      applyAdjustment([0.75, 0.5, 0.25, 1], {
        kind: 'brightness-contrast',
        brightness: 0,
        contrast: 1,
      }),
      [1, 0.5, 0, 1],
    );
  });

  it('exposure of one stop doubles linear light', () => {
    const [r] = applyAdjustment([0.5, 0.5, 0.5, 1], { kind: 'exposure', exposure: 1 });
    expect(r).toBeCloseTo(linearToSrgb(srgbToLinear(0.5) * 2), 9);
    expect(applyAdjustment([0.5, 0.5, 0.5, 1], { kind: 'exposure', exposure: -4 })[0]).toBeLessThan(
      0.2,
    );
  });

  it('saturation -1 gives luma grey and +1 pushes colours apart', () => {
    const [r, g, b] = applyAdjustment(sample, { kind: 'saturation', saturation: -1 });
    expect(r).toBeCloseTo(g, 9);
    expect(g).toBeCloseTo(b, 9);
    expect(r).toBeCloseTo(0.2126 * 0.8 + 0.7152 * 0.4 + 0.0722 * 0.2, 9);
    const boosted = applyAdjustment(sample, { kind: 'saturation', saturation: 1 });
    expect(boosted[0] - boosted[2]).toBeGreaterThan(sample[0] - sample[2]);
  });

  it('always stays inside 0..1', () => {
    for (const adjustment of [
      { kind: 'brightness-contrast', brightness: 1, contrast: 1 },
      { kind: 'exposure', exposure: 4 },
      { kind: 'saturation', saturation: 1 },
    ] as const) {
      for (const c of applyAdjustment([0.99, 0.01, 0.5, 1], adjustment).slice(0, 3)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});
