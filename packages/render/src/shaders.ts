import { BLEND_MODES } from '@media-studio/core';

/** Index of a blend mode as the `uMode` uniform of the composite shader. */
export function blendModeIndex(mode: (typeof BLEND_MODES)[number]): number {
  return BLEND_MODES.indexOf(mode);
}

export const FULLSCREEN_VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Draws a layer's image as a transformed quad. uToClip maps source pixels straight to clip space. */
export const LAYER_VERTEX = `#version 300 es
in vec2 aCorner;
uniform mat3 uToClip;
uniform vec2 uSize;
out vec2 vUv;
void main() {
  vUv = aCorner;
  vec3 p = uToClip * vec3(aCorner * uSize, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

/** Textures are uploaded premultiplied, so the layer pass is a plain copy. */
export const LAYER_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUv);
}`;

/**
 * W3C Compositing and Blending Level 1: source-over with a separable blend function.
 *   ar = as + ab (1 - as)
 *   ar * Cr = (1 - as) ab Cb + (1 - ab) as Cs + as ab B(Cb, Cs)
 * Inputs are premultiplied; the equations use straight colours. Mirrors compositeOver() in packages/core/src/color.ts.
 */
export const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uBackdrop;
uniform sampler2D uSource;
uniform int uMode;
uniform float uOpacity;
in vec2 vUv;
out vec4 outColor;

// ---- separable blend functions (one channel); uMode indices follow BLEND_MODES in core/color.ts ----
float hardLight(float cb, float cs) {
  return cs <= 0.5 ? cb * 2.0 * cs : cb + (2.0 * cs - 1.0) - cb * (2.0 * cs - 1.0);
}
float softLight(float cb, float cs) {
  if (cs <= 0.5) return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
  float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
  return cb + (2.0 * cs - 1.0) * (d - cb);
}
float dodge(float cb, float cs) {
  if (cb == 0.0) return 0.0;
  return cs >= 1.0 ? 1.0 : min(1.0, cb / (1.0 - cs));
}
float burn(float cb, float cs) {
  if (cb >= 1.0) return 1.0;
  return cs <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - cb) / cs);
}
float separable(int mode, float cb, float cs) {
  if (mode == 1) return cb * cs;
  if (mode == 2) return cb + cs - cb * cs;
  if (mode == 3) return hardLight(cs, cb);          // overlay = hard-light with the layers swapped
  if (mode == 4) return min(cb, cs);
  if (mode == 5) return max(cb, cs);
  if (mode == 6) return dodge(cb, cs);
  if (mode == 7) return burn(cb, cs);
  if (mode == 8) return hardLight(cb, cs);
  if (mode == 9) return softLight(cb, cs);
  if (mode == 10) return abs(cb - cs);
  if (mode == 11) return cb + cs - 2.0 * cb * cs;
  return cs;                                         // normal
}

// ---- non-separable (HSL) blend functions ----
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 setSat(vec3 c, float s) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  return mx > mn ? (c - mn) * s / (mx - mn) : vec3(0.0);
}

vec3 blendFn(vec3 cb, vec3 cs) {
  if (uMode == 12) return setLum(setSat(cs, sat(cb)), lum(cb));   // hue
  if (uMode == 13) return setLum(setSat(cb, sat(cs)), lum(cb));   // saturation
  if (uMode == 14) return setLum(cs, lum(cb));                     // color
  if (uMode == 15) return setLum(cb, lum(cs));                     // luminosity
  return vec3(separable(uMode, cb.r, cs.r), separable(uMode, cb.g, cs.g), separable(uMode, cb.b, cs.b));
}

void main() {
  vec4 b = texture(uBackdrop, vUv);
  vec4 s = texture(uSource, vUv);
  float ab = b.a;
  float as = s.a * uOpacity;
  vec3 cb = ab > 0.0 ? b.rgb / ab : vec3(0.0);
  vec3 cs = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  float ar = as + ab * (1.0 - as);
  vec3 premultiplied = (1.0 - as) * ab * cb + (1.0 - ab) * as * cs + as * ab * blendFn(cb, cs);
  outColor = vec4(premultiplied, ar);
}`;

/** Adjustments run on straight colour and never change alpha. Mirrors applyAdjustment() in core. */
export const ADJUST_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uBackdrop;
uniform int uKind;        // 0 brightness/contrast, 1 exposure, 2 saturation
uniform vec2 uParams;
uniform float uOpacity;
in vec2 vUv;
out vec4 outColor;

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
  vec4 p = texture(uBackdrop, vUv);
  float a = p.a;
  vec3 c = a > 0.0 ? p.rgb / a : vec3(0.0);
  vec3 r = c;
  if (uKind == 0) {
    r = clamp((c - 0.5) * (1.0 + uParams.y) + 0.5 + uParams.x, 0.0, 1.0);
  } else if (uKind == 1) {
    r = clamp(toSrgb(clamp(toLinear(c) * exp2(uParams.x), 0.0, 1.0)), 0.0, 1.0);
  } else {
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    r = clamp(vec3(luma) + (c - luma) * (1.0 + uParams.x), 0.0, 1.0);
  }
  vec3 result = mix(c, r, uOpacity);
  outColor = vec4(result * a, a);
}`;

/** Final pass to the canvas: empty fill, and optional clipping to the document rectangle. */
export const FINAL_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform int uFill;           // 0 transparent, 1 checkerboard, 2 solid
uniform vec3 uColor;
uniform vec4 uDocRect;       // x0, y0, x1, y1 in output pixels, y down
uniform float uOutHeight;
uniform int uClip;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 px = vec2(gl_FragCoord.x, uOutHeight - gl_FragCoord.y);
  if (uClip == 1 && (px.x < uDocRect.x || px.y < uDocRect.y || px.x > uDocRect.z || px.y > uDocRect.w)) {
    outColor = vec4(0.0);
    return;
  }
  vec4 p = texture(uTex, vUv);
  if (uFill == 0) {
    outColor = p;
    return;
  }
  vec3 bg = uColor;
  if (uFill == 1) {
    vec2 cell = floor(px / 12.0);
    bg = mix(vec3(0.80), vec3(0.62), mod(cell.x + cell.y, 2.0));
  }
  outColor = vec4(p.rgb + (1.0 - p.a) * bg, 1.0);
}`;
