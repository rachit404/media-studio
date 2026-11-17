// node spikes/s6-probe/run.mjs  -> spikes/results/s6-probe.json + prints matrix. Re-run the probe anywhere:
//   (Linux/CI) start `npm run dev` in spikes/, then run this with CHROME_PATH=/path/to/chrome node s6-probe/run.mjs
import { chromium } from 'playwright-core';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL, SPIKES_DIR, writeResult } from '../shared/harness.mjs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const targets = [
  { name: 'chrome-headed', exe: CHROME, headless: false },
  { name: 'chrome-headless', exe: CHROME, headless: true },
  { name: 'edge-headed', exe: EDGE, headless: false },
  { name: 'edge-headless', exe: EDGE, headless: true },
];
const results = { generatedAt: new Date().toISOString(), note: 'Other agents may have been running concurrently; this probe is capability-only (not timed) except opfsWriteMBps.', targets: {} };
for (const t of targets) {
  if (!existsSync(t.exe)) { results.targets[t.name] = { error: 'executable not found' }; continue; }
  let browser;
  try {
    browser = await chromium.launch({ executablePath: t.exe, headless: t.headless, args: ['--no-first-run', '--no-default-browser-check'] });
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log(t.name, 'pageerror', e.message));
    await page.goto(`${BASE_URL}/s6-probe/index.html`);
    await page.waitForFunction(() => window.__probe && window.__probe.roundTrip, null, { timeout: 120000 });
    results.targets[t.name] = { version: browser.version(), ...(await page.evaluate(() => window.__probe)) };
    console.log(t.name, 'ok', browser.version());
  } catch (e) {
    results.targets[t.name] = { error: String(e) };
    console.log(t.name, 'FAILED', String(e).slice(0, 200));
  } finally { await browser?.close(); }
}
await writeResult('s6-probe', results);
