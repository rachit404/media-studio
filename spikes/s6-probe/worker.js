// S6 worker: OffscreenCanvas + OPFS sync access handle + SAB
self.onmessage = async () => {
  const r = {};
  try {
    const oc = new OffscreenCanvas(64, 64);
    r.offscreen2d = !!oc.getContext('2d');
    const gl = new OffscreenCanvas(64, 64).getContext('webgl2');
    r.offscreenWebgl2 = !!gl;
    if (gl) { const e = gl.getExtension('WEBGL_debug_renderer_info'); r.workerGlRenderer = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; }
  } catch (e) { r.offscreenError = String(e); }
  try {
    const root = await navigator.storage.getDirectory(); r.opfsGetDirectory = true;
    const fh = await root.getFileHandle('s6-probe.bin', { create: true });
    const h = await fh.createSyncAccessHandle(); r.opfsSyncAccessHandle = true;
    const buf = new Uint8Array(1024 * 1024).fill(7);
    const t0 = performance.now();
    for (let i = 0; i < 16; i++) h.write(buf, { at: i * buf.length });
    h.flush();
    r.opfsWriteMBps_16MB = +(16 / ((performance.now() - t0) / 1000)).toFixed(1);
    h.close();
    await root.removeEntry('s6-probe.bin');
  } catch (e) { r.opfsError = String(e); }
  try { r.sharedArrayBufferInWorker = typeof SharedArrayBuffer !== 'undefined'; } catch { r.sharedArrayBufferInWorker = false; }
  r.workerHasVideoEncoder = typeof VideoEncoder !== 'undefined';
  self.postMessage(r);
};
