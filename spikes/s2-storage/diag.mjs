// THROWAWAY diagnostic for the intermittent QuotaExceededError. node s2-storage/diag.mjs
import { launchChrome, withBenchLock, BASE_URL, writeResult } from '../shared/harness.mjs';
const browser = await launchChrome(); const page = await browser.newPage(); const out = { runs: [] };
try {
  await page.goto(`${BASE_URL}/s2-storage/index.html`); await page.waitForFunction(() => !!window.s2);
  for (const a of [{ chunk: 65536, prealloc: false }, { chunk: 4194304, prealloc: false }, { chunk: 1048576, prealloc: true }]) {
    const r = await withBenchLock('s2', () => page.evaluate(a => window.s2.callW('A', 'untilFail', { name: 'd.bin', maxBytes: 2 * 1073741824, ...a }), a));
    out.runs.push(r); console.log(JSON.stringify(r).slice(0, 900));
  }
  await page.evaluate(() => window.s2.cleanupMain());
} finally { await browser.close(); }
await writeResult('s2-storage.diag', out);
