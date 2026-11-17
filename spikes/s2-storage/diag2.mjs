// THROWAWAY: is the ceiling per file or per origin? Also async createWritable path until failure.
import { launchChrome, withBenchLock, BASE_URL, writeResult } from '../shared/harness.mjs';
const browser = await launchChrome(); const page = await browser.newPage(); const out = {};
try {
  await page.goto(`${BASE_URL}/s2-storage/index.html`); await page.waitForFunction(() => !!window.s2);
  out.multi = await withBenchLock('s2', () => page.evaluate(() => window.s2.callW('A', 'multi', { prefix: 'm', fileBytes: 128 * 1048576, maxFiles: 24, chunk: 1048576 })));
  console.log(JSON.stringify(out.multi));
  await page.evaluate(() => window.s2.cleanupMain());
  out.stream2GB = await withBenchLock('s2', () => page.evaluate(() => window.s2.streamWrite('st.bin', 2 * 1073741824, 1048576).catch(e => 'FAILED ' + e.name + ': ' + e.message + ' | heapMax=' + 0)));
  console.log(JSON.stringify(out.stream2GB).slice(0, 700));
  out.estimateEnd = await page.evaluate(() => navigator.storage.estimate());
  await page.reload(); await page.waitForFunction(() => !!window.s2); await page.evaluate(() => window.s2.cleanupMain());
} finally { await browser.close(); }
await writeResult('s2-storage.diag2', out);
