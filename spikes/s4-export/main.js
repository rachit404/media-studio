// S4 page: mixes audio with OfflineAudioContext (not available in workers), drives the export worker, verifies output.
import { Input, ALL_FORMATS, BlobSource, VideoSampleSink, AudioSampleSink } from 'mediabunny';

const audioCache = new Map();
async function mixAudio(seconds) {
  if (audioCache.has(seconds)) return audioCache.get(seconds);
  const t0 = performance.now();
  const ctx = new OfflineAudioContext(2, 48000 * seconds, 48000);
  const mk = (type, freq, gainVal, pan, lfoHz) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = gainVal;
    if (lfoHz) { const l = ctx.createOscillator(); l.frequency.value = lfoHz; const lg = ctx.createGain(); lg.gain.value = gainVal * 0.8; l.connect(lg).connect(g.gain); l.start(); }
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p).connect(ctx.destination); o.start();
  };
  mk('sine', 220, 0.2, -0.3, 0.5); mk('triangle', 330, 0.15, 0.4, 0.25); mk('sawtooth', 110, 0.06, 0, 1);
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0).slice(), R = buf.getChannelData(1).slice();
  const out = { audio: { L, R }, mixMs: performance.now() - t0 };
  audioCache.set(seconds, out); return out;
}

function newWorker() {
  const w = new Worker(new URL('./export-worker.js', import.meta.url), { type: 'module' });
  return new Promise((res, rej) => {
    w.onerror = (e) => rej(new Error('worker error ' + e.message));
    w.onmessage = (e) => { if (e.data.type === 'ready') res({ w, ready: e.data }); };
    w.postMessage({ type: 'ping' });
  });
}

// opts: see export-worker.js; plus cancelAtFraction (0..1) and mainStats.
window.runExport = async (opts) => {
  const seconds = opts.seconds ?? 60;
  const { audio, mixMs } = opts.noAudio ? { audio: null, mixMs: 0 } : await mixAudio(seconds);
  const { w, ready } = await newWorker();
  const mainHeap = []; const t00 = performance.now();
  const iv = setInterval(() => mainHeap.push({ tSec: +((performance.now() - t00) / 1000).toFixed(2), heap: performance.memory?.usedJSHeapSize ?? null }), 1000);
  const cancelFrame = opts.cancelAtFraction ? Math.floor(seconds * 30 * opts.cancelAtFraction) : null;
  let cancelSentAt = null;
  const result = await new Promise((resolve, reject) => {
    w.onerror = (e) => reject(new Error('worker error ' + e.message));
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress' && cancelFrame !== null && cancelSentAt === null && m.frame >= cancelFrame) {
        cancelSentAt = performance.timeOrigin + performance.now();
        w.postMessage({ type: 'cancel', tSent: cancelSentAt });
      } else if (m.type === 'done') { m.result.buffer = m.buffer; resolve(m.result); }
      else if (m.type === 'cancelled') { m.result.cancelAckAtMainMs = performance.timeOrigin + performance.now() - cancelSentAt; resolve(m.result); }
      else if (m.type === 'error') reject(new Error(m.error));
    };
    const tStartMain = performance.now();
    w.postMessage({ type: 'start', opts, audio }); // structured clone (audio cache stays usable); copy happens before the timed loop starts
    window.__tStartMain = tStartMain;
  });
  clearInterval(iv); w.terminate();
  result.audioMixMs = mixMs; result.mainHeap = mainHeap; result.workerReady = ready;
  window.__last = result;
  const buf = result.buffer; delete result.buffer;
  window.__lastBuffer = buf || null;
  return result;
};

async function sha256(blob) {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Re-open the produced file with Mediabunny and check it. run = result of runExport.
window.verifyOutput = async (run, { expectedSeconds = 60, fps = 30, W = 1920, H = 1080, decodeAll = true } = {}) => {
  const v = { checks: {} };
  let blob;
  if (run.fileName) { const root = await navigator.storage.getDirectory(); blob = await (await root.getFileHandle(run.fileName)).getFile(); }
  else blob = new Blob([window.__lastBuffer]);
  v.fileBytes = blob.size; v.sha256 = await sha256(blob);
  v.bitrateMbpsTotal = +(blob.size * 8 / expectedSeconds / 1e6).toFixed(3);
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    v.format = (await input.getFormat()).name;
    v.durationSec = await input.computeDuration();
    const vt = await input.getPrimaryVideoTrack(), at = await input.getPrimaryAudioTrack();
    v.video = { codec: await vt.getCodec(), codedWidth: await vt.getCodedWidth(), codedHeight: await vt.getCodedHeight() };
    const st = await vt.computePacketStats(); v.video.packetCount = st.packetCount; v.video.averageBitrateMbps = +(st.averageBitrate / 1e6).toFixed(3); v.video.avgPacketRate = st.averagePacketRate;
    v.audio = at ? { codec: await at.getCodec(), channels: await at.getNumberOfChannels(), sampleRate: await at.getSampleRate(), durationSec: await at.computeDuration() } : null;
    const sink = new VideoSampleSink(vt);
    const first = await sink.getSample(0); v.firstFrame = first ? { ts: first.timestamp, w: first.displayWidth, h: first.displayHeight } : null; first?.close();
    const lastTs = (expectedSeconds * fps - 1) / fps;
    const last = await sink.getSample(lastTs); v.lastFrame = last ? { ts: last.timestamp, w: last.displayWidth } : null; last?.close();
    if (decodeAll) {
      const t0 = performance.now(); let n = 0, maxErr = 0, prev = -1, mono = true;
      for await (const s of sink.samples()) { maxErr = Math.max(maxErr, Math.abs(s.timestamp - n / fps)); if (s.timestamp <= prev) mono = false; prev = s.timestamp; n++; s.close(); }
      v.decodedFrames = n; v.maxTimestampErrorSec = maxErr; v.timestampsMonotonic = mono; v.decodeAllMs = performance.now() - t0;
    }
    if (at) { const asink = new AudioSampleSink(at); const a0 = await asink.getSample(0); v.audioFirstSampleDecodable = !!a0; a0?.close?.(); }
    const c = v.checks;
    c.durationWithin0_1s = Math.abs(v.durationSec - expectedSeconds) <= 0.1;
    c.frameCount = (v.decodedFrames ?? v.video.packetCount) === expectedSeconds * fps;
    c.resolution = v.video.codedWidth === W && v.video.codedHeight === H;
    c.audioPresent = !!v.audio;
    c.firstLastDecodable = !!v.firstFrame && !!v.lastFrame && Math.abs(v.lastFrame.ts - lastTs) < 1e-4;
    c.timestampsExact = decodeAll ? v.maxTimestampErrorSec < 1e-5 && v.timestampsMonotonic : null;
    v.allPass = Object.values(c).every((x) => x !== false);
  } catch (e) { v.error = String(e && e.stack || e); v.allPass = false; }
  finally { input.dispose?.(); }
  return v;
};

window.opfsList = async () => { const root = await navigator.storage.getDirectory(); const n = []; for await (const [name] of root.entries()) n.push(name); return n; };
window.opfsClear = async () => { const root = await navigator.storage.getDirectory(); for (const n of await window.opfsList()) await root.removeEntry(n, { recursive: true }); };
window.__ready = true;
