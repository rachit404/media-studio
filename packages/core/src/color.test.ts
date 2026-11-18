import { describe, expect, it } from 'vitest';
import {
  BLEND_MODES,
  applyAdjustment,
  blendChannel,
  blendRgb,
  compositeOver,
  defaultAdjustment,
  isFilterAdjustment,
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

  it('matches hand-computed values for the remaining separable modes', () => {
    expect(blendChannel('darken', 0.3, 0.6)).toBe(0.3);
    expect(blendChannel('lighten', 0.3, 0.6)).toBe(0.6);
    expect(blendChannel('difference', 0.8, 0.3)).toBeCloseTo(0.5);
    expect(blendChannel('exclusion', 0.5, 0.5)).toBeCloseTo(0.5);
    expect(blendChannel('hard-light', 0.5, 0.25)).toBeCloseTo(0.25);
    expect(blendChannel('hard-light', 0.5, 0.75)).toBeCloseTo(0.75);
    expect(blendChannel('color-dodge', 0.5, 0.5)).toBe(1);
    expect(blendChannel('color-dodge', 0, 0.9)).toBe(0);
    expect(blendChannel('color-dodge', 0.4, 1)).toBe(1);
    expect(blendChannel('color-burn', 0.5, 0.5)).toBe(0);
    expect(blendChannel('color-burn', 1, 0.2)).toBe(1);
    expect(blendChannel('color-burn', 0.4, 0)).toBe(0);
    expect(blendChannel('soft-light', 0.5, 0.25)).toBeCloseTo(0.375);
    expect(blendChannel('soft-light', 0.5, 0.75)).toBeCloseTo(0.5 + 0.5 * (Math.sqrt(0.5) - 0.5));
    expect(blendChannel('soft-light', 0.2, 0.75)).toBeCloseTo(
      0.2 + 0.5 * (((16 * 0.2 - 12) * 0.2 + 4) * 0.2 - 0.2),
    );
  });

  it('refuses to treat HSL modes as separable', () => {
    for (const mode of ['hue', 'saturation', 'color', 'luminosity'] as const) {
      expect(() => blendChannel(mode, 0.2, 0.3)).toThrow(RangeError);
    }
  });

  it('has the expected identities for every mode', () => {
    for (const mode of BLEND_MODES) {
      for (const v of [0, 0.2, 0.5, 0.9, 1]) {
        for (const c of blendRgb(mode, [v, v, v], [v, 1 - v, 0.5])) {
          expect(c).toBeGreaterThanOrEqual(-1e-9);
          expect(c).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
    expect(blendChannel('multiply', 0.7, 1)).toBeCloseTo(0.7); // white is neutral
    expect(blendChannel('screen', 0.7, 0)).toBeCloseTo(0.7); // black is neutral
    expect(blendChannel('overlay', 0.6, 0.5)).toBeCloseTo(0.6); // mid grey is neutral
    expect(blendChannel('soft-light', 0.6, 0.5)).toBeCloseTo(0.6);
    expect(blendChannel('difference', 0.6, 0.6)).toBe(0);
    expect(blendChannel('multiply', 0.7, 0)).toBe(0);
    expect(blendChannel('screen', 0.7, 1)).toBe(1);
  });
});

describe('non-separable (HSL) modes', () => {
  const lum = (c: readonly number[]) => 0.3 * (c[0] ?? 0) + 0.59 * (c[1] ?? 0) + 0.11 * (c[2] ?? 0);
  const backdrop = [0.78, 0.39, 0.2] as const;
  const source = [0.2, 0.59, 0.98] as const;

  it("'color' keeps the backdrop luminosity and takes the source hue and saturation", () => {
    const result = blendRgb('color', backdrop, source);
    expect(lum(result)).toBeCloseTo(lum(backdrop), 6);
    expect(result[2]).toBeGreaterThan(result[0]); // blue-ish like the source
  });

  it("'luminosity' keeps the backdrop colour and takes the source luminosity", () => {
    const result = blendRgb('luminosity', backdrop, source);
    expect(lum(result)).toBeCloseTo(lum(source), 6);
    expect(result[0]).toBeGreaterThan(result[2]); // still orange-ish like the backdrop
  });

  it("'hue' and 'saturation' keep the backdrop luminosity", () => {
    expect(lum(blendRgb('hue', backdrop, source))).toBeCloseTo(lum(backdrop), 6);
    expect(lum(blendRgb('saturation', backdrop, source))).toBeCloseTo(lum(backdrop), 6);
  });

  it('a grey source removes all colour in hue and saturation modes', () => {
    for (const mode of ['hue', 'saturation'] as const) {
      const [r, g, b] = blendRgb(mode, backdrop, [0.4, 0.4, 0.4]);
      expect(r).toBeCloseTo(g, 9);
      expect(g).toBeCloseTo(b, 9);
      expect(r).toBeCloseTo(lum(backdrop), 6);
    }
  });

  it('blending a colour with itself leaves it unchanged', () => {
    for (const mode of ['color', 'luminosity', 'hue', 'saturation'] as const) {
      const result = blendRgb(mode, backdrop, backdrop);
      result.forEach((value, index) => expect(value).toBeCloseTo(backdrop[index] ?? NaN, 6));
    }
  });

  it('stays inside the colour gamut (clip step)', () => {
    for (const mode of ['color', 'luminosity', 'hue', 'saturation'] as const) {
      for (const cs of [
        [1, 0, 0],
        [0, 1, 1],
        [0.9, 0.1, 0.95],
      ] as const) {
        for (const cb of [
          [0.05, 0.9, 0.1],
          [0.99, 0.99, 0.01],
          [0.5, 0.5, 0.5],
        ] as const) {
          for (const c of blendRgb(mode, cb, cs)) {
            expect(c).toBeGreaterThanOrEqual(-1e-9);
            expect(c).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
      }
    }
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
    for (const kind of ['brightness-contrast', 'exposure', 'saturation', 'levels'] as const) {
      const adjustment = defaultAdjustment(kind);
      if (isFilterAdjustment(adjustment)) throw new Error('expected a point adjustment');
      close(applyAdjustment(sample, adjustment), sample);
    }
    expect(defaultAdjustment('blur').kind).toBe('blur');
    expect(isFilterAdjustment(defaultAdjustment('sharpen'))).toBe(true);
    expect(isFilterAdjustment(defaultAdjustment('levels'))).toBe(false);
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

  it('levels remap the input range, apply gamma and map to the output range', () => {
    const base = {
      kind: 'levels',
      inBlack: 0.2,
      inWhite: 0.8,
      gamma: 1,
      outBlack: 0,
      outWhite: 1,
    } as const;
    close(applyAdjustment([0.2, 0.5, 0.8, 1], base), [0, 0.5, 1, 1]);
    close(applyAdjustment([0.1, 0.9, 0.5, 1], base), [0, 1, 0.5, 1]); // clipped outside the input range
    const [mid] = applyAdjustment([0.5, 0.5, 0.5, 1], {
      ...base,
      inBlack: 0,
      inWhite: 1,
      gamma: 2,
    });
    expect(mid).toBeCloseTo(0.5 ** 0.5, 9); // gamma above 1 brightens mid-tones
    const [low, high] = applyAdjustment([0, 1, 0.5, 1], {
      ...base,
      inBlack: 0,
      inWhite: 1,
      outBlack: 0.25,
      outWhite: 0.75,
    });
    expect(low).toBeCloseTo(0.25);
    expect(high).toBeCloseTo(0.75);
  });

  it('black & white blends towards luma and keeps alpha', () => {
    const luma = 0.2126 * 0.8 + 0.7152 * 0.4 + 0.0722 * 0.2;
    close(applyAdjustment(sample, { kind: 'black-white', amount: 1 }), [luma, luma, luma, 0.6]);
    close(applyAdjustment(sample, { kind: 'black-white', amount: 0 }), sample);
    const [r] = applyAdjustment(sample, { kind: 'black-white', amount: 0.5 });
    expect(r).toBeCloseTo((0.8 + luma) / 2);
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
