// THROWAWAY spike helper. Shared by all spike runner scripts.
//
// Usage from a runner script (node spikes/sN-xxx/run.mjs):
//   import { launchChrome, withBenchLock, envInfo, writeResult } from '../shared/harness.mjs';
//
// Why a lock: spikes S1/S3/S4/S7 measure speed on the same integrated GPU/CPU. Several agents work in parallel,
// so *timed* runs must be serialised. Develop and check correctness freely; wrap only the timed run in withBenchLock().

import { chromium } from 'playwright-core';
import { mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SPIKES_DIR = resolve(here, '..');
export const BASE_URL = 'http://127.0.0.1:5199';
const LOCK_DIR = resolve(SPIKES_DIR, '.bench-lock');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/** Launch the user's real Chrome (branded: has H.264/AAC) with a fresh temp profile. headless:false gives the most realistic GPU path. */
export async function launchChrome({ headless = false, args = [] } = {}) {
  return chromium.launch({
    executablePath: CHROME,
    headless,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', ...args],
  });
}

/** Run fn while holding the global benchmark lock (atomic mkdir). Waits up to maxWaitMs; steals locks older than 12 minutes. */
export async function withBenchLock(owner, fn, { maxWaitMs = 10 * 60_000 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      await mkdir(LOCK_DIR);
      await writeFile(resolve(LOCK_DIR, 'owner.txt'), `${owner} ${new Date().toISOString()}`);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const s = await stat(LOCK_DIR);
        if (Date.now() - s.mtimeMs > 12 * 60_000) { await rm(LOCK_DIR, { recursive: true, force: true }); continue; }
      } catch { /* lock vanished, retry */ }
      if (Date.now() - start > maxWaitMs) throw new Error(`bench lock wait timed out (${owner})`);
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  try { return await fn(); } finally { await rm(LOCK_DIR, { recursive: true, force: true }); }
}

/** Collect machine/browser facts to store next to every result. Run inside a page. */
export async function envInfo(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      cores: navigator.hardwareConcurrency,
      deviceMemoryGB: /** @type {any} */ (navigator).deviceMemory ?? null,
      webgl2: !!gl,
      glRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      webgpu: 'gpu' in navigator,
      crossOriginIsolated: self.crossOriginIsolated,
      secureContext: self.isSecureContext,
    };
  });
}

/** Write results/<name>.json (machine-readable). Write the human summary to results/<name>.md yourself. */
export async function writeResult(name, data) {
  const dir = resolve(SPIKES_DIR, 'results');
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, `${name}.json`), JSON.stringify(data, null, 2));
}
