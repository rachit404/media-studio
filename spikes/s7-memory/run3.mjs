// THROWAWAY S7 runner. node s7-memory/run.mjs <phase>   phases: check | bench
import { execFile } from 'node:child_process';
import { launchChrome, withBenchLock, envInfo, writeResult, BASE_URL } from '../shared/harness.mjs';
const phase = process.argv[2] ?? 'check';
const F1080 = 'h264_1080p30_gop2s_60s.mp4', F4K = 'h264_4k30_gop2s_20s.mp4';
const MARK = `s7marker${process.pid}`;
const browser = await launchChrome({ args: [`--s7-marker=${MARK}`] });
const page = await browser.newPage();
page.on('crash', () => console.log('[PAGE CRASH]')); browser.on('disconnected', () => console.log('[BROWSER DISCONNECTED]')); page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
await page.goto(`${BASE_URL}/s7-memory/index.html${process.env.DIRECT ? '?direct=1' : ''}`);
await page.waitForFunction(() => window.s7ready);
const call = (msg) => page.evaluate((m) => window.s7(m), msg);

/** Sum working set (MB) of the browser process + its direct children (renderer/GPU/utility) that we launched, identified by the marker arg. */
function chromeTreeMB() {
  const ps = `$all = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"; $root = $all | Where-Object { $_.CommandLine -like '*${MARK}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1; if(-not $root){ '{}'; exit }; $o=@{}; $o['browser']=[math]::Round($root.WorkingSetSize/1MB); $tot=$root.WorkingSetSize; foreach($p in ($all | Where-Object { $_.ParentProcessId -eq $root.ProcessId })){ $t='other'; if($p.CommandLine -match '--type=([a-z-]+)'){ $t=$Matches[1] }; if($p.CommandLine -match 'gpu-process'){ $t='gpu' }; $o[$t]=[math]::Round(($o[$t]+$p.WorkingSetSize/1MB)); $tot+=$p.WorkingSetSize }; $o['total']=[math]::Round($tot/1MB); $o | ConvertTo-Json -Compress`;
  return new Promise((res) => execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 15000 }, (e, so) => { try { res(e ? null : JSON.parse(so.trim())); } catch { res(null); } }));
}
async function withOsSampling(fn, everyMs = 10000) {
  const os = []; const t0 = Date.now(); let stop = false;
  const loop = (async () => { while (!stop) { const v = await chromeTreeMB(); os.push({ tSec: +((Date.now() - t0) / 1000).toFixed(0), procMB: v }); await new Promise((r) => setTimeout(r, everyMs)); } })();
  const r = await fn(); stop = true; await loop; return { r, os };
}

import { readFile } from 'node:fs/promises'; const out = JSON.parse(await readFile(new URL('../results/s7-memory.json', import.meta.url))); out.env = await envInfo(page);
try {
  const L = (fn) => withBenchLock('s1', fn);
  const run = async (name, msg) => {
    const { r, os } = await L(() => withOsSampling(() => call(msg)));
    r.osSamples = os; out[name].push(r);
    const summ = { ...r }; delete summ.samples; delete summ.osSamples;
    console.log(name, JSON.stringify(summ).slice(0, 700), 'OS MB:', os.map((o) => (o.procMB?.total)).join(','));
    await writeResult('s7-memory', out);
  };
  await run('scrub', { cmd: 'scrub', file: F1080, hw: 'prefer-hardware', cacheMax: 60, durSec: 20, seed: 5 });
  await run('proxy', { cmd: 'proxy', file: F1080, decHw: 'prefer-hardware', encHw: 'no-preference', bitrate: 3_000_000 });
  await run('proxy', { cmd: 'proxy', file: F4K, decHw: 'prefer-hardware', encHw: 'no-preference', bitrate: 3_000_000 });
  await run('proxy', { cmd: 'proxy', file: F1080, decHw: 'prefer-hardware', encHw: 'prefer-software', bitrate: 3_000_000 });
} finally { await browser.close(); }
