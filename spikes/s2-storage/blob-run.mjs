// THROWAWAY S2 blob-only re-run (the blob step in run.mjs lost its page; see results). node s2-storage/blob-run.mjs
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { withBenchLock, writeResult, BASE_URL } from '../shared/harness.mjs';
const MB = 1 << 20;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
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


const profileDir = await mkdtemp(path.join(os.tmpdir(), 's2-profile-'));
const ctx = await chromium.launchPersistentContext(profileDir, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, args: ['--no-first-run', '--no-default-browser-check'] });
const browser = ctx.browser(); const R = { startedAt: new Date().toISOString(), progress: [] };
const targets = (process.env.TARGETS || '100,500,1000,2000').split(',').map(Number);
try {
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('crash', () => { R.pageCrashed = true; log('PAGE CRASHED'); });
  await page.goto(`${BASE_URL}/s2-storage/index.html`); await page.waitForFunction(() => !!window.s2);
  await page.exposeFunction('__report', s => { R.progress.push(s); log('blob', JSON.stringify(s)); });
  const stop = await startSampler(browser);
  try { R.final = await withBenchLock('s2', () => page.evaluate(([t]) => window.s2.blobTest(t, 100, window.__report), [targets])); }
  catch (e) { R.crashed = String(e).slice(0, 400); log('ERR', R.crashed); }
  R.processMemory = await stop();
} finally { R.finishedAt = new Date().toISOString(); await writeResult('s2-storage.blob', R); await ctx.close().catch(() => {}); await rm(profileDir, { recursive: true, force: true }).catch(() => {}); }
log('done');
