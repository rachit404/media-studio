// M7 export speed measurement (PERF-4): exports a 1080p clip with sound and a title over it in the real app and
// records how long it took against how long the video is. Not a pass/fail test: speed depends on the machine, so the
// numbers are recorded in docs/engineering/m7-export-measurement.md.
//
//   pnpm build
//   pnpm --filter @media-studio/web preview --port 4273 --strictPort     (in another terminal)
//   BASE_URL=http://127.0.0.1:4273 node spikes/m7-export/run.mjs
//
// Needs ffmpeg for the test media (made in the OS temp folder, never committed). Each run exports 10 s of 1920x1080
// at 30 fps (two layers: the video and a title) as MP4 with the encoder set to Automatic, then to software.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { basename, join } from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4273';
const OUT = process.env.OUT ?? 'spikes/results/m7-export.json';
const SECONDS = Number(process.env.SECONDS ?? 10);
const SIZE = process.env.SIZE ?? '1920x1080'; // for example 3840x2160 for the 4K check
const HARD_LIMIT_MS = 9 * 60 * 1000;

setTimeout(() => {
  console.error('Hard time limit reached, stopping.');
  process.exit(2);
}, HARD_LIMIT_MS).unref();

const DIR = join(tmpdir(), 'media-studio-m7-export');
mkdirSync(DIR, { recursive: true });
const clip = join(DIR, `ref-${SIZE}-${String(SECONDS)}s.mp4`);
if (!existsSync(clip)) {
  execFileSync(
    'ffmpeg',
    [
      ...['-y', '-loglevel', 'error'],
      ...['-f', 'lavfi', '-i', `testsrc2=s=${SIZE}:r=30:d=${String(SECONDS)}`],
      ...['-f', 'lavfi', '-i', `sine=frequency=330:duration=${String(SECONDS)}`],
      ...['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '30'],
      ...['-c:a', 'aac', '-shortest', clip],
    ],
    { stdio: 'inherit', timeout: 4 * 60 * 1000 },
  );
}

const clipName = basename(clip);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(60_000);

await page.goto(BASE_URL);
await page.getByRole('button', { name: 'New video project' }).click();
await page.getByLabel('Project name').fill('Export speed');
await page.getByRole('button', { name: 'Create project' }).click();
await page.getByRole('textbox', { name: 'Project name' }).waitFor();
await page.getByTestId('import-media-input').setInputFiles([clip]);
await page
  .getByRole('list', { name: 'Project media' })
  .getByText(clipName, { exact: true })
  .waitFor({ timeout: 180_000 });
await page.getByRole('button', { name: `Add to timeline: ${clipName}` }).click();
await page.getByRole('button', { name: 'Add text' }).click();

const results = [];
for (const [label, encoder] of [
  ['automatic', 'no-preference'],
  ['software', 'prefer-software'],
]) {
  await page.getByRole('button', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export video' });
  await dialog.getByLabel('Preset').selectOption('best');
  await dialog.getByText('More settings').click();
  await dialog.getByLabel('Encoder').selectOption(encoder);
  await dialog.getByRole('checkbox', { name: /^Check the finished file/ }).uncheck();
  if (process.env.DEBUG_DIALOG) console.log(await dialog.innerText());
  const started = Date.now();
  await dialog.getByRole('button', { name: 'Start export' }).click();
  await dialog.getByRole('link', { name: /^Download/ }).waitFor({ timeout: 8 * 60 * 1000 });
  const wallSeconds = (Date.now() - started) / 1000;
  const size = await dialog.getByRole('status').first().innerText();
  results.push({
    encoder: label,
    videoSeconds: SECONDS,
    wallSeconds: Number(wallSeconds.toFixed(1)),
    timesRealTime: Number((SECONDS / wallSeconds).toFixed(2)),
    note: size,
  });
  console.log(label, results.at(-1));
  await dialog.getByRole('button', { name: 'Close' }).click();
}
await browser.close();

const report = {
  when: new Date().toISOString(),
  machine: {
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    os: `${platform()} ${release()}`,
  },
  project: `${SIZE} 30 fps, ${String(SECONDS)} s, one video layer and a title, sound; preset "Best quality, sequence size"`,
  results,
};
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${OUT}`);
