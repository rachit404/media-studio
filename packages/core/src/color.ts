/**
 * Reference (CPU) implementations of blending and adjustments. The GPU shaders in `packages/render` implement the
 * same formulas; end-to-end tests compare rendered pixels against these functions (error budget 2/255).
 * Colour values are straight (non-premultiplied) sRGB floats in 0..1.
 */
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export type Rgba = readonly [r: number, g: number, b: number, a: number];

export type Adjustment =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number }
  | { kind: 'exposure'; exposure: number }
  | { kind: 'saturation'; saturation: number };
export type AdjustmentKind = Adjustment['kind'];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** W3C Compositing and Blending Level 1, separable blend functions B(cb, cs). */
export function blendChannel(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case 'normal':
      return cs;
    case 'multiply':
      return cb * cs;
    case 'screen':
      return cb + cs - cb * cs;
    case 'overlay':
      // Overlay is hard-light with the layers swapped.
      return cb <= 0.5 ? cs * 2 * cb : cs + (2 * cb - 1) - cs * (2 * cb - 1);
  }
}

/** Source-over compositing with a blend mode (W3C general formula). Opacity scales the source alpha. */
export function compositeOver(
  backdrop: Rgba,
  source: Rgba,
  mode: BlendMode,
  opacity: number,
): [number, number, number, number] {
  const ab = backdrop[3];
  const as = source[3] * opacity;
  const ar = as + ab * (1 - as);
  if (ar <= 0) return [0, 0, 0, 0];
  const channel = (index: 0 | 1 | 2): number => {
    const cb = backdrop[index];
    const cs = source[index];
    const premultiplied =
      (1 - as) * ab * cb + (1 - ab) * as * cs + as * ab * blendChannel(mode, cb, cs);
    return premultiplied / ar;
  };
  return [channel(0), channel(1), channel(2), ar];
}

export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** Apply an adjustment to a straight-alpha colour. Alpha is never changed. */
export function applyAdjustment(
  color: Rgba,
  adjustment: Adjustment,
): [number, number, number, number] {
  const [r, g, b, a] = color;
  switch (adjustment.kind) {
    case 'brightness-contrast': {
      const factor = 1 + adjustment.contrast;
      const map = (v: number) => clamp01((v - 0.5) * factor + 0.5 + adjustment.brightness);
      return [map(r), map(g), map(b), a];
    }
    case 'exposure': {
      const gain = 2 ** adjustment.exposure;
      const map = (v: number) => clamp01(linearToSrgb(clamp01(srgbToLinear(v) * gain)));
      return [map(r), map(g), map(b), a];
    }
    case 'saturation': {
      const luma = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
      const factor = 1 + adjustment.saturation;
      const map = (v: number) => clamp01(luma + (v - luma) * factor);
      return [map(r), map(g), map(b), a];
    }
  }
}

/** Default parameters for a new adjustment layer. */
export function defaultAdjustment(kind: AdjustmentKind): Adjustment {
  switch (kind) {
    case 'brightness-contrast':
      return { kind, brightness: 0, contrast: 0 };
    case 'exposure':
      return { kind, exposure: 0 };
    case 'saturation':
      return { kind, saturation: 0 };
  }
}
