// THROWAWAY manual File System Access checks. Not automatable: native pickers.
const MB = 1 << 20;
const $ = (id: string) => document.getElementById(id)!;
const log = (s: string) => { $('log').textContent += '\n' + s; };
const mem = () => ((performance as any).memory?.usedJSHeapSize ?? 0) / MB;
const w = window as any;

$('open').onclick = async () => {
  try {
    const [h] = await w.showOpenFilePicker();
    const f: File = await h.getFile(); const t = performance.now();
    const buf = await f.slice(0, MB).arrayBuffer();
    log(`opened ${f.name} (${(f.size / MB).toFixed(1)} MB); read ${buf.byteLength} bytes in ${(performance.now() - t).toFixed(1)} ms`);
  } catch (e) { log('open failed: ' + e); }
};

$('save').onclick = async () => {
  try {
    const h = await w.showSaveFilePicker({ suggestedName: 'media-studio-1gb-test.bin' });
    const chunk = new Uint8Array(MB).map((_, i) => (i * 31) & 255); const n = 1024; let i = 0, peak = 0;
    const timer = setInterval(() => { peak = Math.max(peak, mem()); }, 100);
    const t0 = performance.now(); const writable = await h.createWritable();
    const rs = new ReadableStream<Uint8Array>({ pull(c) { if (i >= n) { c.close(); return; } const b = new Uint8Array(chunk); new Uint32Array(b.buffer, 0, 1)[0] = i++; c.enqueue(b); } }, new CountQueuingStrategy({ highWaterMark: 2 }));
    await rs.pipeTo(writable); // closes the stream, i.e. commits the file
    clearInterval(timer);
    const s = (performance.now() - t0) / 1000;
    log(`saved 1 GB in ${s.toFixed(1)} s = ${(1024 / s).toFixed(0)} MB/s, peak JS heap ${peak.toFixed(0)} MB (delete the file afterwards)`);
  } catch (e) { log('save failed: ' + e); }
};

const db = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('s2-manual', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
$('store').onclick = async () => {
  try {
    const [h] = await w.showOpenFilePicker(); const d = await db();
    await new Promise<void>((res, rej) => { const tx = d.transaction('h', 'readwrite'); tx.objectStore('h').put(h, 'last'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    log(`stored handle for ${h.name} in IndexedDB. Now click 3b (reload), then 3c.`);
  } catch (e) { log('store failed: ' + e); }
};
$('reload').onclick = () => location.reload();
$('perm').onclick = async () => {
  try {
    const d = await db();
    const h: any = await new Promise((res, rej) => { const r = d.transaction('h').objectStore('h').get('last'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    if (!h) { log('no stored handle: run 3a first'); return; }
    const before = await h.queryPermission({ mode: 'read' }); log(`stored handle ${h.name}; permission after reload: ${before}`);
    const after = before === 'granted' ? before : await h.requestPermission({ mode: 'read' });
    log(`after requestPermission: ${after}`);
    if (after === 'granted') { const f = await h.getFile(); log(`read OK: ${f.name}, ${f.size} bytes, first 16 bytes read: ${(await f.slice(0, 16).arrayBuffer()).byteLength}`); }
  } catch (e) { log('permission test failed: ' + e); }
};
