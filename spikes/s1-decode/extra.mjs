import { launchChrome, withBenchLock, writeResult, BASE_URL } from '../shared/harness.mjs';
import { readFile } from 'node:fs/promises';
const b = await launchChrome(); const page = await b.newPage();
await page.goto(`${BASE_URL}/s1-decode/index.html`); await page.waitForFunction(() => window.s1ready);
const call = (m) => page.evaluate((x) => window.s1(x), m);
const res = JSON.parse(await readFile(new URL('../results/s1-decode.json', import.meta.url)));
res.gopCacheFill = [];
for (const [k, f] of [['gop2', 'h264_1080p30_gop2s_60s.mp4'], ['gop10', 'h264_1080p30_gop10s_30s.mp4']]) {
  const r = await withBenchLock('s1', () => call({ cmd: 'seekGop', file: f, hw: 'prefer-hardware', n: 12, seed: 11, stepSec: 25 })); r.key = k; res.gopCacheFill.push(r);
  console.log(k, JSON.stringify([r.uncachedMs, r.cachedMs, r.hitRate, r.peakCachedFrames]));
}
await writeResult('s1-decode', res);
await b.close();
