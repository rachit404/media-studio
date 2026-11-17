// THROWAWAY S7 worker: frame-cache / leak simulation + proxy transcode.
import {
  Input, ALL_FORMATS, BlobSource, EncodedPacketSink, EncodedPacket, VideoSampleSink,
  Output, Mp4OutputFormat, BufferTarget, EncodedVideoPacketSource,
} from 'mediabunny';

type HW = 'prefer-hardware' | 'prefer-software' | 'no-preference';
const FPS = 30;
const inputs = new Map<string, any>();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const heapMB = () => ((performance as any).memory ? (performance as any).memory.usedJSHeapSize / 1048576 : null);
const waitDequeue = (d: any) => new Promise<void>((r) => d.addEventListener('dequeue', () => r(), { once: true }));
function pct(a: number[], p: number) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!; }
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

async function open(file: string) {
  let o = inputs.get(file);
  if (o) return o;
  const blob = await (await fetch(`/fixtures/${file}`)).blob();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no video track');
  const config = (await track.getDecoderConfig())!;
  const sink = new EncodedPacketSink(track);
  const duration = await input.computeDuration();
  o = { input, track, config, sink, duration };
  inputs.set(file, o);
  return o;
}

/** Counters for the leak check. 'created' = every VideoFrame/ImageBitmap we receive/make, 'closed' = every .close() we call. */
class Counters {
  vfCreated = 0; vfClosed = 0; bmCreated = 0; bmClosed = 0; maxOpenVF = 0; maxOpenBM = 0;
  get openVF() { return this.vfCreated - this.vfClosed; }
  get openBM() { return this.bmCreated - this.bmClosed; }
  vf() { this.vfCreated++; this.maxOpenVF = Math.max(this.maxOpenVF, this.openVF); }
  bm() { this.bmCreated++; this.maxOpenBM = Math.max(this.maxOpenBM, this.openBM); }
  closeVF(f: VideoFrame) { f.close(); this.vfClosed++; }
  closeBM(b: ImageBitmap) { b.close(); this.bmClosed++; }
}

/** LRU cache keyed by timeline frame number. Evicted entries are ALWAYS closed. */
class LruFrameCache {
  m = new Map<number, VideoFrame | ImageBitmap>();
  evictions = 0; hits = 0; misses = 0;
  constructor(public max: number, public c: Counters, public kind: 'bitmap' | 'videoframe') {}
  private closeOne(x: any) { this.kind === 'bitmap' ? this.c.closeBM(x) : this.c.closeVF(x); }
  get(k: number) { const v = this.m.get(k); if (!v) { this.misses++; return undefined; } this.m.delete(k); this.m.set(k, v); this.hits++; return v; }
  has(k: number) { return this.m.has(k); }
  set(k: number, v: VideoFrame | ImageBitmap) {
    const old = this.m.get(k); if (old) { this.m.delete(k); this.closeOne(old); }
    this.m.set(k, v);
    while (this.m.size > this.max) { const first = this.m.keys().next().value as number; const f = this.m.get(first)!; this.m.delete(first); this.closeOne(f); this.evictions++; }
  }
  clear() { for (const f of this.m.values()) this.closeOne(f); this.m.clear(); }
}

/**
 * Timeline playback simulation. 'clips' consecutive clips, each = clipSec of the same file starting at a different
 * (non keyframe aligned) in-point, played back at real time (wall clock). Decode runs ahead of the playhead by
 * min(cacheMax/2, 30) frames and is throttled; decoded frames go through the LRU cache and are consumed at playhead time.
 */
async function playback(p: { file: string; hw: HW; cacheMax: number; kind: 'bitmap' | 'videoframe'; clips: number; clipSec: number; label: string }) {
  const { sink, config, duration } = await open(p.file);
  const cfg = { ...config, hardwareAcceleration: p.hw };
  const c = new Counters();
  const cache = new LruFrameCache(p.cacheMax, c, p.kind);
  const clipFrames = Math.round(p.clipSec * FPS);
  const inF: number[] = [];
  for (let i = 0; i < p.clips; i++) inF.push(Math.round(((i * 7.3) % (duration - p.clipSec - 2)) * FPS) + 7); // +7 frames: never keyframe aligned
  const totalFrames = p.clips * clipFrames;
  const ahead = Math.min(Math.floor(p.cacheMax / 2), 30);
  const oc = new OffscreenCanvas(960, 540); const ctx = oc.getContext('2d')!;
  let playG = -1, frontierG = -1, running = true, err: any = null, curClip = 0, startedAt = 0;
  const pendingBitmaps = new Set<Promise<void>>();
  let producedDiscarded = 0, stallWaits = 0;
  const clipBase = (cl: number) => cl * clipFrames;

  const dec = new VideoDecoder({
    output: (f) => {
      c.vf();
      const mf = Math.round((f.timestamp / 1e6) * FPS);
      const cl = curClip; const rel = mf - inF[cl]!;
      if (rel < 0 || rel >= clipFrames || !running) { c.closeVF(f); producedDiscarded++; return; }
      const g = clipBase(cl) + rel;
      if (g < playG - 1) { c.closeVF(f); producedDiscarded++; return; } // already past
      frontierG = Math.max(frontierG, g);
      if (p.kind === 'videoframe') cache.set(g, f);
      else {
        c.bm();
        const pr: Promise<void> = createImageBitmap(f).then((b) => { c.closeVF(f); if (running) cache.set(g, b); else c.closeBM(b); }).finally(() => pendingBitmaps.delete(pr));
        pendingBitmaps.add(pr);
      }
    },
    error: (e) => (err = e),
  });
  dec.configure(cfg);
  const stallLog: any[] = [];
  const producer = (async () => {
    for (let cl = 0; cl < p.clips && running && !err; cl++) {
      curClip = cl;
      const startMF = inF[cl]!, endMF = startMF + clipFrames;
      const key = await sink.getKeyPacket(startMF / FPS + 0.001);
      if (!key) throw new Error('no key packet');
      let pastEnd = 0;
      for await (const pk of sink.packets(key)) {
        const mfp = Math.round(pk.timestamp * FPS);
        // throttle: stay at most 'ahead' frames in front of playhead (only for frames that are part of this clip)
        for (;;) {
          if (!running || err) break;
          const g = clipBase(cl) + (mfp - startMF);
          if (dec.decodeQueueSize <= 4 && (playG < 0 ? g < ahead : g - playG <= ahead)) break;
          stallWaits++; await sleep(2);
        }
        if (!running || err) break;
        dec.decode(pk.toEncodedVideoChunk());
        if (mfp >= endMF) { if (++pastEnd >= 4) break; } // B-frame reorder slack
      }
      if (running && !err) await Promise.race([dec.flush(), sleep(5000)]);
    }
  })().catch((e) => { err = e; });

  // wait for first frame, then start the realtime clock
  const tWait = performance.now();
  while (!cache.has(0) && !err && performance.now() - tWait < 10000) await sleep(2);
  const startupMs = performance.now() - tWait;
  startedAt = performance.now();
  const samples: any[] = [];
  const heapTimer = setInterval(() => samples.push({ tSec: +((performance.now() - startedAt) / 1000).toFixed(1), heapMB: heapMB(), cache: cache.m.size, openVF: c.openVF, openBM: c.openBM, playG }), 1000);
  let presented = 0; const missed: number[] = []; let lastG = -1;
  while (!err) {
    const g = Math.floor(((performance.now() - startedAt) / 1000) * FPS);
    if (g >= totalFrames) break;
    if (g !== lastG) {
      // every tick we skipped (event loop starved) counts as a miss too
      for (let k = lastG + 1; k <= g; k++) {
        playG = k;
        const fr = k === g ? cache.get(k) : undefined;
        if (fr) { ctx.drawImage(fr as any, 0, 0, 960, 540); presented++; } else missed.push(k);
      }
      lastG = g;
    }
    await sleep(3);
  }
  const wallSec = (performance.now() - startedAt) / 1000;
  running = false; clearInterval(heapTimer);
  await Promise.race([producer, sleep(3000)]);
  await Promise.all([...pendingBitmaps]);
  const cacheAtEnd = cache.m.size;
  cache.clear();
  try { dec.close(); } catch { /* ignore */ }
  const heaps = samples.map((s) => s.heapMB).filter((x) => x != null) as number[];
  // per-boundary misses: misses in the 15 ticks after each clip start (clip>0)
  const missSet = new Set(missed);
  const boundaryMiss: number[] = [];
  for (let cl = 1; cl < p.clips; cl++) { let m = 0; for (let k = 0; k < 15; k++) if (missSet.has(clipBase(cl) + k)) m++; boundaryMiss.push(m); }
  const half = Math.floor(heaps.length / 2);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    label: p.label, kind: p.kind, hw: p.hw, cacheMax: p.cacheMax, clips: p.clips, clipSec: p.clipSec, timelineFramesPlayed: totalFrames, wallSec, startupMs,
    presented, missed: missed.length, missedPct: (100 * missed.length) / totalFrames, boundaryMissTotal: boundaryMiss.reduce((a, b) => a + b, 0), boundaryMissPerClip: boundaryMiss,
    heapMB: { n: heaps.length, min: Math.min(...heaps), max: Math.max(...heaps), firstHalfAvg: avg(heaps.slice(0, half)), secondHalfAvg: avg(heaps.slice(half)), last: heaps[heaps.length - 1] },
    counters: { vfCreated: c.vfCreated, vfClosed: c.vfClosed, bmCreated: c.bmCreated, bmClosed: c.bmClosed, maxOpenVF: c.maxOpenVF, maxOpenBM: c.maxOpenBM, finalOpenVF: c.openVF, finalOpenBM: c.openBM },
    cache: { evictions: cache.evictions, hits: cache.hits, misses: cache.misses, sizeAtEnd: cacheAtEnd, discardedByDecoder: producedDiscarded, throttleWaits: stallWaits },
    error: err ? String(err) : null, samples,
  };
}

/** Fast scrubbing: random seek every 100 ms for durSec. Cache = LRU of ImageBitmaps (target frames only). New request cancels the in-flight one. */
async function scrub(p: { file: string; hw: HW; cacheMax: number; durSec: number; seed: number }) {
  const { sink, config, duration } = await open(p.file);
  const cfg = { ...config, hardwareAcceleration: p.hw };
  const c = new Counters();
  const cache = new LruFrameCache(p.cacheMax, c, 'bitmap');
  const rand = rng(p.seed);
  let epoch = 0, err: any = null, target = 0, hitCb: ((f: VideoFrame) => void) | null = null;
  const pendingBM = new Set<Promise<void>>();
  const dec = new VideoDecoder({
    output: (f) => { c.vf(); if (f.timestamp === target && hitCb) { const h = hitCb; hitCb = null; h(f); } else c.closeVF(f); },
    error: (e) => (err = e),
  });
  dec.configure(cfg);
  const lat: number[] = []; let superseded = 0, cacheHits = 0, requests = 0, failed = 0;
  const samples: any[] = []; const t00 = performance.now();
  const timer = setInterval(() => samples.push({ tSec: +((performance.now() - t00) / 1000).toFixed(1), heapMB: heapMB(), cache: cache.m.size, openVF: c.openVF, openBM: c.openBM }), 1000);
  async function seek(g: number, myEpoch: number) {
    const t0 = performance.now();
    const t = g / FPS;
    if (cache.get(g)) { cacheHits++; lat.push(0); return; }
    const tp = await sink.getPacket(t + 0.001); const key = await sink.getKeyPacket(t + 0.001);
    if (myEpoch !== epoch) { superseded++; return; }
    target = tp!.toEncodedVideoChunk().timestamp;
    const got = new Promise<VideoFrame>((r) => (hitCb = r));
    try { dec.reset(); dec.configure(cfg); } catch (e) { err = e; return; }
    let fed = 0;
    for await (const pk of sink.packets(key!)) {
      if (myEpoch !== epoch) { superseded++; hitCb = null; return; }
      while (dec.decodeQueueSize > 8) { await waitDequeue(dec); if (myEpoch !== epoch) { superseded++; return; } }
      dec.decode(pk.toEncodedVideoChunk()); fed++;
      if (pk.timestamp === tp!.timestamp) break;
    }
    dec.flush().catch(() => { /* aborted by a later reset() */ });
    const f = await Promise.race([got, sleep(3000).then(() => null)]);
    if (myEpoch !== epoch) { if (f) c.closeVF(f); superseded++; return; }
    if (!f) { failed++; return; }
    c.bm();
    const b = await createImageBitmap(f); c.closeVF(f);
    if (myEpoch !== epoch) { c.closeBM(b); superseded++; return; }
    cache.set(g, b);
    lat.push(performance.now() - t0);
  }
  const tEnd = performance.now() + p.durSec * 1000;
  let last: Promise<void> = Promise.resolve();
  while (performance.now() < tEnd && !err) {
    const g = Math.floor((1 + rand() * (duration - 2)) * FPS);
    requests++; epoch++;
    last = seek(g, epoch).catch((e) => { if (!String(e).includes('Abort')) err = e; });
    await sleep(100);
  }
  await last; // final request settles
  const settleOk = lat.length > 0;
  clearInterval(timer);
  epoch++; await sleep(50);
  cache.clear(); try { dec.close(); } catch { /* ignore */ }
  const heaps = samples.map((s) => s.heapMB).filter((x) => x != null) as number[];
  return {
    cacheMax: p.cacheMax, hw: p.hw, durSec: p.durSec, requests, completed: lat.length, superseded, failed, cacheHits,
    completedLatencyMs: { p50: pct(lat.filter((x) => x > 0), 50), p95: pct(lat.filter((x) => x > 0), 95), max: lat.length ? Math.max(...lat) : null },
    heapMB: heaps.length ? { min: Math.min(...heaps), max: Math.max(...heaps), last: heaps[heaps.length - 1] } : null,
    counters: { vfCreated: c.vfCreated, vfClosed: c.vfClosed, bmCreated: c.bmCreated, bmClosed: c.bmClosed, maxOpenVF: c.maxOpenVF, maxOpenBM: c.maxOpenBM, finalOpenVF: c.openVF, finalOpenBM: c.openBM },
    settleOk, error: err ? String(err) : null, samples,
  };
}

/** Proxy generation: decode -> resize to 960x540 (OffscreenCanvas) -> VideoEncoder (avc) -> Mediabunny MP4 -> verify by reopening. */
async function proxy(p: { file: string; decHw: HW; encHw: HW; bitrate: number; maxFrames?: number }) {
  const { sink, config, duration, track } = await open(p.file);
  const W = 960, H = 540;
  const encCfg: VideoEncoderConfig = { codec: 'avc1.64001f', width: W, height: H, bitrate: p.bitrate, framerate: FPS, hardwareAcceleration: p.encHw, avc: { format: 'avc' } } as any;
  const es = await VideoEncoder.isConfigSupported(encCfg).catch(() => ({ supported: false }));
  if (!es.supported) return { status: 'UNSUPPORTED_ENCODER', encHw: p.encHw };
  const dcfg = { ...config, hardwareAcceleration: p.decHw };
  const chunks: EncodedVideoChunk[] = [];
  for await (const pk of sink.packets()) { chunks.push(pk.toEncodedVideoChunk()); if (p.maxFrames && chunks.length >= p.maxFrames) break; }
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const src = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(src, { frameRate: FPS });
  await output.start();
  const oc = new OffscreenCanvas(W, H); const ctx = oc.getContext('2d')!;
  let err: any = null, decoded = 0, encoded = 0, outPackets = 0, addChain: Promise<void> = Promise.resolve();
  const c = new Counters();
  const enc = new VideoEncoder({
    output: (chunk, meta) => { outPackets++; const pk = EncodedPacket.fromEncodedChunk(chunk); addChain = addChain.then(() => src.add(pk, meta)); },
    error: (e) => (err = e),
  });
  enc.configure(encCfg);
  const dec = new VideoDecoder({
    output: (f) => {
      c.vf(); decoded++;
      ctx.drawImage(f, 0, 0, W, H);
      const small = new VideoFrame(oc, { timestamp: f.timestamp, duration: f.duration ?? Math.round(1e6 / FPS) });
      c.vf(); c.closeVF(f);
      enc.encode(small, { keyFrame: (decoded - 1) % 60 === 0 }); encoded++;
      c.closeVF(small);
    },
    error: (e) => (err = e),
  });
  dec.configure(dcfg);
  const t0 = performance.now();
  for (const ch of chunks) {
    while ((dec.decodeQueueSize > 6 || enc.encodeQueueSize > 6) && !err) { await sleep(1); }
    if (err) break;
    dec.decode(ch);
  }
  if (!err) { await dec.flush(); await enc.flush(); await addChain; }
  const ms = performance.now() - t0;
  if (err) return { status: 'ERROR', error: String(err) };
  await output.finalize();
  const buf = (output.target as BufferTarget).buffer!;
  // verify
  const vin = new Input({ source: new BlobSource(new Blob([buf])), formats: ALL_FORMATS });
  const vt = (await vin.getPrimaryVideoTrack())!;
  const vdur = await vin.computeDuration();
  const stats = await vt.computePacketStats(100000);
  let readable = 0; const vs = new VideoSampleSink(vt);
  for await (const s of vs.samples()) { readable++; s.close(); }
  const mediaSec = chunks.length / FPS;
  dec.close(); enc.close();
  return {
    status: 'OK', file: p.file, decHw: p.decHw, encHw: p.encHw, frames: decoded, ms, fps: (decoded / ms) * 1000, realtimeX: decoded / ms * 1000 / FPS, mediaSec, sourceDur: duration,
    srcSize: `${track.codedWidth}x${track.codedHeight}`, bitrate: p.bitrate, outBytes: buf.byteLength,
    verify: { codec: vt.codec, displayW: vt.displayWidth, displayH: vt.displayHeight, duration: vdur, packets: stats.packetCount, decodableFrames: readable },
    leakVF: c.openVF, maxOpenVF: c.maxOpenVF,
  };
}

export const handlers: Record<string, (m: any) => Promise<any>> = {
  playback: (m) => playback(m),
  scrub: (m) => scrub(m),
  proxy: (m) => proxy(m),
  heap: async () => ({ heapMB: heapMB(), hasMemoryApi: !!(performance as any).memory }),
};
if (typeof (globalThis as any).WorkerGlobalScope !== 'undefined') {
  self.onmessage = async (e) => {
    const { id, cmd } = e.data;
    try { self.postMessage({ id, result: await handlers[cmd]!(e.data) }); }
    catch (err: any) { self.postMessage({ id, error: String(err?.stack ?? err) }); }
  };
}
