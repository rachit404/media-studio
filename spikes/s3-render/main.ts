// THROWAWAY S3 page API: window.S3.* functions are driven by run.mjs (Playwright).
import { W, H, FULL, SIMPLE, type SceneOpts } from './scene';
import { setup, stats, unpacedPixi, unpacedRaw, unpacedRawVF, waitFrame, type Mode } from './bench';
import { VideoFeed } from './video';
import { runBlend } from './blend';
import { Sprite, Texture, ImageSource } from 'pixi.js';
import { VIDEO_URL } from './bench';

const host = document.getElementById('host')!;
function newCanvas() { const c = document.createElement('canvas'); c.width = W; c.height = H; host.appendChild(c); return c; }

async function rafCheck(seconds = 2) {
  const ts: number[] = [];
  await new Promise<void>(res => { const t0 = performance.now(); const f = (n: number) => { ts.push(n); if (n - t0 > seconds * 1000) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const d = ts.slice(1).map((v, i) => v - ts[i]!);
  return { hz: Math.round(1000 / (d.reduce((a, b) => a + b, 0) / d.length) * 10) / 10, intervals: stats(d), visibility: document.visibilityState };
}

async function interactive(seconds: number, video: boolean, sceneOpts: SceneOpts = FULL) {
  const canvas = newCanvas();
  const s = await setup(canvas, sceneOpts, video);
  const ts: number[] = [], cpu: number[] = [], uploads: number[] = [];
  let cur: VideoFrame | null = null; let start = 0; let firstMs = 0;
  const warm = 30;
  await new Promise<void>(res => {
    const frame = (now: number) => {
      if (!start) start = now;
      const t = (now - start) / 1000;
      const c0 = performance.now();
      if (s.feed) { const f = s.feed.take(t); if (f && f !== cur) { s.scene.setVideoFrame(f); cur = f; } }
      s.scene.update(t);
      s.renderer.render({ container: s.scene.root });
      const c1 = performance.now();
      if (ts.length === 0) firstMs = c1 - c0;
      cpu.push(c1 - c0); ts.push(now);
      if (t > seconds + warm / 60) res(); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const d = ts.slice(1).map((v, i) => v - ts[i]!).slice(warm);
  const cpuS = cpu.slice(warm + 1);
  const total = (ts[ts.length - 1]! - ts[warm]!) / 1000;
  const r = {
    video, frames: d.length, seconds: Math.round(total * 100) / 100,
    fps: Math.round((d.length / total) * 10) / 10,
    frameIntervalMs: stats(d), droppedOver33ms: d.filter(x => x > 33.4).length, over20ms: d.filter(x => x > 20).length, longest: Math.round(Math.max(...d) * 10) / 10,
    jsRenderCallMs: stats(cpuS), firstFrameMs: Math.round(firstMs * 10) / 10,
    videoFramesDecoded: s.feed?.decodedCount ?? null, visibility: document.visibilityState,
  };
  s.dispose(); canvas.remove();
  return r;
}

async function unpaced(video: boolean, sceneOpts: SceneOpts, frames: number, mode: Mode) {
  const canvas = newCanvas();
  try { return { sceneOpts, ...(await unpacedPixi(canvas, sceneOpts, video, frames, mode)) }; } finally { canvas.remove(); }
}
async function raw(video: boolean, frames: number, vf: boolean) {
  const canvas = newCanvas();
  try { return vf ? await unpacedRawVF(canvas, video, frames) : await unpacedRaw(canvas, video, frames); } finally { canvas.remove(); }
}

/** Per-frame cost of getting a decoded VideoFrame into a GL texture, several ways. */
async function uploadBench(n = 150) {
  const out: any = {};
  const sync = (gl: WebGL2RenderingContext, p: Uint8Array) => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
  const p4 = new Uint8Array(4);
  const run = async (name: string, fn: (f: VideoFrame, gl: WebGL2RenderingContext) => Promise<void> | void, pre?: (gl: WebGL2RenderingContext) => void) => {
    const canvas = newCanvas(); const gl = canvas.getContext('webgl2', { antialias: false })!;
    const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); pre?.(gl);
    const feed = await VideoFeed.open(VIDEO_URL); feed.start(); await waitFrame(feed);
    const per: number[] = []; let t0 = 0;
    for (let i = 0; i < n + 15; i++) {
      const f = await feed.next(); if (!f) break;
      if (i === 15) { sync(gl, p4); t0 = performance.now(); }
      const a = performance.now(); await fn(f, gl); sync(gl, p4); f.close();
      if (i >= 15) per.push(performance.now() - a);
    }
    const wall = performance.now() - t0; feed.stop(); canvas.remove();
    out[name] = { frames: per.length, uploadMs: stats(per), loopFps: Math.round((per.length / wall) * 1000) };
  };
  // decode-only (no GL): upper bound for decode throughput on main-thread-driven mediabunny
  {
    const feed = await VideoFeed.open(VIDEO_URL); feed.start(); await waitFrame(feed); let c = 0; const t0 = performance.now();
    for (;;) { const f = await feed.next(); if (!f) break; f.close(); if (++c >= n + 15) break; }
    out.decodeOnly = { frames: c, fps: Math.round((c / (performance.now() - t0)) * 1000) }; feed.stop();
  }
  await run('A_texSubImage2D(VideoFrame)', (f, gl) => gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, f as any));
  await run('B_createImageBitmap_then_texSubImage2D', async (f, gl) => { const bm = await createImageBitmap(f); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bm); bm.close(); });
  {
    const buf = new Uint8Array(W * H * 4);
    await run('C_copyTo_RGBA_then_texSubImage2D(ArrayBufferView)', async (f, gl) => { await f.copyTo(buf, { format: 'RGBA' }); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf); }, gl => gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false));
  }
  // D: through Pixi: ImageSource.resource = frame; update(); render a full-screen sprite
  {
    const canvas = newCanvas(); const s = await setup(canvas, SIMPLE, true);
    const src = new ImageSource({ resource: (await waitFrame(s.feed!)), width: W, height: H, autoGenerateMipmaps: false });
    const sp = new Sprite(new Texture({ source: src })); s.scene.root.removeChildren(); s.scene.root.addChild(sp);
    const per: number[] = []; let t0 = 0;
    for (let i = 0; i < n + 15; i++) {
      const f = await s.feed!.next(); if (!f) break;
      if (i === 15) { s.sync(); t0 = performance.now(); }
      const a = performance.now(); src.resource = f; src.update(); s.renderer.render({ container: s.scene.root }); s.sync();
      if (i === 40) { const cv = new OffscreenCanvas(W, H); const g2 = cv.getContext('2d')!; g2.drawImage(f, 0, 0); const gl = (s.renderer as any).gl as WebGL2RenderingContext; const pts = [[100, 100], [960, 540], [1700, 900], [500, 800]]; out.videoPixelCheck = pts.map(([x, y]) => { const c = Array.from(g2.getImageData(x!, y!, 1, 1).data.slice(0, 3)); const b = new Uint8Array(4); gl.readPixels(x!, H - 1 - y!, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return { x, y, cpu2d: c, pixi: Array.from(b.slice(0, 3)), maxDiff: Math.max(...c.map((v, k) => Math.abs(v - b[k]!))) }; }); }
      f.close();
      if (i >= 15) per.push(performance.now() - a);
    }
    const wall = performance.now() - t0;
    out['D_pixi_ImageSource.resource=frame+update+render1sprite'] = { frames: per.length, uploadMs: stats(per), loopFps: Math.round((per.length / wall) * 1000) };
    s.feed!.stop(); canvas.remove();
  }
  return out;
}

async function workerRun(frames: number, video: boolean) {
  const canvas = newCanvas(); const off = canvas.transferControlToOffscreen();
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const res = await new Promise<any>((resolve, reject) => { w.onmessage = e => resolve(e.data); w.onerror = e => reject(new Error('worker error: ' + e.message)); w.postMessage({ canvas: off, frames, video }, [off]); });
  w.terminate(); canvas.remove(); return res;
}

(window as any).S3 = { rafCheck, interactive, unpaced, raw, uploadBench, workerRun, blend: runBlend, FULL, SIMPLE };
document.getElementById('log')!.textContent = 'S3 ready';
