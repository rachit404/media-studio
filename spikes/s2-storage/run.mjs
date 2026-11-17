// THROWAWAY S2 runner. node s2-storage/run.mjs [smoke|full]
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { launchChrome, withBenchLock, envInfo, writeResult, BASE_URL } from '../shared/harness.mjs';
import { statfs } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';

const mode = process.argv[2] || 'full';
const ONLY = (process.env.ONLY || 'quota,seq,random,big,stream,blob').split(',');
const MB = 1 << 20, GB = 1 << 30;
const smoke = mode === 'smoke';
const S = smoke ? 1 / 32 : 1; // scale factor for sizes in smoke mode
const RESULT = process.env.RESULT || (smoke ? 's2-storage.smoke' : 's2-storage');
const R = { mode, startedAt: new Date().toISOString(), steps: {} };
const save = () => writeResult(RESULT, R);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function diskFreeGB() { const s = await statfs(os.tmpdir()); return +(s.bavail * s.bsize / GB).toFixed(2); }
async function guard(needGB) { const f = await diskFreeGB(); if (f - needGB < 6) throw new Error(`disk guard: free ${f} GB, need ${needGB} GB + 6 GB reserve`); return f; }

function ps(ids) {
  return new Promise(res => execFile('powershell', ['-NoProfile', '-Command', `Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,PrivateMemorySize64,WorkingSet64 | ConvertTo-Json -Compress`], { timeout: 8000 }, (e, out) => {
    try { const j = JSON.parse(out); res(Array.isArray(j) ? j : [j]); } catch { res([]); }
  }));
}
/** Samples private bytes / working set of every process of THIS browser (via CDP pids) every ~1.5 s. */
async function startSampler(browser) {
  const cdp = await browser.newBrowserCDPSession(); let stop = false; const peaks = { privTotal: 0, wsTotal: 0, rendererPriv: 0, browserPriv: 0, gpuPriv: 0, utilityPriv: 0, samples: 0 };
  const loop = (async () => {
    while (!stop) {
      try {
        const info = (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
        const rows = await ps(info.map(p => p.id)); const type = Object.fromEntries(info.map(p => [p.id, p.type]));
        let pt = 0, wt = 0; const byType = {};
        for (const r of rows) { pt += r.PrivateMemorySize64; wt += r.WorkingSet64; const t = type[r.Id]; byType[t] = (byType[t] || 0) + r.PrivateMemorySize64; }
        peaks.samples++; peaks.privTotal = Math.max(peaks.privTotal, pt); peaks.wsTotal = Math.max(peaks.wsTotal, wt);
        peaks.rendererPriv = Math.max(peaks.rendererPriv, byType.renderer || 0); peaks.browserPriv = Math.max(peaks.browserPriv, byType.browser || 0);
        peaks.gpuPriv = Math.max(peaks.gpuPriv, byType.GPU || 0); peaks.utilityPriv = Math.max(peaks.utilityPriv, byType.utility || 0);
      } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 800));
    }
  })();
  return async () => { stop = true; await loop; await cdp.detach().catch(() => { }); const o = {}; for (const [k, v] of Object.entries(peaks)) o[k + (k === 'samples' ? '' : 'PeakMB')] = k === 'samples' ? v : +(v / MB).toFixed(0); return o; };
}

// Persistent (on-disk) profile in a temp dir. browser.newPage() on a plain launch() creates an OFF-THE-RECORD context whose OPFS is RAM-limited (see results).
const INCOG = process.env.INCOGNITO === '1';
const profileDir = await mkdtemp(path.join(os.tmpdir(), 's2-profile-'));
let ctx = null, browser;
if (INCOG) browser = await launchChrome();
else { ctx = await chromium.launchPersistentContext(profileDir, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, args: ['--no-first-run', '--no-default-browser-check'] }); browser = ctx.browser(); }
const newPage = () => ctx ? ctx.newPage() : browser.newPage();
const page = ctx && ctx.pages().length ? ctx.pages()[0] : await newPage();
const evalStep = (fn, arg) => page.evaluate(fn, arg);
const W = (op, args) => evalStep(([op, args]) => window.s2.callW('A', op, args), [op, args]);
async function reloadClean() { await page.reload(); await page.waitForFunction(() => !!window.s2); try { await evalStep(() => window.s2.cleanupMain()); } catch { } }
/** Run fn up to 3 times; QuotaExceededError seen in practice is recorded, never hidden. */
async function retry(fn) {
  const fails = [];
  for (let a = 0; a < 3; a++) {
    try { const r = await fn(); r.failedAttemptsBefore = fails; return r; }
    catch (e) { fails.push(String(e).slice(0, 600)); log('ATTEMPT FAILED', String(e).slice(0, 300)); await reloadClean(); }
  }
  return { failedAllAttempts: fails };
}
const timedHold = async (label, fn) => { const t = Date.now(); const r = await withBenchLock('s2', fn); log(`${label} lock-held ${((Date.now() - t) / 1000).toFixed(0)}s incl. wait`); return r; };

try {
  await page.goto(`${BASE_URL}/s2-storage/index.html`); await page.waitForFunction(() => !!window.s2);
  R.env = { ...(await envInfo(page)), os: `${os.type()} ${os.release()}`, totalRamGB: +(os.totalmem() / GB).toFixed(1), freeRamGBAtStart: +(os.freemem() / GB).toFixed(1), diskFreeGBAtStart: await diskFreeGB(), tmpdir: os.tmpdir() };
  R.env.heapApiAvailable = await page.evaluate(() => typeof performance.memory?.usedJSHeapSize);
  await save();

  // --- 4 + 5: quota, persistence, single writer ---
  R.steps.quota = await evalStep(() => window.s2.quotaInfo());
  R.steps.mainThreadSync = await evalStep(() => window.s2.mainThreadSync());
  R.steps.singleWriter = await W('singleWriter');
  await W('hold', { name: 'x-test.bin' });
  const crossWorker = await evalStep(() => window.s2.callW('B', 'tryOpen', { name: 'x-test.bin' }));
  await W('release', { name: 'x-test.bin' });
  const crossAfter = await evalStep(() => window.s2.callW('B', 'tryOpen', { name: 'x-test.bin' }));
  R.steps.singleWriterCrossWorker = { workerBWhileAHolds: crossWorker, workerBAfterAReleased: crossAfter };
  await W('remove', { name: 'x-test.bin' });
  await save(); log('quota/single-writer done', JSON.stringify(R.steps.singleWriter));

  // --- 1: 1 GB sequential, 3 chunk sizes ---
  R.steps.seq1GB = [];
  for (const chunk of (process.env.CHUNKS ? process.env.CHUNKS.split(",").map(Number) : [64 * 1024, MB, 4 * MB])) {
    await guard(1);
    const r = await retry(() => timedHold(`seq1GB ${chunk}`, () => W('seq', { name: `s1g-${chunk}.bin`, size: GB * S, chunk, sampleEvery: Math.max(1, Math.floor((16 * MB) / chunk)) })));
    r.diskFreeGBAfter = await diskFreeGB(); R.steps.seq1GB.push(r); await save(); log('seq1GB', chunk, r.writeMBps?.toFixed(0), 'w', r.readMBps?.toFixed(0), 'r');
    if (chunk !== MB) await W('remove', { name: `s1g-${chunk}.bin` });
  }
  // --- random reads on the 1 MB-chunk 1 GB file; flush cost ---
  R.steps.random = await timedHold('random', () => W('random', { name: `s1g-${MB}.bin`, sizes: [64 * 1024, MB, 4 * MB], count: 1000 }));
  R.steps.flushSmall = await timedHold('flushSmall', () => W('flushSmall', { name: 'flush.bin', writes: 200, chunk: 64 * 1024 }));
  await W('remove', { name: 'flush.bin' }); await W('remove', { name: `s1g-${MB}.bin` });
  await save(); log('random/flush done');

  // --- 1b: 4 GB (or scaled) sequential with heap + process sampling ---
  let bigGB = 4; const f0 = await diskFreeGB(); if (f0 - bigGB < 6) bigGB = 2; R.steps.big = { requestedGB: 4, usedGB: bigGB, scaledDownBecauseDisk: bigGB !== 4 };
  {
    await guard(bigGB);
    const stop = await startSampler(browser);
    const r = await retry(() => timedHold('big', async () => { await evalStep(() => window.s2.heapStart()); const x = await W('seq', { name: 'big.bin', size: bigGB * GB * S, chunk: MB, sampleEvery: 64 }); x.heapMainBytes = await evalStep(() => window.s2.heapStop()); return x; }));
    r.processMemory = await stop(); r.diskFreeGBWhileFilePresent = await diskFreeGB();
    r.quotaAfter = await evalStep(() => navigator.storage.estimate());
    Object.assign(R.steps.big, r); await save(); log('big', r.writeMBps?.toFixed(0), 'w', r.readMBps?.toFixed(0), 'r', JSON.stringify(r.processMemory));
    await W('remove', { name: 'big.bin' });
  }

  // --- 2: async streaming (createWritable) 1 GB and 4 GB ---
  R.steps.stream = [];
  for (const gb of [1, bigGB]) {
    await guard(gb);
    const stop = await startSampler(browser);
    const r = await retry(() => timedHold(`stream ${gb}GB`, () => evalStep(([gb, S]) => window.s2.streamWrite(`stream${gb}.bin`, gb * 1073741824 * S, 1048576), [gb, S])));
    r.processMemory = await stop(); R.steps.stream.push(r); await save(); log('stream', gb, r.writeMBps_excl_close?.toFixed(0), 'MB/s (excl close)', JSON.stringify(r.processMemory));
    await evalStep(() => window.s2.cleanupMain());
  }
  R.steps.leftoverOPFS = await evalStep(() => window.s2.cleanupMain());
  await save();

  // --- 3: Blob fallback (fresh page; may crash) ---
  const page2 = await newPage(); await page2.goto(`${BASE_URL}/s2-storage/index.html`); await page2.waitForFunction(() => !!window.s2);
  const progress = []; await page2.exposeFunction('__report', s => { progress.push(s); log('blob', JSON.stringify(s)); });
  const stopB = await startSampler(browser);
  const targets = smoke ? [64, 128] : [100, 500, 1000, 2000];
  R.steps.blob = { chunkMB: 100, progress };
  try {
    R.steps.blob.final = await timedHold('blob', () => page2.evaluate(([t]) => window.s2.blobTest(t, 100, window.__report), [targets]));
  } catch (e) { R.steps.blob.crashed = String(e).slice(0, 300); }
  R.steps.blob.processMemory = await stopB(); await save();
  await page2.close().catch(() => { });
} catch (e) {
  R.error = String(e?.stack || e); log('ERROR', R.error);
} finally {
  try { await page.evaluate(() => window.s2.cleanupMain()); } catch { }
  R.finishedAt = new Date().toISOString(); R.diskFreeGBAtEnd = await diskFreeGB(); await save();
  await (ctx ?? browser).close(); await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
log('done');
