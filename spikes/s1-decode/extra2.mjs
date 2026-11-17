// THROWAWAY: adds holdTest (how many un-closed VideoFrames can be held) + seek re-check with hit verification to s1-decode.json
import { launchChrome, withBenchLock, writeResult, BASE_URL } from '../shared/harness.mjs';
import { readFile } from 'node:fs/promises';
const b = await launchChrome(); const page = await b.newPage();
try {
  await page.goto(`${BASE_URL}/s1-decode/index.html`); await page.waitForFunction(() => window.s1ready);
  const call = (m) => page.evaluate((x) => window.s1(x), m);
  const res = JSON.parse(await readFile(new URL('../results/s1-decode.json', import.meta.url)));
  res.holdTest = [];
  for (const hw of ['prefer-hardware', 'prefer-software']) {
    const r = await withBenchLock('s1', () => call({ cmd: 'hold', file: 'h264_1080p30_gop2s_60s.mp4', hw })); res.holdTest.push(r); console.log(JSON.stringify(r));
  }
  await writeResult('s1-decode', res);
} finally { await b.close(); }
