// S6 capability probe. Produces window.__probe (JSON). Reusable: open the page in any browser.
const out = {};
const sup = async (api, cfg) => {
  try { const r = await api.isConfigSupported(cfg); return r.supported ? 'yes' : 'no'; }
  catch (e) { return 'error:' + e.name; }
};
const HW = ['prefer-hardware', 'prefer-software', 'no-preference'];

async function videoMatrix() {
  const codecs = [
    ['avc1.42001f', 'H.264 Baseline@3.1 720p', 1280, 720],
    ['avc1.42002a', 'H.264 Baseline@4.2 1080p', 1920, 1080],
    ['avc1.4d0028', 'H.264 Main@4.0 1080p', 1920, 1080],
    ['avc1.64001f', 'H.264 High@3.1 720p', 1280, 720],
    ['avc1.640028', 'H.264 High@4.0 1080p', 1920, 1080],
    ['avc1.640032', 'H.264 High@5.0 1080p', 1920, 1080],
    ['avc1.640033', 'H.264 High@5.1 4K', 3840, 2160],
    ['avc1.640034', 'H.264 High@5.2 4K', 3840, 2160],
    ['hvc1.1.6.L120.B0', 'HEVC Main@4.0 1080p (hvc1)', 1920, 1080],
    ['hev1.1.6.L153.B0', 'HEVC Main@5.1 4K (hev1)', 3840, 2160],
    ['vp09.00.40.08', 'VP9 p0 L4.0 1080p', 1920, 1080],
    ['vp09.00.51.08', 'VP9 p0 L5.1 4K', 3840, 2160],
    ['vp8', 'VP8 1080p', 1920, 1080],
    ['av01.0.08M.08', 'AV1 Main L4.0 1080p', 1920, 1080],
    ['av01.0.12M.08', 'AV1 Main L5.0 4K', 3840, 2160],
  ];
  const m = {};
  for (const [codec, label, width, height] of codecs) {
    const row = { codec, w: width, h: height, encode: {}, decode: {} };
    for (const hw of HW) {
      const enc = { codec, width, height, bitrate: width >= 3840 ? 30e6 : 8e6, framerate: 30, hardwareAcceleration: hw };
      if (codec.startsWith('avc1')) enc.avc = { format: 'avc' };
      if (codec.startsWith('hvc1') || codec.startsWith('hev1')) enc.hevc = { format: 'hevc' };
      row.encode[hw] = await sup(VideoEncoder, enc);
      row.decode[hw] = await sup(VideoDecoder, { codec, codedWidth: width, codedHeight: height, hardwareAcceleration: hw });
    }
    m[label] = row;
  }
  return m;
}
async function audioMatrix() {
  const cfgs = [
    ['AAC-LC mp4a.40.2', 'mp4a.40.2', { aac: { format: 'aac' } }],
    ['Opus', 'opus', {}],
    ['FLAC', 'flac', {}],
    ['Vorbis', 'vorbis', {}],
    ['MP3', 'mp3', {}],
  ];
  const m = {};
  for (const [label, codec, extra] of cfgs) {
    m[label] = {
      encode: await sup(AudioEncoder, { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000, ...extra }),
      decode: await sup(AudioDecoder, { codec, sampleRate: 48000, numberOfChannels: 2 }),
    };
  }
  return m;
}
async function imageDecoders() {
  const m = {};
  if (typeof ImageDecoder === 'undefined') return { ImageDecoder: false };
  for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']) {
    try { m[t] = await ImageDecoder.isTypeSupported(t); } catch (e) { m[t] = 'error:' + e.name; }
  }
  return m;
}
async function gfx() {
  const r = {};
  const gl = document.createElement('canvas').getContext('webgl2');
  r.webgl2 = !!gl;
  if (gl) {
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    r.webgl2Renderer = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    r.webgl2Vendor = e ? gl.getParameter(e.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    r.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  }
  r.webgl1 = !!document.createElement('canvas').getContext('webgl');
  r.webgpuApi = 'gpu' in navigator;
  if (r.webgpuApi) {
    try {
      const a = await navigator.gpu.requestAdapter();
      if (!a) r.webgpuAdapter = null;
      else {
        const info = a.info ?? (a.requestAdapterInfo ? await a.requestAdapterInfo() : {});
        r.webgpuAdapter = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: a.isFallbackAdapter };
      }
    } catch (e) { r.webgpuAdapter = 'error:' + e; }
  }
  return r;
}
async function platform() {
  const r = {
    userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, deviceMemoryGB: navigator.deviceMemory ?? null,
    isSecureContext: self.isSecureContext, origin: location.origin, crossOriginIsolated: self.crossOriginIsolated,
    sharedArrayBufferMainThread: typeof SharedArrayBuffer !== 'undefined',
    showOpenFilePicker: typeof window.showOpenFilePicker === 'function',
    showSaveFilePicker: typeof window.showSaveFilePicker === 'function',
    showDirectoryPicker: typeof window.showDirectoryPicker === 'function',
    opfsGetDirectoryMain: !!(navigator.storage && navigator.storage.getDirectory),
    mainHasVideoEncoder: typeof VideoEncoder !== 'undefined', mainHasAudioEncoder: typeof AudioEncoder !== 'undefined',
    performanceMemory: !!performance.memory,
  };
  try { const e = await navigator.storage.estimate(); r.storageEstimate = { quotaMB: Math.round(e.quota / 1e6), usageMB: +(e.usage / 1e6).toFixed(2) }; } catch (e) { r.storageEstimate = 'error:' + e; }
  try { r.storagePersist = await navigator.storage.persist(); r.storagePersisted = await navigator.storage.persisted(); } catch (e) { r.storagePersist = 'error:' + e; }
  return r;
}
function workerProbe() {
  return new Promise((res) => {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const t = setTimeout(() => res({ error: 'worker timeout' }), 20000);
    w.onmessage = (e) => { clearTimeout(t); res(e.data); w.terminate(); };
    w.onerror = (e) => { clearTimeout(t); res({ error: 'worker error ' + e.message }); };
    w.postMessage(1);
  });
}
// A real round trip: does the encoder actually produce output? (isConfigSupported can say yes and still fail)
async function realEncode(codec, hw, extra = {}) {
  const r = { codec, hw, ok: false };
  try {
    const chunks = []; let err = null;
    const enc = new VideoEncoder({ output: (c) => chunks.push(c.byteLength), error: (e) => { err = String(e); } });
    enc.configure({ codec, width: 1280, height: 720, bitrate: 4e6, framerate: 30, hardwareAcceleration: hw, ...extra });
    const cv = new OffscreenCanvas(1280, 720); const g = cv.getContext('2d');
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `hsl(${i * 10},70%,50%)`; g.fillRect(0, 0, 1280, 720);
      const f = new VideoFrame(cv, { timestamp: i * 33333 }); enc.encode(f, { keyFrame: i === 0 }); f.close();
    }
    await enc.flush(); enc.close();
    r.ok = !err && chunks.length === 30; r.chunks = chunks.length; r.err = err;
  } catch (e) { r.error = String(e); }
  return r;
}
async function realAudioEncode(codec, extra = {}) {
  const r = { codec, ok: false };
  try {
    const chunks = []; let err = null;
    const enc = new AudioEncoder({ output: (c) => chunks.push(c.byteLength), error: (e) => { err = String(e); } });
    enc.configure({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000, ...extra });
    const data = new Float32Array(48000 * 2);
    for (let i = 0; i < 48000; i++) { data[i] = Math.sin(i / 20); data[48000 + i] = Math.sin(i / 30); }
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: 48000, numberOfChannels: 2, timestamp: 0, data });
    enc.encode(ad); ad.close(); await enc.flush(); enc.close();
    r.ok = !err && chunks.length > 0; r.chunks = chunks.length; r.err = err;
  } catch (e) { r.error = String(e); }
  return r;
}
async function main() {
  const step = async (k, fn) => { try { out[k] = await fn(); } catch (e) { out[k] = { error: String(e) }; } };
  await step('platform', platform);
  await step('graphics', gfx);
  await step('worker', workerProbe);
  await step('video', videoMatrix);
  await step('audio', audioMatrix);
  await step('imageDecoder', imageDecoders);
  await step('roundTrip', async () => ({
    h264_hw: await realEncode('avc1.640028', 'prefer-hardware', { avc: { format: 'avc' } }),
    h264_sw: await realEncode('avc1.640028', 'prefer-software', { avc: { format: 'avc' } }),
    vp9_sw: await realEncode('vp09.00.40.08', 'prefer-software'),
    vp8_sw: await realEncode('vp8', 'prefer-software'),
    av1_sw: await realEncode('av01.0.08M.08', 'prefer-software'),
    aac: await realAudioEncode('mp4a.40.2', { aac: { format: 'aac' } }),
    opus: await realAudioEncode('opus'),
  }));
  window.__probe = out;
  document.getElementById('out').textContent = JSON.stringify(out, null, 1);
  document.title = 'S6 done';
}
main();
