// THROWAWAY S3 spike: 8-layer 1920x1080 scene in PixiJS v8 (WebGL2). Environment-agnostic (main thread + worker).
import 'pixi.js/advanced-blend-modes';
import { Container, Sprite, Texture, ImageSource, Graphics, ColorMatrixFilter, BlurFilter } from 'pixi.js';

export const W = 1920, H = 1080;
export interface SceneOpts { filters: boolean; advanced: boolean; mask: boolean }
export const FULL: SceneOpts = { filters: true, advanced: true, mask: true };
export const SIMPLE: SceneOpts = { filters: false, advanced: false, mask: false };

export interface LayerDef { name: string; w: number; h: number; blend: 'normal' | 'multiply' | 'screen' | 'overlay'; draw: (g: OffscreenCanvasRenderingContext2D, w: number, h: number) => void }

function rnd(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export const LAYERS: LayerDef[] = [
  { name: 'bg-gradient', w: W, h: H, blend: 'normal', draw: (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#12326b'); gr.addColorStop(0.5, '#7a2f8f'); gr.addColorStop(1, '#e8a23a'); g.fillStyle = gr; g.fillRect(0, 0, w, h); } },
  { name: 'checker', w: 1600, h: 900, blend: 'normal', draw: (g, w, h) => { const r = rnd(1); for (let y = 0; y < h; y += 100) for (let x = 0; x < w; x += 100) { g.fillStyle = ((x + y) / 100) % 2 ? `rgba(${(r() * 255) | 0},${(r() * 255) | 0},200,0.65)` : 'rgba(255,255,255,0.15)'; g.fillRect(x, y, 100, 100); } } },
  { name: 'video', w: W, h: H, blend: 'normal', draw: (g, w, h) => { for (let x = 0; x < w; x += 160) { g.fillStyle = `hsl(${(x / w) * 360},70%,50%)`; g.fillRect(x, 0, 160, h); } } },
  { name: 'radial-multiply', w: 1200, h: 800, blend: 'multiply', draw: (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w / 2); gr.addColorStop(0, '#ffe08a'); gr.addColorStop(0.6, '#5aa0ff'); gr.addColorStop(1, 'rgba(60,60,180,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); } },
  { name: 'stripes-screen', w: 1400, h: 900, blend: 'screen', draw: (g, w, h) => { for (let i = 0; i < 30; i++) { g.fillStyle = `hsla(${i * 12},80%,${30 + (i % 3) * 15}%,0.8)`; g.fillRect(0, (i * h) / 30, w, h / 30); } } },
  { name: 'blobs-overlay-blur', w: 1300, h: 800, blend: 'overlay', draw: (g, w, h) => { const r = rnd(7); for (let i = 0; i < 40; i++) { g.fillStyle = `hsla(${(r() * 360) | 0},85%,55%,0.7)`; g.beginPath(); g.arc(r() * w, r() * h, 40 + r() * 140, 0, 7); g.fill(); } } },
  { name: 'rings-masked', w: 1000, h: 1000, blend: 'normal', draw: (g, w, h) => { for (let i = 0; i < 14; i++) { g.strokeStyle = i % 2 ? '#ffffff' : '#ff4466'; g.lineWidth = 22; g.beginPath(); g.arc(w / 2, h / 2, 40 + i * 33, 0, 7); g.stroke(); } } },
  { name: 'panel', w: 800, h: 500, blend: 'normal', draw: (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(20,200,160,0.9)'); gr.addColorStop(1, 'rgba(250,250,80,0.9)'); g.fillStyle = gr; g.beginPath(); g.roundRect(0, 0, w, h, 60); g.fill(); g.fillStyle = 'rgba(0,0,0,0.5)'; g.font = '120px sans-serif'; g.fillText('Media Studio', 60, 280); } },
];

export function makeCanvases(): OffscreenCanvas[] {
  return LAYERS.map(l => { const c = new OffscreenCanvas(l.w, l.h); l.draw(c.getContext('2d')!, l.w, l.h); return c; });
}

export interface Xf { x: number; y: number; rot: number; sx: number; alpha: number }
export function layerXf(i: number, t: number): Xf {
  if (i === 0) return { x: W / 2, y: H / 2, rot: 0, sx: 1.02 + 0.02 * Math.sin(t), alpha: 1 };
  if (i === 2) return { x: W / 2, y: H / 2, rot: 0, sx: 1.0 + 0.03 * Math.sin(t * 0.7), alpha: 1 };
  return { x: W / 2 + 500 * Math.cos(t * 0.7 + i), y: H / 2 + 250 * Math.sin(t * 0.9 + i * 1.3), rot: t * 0.3 * (i % 2 ? 1 : -1), sx: 0.8 + 0.2 * Math.sin(t + i), alpha: 0.7 + 0.3 * Math.sin(t * 0.5 + i) ** 2 };
}

export interface Scene { root: Container; update(t: number): void; setVideoFrame(f: VideoFrame): void; hasVideo: boolean; sprites: Sprite[]; destroy(): void }

export function buildScene(canvases: OffscreenCanvas[], opts: SceneOpts, withVideo: boolean, firstFrame?: VideoFrame): Scene {
  const root = new Container();
  const sprites: Sprite[] = [];
  let vsource: ImageSource | null = null;
  const textures: Texture[] = [];
  LAYERS.forEach((l, i) => {
    let tex: Texture;
    if (i === 2 && withVideo && firstFrame) {
      vsource = new ImageSource({ resource: firstFrame, width: W, height: H, autoGenerateMipmaps: false });
      tex = new Texture({ source: vsource });
    } else tex = Texture.from(canvases[i]!);
    textures.push(tex);
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.blendMode = (l.blend === 'overlay' && !opts.advanced) ? 'normal' : l.blend;
    sprites.push(s);
    root.addChild(s);
  });
  if (opts.filters) {
    const cm1 = new ColorMatrixFilter(); cm1.brightness(1.15, false); cm1.contrast(0.2, true);
    const cm2 = new ColorMatrixFilter(); cm2.brightness(1.1, false); cm2.saturate(0.4, true);
    sprites[1]!.filters = [cm1];
    sprites[2]!.filters = [cm2];
    sprites[5]!.filters = [new BlurFilter({ strength: 8, quality: 3 })];
  }
  let mask: Graphics | null = null;
  if (opts.mask) { mask = new Graphics().circle(0, 0, 380).fill(0xffffff); root.addChild(mask); sprites[6]!.mask = mask; }
  return {
    root, sprites, hasVideo: !!vsource,
    update(t) {
      sprites.forEach((s, i) => { const x = layerXf(i, t); s.position.set(x.x, x.y); s.rotation = x.rot; s.scale.set(x.sx); s.alpha = x.alpha; });
      if (mask) { mask.position.set(sprites[6]!.x, sprites[6]!.y); mask.scale.set(0.9 + 0.1 * Math.sin(t * 2)); }
    },
    setVideoFrame(f) { if (!vsource) return; vsource.resource = f; vsource.update(); },
    destroy() { root.destroy({ children: true }); textures.forEach(t => t.destroy(true)); },
  };
}
