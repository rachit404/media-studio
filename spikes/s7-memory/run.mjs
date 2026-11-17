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

import { readFile } from 'node:fs/promises';
let prev = {}; try { prev = JSON.parse(await readFile(new URL('../results/s7-memory.json', import.meta.url))); } catch { /* none */ }
const out = { env: await envInfo(page), playback: [], scrub: [], proxy: [], playbackDirect: [], scrubDirect: [], ...prev };
if (!out.playbackDirect) out.playbackDirect = [];
try {
  console.log('heap api in worker:', JSON.stringify(await call({ cmd: 'heap' })));
  if (phase === 'check') {
    const r = await call({ cmd: 'playback', file: F1080, hw: 'prefer-hardware', cacheMax: 60, kind: 'bitmap', clips: 6, clipSec: 2, label: 'check' });
    delete r.samples; console.log(JSON.stringify(r, null, 1));
    const s = await call({ cmd: 'scrub', file: F1080, hw: 'prefer-hardware', cacheMax: 60, durSec: 5, seed: 3 }); delete s.samples; console.log(JSON.stringify(s, null, 1));
    const pr = await call({ cmd: 'proxy', file: F1080, decHw: 'prefer-hardware', encHw: 'no-preference', bitrate: 2_000_000, maxFrames: 150 }); console.log(JSON.stringify(pr, null, 1));
  } else if (phase === 'diag') {
    for (const cm of [60, 4]) {
      const { r, os } = await withBenchLock('s1', () => withOsSampling(() => call({ cmd: 'playback', file: F1080, hw: 'prefer-hardware', cacheMax: cm, kind: 'bitmap', clips: 30, clipSec: 1, label: 'diag' }), 5000));
      console.log('cacheMax', cm, 'missed', r.missed, 'counters', JSON.stringify(r.counters), 'heap', JSON.stringify(r.heapMB), r.error);
      for (const o of os) console.log('  ', o.tSec, JSON.stringify(o.procMB));
    }
  } else if (phase === 'heap') {
    const L = (fn) => withBenchLock('s1', fn);
    const run = async (name, msg) => {
      const { r, os } = await L(() => withOsSampling(() => call(msg)));
      r.osSamples = os; out[name].push(r);
      const summ = { ...r }; delete summ.samples; delete summ.osSamples;
      console.log(name, JSON.stringify(summ).slice(0, 900), 'OS MB:', os.map((o) => (o.procMB?.total)).join(','));
    };
    await run('playbackDirect', { cmd: 'playback', file: F1080, hw: 'prefer-hardware', cacheMax: 60, kind: 'bitmap', clips: 30, clipSec: 3, label: 'MAIN-THREAD main-60-bitmap-HW-90s' });
    await run('scrubDirect', { cmd: 'scrub', file: F1080, hw: 'prefer-hardware', cacheMax: 60, durSec: 20, seed: 5 });
    await writeResult('s7-memory', out);
  } else {
    const L = (fn) => withBenchLock('s1', fn); // same lock name used for all 'timed' agent S1/S7 runs by this agent
    const run = async (name, msg) => {
      const { r, os } = await L(() => withOsSampling(() => call(msg)));
      r.osSamples = os; out[name].push(r);
      const summ = { ...r }; delete summ.samples; delete summ.osSamples; delete summ.cachePlaceholder;
      console.log(name, JSON.stringify(summ).slice(0, 900), 'OS MB:', os.map((o) => (o.procMB?.total)).join(','));
      return r;
    };
    // (a) playback: main = 60-frame bitmap cache, 30 clips x 3 s = 90 s realtime
    await run('playback', { cmd: 'playback', file: F1080, hw: 'prefer-hardware', cacheMax: 60, kind: 'bitmap', clips: 30, clipSec: 3, label: 'main-60-bitmap-HW-90s' });
    await run('playback', { cmd: 'playback', file: F1080, hw: 'prefer-hardware', cacheMax: 30, kind: 'bitmap', clips: 30, clipSec: 1, label: 'cache30-bitmap-HW-30s' });
    await run('playback', { cmd: 'playback', file: F1080, hw: 'prefer-hardware', cacheMax: 120, kind: 'bitmap', clips: 30, clipSec: 1, label: 'cache120-bitmap-HW-30s' });
    // cache of raw VideoFrames (what ADR-0007 literally says): HW (expected to stall) and SW
    await run('playback', { cmd: 'playback', file: F1080, hw: 'prefer-hardware', cacheMax: 60, kind: 'videoframe', clips: 10, clipSec: 1, label: 'cache60-VIDEOFRAME-HW-10s' });
    await run('playback', { cmd: 'playback', file: F1080, hw: 'prefer-software', cacheMax: 60, kind: 'videoframe', clips: 15, clipSec: 2, label: 'cache60-VIDEOFRAME-SW-30s' });
    await run('playback', { cmd: 'playback', file: F1080, hw: 'prefer-software', cacheMax: 60, kind: 'bitmap', clips: 15, clipSec: 2, label: 'cache60-bitmap-SW-30s' });
    // scrub
    await run('scrub', { cmd: 'scrub', file: F1080, hw: 'prefer-hardware', cacheMax: 60, durSec: 20, seed: 5 });
    await run('scrub', { cmd: 'scrub', file: F1080, hw: 'prefer-software', cacheMax: 60, durSec: 20, seed: 5 });
    // (b) proxy
    for (const encHw of ['no-preference', 'prefer-software']) {
      await run('proxy', { cmd: 'proxy', file: F1080, decHw: 'prefer-hardware', encHw, bitrate: 3_000_000 });
      await run('proxy', { cmd: 'proxy', file: F4K, decHw: 'prefer-hardware', encHw, bitrate: 3_000_000 });
    }
    await writeResult('s7-memory', out);
  }
} finally { await browser.close(); }
