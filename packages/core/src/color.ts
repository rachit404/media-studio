/**
 * Reference (CPU) implementations of blending and adjustments. The GPU shaders in `packages/render` implement the
 * same formulas; end-to-end tests compare rendered pixels against these functions (error budget 2/255).
 * Colour values are straight (non-premultiplied) sRGB floats in 0..1.
 */
/** W3C Compositing and Blending Level 1 modes. The order is the shader's `uMode` index: do not reorder. */
export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export type Rgba = readonly [r: number, g: number, b: number, a: number];

export type Adjustment =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number }
  | { kind: 'exposure'; exposure: number }
  | { kind: 'saturation'; saturation: number };
export type AdjustmentKind = Adjustment['kind'];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export type Vec3 = readonly [number, number, number];

/** Separable blend functions B(cb, cs), applied to one channel (W3C Compositing and Blending Level 1). */
export function blendChannel(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case 'normal':
      return cs;
    case 'multiply':
      return cb * cs;
    case 'screen':
      return cb + cs - cb * cs;
    case 'overlay':
      return blendChannel('hard-light', cs, cb); // overlay is hard-light with the layers swapped
    case 'darken':
      return Math.min(cb, cs);
    case 'lighten':
      return Math.max(cb, cs);
    case 'color-dodge':
      if (cb === 0) return 0;
      return cs >= 1 ? 1 : Math.min(1, cb / (1 - cs));
    case 'color-burn':
      if (cb >= 1) return 1;
      return cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
    case 'hard-light':
      return cs <= 0.5 ? cb * 2 * cs : cb + (2 * cs - 1) - cb * (2 * cs - 1);
    case 'soft-light': {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
    case 'difference':
      return Math.abs(cb - cs);
    case 'exclusion':
      return cb + cs - 2 * cb * cs;
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      throw new RangeError(`${mode} is not a separable blend mode; use blendRgb`);
  }
}

const lum = (c: Vec3): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

function clipColor(c: Vec3): Vec3 {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out: Vec3 = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as unknown as Vec3;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as unknown as Vec3;
  return out;
}

function setLum(c: Vec3, l: number): Vec3 {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

const sat = (c: Vec3): number => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

function setSat(c: Vec3, s: number): Vec3 {
  const max = Math.max(c[0], c[1], c[2]);
  const min = Math.min(c[0], c[1], c[2]);
  if (max <= min) return [0, 0, 0];
  const scale = s / (max - min);
  return [(c[0] - min) * scale, (c[1] - min) * scale, (c[2] - min) * scale];
}

/** Blend whole colours: separable modes per channel, the four HSL modes as defined by the W3C spec. */
export function blendRgb(mode: BlendMode, cb: Vec3, cs: Vec3): [number, number, number] {
  if (mode === 'hue') return [...setLum(setSat(cs, sat(cb)), lum(cb))];
  if (mode === 'saturation') return [...setLum(setSat(cb, sat(cs)), lum(cb))];
  if (mode === 'color') return [...setLum(cs, lum(cb))];
  if (mode === 'luminosity') return [...setLum(cb, lum(cs))];
  return [
    blendChannel(mode, cb[0], cs[0]),
    blendChannel(mode, cb[1], cs[1]),
    blendChannel(mode, cb[2], cs[2]),
  ];
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
  const cb: Vec3 = [backdrop[0], backdrop[1], backdrop[2]];
  const cs: Vec3 = [source[0], source[1], source[2]];
  const blended = blendRgb(mode, cb, cs);
  const channel = (index: 0 | 1 | 2): number =>
    ((1 - as) * ab * cb[index] + (1 - ab) * as * cs[index] + as * ab * blended[index]) / ar;
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
