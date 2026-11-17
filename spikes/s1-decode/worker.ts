// THROWAWAY S1 worker: Mediabunny demux + raw WebCodecs VideoDecoder.
import { Input, ALL_FORMATS, BlobSource, EncodedPacketSink, VideoSampleSink } from 'mediabunny';

type HW = 'prefer-hardware' | 'prefer-software' | 'no-preference';
const inputs = new Map<string, any>();

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
  o = { input, track, config, sink, duration, bytes: blob.size, blob };
  inputs.set(file, o);
  return o;
}

function pct(a: number[], p: number) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}
function stats(a: number[]) {
  return { n: a.length, p50: pct(a, 50), p95: pct(a, 95), max: Math.max(...a), mean: a.reduce((x, y) => x + y, 0) / a.length, min: Math.min(...a) };
}
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
const waitDequeue = (d: VideoDecoder) => new Promise<void>((r) => d.addEventListener('dequeue', () => r(), { once: true }));

async function configSupport(file: string) {
  const { config } = await open(file);
  const out: any = { codec: config.codec, coded: `${config.codedWidth}x${config.codedHeight}` };
  for (const hw of ['prefer-hardware', 'prefer-software'] as HW[]) {
    try { const s = await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration: hw }); out[hw] = s.supported; }
    catch (e: any) { out[hw] = 'error: ' + e.message; }
  }
  return out;
}

/** Sequential decode from pre-collected packets (pure decode time) with bounded queue; every frame closed. */
async function seq(file: string, hw: HW) {
  const { sink, config, duration } = await open(file);
  const cfg = { ...config, hardwareAcceleration: hw };
  const sup = await VideoDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!sup.supported) return { status: 'UNSUPPORTED', file, hw };
  const td = performance.now();
  const chunks: EncodedVideoChunk[] = [];
  for await (const p of sink.packets()) chunks.push(p.toEncodedVideoChunk());
  const demuxMs = performance.now() - td;
  let frames = 0, closed = 0, err: any = null, maxQueue = 0;
  const dec = new VideoDecoder({ output: (f) => { frames++; f.close(); closed++; }, error: (e) => (err = e) });
  dec.configure(cfg);
  const t0 = performance.now();
  for (const c of chunks) {
    while (dec.decodeQueueSize > 8 && !err) await waitDequeue(dec);
    maxQueue = Math.max(maxQueue, dec.decodeQueueSize);
    if (err) break;
    dec.decode(c);
  }
  if (!err) await dec.flush();
  const ms = performance.now() - t0;
  dec.close();
  if (err) return { status: 'ERROR', error: String(err), file, hw, frames };
  const fps = (frames / ms) * 1000;
  return { status: 'OK', file, hw, frames, packets: chunks.length, decodeMs: ms, demuxMs, fps, realtimeX: fps / (frames / duration), mediaDuration: duration, leak: frames - closed, maxQueue };
}

/** Mediabunny VideoSampleSink.samples() sequential: demux+decode streaming, closed every sample. */
async function seqMB(file: string, hw: HW) {
  const { track, duration } = await open(file);
  const s = new VideoSampleSink(track, { hardwareAcceleration: hw });
  let n = 0;
  const t0 = performance.now();
  for await (const smp of s.samples()) { n++; smp.close(); }
  const ms = performance.now() - t0;
  const fps = (n / ms) * 1000;
  return { status: 'OK', file, hw, frames: n, decodeMs: ms, fps, realtimeX: fps / (n / duration) };
}

/** Random seek, raw WebCodecs: keyframe lookup -> decode forward to target packet -> time at exact target frame output. Decoder reused (warm). */
async function seekRaw(file: string, hw: HW, n: number, seed: number) {
  const { sink, config, duration } = await open(file);
  const cfg = { ...config, hardwareAcceleration: hw };
  const sup = await VideoDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!sup.supported) return { status: 'UNSUPPORTED' };
  let targetTs = 0, hit: ((t: number) => void) | null = null, err: any = null, decodedFrames = 0, opened = 0, closed = 0;
  const dec = new VideoDecoder({
    output: (f) => { opened++; decodedFrames++; if (f.timestamp === targetTs && hit) { const h = hit; hit = null; h(performance.now()); } f.close(); closed++; },
    error: (e) => (err = e),
  });
  dec.configure(cfg);
  const rand = rng(seed);
  const fps = 30;
  const lat: number[] = [], pack: number[] = [], frames: number[] = [], breakdown: any[] = [];
  const total = n + 2; // 2 warmups discarded
  for (let i = 0; i < total; i++) {
    const t = Math.floor((1 + rand() * (duration - 2)) * fps) / fps;
    decodedFrames = 0;
    const t0 = performance.now();
    const target = (await sink.getPacket(t))!;
    const key = (await sink.getKeyPacket(t))!;
    targetTs = target.toEncodedVideoChunk().timestamp;
    const tFound = performance.now();
    const done = new Promise<number>((r) => (hit = r));
    let fed = 0;
    for await (const p of sink.packets(key)) {
      dec.decode(p.toEncodedVideoChunk()); fed++;
      if (p.timestamp === target.timestamp) break;
    }
    const flushP = dec.flush();
    const tHit = await Promise.race([done, flushP.then(() => -1)]);
    const t1 = tHit === -1 ? performance.now() : tHit;
    await flushP;
    if (err) return { status: 'ERROR', error: String(err) };
    if (i >= 2) { lat.push(t1 - t0); pack.push(fed); frames.push(decodedFrames); breakdown.push({ t, findMs: tFound - t0, totalMs: t1 - t0, fed }); }
  }
  dec.close();
  return { status: 'OK', file, hw, impl: 'raw WebCodecs, reused decoder', latencyMs: stats(lat), packetsDecodedPerSeek: stats(pack), leak: opened - closed, samples: breakdown };
}

/** Same, via Mediabunny VideoSampleSink.getSample (the library path an app would likely use). */
async function seekMB(file: string, hw: HW, n: number, seed: number) {
  const { track, duration } = await open(file);
  const s = new VideoSampleSink(track, { hardwareAcceleration: hw });
  const rand = rng(seed);
  const lat: number[] = [];
  for (let i = 0; i < n + 2; i++) {
    const t = Math.floor((1 + rand() * (duration - 2)) * 30) / 30;
    const t0 = performance.now();
    const smp = await s.getSample(t);
    const t1 = performance.now();
    if (!smp || Math.abs(smp.timestamp - t) > 1 / 60) return { status: 'WRONG_FRAME', want: t, got: smp?.timestamp };
    smp.close();
    if (i >= 2) lat.push(t1 - t0);
  }
  return { status: 'OK', file, hw, impl: 'mediabunny VideoSampleSink.getSample', latencyMs: stats(lat) };
}

/**
 * Seek optimisation: cache the decoded frames of the most recent keyframe interval (GOP). Scrub pattern = random walk
 * (step up to +/-stepSec) so most seeks land in the cached GOP. Compares uncached vs cached on the SAME timestamps.
 * Frames in the cache are VideoFrames (closed on GOP replacement). Reports peak cached frames (memory cost).
 */
async function seekGopCache(file: string, hw: HW, n: number, seed: number, stepSec: number) {
  const { sink, config, duration } = await open(file);
  const cfg = { ...config, hardwareAcceleration: hw };
  const sup = await VideoDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!sup.supported) return { status: 'UNSUPPORTED' };
  // NOTE: hardware decoders stall if >~8 VideoFrames are held (see holdTest), so the cache stores ImageBitmap copies.
  let err: any = null; let keep = false; let curTarget = -1; let collect: Promise<{ ts: number; b: ImageBitmap | VideoFrame }>[] = [];
  const dec = new VideoDecoder({
    output: (f) => {
      const ts = f.timestamp;
      if (keep) collect.push(createImageBitmap(f).then((b) => { f.close(); return { ts, b }; }));
      else if (ts === curTarget) collect.push(Promise.resolve({ ts, b: f }));
      else f.close();
    },
    error: (e) => (err = e),
  });
  dec.configure(cfg);
  const rand = rng(seed);
  const ts: number[] = []; let cur = duration / 2;
  for (let i = 0; i < n + 2; i++) { cur = Math.min(duration - 1, Math.max(1, cur + (rand() * 2 - 1) * stepSec)); ts.push(Math.floor(cur * 30) / 30); }
  let cache: Map<number, ImageBitmap> | null = null;
  let peak = 0, hits = 0;
  const latU: number[] = [], latC: number[] = [];
  async function decodeTo(t: number, keepGop: boolean) {
    const target = (await sink.getPacket(t))!; const key = (await sink.getKeyPacket(t))!;
    const targetTs = target.toEncodedVideoChunk().timestamp;
    keep = keepGop; curTarget = targetTs; collect = [];
    const nextKey = keepGop ? await sink.getNextKeyPacket(key) : null;
    for await (const p of sink.packets(key, nextKey ?? undefined)) {
      dec.decode(p.toEncodedVideoChunk());
      if (!keepGop && p.timestamp === target.timestamp) break;
    }
    const to = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('STALL: flush timeout')), 15000));
    await Promise.race([dec.flush(), to]);
    if (err) throw err;
    const got = await Promise.all(collect); collect = [];
    const frames = new Map<number, ImageBitmap>();
    let result: any = null;
    for (const g of got) {
      if (g.ts === targetTs) result = g.b;
      if (keepGop) frames.set(g.ts, g.b as ImageBitmap);
      else if (g.ts !== targetTs) (g.b as VideoFrame).close();
    }
    return { result, frames };
  }
  for (let i = 0; i < ts.length; i++) {
    const t0 = performance.now(); const r = await decodeTo(ts[i]!, false); const t1 = performance.now();
    if (!r.result) return { status: 'WRONG_FRAME' }; r.result.close(); if (i >= 2) latU.push(t1 - t0);
  }
  for (let i = 0; i < ts.length; i++) {
    const tUs = Math.round(ts[i]! * 1e6);
    const t0 = performance.now();
    let frame: any;
    if (cache) { for (const [k, f] of cache) if (Math.abs(k - tUs) < 1000) { frame = f; break; } }
    const isHit = !!frame;
    if (!frame) {
      const r = await decodeTo(ts[i]!, true);
      if (cache) for (const f of cache.values()) f.close();
      cache = r.frames; peak = Math.max(peak, r.frames.size);
      frame = r.result;
    }
    const t1 = performance.now();
    if (!frame) return { status: 'WRONG_FRAME' };
    if (i >= 2) { latC.push(t1 - t0); if (isHit) hits++; }
  }
  if (cache) for (const f of cache.values()) f.close();
  dec.close();
  return { status: 'OK', file, hw, stepSec, impl: 'GOP-interval cache (decode whole GOP to next keyframe, keep ImageBitmap copies)', uncachedMs: stats(latU), cachedMs: stats(latC), hitRate: hits / latC.length, peakCachedFrames: peak, approxBitmapMBperFrame: 1920 * 1080 * 4 / 1e6 };
}

/** How many un-closed VideoFrames can be held before the decoder stalls? (matters for any decoded-frame cache) */
async function holdTest(file: string, hw: HW) {
  const { sink, config } = await open(file);
  const cfg = { ...config, hardwareAcceleration: hw };
  const held: VideoFrame[] = []; let err: any = null;
  const dec = new VideoDecoder({ output: (f) => held.push(f), error: (e) => (err = e) });
  dec.configure(cfg);
  const chunks: EncodedVideoChunk[] = [];
  for await (const p of sink.packets()) { chunks.push(p.toEncodedVideoChunk()); if (chunks.length >= 400) break; }
  let fed = 0;
  for (const c of chunks) { dec.decode(c); fed++; }
  const flushed = await Promise.race([dec.flush().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 6000))]);
  const res = { hw, fed, heldFramesOutput: held.length, flushCompleted: flushed, err: err ? String(err) : null };
  for (const f of held) f.close();
  try { dec.close(); } catch {}
  return res;
}

/** Can decoded frames be copied out (ImageBitmap / copyTo) fast enough to keep the HW decoder flowing while retaining N copies? */
async function copyTest(file: string, hw: HW, mode: 'bitmap' | 'copyTo' | 'canvas', count: number) {
  const { sink, config } = await open(file);
  const cfg = { ...config, hardwareAcceleration: hw };
  let err: any = null; const pend: Promise<any>[] = []; const keep: any[] = []; let outN = 0;
  const oc = new OffscreenCanvas(1920, 1080); const ctx = oc.getContext('2d')!;
  const dec = new VideoDecoder({
    output: (f) => {
      outN++;
      if (mode === 'bitmap') pend.push(createImageBitmap(f).then((b) => { keep.push(b); f.close(); }));
      else if (mode === 'copyTo') { const buf = new ArrayBuffer(f.allocationSize()); pend.push(f.copyTo(buf).then(() => { keep.push(buf); f.close(); })); }
      else { ctx.drawImage(f, 0, 0); f.close(); }
    }, error: (e) => (err = e) });
  dec.configure(cfg);
  const t0 = performance.now(); let n = 0;
  for await (const p of sink.packets()) { dec.decode(p.toEncodedVideoChunk()); if (++n >= count) break; while (dec.decodeQueueSize > 8) await waitDequeue(dec); }
  const ok = await Promise.race([dec.flush().then(() => Promise.all(pend)).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 10000))]);
  const ms = performance.now() - t0;
  const res = { mode, hw, count, outputs: outN, retained: keep.length, completed: ok, ms, fps: count / ms * 1000, err: err ? String(err) : null };
  keep.forEach((k) => k.close?.()); try { dec.close(); } catch {}
  return res;
}

const handlers: Record<string, (m: any) => Promise<any>> = {
  hold: (m) => holdTest(m.file, m.hw),
  copy: (m) => copyTest(m.file, m.hw, m.mode, m.count),
  support: (m) => configSupport(m.file),
  seq: (m) => seq(m.file, m.hw),
  seqMB: (m) => seqMB(m.file, m.hw),
  seekRaw: (m) => seekRaw(m.file, m.hw, m.n ?? 30, m.seed ?? 1),
  seekMB: (m) => seekMB(m.file, m.hw, m.n ?? 30, m.seed ?? 1),
  seekGop: (m) => seekGopCache(m.file, m.hw, m.n ?? 30, m.seed ?? 1, m.stepSec ?? 1.5),
  info: async (m) => { const o = await open(m.file); const st = await o.track.computePacketStats(2000); return { duration: o.duration, bytes: o.bytes, codec: o.config.codec, w: o.track.codedWidth, h: o.track.codedHeight, packetStats: st }; },
};
self.onmessage = async (e) => {
  const { id, cmd } = e.data;
  try { self.postMessage({ id, result: await handlers[cmd]!(e.data) }); }
  catch (err: any) { self.postMessage({ id, error: String(err?.stack ?? err) }); }
};
