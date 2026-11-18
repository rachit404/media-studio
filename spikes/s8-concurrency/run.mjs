// THROWAWAY S8 runner: node s8-concurrency/run.mjs
import { launchChrome, withBenchLock, envInfo, writeResult, BASE_URL } from '../shared/harness.mjs';
const FILE = 'h264_1080p30_gop2s_60s.mp4';
const browser = await launchChrome();
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
await page.goto(`${BASE_URL}/s8-concurrency/index.html`);
await page.waitForFunction(() => window.s8ready);
const out = { env: await envInfo(page), file: FILE, runs: [] };
try {
  for (const hw of ['prefer-hardware', 'prefer-software']) {
    for (const n of [1, 2, 3, 4, 6, 8, 12, 16]) {
      const r = await withBenchLock('s8', () => page.evaluate(({ f, n, hw }) => window.s8(f, n, 3000, hw), { f: FILE, n, hw }));
      out.runs.push(r);
      console.log(hw, 'n=' + n, 'working=' + r.working, 'failed=' + r.failed.length, 'totalFps=' + r.totalFps.toFixed(0), 'perDecoder=' + JSON.stringify(r.perDecoderFps.slice(0, 4)), r.failed[0]?.error ?? '');
    }
  }
  await writeResult('s8-concurrency', out);
} finally { await browser.close(); }
