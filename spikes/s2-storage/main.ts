// THROWAWAY. Page-side helpers for the S2 runner (window.s2).
const MB = 1 << 20;
const mem = () => (performance as any).memory?.usedJSHeapSize as number;
function mkWorker() {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>(); let seq = 0;
  w.onmessage = e => { const p = pending.get(e.data.id)!; pending.delete(e.data.id); 'error' in e.data ? p.rej(new Error(e.data.error)) : p.res(e.data.result); };
  const call = (op: string, args: any = {}) => new Promise<any>((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); w.postMessage({ id, op, args }); });
  return { w, call };
}
const workers: Record<string, ReturnType<typeof mkWorker>> = {};
const callW = (k: string, op: string, args?: any) => (workers[k] ??= mkWorker()).call(op, args);

let heapMax = 0, heapMin = Infinity, heapTimer: any;
function heapStart() { heapMax = 0; heapMin = Infinity; heapTimer = setInterval(() => { const m = mem(); heapMax = Math.max(heapMax, m); heapMin = Math.min(heapMin, m); }, 100); }
function heapStop() { clearInterval(heapTimer); return { minBytes: heapMin, maxBytes: heapMax }; }

function makeBase(n: number) { const b = new Uint8Array(n); const v = new Uint32Array(b.buffer); let x = 0x9e3779b9 >>> 0; for (let i = 0; i < v.length; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; v[i] = x; } return b; }
const err = (e: any) => `${e?.name}: ${e?.message}`;

async function streamWrite(name: string, total: number, chunk: number) {
  const root = await navigator.storage.getDirectory();
  const fh: any = await root.getFileHandle(name, { create: true });
  const w = await fh.createWritable({ keepExistingData: false });
  const base = makeBase(chunk); const n = Math.floor(total / chunk); let i = 0;
  const heap0 = mem(); heapStart(); const t0 = performance.now();
  const rs = new ReadableStream<Uint8Array>({
    pull(c) { if (i >= n) { c.close(); return; } const b = new Uint8Array(chunk); b.set(base); new Uint32Array(b.buffer, 0, 2).set([i, ~i >>> 0]); c.enqueue(b); i++; },
  }, new CountQueuingStrategy({ highWaterMark: 2 }));
  await rs.pipeTo(w, { preventClose: true });
  const t1 = performance.now(); await w.close(); const t2 = performance.now();
  const heap = heapStop();
  const f: File = await fh.getFile();
  let bad = 0, checked = 0; const exp = new Uint8Array(chunk);
  for (let k = 0; k < 64; k++) {
    const idx = k === 0 ? 0 : k === 1 ? n - 1 : Math.floor(Math.random() * n);
    const got = new Uint8Array(await f.slice(idx * chunk, (idx + 1) * chunk).arrayBuffer());
    exp.set(base); new Uint32Array(exp.buffer, 0, 2).set([idx, ~idx >>> 0]); checked++;
    if (got.length !== chunk || got.some((v, j) => v !== exp[j])) bad++;
  }
  return { name, bytes: n * chunk, chunk, writeMBps_excl_close: n * chunk / MB / ((t1 - t0) / 1000), writeMBps_incl_close: n * chunk / MB / ((t2 - t0) / 1000), closeCommitMs: t2 - t1, fileSize: f.size, heapMainBytes: { start: heap0, ...heap }, integrity: { checked, mismatches: bad } };
}

async function blobTest(targetsMB: number[], chunkMB: number, report: (s: any) => void) {
  const buf = makeBase(chunkMB * MB); let blob = new Blob([]); let got = 0; const t0 = performance.now(); const out: any[] = [];
  heapStart();
  for (const target of targetsMB) {
    try {
      while (got < target) { new Uint32Array(buf.buffer, 0, 2).set([got, 1]); blob = new Blob([blob, buf]); got += chunkMB; }
      const t = performance.now();
      let ok = 'n/a'; try { const s = new Uint8Array(await blob.slice(blob.size - 1024).arrayBuffer()); ok = `tail slice read ok (${s.length} B), blob.size=${blob.size}`; } catch (e) { ok = 'slice read failed ' + err(e); }
      let url = 'ok'; try { URL.revokeObjectURL(URL.createObjectURL(blob)); } catch (e) { url = 'createObjectURL failed ' + err(e); }
      const rec = { targetMB: target, ok: true, elapsedMs: t - t0, heapNow: mem(), sliceCheck: ok, objectUrl: url }; out.push(rec); report(rec);
    } catch (e) { const rec = { targetMB: target, ok: false, reachedMB: got, error: err(e), elapsedMs: performance.now() - t0 }; out.push(rec); report(rec); break; }
  }
  return { steps: out, heap: heapStop() };
}

async function quotaInfo() {
  const est = await navigator.storage.estimate(); const before = await navigator.storage.persisted();
  let persist: any; try { persist = await navigator.storage.persist(); } catch (e) { persist = err(e); }
  return { estimate: est, persistedBefore: before, persistResult: persist, persistedAfter: await navigator.storage.persisted() };
}
async function mainThreadSync() {
  const root = await navigator.storage.getDirectory(); const fh: any = await root.getFileHandle('mt.bin', { create: true });
  const r: any = { typeofCreateSyncAccessHandleOnMainThread: typeof fh.createSyncAccessHandle };
  try { await fh.createSyncAccessHandle(); r.callOnMainThread = 'OPENED (unexpected)'; } catch (e) { r.callOnMainThread = err(e); }
  await root.removeEntry('mt.bin'); return r;
}
async function cleanupMain() { const root: any = await navigator.storage.getDirectory(); const names: string[] = []; for await (const [k] of root.entries()) names.push(k); for (const k of names) await root.removeEntry(k, { recursive: true }); return names; }

(window as any).s2 = { callW, heapStart, heapStop, streamWrite, blobTest, quotaInfo, mainThreadSync, cleanupMain, mem };
