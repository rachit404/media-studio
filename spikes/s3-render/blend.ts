// THROWAWAY: blend-math + adjustment-layer (filtered container) correctness vs W3C compositing formulas (non-premultiplied sRGB-encoded values).
import 'pixi.js/advanced-blend-modes';
import { autoDetectRenderer, Container, Sprite, Texture, ColorMatrixFilter, type WebGLRenderer } from 'pixi.js';

type RGB = [number, number, number];
const CELL = 8, COLS = 20, SIZE = CELL * COLS;
const MODES = ['normal', 'multiply', 'screen', 'overlay'] as const;
type Mode = (typeof MODES)[number];

function B(mode: Mode, cb: number, cs: number) {
  switch (mode) {
    case 'normal': return cs;
    case 'multiply': return cb * cs;
    case 'screen': return cb + cs - cb * cs;
    case 'overlay': return cb <= 0.5 ? cs * 2 * cb : cs + (2 * cb - 1) - cs * (2 * cb - 1); // hard-light with backdrop/source swapped
  }
}
/** Opaque backdrop: Cr = (1-as)*Cb + as*B(Cb,Cs) */
export function expected(mode: Mode, cb: RGB, cs: RGB, a: number): RGB {
  return cb.map((b, i) => 255 * ((1 - a) * (b / 255) + a * B(mode, b / 255, cs[i]! / 255))) as RGB;
}
const hex = (c: RGB) => (c[0] << 16) | (c[1] << 8) | c[2];

function rect(x: number, y: number, w: number, h: number, c: RGB, a = 1, mode: Mode = 'normal', tex: Texture = Texture.WHITE) {
  const s = new Sprite(tex); s.position.set(x, y); s.width = w; s.height = h; if (tex === Texture.WHITE) s.tint = hex(c); s.alpha = a; s.blendMode = mode; return s;
}
function read(r: WebGLRenderer): Uint8Array {
  const gl = (r as any).gl as WebGL2RenderingContext; const buf = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, buf); return buf;
}
function px(buf: Uint8Array, x: number, y: number): RGB { const o = ((SIZE - 1 - y) * SIZE + x) * 4; return [buf[o]!, buf[o + 1]!, buf[o + 2]!]; }
const cellXY = (i: number) => ({ x: (i % COLS) * CELL, y: Math.floor(i / COLS) * CELL });
const err = (a: RGB, b: RGB) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

export async function runBlend() {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const renderer = (await autoDetectRenderer({ canvas: canvas as any, width: SIZE, height: SIZE, preference: 'webgl', antialias: false, resolution: 1, autoDensity: false, backgroundAlpha: 1, backgroundColor: 0x000000, useBackBuffer: true })) as WebGLRenderer;
  const out: any = { rendererType: renderer.name, solid: {}, texture: {}, adjustment: {} };

  // --- 1. solid colour sprites with alpha + tint ---
  const backdrops: RGB[] = [[200, 100, 50], [40, 180, 220], [128, 128, 128], [255, 0, 128], [10, 10, 10]];
  const sources: RGB[] = [[255, 255, 255], [30, 60, 200], [128, 128, 128], [240, 200, 20], [0, 0, 0]];
  const alphas = [1, 0.75, 0.5, 0.25];
  {
    const root = new Container(); const cases: { mode: Mode; cb: RGB; cs: RGB; a: number }[] = [];
    for (const mode of MODES) for (const cb of backdrops) for (const cs of sources) for (const a of alphas) cases.push({ mode, cb, cs, a });
    cases.forEach((c, i) => { const { x, y } = cellXY(i); root.addChild(rect(x, y, CELL, CELL, c.cb)); root.addChild(rect(x, y, CELL, CELL, c.cs, c.a, c.mode)); });
    // 400 cells exactly fill the 20x20 grid
    renderer.render({ container: root }); const buf = read(renderer);
    const per: Record<string, { max: number; sum: number; n: number; worst?: any }> = {};
    cases.forEach((c, i) => {
      const { x, y } = cellXY(i); const got = px(buf, x + 4, y + 4); const exp = expected(c.mode, c.cb, c.cs, c.a); const e = err(got, exp);
      const p = (per[c.mode] ??= { max: 0, sum: 0, n: 0 }); p.sum += e; p.n++; if (c.mode === 'overlay') (out.overlayDetail ??= []).push({ cb: c.cb, cs: c.cs, a: c.a, got, exp: exp.map(v => Math.round(v)), e: Math.round(e) });
      if (e > p.max) { p.max = e; p.worst = { ...c, got, expected: exp.map(v => Math.round(v * 10) / 10) }; }
    });
    for (const k of Object.keys(per)) { const p = per[k]!; out.solid[k] = { cases: p.n, maxErr: Math.round(p.max * 100) / 100, meanErr: Math.round((p.sum / p.n) * 100) / 100, worst: p.worst }; }
    root.destroy({ children: true });
  }

  // --- 2. texture with canvas alpha (premultiply-on-upload precision) ---
  {
    const cols: RGB[] = [[255, 0, 0], [30, 160, 90]]; const bds: RGB[] = [[200, 100, 50], [40, 180, 220]]; const ks = [128, 64, 26, 8]; // alpha = k/255
    const root = new Container(); const cases: any[] = [];
    for (const mode of MODES) for (const cs of cols) for (const cb of bds) for (const k of ks) cases.push({ mode, cs, cb, k });
    const texs: Texture[] = [];
    cases.forEach((c, i) => {
      const { x, y } = cellXY(i); const cv = new OffscreenCanvas(CELL, CELL); const g = cv.getContext('2d')!; g.fillStyle = `rgba(${c.cs.join(',')},${c.k / 255})`; g.fillRect(0, 0, CELL, CELL);
      const t = Texture.from(cv); texs.push(t);
      root.addChild(rect(x, y, CELL, CELL, c.cb)); root.addChild(rect(x, y, CELL, CELL, [0, 0, 0], 1, c.mode, t));
    });
    renderer.render({ container: root }); const buf = read(renderer);
    const per: Record<string, { max: number; worst?: any }> = {};
    cases.forEach((c, i) => {
      const { x, y } = cellXY(i); const got = px(buf, x + 4, y + 4); const exp = expected(c.mode, c.cb, c.cs, c.k / 255); const e = err(got, exp);
      const p = (per[c.mode] ??= { max: 0 });
      if (e > p.max) { p.max = e; p.worst = { ...c, got, expected: exp.map((v: number) => Math.round(v * 10) / 10) }; }
    });
    for (const k of Object.keys(per)) out.texture[k] = { cases: ks.length * cols.length * bds.length, maxErr: Math.round(per[k]!.max * 100) / 100, worst: per[k]!.worst };
    root.destroy({ children: true }); texs.forEach(t => t.destroy(true));
  }

  // --- 3. adjustment-layer semantics (filter on a Container) ---
  {
    const root = new Container(); const adj = out.adjustment;
    const cell = (cx: number, cy: number) => ({ x: cx * 32, y: cy * 32 });
    const Ya: RGB = [200, 120, 40], Yb: RGB = [180, 90, 220], Yc: RGB = [60, 200, 100], Cb: RGB = [200, 100, 50], Cs: RGB = [30, 160, 220];
    const mk = (b: number, id = false) => { const f = new ColorMatrixFilter(); if (!id) f.brightness(b, false); return f; };
    // row 0: outside | filtered container (brightness .5) | outside
    { const a = cell(0, 0), b = cell(1, 0), c = cell(2, 0);
      root.addChild(rect(a.x, a.y, 32, 32, Ya));
      const ct = new Container(); ct.addChild(rect(b.x, b.y, 32, 32, Yb)); ct.filters = [mk(0.5)]; root.addChild(ct);
      root.addChild(rect(c.x, c.y, 32, 32, Yc)); }
    // row 1: identity filter, semi-transparent child (a=.5) over backdrop  vs same without filter
    { const d = cell(0, 1), e = cell(1, 1);
      root.addChild(rect(d.x, d.y, 32, 32, Cb)); const ct = new Container(); ct.addChild(rect(d.x, d.y, 32, 32, Cs, 0.5)); ct.filters = [mk(1, true)]; root.addChild(ct);
      root.addChild(rect(e.x, e.y, 32, 32, Cb)); root.addChild(rect(e.x, e.y, 32, 32, Cs, 0.5)); }
    // row 2: multiply child inside filtered (identity) container, backdrop outside the container, vs plain multiply
    { const f = cell(0, 2), g = cell(1, 2);
      root.addChild(rect(f.x, f.y, 32, 32, Cb)); const ct = new Container(); ct.addChild(rect(f.x, f.y, 32, 32, Cs, 1, 'multiply')); ct.filters = [mk(1, true)]; root.addChild(ct);
      root.addChild(rect(g.x, g.y, 32, 32, Cb)); root.addChild(rect(g.x, g.y, 32, 32, Cs, 1, 'multiply')); }
    // row 3: brightness .5 filter on a container whose child is semi-transparent (premultiplication check)
    { const h = cell(0, 3);
      root.addChild(rect(h.x, h.y, 32, 32, Cb)); const ct = new Container(); ct.addChild(rect(h.x, h.y, 32, 32, Cs, 0.5)); ct.filters = [mk(0.5)]; root.addChild(ct); }
    renderer.render({ container: root }); const buf = read(renderer);
    const at = (c: { x: number; y: number }) => px(buf, c.x + 16, c.y + 16);
    const edge = (c: { x: number; y: number }, dx: number) => px(buf, c.x + dx, c.y + 16);
    adj.outsideBefore = { got: at(cell(0, 0)), expected: Ya, err: err(at(cell(0, 0)), Ya) };
    adj.filteredChild = { got: at(cell(1, 0)), expected: Yb.map(v => v * 0.5), err: err(at(cell(1, 0)), Yb.map(v => v * 0.5) as RGB) };
    adj.outsideAfter = { got: at(cell(2, 0)), expected: Yc, err: err(at(cell(2, 0)), Yc) };
    adj.edgeLeakLeft = { got: edge(cell(0, 0), 31), expected: Ya, err: err(edge(cell(0, 0), 31), Ya) };
    adj.edgeLeakRight = { got: edge(cell(2, 0), 0), expected: Yc, err: err(edge(cell(2, 0), 0), Yc) };
    const semiExp = expected('normal', Cb, Cs, 0.5);
    adj.identityFilterSemiAlpha = { withFilter: at(cell(0, 1)), withoutFilter: at(cell(1, 1)), w3cExpected: semiExp.map(v => Math.round(v * 10) / 10), errVsPlain: err(at(cell(0, 1)), at(cell(1, 1))), errVsW3C: err(at(cell(0, 1)), semiExp) };
    const mulExp = expected('multiply', Cb, Cs, 1);
    adj.multiplyInsideFilteredContainer = { insideFiltered: at(cell(0, 2)), plainMultiply: at(cell(1, 2)), passThroughExpected: mulExp.map(v => Math.round(v * 10) / 10), isolatedGroupExpected: Cs, note: 'if insideFiltered ~ passThrough then child blends with backdrop outside the container; if ~ Cs the filtered container is an isolated group' };
    const brExp = Cb.map((b, i) => 0.5 * b + 0.5 * 0.5 * Cs[i]!) as RGB;
    adj.brightnessFilterOnSemiAlphaChild = { got: at(cell(0, 3)), expected: brExp.map(v => Math.round(v * 10) / 10), err: err(at(cell(0, 3)), brExp) };
    root.destroy({ children: true });
  }
  renderer.destroy();
  const all = [...Object.values(out.solid), ...Object.values(out.texture)].map((v: any) => v.maxErr);
  out.solidMaxErr = Math.max(...Object.values(out.solid).map((v: any) => v.maxErr));
  out.textureMaxErr = Math.max(...Object.values(out.texture).map((v: any) => v.maxErr));
  out.overallMaxErr = Math.max(...all);
  return out;
}
