// THROWAWAY S1 runner. node s1-decode/run.mjs <phase>   phases: check | bench
import { launchChrome, withBenchLock, envInfo, writeResult, BASE_URL } from '../shared/harness.mjs';
const phase = process.argv[2] ?? 'check';
const F = { h264: 'h264_1080p30_gop2s_60s.mp4', k4: 'h264_4k30_gop2s_20s.mp4', vp9: 'f1080p30_vp9_opus_10s.webm', hevc: 'hevc_1080p30_10s.mp4', gop10: 'h264_1080p30_gop10s_30s.mp4' };
const browser = await launchChrome();
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('[page]', m.text()); });
await page.goto(`${BASE_URL}/s1-decode/index.html`);
await page.waitForFunction(() => window.s1ready);
const call = (msg) => page.evaluate((m) => window.s1(m), msg);
const out = { env: await envInfo(page), fixtures: {}, support: {}, seq: [], seqMB: [], seek: [], seekMB: [], gopCache: [] };
try {
  for (const [k, f] of Object.entries(F)) { out.fixtures[k] = { file: f, ...(await call({ cmd: 'info', file: f })) }; out.support[k] = await call({ cmd: 'support', file: f }); }
  console.log(JSON.stringify(out.support, null, 1));
  if (phase === 'check') {
    console.log(JSON.stringify(out.fixtures, null, 1));
    console.log(JSON.stringify(await call({ cmd: 'seq', file: F.h264, hw: 'prefer-hardware' })));
    const r = await call({ cmd: 'seekRaw', file: F.h264, hw: 'prefer-hardware', n: 5 }); delete r.samples; console.log(JSON.stringify(r, null, 1));
    console.log(JSON.stringify(await call({ cmd: 'seekMB', file: F.h264, hw: 'prefer-hardware', n: 5 })));
    console.log(JSON.stringify(await call({ cmd: 'seekGop', file: F.h264, hw: 'prefer-hardware', n: 8 })));
  } else {
    const L = (fn) => withBenchLock('s1', fn);
    const jobs = [];
    for (const [k, f] of [['h264', F.h264], ['k4', F.k4], ['vp9', F.vp9], ['hevc', F.hevc]])
      for (const hw of ['prefer-hardware', 'prefer-software']) jobs.push({ k, f, hw });
    for (const j of jobs) {
      for (let rep = 0; rep < 2; rep++) {
        const r = await L(() => call({ cmd: 'seq', file: j.f, hw: j.hw }));
        r.key = j.k; r.rep = rep; out.seq.push(r); console.log('seq', j.k, j.hw, rep, r.status, r.fps?.toFixed(1), r.realtimeX?.toFixed(2));
        if (r.status !== 'OK') break;
      }
    }
    for (const [k, f] of [['h264', F.h264], ['vp9', F.vp9]]) for (const hw of ['prefer-hardware', 'prefer-software']) {
      const r = await L(() => call({ cmd: 'seqMB', file: f, hw })); r.key = k; out.seqMB.push(r); console.log('seqMB', k, hw, r.fps?.toFixed(1));
    }
    for (const [k, f] of [['gop2', F.h264], ['gop10', F.gop10]]) for (const hw of ['prefer-hardware', 'prefer-software']) {
      const r = await L(() => call({ cmd: 'seekRaw', file: f, hw, n: 30, seed: 7 })); r.key = k; out.seek.push(r);
      console.log('seek', k, hw, JSON.stringify(r.latencyMs));
      const m = await L(() => call({ cmd: 'seekMB', file: f, hw, n: 30, seed: 7 })); m.key = k; out.seekMB.push(m); console.log('seekMB', k, hw, JSON.stringify(m.latencyMs));
    }
    for (const [k, f] of [['gop2', F.h264], ['gop10', F.gop10]]) {
      const r = await L(() => call({ cmd: 'seekGop', file: f, hw: 'prefer-hardware', n: 30, seed: 7, stepSec: 1.5 })); r.key = k; out.gopCache.push(r);
      console.log('gopCache', k, JSON.stringify([r.uncachedMs, r.cachedMs, r.hitRate, r.peakCachedFrames]));
    }
    await writeResult('s1-decode', out);
  }
} finally { await browser.close(); }
