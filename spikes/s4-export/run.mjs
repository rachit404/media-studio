// node s4-export/run.mjs [--quick] [--only=label1,label2]
// Each config: timed export under the bench lock, then (outside the lock) verification of the output with Mediabunny.
import { launchChrome, withBenchLock, envInfo, writeResult, BASE_URL } from '../shared/harness.mjs';

const quick = process.argv.includes('--quick');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const OUTNAME = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6) || (quick ? 's4-export.quick' : 's4-export');
const seconds = quick ? 6 : 60;
const H264 = 'avc1.640028', VP9 = 'vp09.00.40.08';
const configs = [
  { label: 'h264-hw-buffer', codec: H264, hw: 'prefer-hardware', sink: 'buffer' },
  { label: 'h264-sw-buffer', codec: H264, hw: 'prefer-software', sink: 'buffer' },
  { label: 'h264-hw-opfs', codec: H264, hw: 'prefer-hardware', sink: 'opfs' },
  { label: 'h264-hw-buffer-rerun', codec: H264, hw: 'prefer-hardware', sink: 'buffer' },
  { label: 'vp9-hw-buffer', codec: VP9, hw: 'prefer-hardware', sink: 'buffer' },
  { label: 'vp9-sw-buffer', codec: VP9, hw: 'prefer-software', sink: 'buffer' },
  { label: 'cancel50-h264-hw-opfs', codec: H264, hw: 'prefer-hardware', sink: 'opfs', cancelAtFraction: 0.5 },
  { label: 'cancel50-h264-sw-buffer', codec: H264, hw: 'prefer-software', sink: 'buffer', cancelAtFraction: 0.5 },
].filter((c) => !only.length || only.includes(c.label));

const DBG = 9333;
const browser = await launchChrome({ headless: false, args: [`--remote-debugging-port=${DBG}`] });
// Browser-level CDP over our own socket so we can read the *worker's* JS heap (performance.memory is not exposed in workers).
const ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const bsend = (method, params = {}, sessionId) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const attached = new Map(); // targetId -> sessionId
async function sampleOnce(tSec, store) {
  const t = await bsend('Target.getTargets');
  const rec = { tSec };
  for (const ti of t.result.targetInfos) {
    if (ti.type === 'worker' && ti.url.includes('export-worker')) {
      if (!attached.has(ti.targetId)) { const a = await bsend('Target.attachToTarget', { targetId: ti.targetId, flatten: true }); attached.set(ti.targetId, a.result.sessionId); }
      const h = await bsend('Runtime.getHeapUsage', {}, attached.get(ti.targetId));
      if (h.result) { rec.workerHeapMB = +(h.result.usedSize / 1048576).toFixed(1); rec.workerHeapTotalMB = +(h.result.totalSize / 1048576).toFixed(1); }
    }
  }
  try { const h = await cdp.send('Runtime.getHeapUsage'); rec.pageHeapMB = +(h.usedSize / 1048576).toFixed(1); } catch {}
  store.push(rec);
}
async function rssMB() {
  try {
    const r = (await bsend('SystemInfo.getProcessInfo')).result; const ids = r.processInfo.map((p) => p.id); const types = Object.fromEntries(r.processInfo.map((p) => [p.id, p.type]));
    const { execFile } = await import('node:child_process');
    const txt = await new Promise((res) => execFile('powershell', ['-NoProfile', '-Command', `Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id),$($_.WorkingSet64)" }`], (e, o) => res(o || '')));
    const o = {}; for (const line of txt.trim().split('\n')) { const [id, ws2] = line.trim().split(','); if (id) o[types[+id] || id] = (o[types[+id] || id] || 0) + +ws2 / 1048576; }
    for (const k in o) o[k] = Math.round(o[k]); return o;
  } catch { return null; }
}
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text()); });
// Vite HMR would reload the page whenever any agent writes into spikes/ (incl. result files): mock the HMR socket.
await page.routeWebSocket(/.*/, () => {});
await page.goto(`${BASE_URL}/s4-export/index.html`);
await page.waitForFunction(() => window.__ready);
const env = await envInfo(page);
const cdp = await page.context().newCDPSession(page);
const procCpu = async () => { try { const r = (await bsend('SystemInfo.getProcessInfo')).result; const o = {}; for (const p of r.processInfo) o[p.type] = (o[p.type] || 0) + p.cpuTime; return o; } catch { return null; } };

const out = { env: { ...env, browserVersion: browser.version() }, seconds, quick, startedAt: new Date().toISOString(), runs: [] };
await page.evaluate((s) => window.opfsClear(), 0);
for (const cfg of configs) {
  const opts = { ...cfg, seconds };
  console.log('RUN', cfg.label);
  let run;
  const timed = async () => {
    const c0 = await procCpu(); const t0 = Date.now();
    let stop = false; const samples = [], rss = []; const tS0 = Date.now();
    const loop = (async () => { let n = 0; while (!stop) { try { await sampleOnce(+((Date.now() - tS0) / 1000).toFixed(1), samples); } catch (e) { samples.push({ err: String(e) }); } if (n++ % 12 === 0) { const m = await rssMB(); if (m) rss.push({ tSec: +((Date.now() - tS0) / 1000).toFixed(1), ...m }); } await new Promise((r2) => setTimeout(r2, 800)); } })();
    const r = await page.evaluate((o) => window.runExport(o), opts);
    stop = true; await loop; r.heapSamples = samples; r.rssSamplesMB = rss;
    const c1 = await procCpu();
    r.hostWallMs = Date.now() - t0;
    if (c0 && c1) r.cpuSecByProcessType = Object.fromEntries(Object.keys(c1).map((k) => [k, +(c1[k] - (c0[k] || 0)).toFixed(2)]));
    return r;
  };
  try {
    run = quick ? await timed() : await withBenchLock('s4', timed);
  } catch (e) { out.runs.push({ label: cfg.label, error: String(e) }); console.log('  ERROR', String(e).slice(0, 300)); continue; }
  if (!run.cancelled && !run.aborted) {
    run.verify = await page.evaluate(([r, s]) => window.verifyOutput(r, { expectedSeconds: s }), [run, seconds]);
  }
  run.opfsAfter = await page.evaluate(() => window.opfsList());
  if (run.fileName) await page.evaluate(async (n) => { const root = await navigator.storage.getDirectory(); await root.removeEntry(n); }, run.fileName);
  const encFps = run.frames / (run.wallMs / 1000);
  console.log(`  wall ${(run.wallMs / 1000).toFixed(1)}s  ${encFps.toFixed(1)} fps  x${(seconds / (run.wallMs / 1000)).toFixed(2)} rt  bytes ${run.fileBytes}  cancel=${JSON.stringify(run.cancel && { rcv: run.cancel.msgLatencyMs, clean: run.cancel.cleanupDoneAfterMs, partial: run.cancel.partialFileRemains })}  verify=${run.verify && run.verify.allPass}`);
  out.runs.push(run);
  await writeResult(OUTNAME, out);
}
out.finishedAt = new Date().toISOString();
await writeResult(OUTNAME, out);
ws.close(); await browser.close();
