// S4 export worker: synthetic timeline -> OffscreenCanvas -> VideoFrame -> VideoEncoder -> Mediabunny MP4.
// THROWAWAY spike code. Rendering is cheap 2D drawing on purpose: this measures the encode/mux side, not the compositor.
import { Output, Mp4OutputFormat, BufferTarget, StreamTarget, EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacket } from 'mediabunny';

const tNow = () => performance.timeOrigin + performance.now(); // comparable across page and worker
const heapNow = () => (performance.memory ? performance.memory.usedJSHeapSize : null);
const yieldMacro = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); r(); }; c.port2.postMessage(0); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cancelRequested = null; // { tRecv }
let cancelHook = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ping') self.postMessage({ type: 'ready', workerHasPerfMemory: !!performance.memory });
  else if (m.type === 'start') run(m.opts, m.audio).catch((err) => self.postMessage({ type: 'error', error: String(err && err.stack || err) }));
  else if (m.type === 'cancel') { cancelRequested = { tRecv: tNow(), tSent: m.tSent }; cancelHook && cancelHook(); }
};

function drawFrame(ctx, i, W, H) {
  const t = i / 30;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${(t * 12) % 360},70%,35%)`);
  g.addColorStop(0.5, `hsl(${(t * 12 + 120) % 360},60%,30%)`);
  g.addColorStop(1, `hsl(${(t * 12 + 240) % 360},70%,25%)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < 14; k++) {
    const x = W / 2 + Math.cos(t * 0.7 + k) * W * 0.38, y = H / 2 + Math.sin(t * 1.1 + k * 1.3) * H * 0.32;
    ctx.fillStyle = `hsla(${(k * 25 + t * 30) % 360},80%,60%,0.75)`;
    ctx.beginPath(); ctx.arc(x, y, 40 + 25 * Math.sin(t * 2 + k), 0, Math.PI * 2); ctx.fill();
  }
  for (let k = 0; k < 6; k++) {
    ctx.save(); ctx.translate(200 + k * 300, 200 + 120 * Math.sin(t + k)); ctx.rotate(t * (0.5 + k * 0.2));
    ctx.fillStyle = `hsla(${(k * 60) % 360},70%,70%,0.8)`; ctx.fillRect(-60, -40, 120, 80); ctx.restore();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(80, H - 220, 1100, 140);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 72px sans-serif'; ctx.fillText('Media Studio export spike', 110, H - 140);
  ctx.font = '48px monospace';
  ctx.fillText(`frame ${String(i).padStart(5, '0')}  t=${t.toFixed(3)}s`, 110, H - 95);
}

async function run(opts, audio) {
  const { W = 1920, H = 1080, fps = 30, seconds = 60, codec, hw, sink, audioCodec = 'mp4a.40.2', label = 'run',
    bitrate = 8_000_000, keyEvery = 60, maxQ = 6, maxMux = 40, maxWallMs = 110_000 } = opts;
  const N = seconds * fps;
  const res = { label, opts, frames: N, tracks: {}, cancel: null };
  const tStart = tNow();

  // --- frame ownership counters (leak detector) ---
  let created = 0, closed = 0, open = 0, maxOpen = 0;
  const makeFrame = (canvas, init) => { const f = new VideoFrame(canvas, init); created++; open++; if (open > maxOpen) maxOpen = open; return f; };
  const closeFrame = (f) => { f.close(); closed++; open--; };

  // --- output + target ---
  let target, writable = null, root = null, fileName = null;
  if (sink === 'opfs') {
    root = await navigator.storage.getDirectory();
    fileName = `s4-${label}.mp4`;
    const fh = await root.getFileHandle(fileName, { create: true });
    writable = await fh.createWritable();
    target = new StreamTarget(writable);
  } else target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const vCodecName = codec.startsWith('avc1') ? 'avc' : codec.startsWith('vp09') ? 'vp9' : codec.startsWith('av01') ? 'av1' : codec.startsWith('hvc1') || codec.startsWith('hev1') ? 'hevc' : 'vp8';
  const aCodecName = audioCodec === 'opus' ? 'opus' : 'aac';
  const vsrc = new EncodedVideoPacketSource(vCodecName);
  output.addVideoTrack(vsrc, { frameRate: fps });
  const asrc = audio ? new EncodedAudioPacketSource(aCodecName) : null;
  if (asrc) output.addAudioTrack(asrc);
  await output.start();

  // --- encoders ---
  let cancelled = false, cbAfterCancel = 0, encErr = null, vBytes = 0, vChunks = 0, aChunks = 0, aBytes = 0;
  let vq = Promise.resolve(), aq = Promise.resolve(), pendingMux = 0, maxPendingMux = 0, peakQ = 0, peakAQ = 0;
  let muxError = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => {
      if (cancelled) { cbAfterCancel++; return; }
      vChunks++; vBytes += chunk.byteLength; pendingMux++; if (pendingMux > maxPendingMux) maxPendingMux = pendingMux;
      const pkt = EncodedPacket.fromEncodedChunk(chunk);
      vq = vq.then(() => cancelled ? undefined : vsrc.add(pkt, meta)).then(() => { pendingMux--; }, (e) => { muxError = e; pendingMux--; });
    },
    error: (e) => { if (cancelled) cbAfterCancel++; else encErr = e; },
  });
  const vcfg = { codec, width: W, height: H, bitrate, framerate: fps, hardwareAcceleration: hw };
  if (codec.startsWith('avc1')) vcfg.avc = { format: 'avc' };
  const sup = await VideoEncoder.isConfigSupported(vcfg);
  if (!sup.supported) { self.postMessage({ type: 'error', error: 'video config unsupported ' + JSON.stringify(vcfg) }); return; }
  venc.configure(vcfg);

  let aenc = null;
  if (asrc) {
    aenc = new AudioEncoder({
      output: (chunk, meta) => {
        if (cancelled) { cbAfterCancel++; return; }
        aChunks++; aBytes += chunk.byteLength; pendingMux++;
        const pkt = EncodedPacket.fromEncodedChunk(chunk);
        aq = aq.then(() => cancelled ? undefined : asrc.add(pkt, meta)).then(() => { pendingMux--; }, (e) => { muxError = e; pendingMux--; });
      },
      error: (e) => { if (cancelled) cbAfterCancel++; else encErr = e; },
    });
    const acfg = { codec: audioCodec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 };
    if (audioCodec.startsWith('mp4a')) acfg.aac = { format: 'aac' };
    aenc.configure(acfg);
  }
  const feedAudio = (s) => {
    const n = 48000, data = new Float32Array(n * 2);
    data.set(audio.L.subarray(s * n, (s + 1) * n), 0); data.set(audio.R.subarray(s * n, (s + 1) * n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: s * 1e6, data });
    aenc.encode(ad); ad.close();
    if (aenc.encodeQueueSize > peakAQ) peakAQ = aenc.encodeQueueSize;
  };

  // --- cancel handler: close encoders, abort mux, delete partial file ---
  let loopExited; const loopDone = new Promise((r) => { loopExited = r; });
  let cancelStarted = false;
  cancelHook = async () => {
    if (cancelStarted || !cancelRequested) return; cancelStarted = true;
    cancelled = true;
    const tRecv = cancelRequested.tRecv;
    const c = { tSent: cancelRequested.tSent, msgLatencyMs: tRecv - cancelRequested.tSent, frameAtCancel: curFrame, openFramesAtCancel: open };
    try { venc.close(); } catch (e) { c.vencCloseErr = String(e); }
    try { aenc && aenc.close(); } catch (e) { c.aencCloseErr = String(e); }
    c.encodersClosedAfterMs = tNow() - tRecv; c.vencState = venc.state; c.aencState = aenc ? aenc.state : null;
    try { await output.cancel(); } catch (e) { c.outputCancelErr = String(e); }
    c.outputCancelledAfterMs = tNow() - tRecv;
    if (writable) {
      try { await writable.abort(); c.writableAbort = 'ok'; } catch (e) { c.writableAbort = 'err: ' + e.name; }
      try { await root.removeEntry(fileName); c.removeEntry = 'ok'; } catch (e) { c.removeEntry = 'err: ' + e.name + ' ' + e.message; }
    }
    await loopDone;
    c.cleanupDoneAfterMs = tNow() - tRecv; c.openFramesAfter = open; c.framesCreated = created; c.framesClosed = closed;
    // OPFS directory listing: any partial file left?
    if (root) { const names = []; for await (const [n] of root.entries()) names.push(n); c.opfsEntriesAfter = names; c.partialFileRemains = names.includes(fileName); }
    await sleep(1500); // watch for stray callbacks after cancel
    c.callbacksAfterCancel = cbAfterCancel; c.encoderErrorAfterCancel = !!encErr;
    res.cancel = c;
    res.cancelled = true;
    self.postMessage({ type: 'cancelled', result: res });
  };
  // a cancel that arrived before hook installation is handled at first yield below

  // --- main loop ---
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const heap = []; let lastHeapT = -1e9, curFrame = 0, renderMs = 0, frameMs = 0, aborted = false;
  const tLoop0 = tNow();
  const sampleHeap = (frame) => {
    const t = tNow();
    if (t - lastHeapT >= 1000) { lastHeapT = t; heap.push({ tSec: +((t - tLoop0) / 1000).toFixed(2), frame, heap: heapNow(), queue: venc.encodeQueueSize, openFrames: open, pendingMux }); }
  };
  let nextAudio = 0;
  try {
    for (let i = 0; i < N; i++) {
      curFrame = i;
      if (cancelStarted) break;
      if (i % fps === 0 && aenc) { while (nextAudio <= Math.min(i / fps + 1, seconds - 1)) feedAudio(nextAudio++); }
      if (tNow() - tLoop0 > maxWallMs) { aborted = true; break; }
      let guard = 0;
      while ((venc.encodeQueueSize > maxQ || pendingMux > maxMux) && !cancelStarted) {
        await Promise.race([new Promise((r) => venc.addEventListener('dequeue', r, { once: true })), sleep(4)]);
        if (++guard > 200000) throw new Error('backpressure stuck');
      }
      if (cancelStarted) break;
      if (encErr) throw encErr; if (muxError) throw muxError;
      const t0 = performance.now();
      drawFrame(ctx, i, W, H);
      const t1 = performance.now();
      const ts = Math.round(i * 1e6 / fps), dur = Math.round((i + 1) * 1e6 / fps) - ts; // exact frame-index timestamps, integer microseconds
      const f = makeFrame(canvas, { timestamp: ts, duration: dur });
      venc.encode(f, { keyFrame: i % keyEvery === 0 });
      closeFrame(f);
      frameMs += performance.now() - t1; renderMs += t1 - t0;
      if (venc.encodeQueueSize > peakQ) peakQ = venc.encodeQueueSize;
      sampleHeap(i);
      if (i % 30 === 0) self.postMessage({ type: 'progress', frame: i, t: tNow() });
      if (i % 4 === 0) await yieldMacro(); // let a cancel message through
    }
  } finally { loopExited(); }
  if (cancelStarted) return; // cancelHook posts the result

  const tLoopEnd = tNow();
  await venc.flush(); if (aenc) await aenc.flush();
  const tFlushed = tNow();
  await vq; await aq;
  if (encErr) throw encErr; if (muxError) throw muxError;
  if (aborted) {
    res.aborted = true; res.abortedAtFrame = curFrame;
    venc.close(); aenc && aenc.close(); await output.cancel();
    if (writable) { try { await writable.abort(); } catch {} try { await root.removeEntry(fileName); } catch {} }
  } else await output.finalize();
  const tEnd = tNow();
  sampleHeap(N);
  Object.assign(res, {
    ok: !aborted, wallMs: tEnd - tLoop0, // export wall time from first frame to finalized file (excludes audio mix in page and worker spin-up)
    loopMs: tLoopEnd - tLoop0, flushMs: tFlushed - tLoopEnd, finalizeMs: tEnd - tFlushed,
    framesEncoded: vChunks, audioChunks: aChunks, videoBytes: vBytes, audioBytes: aBytes,
    renderMsTotal: renderMs, frameCreateEncodeMsTotal: frameMs,
    framesCreated: created, framesClosed: closed, openFramesAtEnd: open, maxOpenFrames: maxOpen,
    peakEncodeQueue: peakQ, peakAudioQueue: peakAQ, maxPendingMux, maxQ, maxMux,
    heap, workerHasPerfMemory: !!performance.memory, startupMs: tLoop0 - tStart,
    vencConfigAccepted: sup.config ? { codec: sup.config.codec, hardwareAcceleration: sup.config.hardwareAcceleration } : null,
  });
  if (sink === 'opfs') { const f = await (await root.getFileHandle(fileName)).getFile(); res.fileBytes = f.size; res.fileName = fileName; }
  else { const buf = target.buffer; res.fileBytes = buf.byteLength; self.postMessage({ type: 'done', result: res, buffer: buf }, [buf]); return; }
  self.postMessage({ type: 'done', result: res });
}
