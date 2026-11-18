// THROWAWAY S9 soak: play and scrub in the real app (production build) for N minutes while sampling memory of the
// whole browser process tree. node s9-soak/run.mjs <minutes>   (needs the app preview on :4173 and the fixture)
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchChrome, envInfo, writeResult } from '../shared/harness.mjs';

const MINUTES = Number(process.argv[2] ?? 30);
const APP = 'http://127.0.0.1:4173';
const FILE = new URL('../fixtures/soak_1080p30_gop2s_120s.mp4', import.meta.url);
const MARK = `s9marker${process.pid}`;

/** Working set (MB) of the browser process and its direct children (renderer, GPU, utility), by role. */
function chromeTreeMB() {
  const ps = `$all = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"; $root = $all | Where-Object { $_.CommandLine -like '*${MARK}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1; if(-not $root){ '{}'; exit }; $o=@{}; $o['browser']=[math]::Round($root.WorkingSetSize/1MB); $tot=$root.WorkingSetSize; foreach($p in ($all | Where-Object { $_.ParentProcessId -eq $root.ProcessId })){ $t='other'; if($p.CommandLine -match '--type=([a-z-]+)'){ $t=$Matches[1] }; if($p.CommandLine -match 'gpu-process'){ $t='gpu' }; $o[$t]=[math]::Round(($o[$t]+$p.WorkingSetSize/1MB)); $tot+=$p.WorkingSetSize }; $o['total']=[math]::Round($tot/1MB); $o | ConvertTo-Json -Compress`;
  return new Promise((res) => execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 20000 }, (e, so) => { try { res(e ? null : JSON.parse(so.trim())); } catch { res(null); } }));
}

const browser = await launchChrome({ headless: true, args: [`--s9-marker=${MARK}`, '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('crash', () => console.log('[PAGE CRASH]'));
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const out = { env: null, minutes: MINUTES, samples: [], cycles: 0, seeks: 0, errors };
try {
  await page.goto(APP + '/');
  out.env = await envInfo(page);
  await page.getByRole('button', { name: 'New video project' }).click();
  await page.getByLabel('Project name').fill('Soak');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByTestId('import-media-input').setInputFiles(fileURLToPath(FILE));
  await page.getByRole('list', { name: 'Project media' }).getByText(/soak_1080p30/).waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: /^Add to timeline: soak/ }).click();
  await page.getByRole('group', { name: 'Video 1' }).getByRole('button', { name: /^soak_1080p30/ }).waitFor();
  await page.getByRole('button', { name: 'Fit' }).click();

  const scroll = page.getByTestId('timeline-scroll');
  const t0 = Date.now();
  const sample = async (phase) => {
    const heap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
    out.samples.push({ tSec: Math.round((Date.now() - t0) / 1000), phase, heapMB: heap, procMB: await chromeTreeMB(), clock: await page.getByTestId('clock').textContent() });
  };
  await sample('start');
  let nextSample = 0;
  while (Date.now() - t0 < MINUTES * 60_000) {
    out.cycles += 1;
    // Play for 25 s from a random place.
    const box = await scroll.boundingBox();
    await page.mouse.click(box.x + 20 + Math.random() * (box.width - 60), box.y + 12);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    for (let i = 0; i < 5; i++) { await page.waitForTimeout(5000); if (Date.now() - t0 >= nextSample) { await sample('play'); nextSample += 10_000; } }
    await page.getByRole('button', { name: 'Pause' }).click().catch(() => {});
    // Scrub: 40 seeks, one every 150 ms (drag along the ruler), as fast as a person would.
    for (let i = 0; i < 40; i++) {
      await page.mouse.click(box.x + 20 + Math.random() * (box.width - 60), box.y + 12);
      out.seeks += 1;
      await page.waitForTimeout(150);
      if (Date.now() - t0 >= nextSample) { await sample('scrub'); nextSample += 10_000; }
    }
    await page.waitForTimeout(1500);
  }
  await sample('end');
} finally {
  await writeResult('s9-soak', out);
  await browser.close();
}
const totals = out.samples.map((s) => s.procMB?.total).filter(Boolean);
console.log('samples', out.samples.length, 'cycles', out.cycles, 'seeks', out.seeks, 'first/last/max total MB', totals[0], totals.at(-1), Math.max(...totals), 'errors', errors.length);
