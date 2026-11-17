// THROWAWAY S3 runner. usage: node s3-render/run.mjs smoke | bench
import { launchChrome, withBenchLock, envInfo, writeResult, BASE_URL } from '../shared/harness.mjs';

const mode = process.argv[2] ?? 'smoke';
const browser = await launchChrome({ headless: false, args: ['--window-size=1300,820', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.route('**/@vite/client', r => r.fulfill({ contentType: 'text/javascript', body: 'export const createHotContext=()=>({accept(){},dispose(){},prune(){},on(){},send(){},invalidate(){}});export const injectQuery=u=>u;export const updateStyle=()=>{};export const removeStyle=()=>{};' })); // other agents write files under spikes/, which would trigger HMR full reloads mid-benchmark
const page = await ctx.newPage();
page.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log('[page]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 500)));
await page.goto(`${BASE_URL}/s3-render/index.html`);
await page.waitForFunction(() => window.S3, null, { timeout: 60000 });
await page.bringToFront();
const call = (expr, timeout = 180000) => page.evaluate(expr, undefined, { timeout }).catch(e => ({ error: String(e).slice(0, 600) }));
const J = o => JSON.stringify(o);
const R = mode === 'rest' ? JSON.parse((await import('node:fs')).readFileSync(new URL('../results/s3-render.json', import.meta.url), 'utf8')) : { env: await envInfo(page), spike: 'S3', date: new Date().toISOString() };
const lock = fn => withBenchLock('s3', fn);
const step = async (name, fn) => { const t = Date.now(); const r = await fn(); R[name] = r; console.log(`== ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)\n`, J(r).slice(0, 1800)); return r; };

try {
  await step('rafCheck', () => call('S3.rafCheck(2)'));
  if (mode === 'rest') { await step('uploadBench', () => lock(() => call('S3.uploadBench(150)'))); await step('worker_novideo', () => lock(() => call('S3.workerRun(300,false)'))); await step('worker_video', () => lock(() => call('S3.workerRun(300,true)'))); await step('worker_novideo_run2', () => lock(() => call('S3.workerRun(300,false)'))); await step('worker_video_run2', () => lock(() => call('S3.workerRun(300,true)'))); await writeResult('s3-render', R); await browser.close(); process.exit(0); }
  const bl = await step('blend', () => call('S3.blend()'));
  if (bl.overlayDetail) { const d = bl.overlayDetail; const mx = f => Math.max(...d.filter(f).map(x => x.e)); bl.overlayByAlpha = { alpha1_maxErr: mx(x => x.a === 1), alpha075_maxErr: mx(x => x.a === 0.75), alpha05_maxErr: mx(x => x.a === 0.5), alpha025_maxErr: mx(x => x.a === 0.25) }; delete bl.overlayDetail; console.log(JSON.stringify(bl.overlayByAlpha)); }
  if (mode === 'smoke') {
    await step('smoke_interactive_novideo', () => call('S3.interactive(3,false)'));
    await step('smoke_interactive_video', () => call('S3.interactive(3,true)'));
    await step('smoke_unpaced_vf', () => call('S3.unpaced(false,S3.FULL,60,"videoframe")'));
    await step('smoke_raw', () => call('S3.raw(true,60,false)'));
    await step('smoke_worker', () => call('S3.workerRun(60,false)'));
  } else {
    await page.bringToFront();
    await step('interactive_novideo', () => lock(async () => { await page.bringToFront(); return call('S3.interactive(10,false)'); }));
    await step('interactive_video', () => lock(async () => { await page.bringToFront(); return call('S3.interactive(10,true)'); }));
    await step('interactive_simple_video', () => lock(async () => { await page.bringToFront(); return call('S3.interactive(10,true,S3.SIMPLE)'); }));
    await step('rafCheckAfter', () => call('S3.rafCheck(2)'));
    await step('export_finish_novideo', () => lock(() => call('S3.unpaced(false,S3.FULL,300,"finish")')));
    await step('export_videoframe_novideo', () => lock(() => call('S3.unpaced(false,S3.FULL,300,"videoframe")')));
    await step('export_videoframe_video', () => lock(() => call('S3.unpaced(true,S3.FULL,300,"videoframe")')));
    await step('export_readpixels_video', () => lock(() => call('S3.unpaced(true,S3.FULL,300,"readpixels")')));
    await step('simple_pixi_finish_video', () => lock(() => call('S3.unpaced(true,S3.SIMPLE,300,"finish")')));
    await step('simple_pixi_finish_novideo', () => lock(() => call('S3.unpaced(false,S3.SIMPLE,300,"finish")')));
    await step('raw_finish_video', () => lock(() => call('S3.raw(true,300,false)')));
    await step('raw_finish_novideo', () => lock(() => call('S3.raw(false,300,false)')));
    await step('raw_videoframe_video', () => lock(() => call('S3.raw(true,300,true)')));
    await step('uploadBench', () => lock(() => call('S3.uploadBench(150)')));
    await step('worker_novideo', () => lock(() => call('S3.workerRun(300,false)')));
    await step('worker_video', () => lock(() => call('S3.workerRun(300,true)')));
  }
} finally {
  await writeResult(mode === 'smoke' ? 's3-render.smoke' : 's3-render', R);
  await browser.close();
}
