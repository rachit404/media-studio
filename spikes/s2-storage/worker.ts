// THROWAWAY. OPFS sync-access-handle benchmark worker.
const MB = 1 << 20;
const mem = () => (performance as any).memory?.usedJSHeapSize as number | undefined;
let root: FileSystemDirectoryHandle;
const held = new Map<string, any>();

function makeBase(n: number) {
  const b = new Uint8Array(n);
  const v = new Uint32Array(b.buffer, 0, n >> 2);
  let x = 0x9e3779b9 >>> 0;
  for (let i = 0; i < v.length; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; v[i] = x; }
  return b;
}
function stamp(b: Uint8Array, i: number) {
  const v = new Uint32Array(b.buffer, 0, 2); v[0] = i >>> 0; v[1] = (~i) >>> 0;
}
function same(a: Uint8Array, b: Uint8Array) {
  const x = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2), y = new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function pct(a: number[], p: number) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
async function open(name: string, create = true) { root ??= await navigator.storage.getDirectory(); const fh = await root.getFileHandle(name, { create }); return fh; }
const err = (e: any) => `${e?.name}: ${e?.message}`;

const ops: Record<string, (a: any) => Promise<any>> = {
  async seq({ name, size, chunk, sampleEvery = 0 }) {
    const n = Math.floor(size / chunk);
    const buf = makeBase(chunk), exp = makeBase(chunk), rbuf = new Uint8Array(chunk);
    const fh = await open(name); const h = await (fh as any).createSyncAccessHandle();
    h.truncate(0);
    const heap: number[] = []; const seg: number[] = []; const segEvery = Math.max(1, Math.floor((256 * MB) / chunk));
    const h0 = mem(); let lastT = performance.now(); const t0 = lastT;
    for (let i = 0; i < n; i++) {
      stamp(buf, i);
      let w: number;
      try { w = h.write(buf, { at: i * chunk }); }
      catch (e: any) { const est = await navigator.storage.estimate(); try { h.close(); } catch {} throw new Error(`${err(e)} | at chunk ${i}/${n} (${(i * chunk / MB).toFixed(0)} MB written, chunk ${chunk}) | estimate=${JSON.stringify(est)}`); }
      if (w !== chunk) throw new Error(`short write ${w}`);
      if (sampleEvery && i % sampleEvery === 0) heap.push(mem() ?? -1);
      if ((i + 1) % segEvery === 0) { const t = performance.now(); seg.push(segEvery * chunk / MB / ((t - lastT) / 1000)); lastT = t; }
    }
    const t1 = performance.now();
    h.flush(); const t2 = performance.now();
    const total = n * chunk;
    const sizeAfter = h.getSize();
    const r0 = performance.now(); let rl = r0; const rseg: number[] = [];
    for (let i = 0; i < n; i++) {
      const r = h.read(rbuf, { at: i * chunk });
      if (r !== chunk) throw new Error(`short read ${r}`);
      if (sampleEvery && i % sampleEvery === 0) heap.push(mem() ?? -1);
      if ((i + 1) % segEvery === 0) { const t = performance.now(); rseg.push(segEvery * chunk / MB / ((t - rl) / 1000)); rl = t; }
    }
    const r1 = performance.now();
    // integrity: first, last and ~256 random chunks compared byte-for-byte against the regenerated pattern
    const R = rng(7); const idx = new Set<number>([0, n - 1]); while (idx.size < Math.min(n, 258)) idx.add(Math.floor(R() * n));
    let bad = 0;
    for (const i of idx) { h.read(rbuf, { at: i * chunk }); exp.set(buf); stamp(exp, i); if (!same(rbuf, exp)) bad++; }
    h.close();
    return {
      name, sizeBytes: total, chunkBytes: chunk, chunks: n,
      writeMBps: total / MB / ((t1 - t0) / 1000), writeMs: t1 - t0, flushMs: t2 - t1,
      readMBps: total / MB / ((r1 - r0) / 1000), readMs: r1 - r0,
      fileSizeAfter: sizeAfter, integrity: { chunksChecked: idx.size, mismatches: bad },
      writeSegMBps_256MB: seg.map(x => +x.toFixed(0)), readSegMBps_256MB: rseg.map(x => +x.toFixed(0)),
      heapWorkerBytes: heap.length ? { start: h0, min: Math.min(...heap), max: Math.max(...heap), samples: heap.length } : { start: h0, end: mem() },
    };
  },
  async random({ name, sizes, count }) {
    const fh = await open(name, false); const h = await (fh as any).createSyncAccessHandle();
    const fsz = h.getSize(); const out: any[] = [];
    for (const len of sizes) {
      const b = new Uint8Array(len); const R = rng(len); const lat: number[] = [];
      const t0 = performance.now();
      for (let i = 0; i < count; i++) {
        const at = Math.floor(R() * (fsz - len)); const s = performance.now();
        const r = h.read(b, { at }); if (r !== len) throw new Error('short');
        lat.push(performance.now() - s);
      }
      const dt = (performance.now() - t0) / 1000;
      out.push({ readBytes: len, count, opsPerSec: count / dt, MBps: count * len / MB / dt, p50ms: pct(lat, .5), p95ms: pct(lat, .95), p99ms: pct(lat, .99), maxMs: Math.max(...lat) });
    }
    h.close(); return { fileSize: fsz, groups: out };
  },
  async flushSmall({ name, writes, chunk }) {
    const fh = await open(name); const h = await (fh as any).createSyncAccessHandle(); h.truncate(0);
    const b = makeBase(chunk); const lat: number[] = [];
    for (let i = 0; i < writes; i++) { h.write(b, { at: i * chunk }); const s = performance.now(); h.flush(); lat.push(performance.now() - s); }
    h.close(); return { writes, chunk, flushP50ms: pct(lat, .5), flushP95ms: pct(lat, .95), flushMaxMs: Math.max(...lat) };
  },
  async hold({ name }) { const fh = await open(name); held.set(name, await (fh as any).createSyncAccessHandle()); return 'held'; },
  async tryOpen({ name, mode }) { const fh = await open(name); try { const h = await (fh as any).createSyncAccessHandle(mode ? { mode } : undefined); h.close(); return 'OPENED'; } catch (e) { return err(e); } },
  async release({ name }) { held.get(name).close(); held.delete(name); return 'released'; },
  async singleWriter() {
    const r: any = {}; const fh: any = await open('sw-test.bin'); const h1 = await fh.createSyncAccessHandle();
    h1.write(new Uint8Array([1, 2, 3]), { at: 0 });
    try { const h2 = await fh.createSyncAccessHandle(); h2.close(); r.secondExclusiveSameWorker = 'OPENED (unexpected)'; } catch (e) { r.secondExclusiveSameWorker = err(e); }
    try { const h3 = await fh.createSyncAccessHandle({ mode: 'readwrite-unsafe' }); h3.close(); r.unsafeWhileExclusiveHeld = 'OPENED'; } catch (e) { r.unsafeWhileExclusiveHeld = err(e); }
    try { const w = await fh.createWritable(); await w.close(); r.createWritableWhileSyncHeld = 'OPENED (unexpected)'; } catch (e) { r.createWritableWhileSyncHeld = err(e); }
    try { const f = await fh.getFile(); r.getFileReadWhileSyncHeld = `OK size=${f.size}`; } catch (e) { r.getFileReadWhileSyncHeld = err(e); }
    try { await root.removeEntry('sw-test.bin'); r.removeWhileHeld = 'REMOVED (unexpected)'; } catch (e) { r.removeWhileHeld = err(e); }
    const fh2: any = await open('sw-test2.bin'); const o = await fh2.createSyncAccessHandle(); r.differentFileConcurrently = 'OK'; o.close(); await root.removeEntry('sw-test2.bin');
    h1.close(); try { h1.read(new Uint8Array(1), { at: 0 }); r.closedHandleUseThrows = 'no throw'; } catch (e) { r.closedHandleUseThrows = err(e); }
    try { const h4 = await fh.createSyncAccessHandle(); r.afterClose = 'OPENED OK'; const b = new Uint8Array(3); h4.read(b, { at: 0 }); r.dataAfterReopen = Array.from(b).join(','); h4.close(); } catch (e) { r.afterClose = err(e); }
    try {
      const u1 = await fh.createSyncAccessHandle({ mode: 'readwrite-unsafe' }); const u2 = await fh.createSyncAccessHandle({ mode: 'readwrite-unsafe' }); r.twoUnsafeConcurrent = 'BOTH OPENED';
      try { const x = await fh.createSyncAccessHandle(); x.close(); r.exclusiveWhileUnsafeHeld = 'OPENED'; } catch (e) { r.exclusiveWhileUnsafeHeld = err(e); }
      u1.close(); u2.close();
    } catch (e) { r.twoUnsafeConcurrent = err(e); }
    await root.removeEntry('sw-test.bin'); return r;
  },
  async untilFail({ name, chunk, maxBytes, prealloc }) {
    const fh: any = await open(name); const h = await fh.createSyncAccessHandle(); h.truncate(0); const r: any = { chunk, prealloc };
    if (prealloc) { try { h.truncate(maxBytes); r.preallocTruncate = 'ok'; } catch (e) { r.preallocTruncate = err(e); } }
    const b = makeBase(chunk); let at = 0; const t0 = performance.now();
    try { while (at < maxBytes) { h.write(b, { at }); at += chunk; } r.completedBytes = at; } catch (e) { r.failedAtBytes = at; r.error = err(e); r.estimateAtFail = await navigator.storage.estimate(); }
    r.seconds = (performance.now() - t0) / 1000;
    if (r.failedAtBytes !== undefined) {
      try { h.write(b, { at: 0 }); r.rewriteExistingRegion = 'ok'; } catch (e) { r.rewriteExistingRegion = err(e); }
      try { h.truncate(r.failedAtBytes + 64 * MB); r.growTruncate64MB = 'ok'; } catch (e) { r.growTruncate64MB = err(e); }
      try { h.truncate(r.failedAtBytes - 200 * MB); h.write(b, { at: r.failedAtBytes - 300 * MB }); r.afterShrink200MB = 'write ok'; } catch (e) { r.afterShrink200MB = err(e); }
    }
    try { h.close(); } catch {}
    try { const f2: any = await open(name + '.2'); const g = await f2.createSyncAccessHandle(); g.write(b, { at: 0 }); g.close(); r.secondFileSmallWrite = 'ok'; await root.removeEntry(name + '.2'); } catch (e) { r.secondFileSmallWrite = err(e); }
    await root.removeEntry(name); return r;
  },
  async multi({ prefix, fileBytes, maxFiles, chunk }) {
    const b = makeBase(chunk); const r: any = { fileBytes, files: 0, totalBytes: 0 }; const names: string[] = [];
    for (let f = 0; f < maxFiles; f++) {
      const nm = `${prefix}${f}.bin`; names.push(nm); const fh: any = await open(nm); const h = await fh.createSyncAccessHandle(); let at = 0;
      try { while (at < fileBytes) { h.write(b, { at }); at += chunk; } r.files++; r.totalBytes += at; h.close(); }
      catch (e) { r.failedInFile = f; r.failedAtBytesInFile = at; r.totalBytes += at; r.error = err(e); r.estimateAtFail = await navigator.storage.estimate(); try { h.close(); } catch {} break; }
    }
    for (const n of names) { try { await root.removeEntry(n); } catch {} }
    return r;
  },
  async remove({ name }) { root ??= await navigator.storage.getDirectory(); try { await root.removeEntry(name); return 'removed'; } catch (e) { return err(e); } },
  async heap() { return mem(); },
};

self.onmessage = async (e: MessageEvent) => {
  const { id, op, args } = e.data;
  try { postMessage({ id, result: await ops[op](args ?? {}) }); }
  catch (er: any) { postMessage({ id, error: err(er) }); }
};
