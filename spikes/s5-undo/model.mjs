// Document models, Zod schemas, workload generators, command appliers. Throwaway.
import { z } from 'zod';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (x) => Math.round(x * 100) / 100 + 0; // +0 normalises -0
const rint = (rng, n) => Math.floor(rng() * n);
const pick = (rng, a) => a[rint(rng, a.length)];
const hex = (rng) => Math.floor(rng() * 0xffffffff).toString(16).padStart(8, '0');
const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'softLight', 'difference'];
const EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

// ---------- Zod schemas ----------
const Keyframe = z.object({ t: z.number(), v: z.number(), ease: z.enum(EASES) });
const AnimProp = z.union([z.number(), z.array(Keyframe)]); // value | keyframes[]
const Adjustment = z.object({ type: z.enum(['levels', 'curves', 'hsl', 'blur']), amount: z.number(), enabled: z.boolean() });
export const LayerSchema = z.object({
  id: z.string(), name: z.string(), visible: z.boolean(), opacity: AnimProp,
  blendMode: z.enum(BLENDS),
  transform: z.object({ x: z.number(), y: z.number(), scaleX: z.number(), scaleY: z.number(), rotation: AnimProp }),
  maskId: z.string().optional(),
  adjustments: z.array(Adjustment),
});
export const ImageDocSchema = z.object({
  version: z.literal(1), id: z.string(), width: z.number(), height: z.number(), layers: z.array(LayerSchema),
});
export const ClipSchema = z.object({
  id: z.string(), trackId: z.string(), start: z.number(), duration: z.number(), sourceId: z.string(),
  in: z.number(), out: z.number(), speed: z.number(),
  properties: z.object({ opacity: AnimProp, volume: AnimProp, scale: AnimProp }),
  transition: z.object({ type: z.enum(['fade', 'wipe', 'slide']), duration: z.number() }).optional(),
});
export const VideoDocSchema = z.object({
  version: z.literal(1), id: z.string(), fps: z.number(),
  tracks: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['video', 'audio']) })),
  sources: z.array(z.object({ id: z.string(), name: z.string(), duration: z.number() })),
  clips: z.array(ClipSchema),
});
export const Schemas = { image: ImageDocSchema, video: VideoDocSchema };

// ---------- builders ----------
const mkKfs = (rng) => {
  const n = 2 + rint(rng, 3); const out = [];
  for (let i = 0; i < n; i++) out.push({ t: i * 2, v: r2(rng()), ease: pick(rng, EASES) });
  return out;
};
function mkLayer(rng, i) {
  const l = {
    id: 'lyr_' + hex(rng) + hex(rng), name: 'Layer ' + i, visible: rng() > 0.1,
    opacity: rng() < 0.1 ? mkKfs(rng) : r2(rng()), blendMode: pick(rng, BLENDS),
    transform: { x: r2(rng() * 4000), y: r2(rng() * 3000), scaleX: r2(0.5 + rng()), scaleY: r2(0.5 + rng()), rotation: rng() < 0.1 ? mkKfs(rng) : r2(rng() * 360) },
    adjustments: Array.from({ length: rint(rng, 4) }, () => ({ type: pick(rng, ['levels', 'curves', 'hsl', 'blur']), amount: r2(rng()), enabled: rng() > 0.2 })),
  };
  if (rng() < 0.2) l.maskId = 'mask_' + hex(rng);
  return l;
}
export function buildImageDoc(nLayers = 1000, seed = 42) {
  const rng = mulberry32(seed);
  return { version: 1, id: 'doc_' + hex(rng), width: 4000, height: 3000, layers: Array.from({ length: nLayers }, (_, i) => mkLayer(rng, i)) };
}
function mkClip(rng, tracks, sources, start) {
  const dur = r2(0.5 + rng() * 9); const speed = pick(rng, [0.5, 1, 1, 1, 2]); const inn = r2(rng() * 20);
  const c = {
    id: 'clip_' + hex(rng) + hex(rng), trackId: pick(rng, tracks).id, start: r2(start), duration: dur,
    sourceId: pick(rng, sources).id, in: inn, out: r2(inn + dur * speed), speed,
    properties: { opacity: rng() < 0.1 ? mkKfs(rng) : 1, volume: rng() < 0.1 ? mkKfs(rng) : r2(rng()), scale: 1 },
  };
  if (rng() < 0.3) c.transition = { type: pick(rng, ['fade', 'wipe', 'slide']), duration: r2(0.2 + rng()) };
  return c;
}
export function buildVideoDoc(nClips = 2000, seed = 43) {
  const rng = mulberry32(seed);
  const tracks = Array.from({ length: 8 }, (_, i) => ({ id: 'trk_' + i, name: (i < 5 ? 'V' : 'A') + (i + 1), kind: i < 5 ? 'video' : 'audio' }));
  const sources = Array.from({ length: 60 }, (_, i) => ({ id: 'src_' + i, name: 'clip' + i + '.mp4', duration: r2(30 + rng() * 300) }));
  const cursor = {}; const clips = [];
  for (let i = 0; i < nClips; i++) {
    const c = mkClip(rng, tracks, sources, 0);
    c.start = r2(cursor[c.trackId] || 0); cursor[c.trackId] = c.start + c.duration; clips.push(c);
  }
  return { version: 1, id: 'doc_' + hex(rng), fps: 30, tracks, sources, clips };
}

// ---------- appliers (work on Immer drafts AND plain objects) ----------
function setAnim(o, k, v, t) { // slider drag / nudge semantics
  const cur = o[k];
  if (typeof cur === 'number') { o[k] = v; return; }
  const kf = cur.find((x) => x.t === t);
  if (kf) kf.v = v; else { cur.push({ t, v, ease: 'linear' }); cur.sort((a, b) => a.t - b.t); }
}
function addKf(o, k, v, t) {
  const cur = o[k];
  if (typeof cur === 'number') o[k] = [{ t: 0, v: cur, ease: 'linear' }, { t, v, ease: 'linear' }];
  else setAnim(o, k, v, t);
}
export function applyImage(d, s) {
  switch (s.type) {
    case 'move': { const t = d.layers[s.idx].transform; t.x += s.dx; t.y += s.dy; break; }
    case 'opacity': setAnim(d.layers[s.idx], 'opacity', s.v, s.t); break;
    case 'addLayer': d.layers.splice(s.idx, 0, s.layer); break;
    case 'removeLayer': d.layers.splice(s.idx, 1); break;
    case 'reorder': { const [x] = d.layers.splice(s.idx, 1); d.layers.splice(s.to, 0, x); break; }
    case 'rename': d.layers[s.idx].name = s.name; break;
    case 'blend': d.layers[s.idx].blendMode = s.mode; break;
    case 'addKeyframe': {
      const l = d.layers[s.idx];
      if (s.prop === 'opacity') addKf(l, 'opacity', s.v, s.t); else addKf(l.transform, 'rotation', s.v, s.t);
      break;
    }
    default: throw new Error('bad spec ' + s.type);
  }
}
export function applyVideo(d, s) {
  switch (s.type) {
    case 'move': d.clips[s.idx].start = Math.max(0, r2(d.clips[s.idx].start + s.dx)); break;
    case 'opacity': setAnim(d.clips[s.idx].properties, 'opacity', s.v, s.t); break;
    case 'split': {
      const c = d.clips[s.idx]; c.duration = s.d1; c.out = s.out1;
      if (c.transition) delete c.transition;
      d.clips.splice(s.idx + 1, 0, s.newClip); break;
    }
    case 'trim': { const c = d.clips[s.idx]; c.out = r2(c.out + s.dOut); c.duration = r2(c.duration + s.dOut / c.speed); break; }
    case 'rippleDelete': {
      for (const j of s.shift) d.clips[j].start = r2(d.clips[j].start - s.dur);
      d.clips.splice(s.idx, 1); break;
    }
    case 'addClip': d.clips.push(s.clip); break;
    case 'addKeyframe': addKf(d.clips[s.idx].properties, s.prop, s.v, s.t); break;
    default: throw new Error('bad spec ' + s.type);
  }
}
export const appliers = { image: applyImage, video: applyVideo };

// ---------- workload generators (spec = plain data, shared by all implementations) ----------
export function imageGen(state, rng, ctx) {
  if (ctx.burst && ctx.burst.left > 0) { ctx.burst.left--; return ctx.burst.next(); }
  const L = state.layers; const n = L.length;
  const mkSpec = (type) => {
    switch (type) {
      case 'opacityBurst': case 'nudgeBurst': {
        const idx = rint(rng, n); const id = L[idx].id; const t = rint(rng, 5) * 2;
        if (type === 'opacityBurst') { ctx.burst = { left: 19, next: () => ({ type: 'opacity', idx, id, key: 'opacity:' + id, v: r2(rng()), t }) }; return { type: 'opacity', idx, id, key: 'opacity:' + id, v: r2(rng()), t }; }
        const dx = rint(rng, 5) - 2, dy = rint(rng, 5) - 2;
        ctx.burst = { left: 9, next: () => ({ type: 'move', idx, id, key: 'move:' + id, dx, dy }) }; return { type: 'move', idx, id, key: 'move:' + id, dx, dy };
      }
      case 'move': { const idx = rint(rng, n); return { type: 'move', idx, id: L[idx].id, dx: rint(rng, 200) - 100, dy: rint(rng, 200) - 100 }; }
      case 'addLayer': return { type: 'addLayer', idx: rint(rng, n + 1), layer: mkLayer(rng, ctx.n++) };
      case 'removeLayer': return { type: 'removeLayer', idx: rint(rng, n) };
      case 'reorder': return { type: 'reorder', idx: rint(rng, n), to: rint(rng, n - 1) };
      case 'rename': return { type: 'rename', idx: rint(rng, n), name: 'Renamed ' + hex(rng) };
      case 'blend': return { type: 'blend', idx: rint(rng, n), mode: pick(rng, BLENDS) };
      case 'addKeyframe': return { type: 'addKeyframe', idx: rint(rng, n), prop: pick(rng, ['opacity', 'rotation']), t: 1 + rint(rng, 9), v: r2(rng()) };
    }
  };
  if (n > 1000) return mkSpec('removeLayer');
  if (n < 950) return mkSpec('addLayer');
  const W = [['opacityBurst', 3], ['nudgeBurst', 3], ['move', 10], ['addLayer', 3], ['removeLayer', 3], ['reorder', 3], ['rename', 5], ['blend', 2], ['addKeyframe', 5]];
  let x = rng() * W.reduce((a, b) => a + b[1], 0);
  for (const [t, w] of W) { if ((x -= w) < 0) return mkSpec(t); }
  return mkSpec('rename');
}
export function videoGen(state, rng, ctx) {
  if (ctx.burst && ctx.burst.left > 0) { ctx.burst.left--; return ctx.burst.next(); }
  const C = state.clips; const n = C.length;
  const mkSpec = (type) => {
    const idx = rint(rng, n); const c = C[idx];
    switch (type) {
      case 'opacityBurst': { const t = rint(rng, 5) * 2; const id = c.id; ctx.burst = { left: 19, next: () => ({ type: 'opacity', idx, id, key: 'opacity:' + id, v: r2(rng()), t }) }; return { type: 'opacity', idx, id, key: 'opacity:' + id, v: r2(rng()), t }; }
      case 'moveBurst': { const id = c.id; const dx = r2((rng() - 0.5) * 0.4); ctx.burst = { left: 9, next: () => ({ type: 'move', idx, id, key: 'move:' + id, dx }) }; return { type: 'move', idx, id, key: 'move:' + id, dx }; }
      case 'trimBurst': {
        const id = c.id; const dOut = r2((rng() - 0.5) * 0.2 * c.speed); const ok = c.duration + dOut / c.speed > 0.5;
        const s = () => ({ type: 'trim', idx, id, key: 'trim:' + id, dOut: ok ? dOut : 0 }); ctx.burst = { left: 7, next: s }; return s();
      }
      case 'split': {
        if (c.duration < 1) return mkSpec('moveBurst');
        const d1 = r2(c.duration / 2); const out1 = r2(c.in + d1 * c.speed);
        const nc = structuredClone(c); nc.id = 'clip_' + hex(rng) + hex(rng); nc.start = r2(c.start + d1); nc.duration = r2(c.duration - d1); nc.in = out1;
        return { type: 'split', idx, d1, out1, newClip: nc };
      }
      case 'rippleDelete': {
        const shift = []; for (let j = 0; j < n; j++) if (C[j].trackId === c.trackId && C[j].start > c.start) shift.push(j);
        return { type: 'rippleDelete', idx, dur: c.duration, shift };
      }
      case 'addClip': { const nc = mkClip(rng, state.tracks, state.sources, rng() * 600); nc.id = 'clip_' + (ctx.n++) + '_' + hex(rng); return { type: 'addClip', clip: nc }; }
      case 'addKeyframe': return { type: 'addKeyframe', idx, prop: pick(rng, ['opacity', 'volume', 'scale']), t: 1 + rint(rng, 9), v: r2(rng()) };
    }
  };
  if (n > 2050) return mkSpec('rippleDelete');
  if (n < 1950) return mkSpec(rng() < 0.5 ? 'addClip' : 'split');
  const W = [['opacityBurst', 2], ['moveBurst', 3], ['trimBurst', 3], ['split', 3], ['rippleDelete', 3], ['addClip', 2], ['addKeyframe', 4]];
  let x = rng() * W.reduce((a, b) => a + b[1], 0);
  for (const [t, w] of W) { if ((x -= w) < 0) return mkSpec(t); }
  return mkSpec('addKeyframe');
}
export const gens = { image: imageGen, video: videoGen };
