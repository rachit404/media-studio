// THROWAWAY: shared bench helpers (main thread + worker).
import { autoDetectRenderer, type WebGLRenderer } from 'pixi.js';
import { W, H, makeCanvases, buildScene, type SceneOpts, type Scene } from './scene';
import { VideoFeed } from './video';
import { createRaw } from './raw';

export const VIDEO_URL = '/fixtures/h264_1080p30_gop2s_60s.mp4';

export function pct(a: number[], p: number) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!; }
export function stats(a: number[]) { const r = (x: number) => Math.round(x * 100) / 100; return { n: a.length, mean: r(a.reduce((x, y) => x + y, 0) / a.length), p50: r(pct(a, 50)), p95: r(pct(a, 95)), p99: r(pct(a, 99)), max: r(Math.max(...a)) }; }

export async function makeRenderer(canvas: any): Promise<WebGLRenderer> {
  return (await autoDetectRenderer({ canvas, width: W, height: H, preference: 'webgl', antialias: false, resolution: 1, autoDensity: false, backgroundAlpha: 1, backgroundColor: 0x000000, useBackBuffer: true })) as WebGLRenderer;
}

export async function waitFrame(feed: VideoFeed) { while (!feed.frames.length) await new Promise(r => setTimeout(r, 5)); return feed.frames[0]!; }

export async function setup(canvas: any, sceneOpts: SceneOpts, video: boolean) {
  const renderer = await makeRenderer(canvas);
  const feed = video ? await VideoFeed.open(VIDEO_URL) : null;
  feed?.start();
  const first = feed ? await waitFrame(feed) : undefined;
  const scene = buildScene(makeCanvases(), sceneOpts, video, first);
  const px = new Uint8Array(4);
  const sync = () => (renderer as any).gl.readPixels(0, 0, 1, 1, (renderer as any).gl.RGBA, (renderer as any).gl.UNSIGNED_BYTE, px);
  return { renderer, feed, scene, sync, dispose() { feed?.stop(); scene.destroy(); renderer.destroy(); } };
}

export type Mode = 'finish' | 'videoframe' | 'readpixels';

/** Unpaced export-style loop (no rAF). Returns per-frame ms and total wall-clock fps. */
export async function unpacedPixi(canvas: any, sceneOpts: SceneOpts, video: boolean, frames: number, mode: Mode, warm = 20) {
  const s = await setup(canvas, sceneOpts, video);
  const gl = (s.renderer as any).gl as WebGL2RenderingContext;
  const buf = mode === 'readpixels' ? new Uint8Array(W * H * 4) : null;
  const per: number[] = [];
  let prev: VideoFrame | null = null;
  let t0 = 0;
  const total = frames + warm;
  for (let i = 0; i < total; i++) {
    if (i === warm) { s.sync(); t0 = performance.now(); }
    const a = performance.now();
    if (s.feed) { const f = await s.feed.next(); if (!f) break; s.scene.setVideoFrame(f); prev?.close(); prev = f; }
    s.scene.update(i / 30);
    s.renderer.render({ container: s.scene.root });
    if (mode === 'finish') s.sync();
    else if (mode === 'videoframe') { const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 33333) }); vf.close(); }
    else gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf!);
    if (i >= warm) per.push(performance.now() - a);
  }
  s.sync();
  const wall = performance.now() - t0;
  prev?.close();
  const n = per.length;
  s.dispose();
  return { mode, video, frames: n, wallMs: Math.round(wall), fps: Math.round((n / wall) * 1000 * 10) / 10, realtimeMultiple30: Math.round((n / wall) * 1000 / 30 * 100) / 100, perFrameMs: stats(per) };
}

export async function unpacedRaw(canvas: any, video: boolean, frames: number, warm = 20) {
  const canvases = makeCanvases();
  const feed = video ? await VideoFeed.open(VIDEO_URL) : null; feed?.start();
  if (feed) await waitFrame(feed);
  const r = createRaw(canvas, canvases, video);
  const per: number[] = []; let prev: VideoFrame | null = null; let t0 = 0;
  for (let i = 0; i < frames + warm; i++) {
    if (i === warm) { r.sync(); t0 = performance.now(); }
    const a = performance.now();
    if (feed) { const f = await feed.next(); if (!f) break; r.setVideoFrame(f); prev?.close(); prev = f; }
    r.render(i / 30); r.sync();
    if (i >= warm) per.push(performance.now() - a);
  }
  const wall = performance.now() - t0; prev?.close(); feed?.stop();
  const n = per.length;
  return { impl: 'raw-webgl2', video, frames: n, wallMs: Math.round(wall), fps: Math.round((n / wall) * 1000 * 10) / 10, perFrameMs: stats(per) };
}

/** Raw WebGL2 + readback to VideoFrame too (for like-for-like export numbers). */
export async function unpacedRawVF(canvas: any, video: boolean, frames: number, warm = 20) {
  const canvases = makeCanvases();
  const feed = video ? await VideoFeed.open(VIDEO_URL) : null; feed?.start();
  if (feed) await waitFrame(feed);
  const r = createRaw(canvas, canvases, video);
  const per: number[] = []; let prev: VideoFrame | null = null; let t0 = 0;
  for (let i = 0; i < frames + warm; i++) {
    if (i === warm) { r.sync(); t0 = performance.now(); }
    const a = performance.now();
    if (feed) { const f = await feed.next(); if (!f) break; r.setVideoFrame(f); prev?.close(); prev = f; }
    r.render(i / 30);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 33333) }); vf.close();
    if (i >= warm) per.push(performance.now() - a);
  }
  r.sync(); const wall = performance.now() - t0; prev?.close(); feed?.stop();
  const n = per.length;
  return { impl: 'raw-webgl2+videoframe', video, frames: n, wallMs: Math.round(wall), fps: Math.round((n / wall) * 1000 * 10) / 10, perFrameMs: stats(per) };
}
export type { Scene };
