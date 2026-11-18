// M6 playback measurement (PERF-2): builds the reference project in the real app and plays it, counting the
// frames the preview skipped. Not a pass/fail test: timing depends on the machine, so the numbers are recorded in
// docs/engineering/m6-playback-measurement.md.
//
//   pnpm build
//   pnpm --filter @media-studio/web preview --port 4273 --strictPort     (in another terminal)
//   BASE_URL=http://127.0.0.1:4273 node spikes/m6-playback/run.mjs
//
// Reference project: 1920x1080 at 30 fps; V1 two 10 s clips with a cross-fade between them; V2 a 20 s clip over the
// top from 3 s at 80% opacity (two video layers decoded and composited from then on); a 3 s title; sound from the first video. Needs ffmpeg for the test media (made in the OS temp folder, never committed).
//
// How dropped frames are counted: the same rule as `Transport` (engine-video): every time the clock readout moves
// to a new frame number, `presented` goes up by one and `dropped` by the frames skipped in between. The readout is
// updated from the same ticks that draw the picture, so it sees what a user would see. Also recorded: the gaps
// between animation frames (browser jank) and the machine.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4273';
const RUNS = Number(process.env.RUNS ?? 3);
const FPS = 30;
const HARD_LIMIT_MS = 9 * 60 * 1000; // the whole script ends itself before 10 minutes
const OUT = process.env.OUT ?? 'spikes/results/m6-playback.json';

setTimeout(() => {
  console.error('Hard time limit reached, stopping.');
  process.exit(2);
}, HARD_LIMIT_MS).unref();

const DIR = join(tmpdir(), 'media-studio-m6-playback');
mkdirSync(DIR, { recursive: true });
function make(file, args) {
  const path = join(DIR, file);
  if (!existsSync(path)) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, path], {
      stdio: 'inherit',
      timeout: 4 * 60 * 1000,
    });
  }
  return { name: file, path };
}
const x264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '30'];
const files = [
  make('ref-a.mp4', [
    ...['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=10'],
    ...['-f', 'lavfi', '-i', 'sine=frequency=330:duration=10'],
    ...x264,
    ...['-c:a', 'aac', '-shortest'],
  ]),
  // No sound track on the overlay: a video with sound needs a free audio track under the drop, and this keeps the
  // drop simple. The sound of the project is the 20 s of ref-a.
  make('ref-b.mp4', [...['-f', 'lavfi', '-i', 'rgbtestsrc=s=1920x1080:r=30:d=20'], ...x264, '-an']),
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(30_000);

async function step(label, action) {
  const started = Date.now();
  await action();
  console.log(`${label} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

await step('create project', async () => {
  await page.goto(BASE_URL);
  await page.getByRole('button', { name: 'New video project' }).click();
  await page.getByLabel('Project name').fill('Reference project');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).waitFor();
});

await step('import media', async () => {
  await page.getByTestId('import-media-input').setInputFiles(files.map((f) => f.path));
  const list = page.getByRole('list', { name: 'Project media' });
  for (const f of files) await list.getByText(f.name, { exact: true }).waitFor({ timeout: 180_000 });
});

const addToTimeline = (name) =>
  page.getByRole('button', { name: `Add to timeline: ${name}` }).click();
const clip = (name, track) =>
  page.getByRole('group', { name: track }).getByRole('button', { name: new RegExp(`^${name}`) });

await step('build timeline', async () => {
  await addToTimeline('ref-a.mp4'); // V1 0 to 10 s
  await addToTimeline('ref-a.mp4'); // V1 10 to 20 s
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Add text' }).click(); // 3 s title at the start, on a new Video 2
  const lane = page.getByRole('group', { name: 'Video 2' });
  await lane.scrollIntoViewIfNeeded();
  // The second video on Video 2, from about 3.2 s, so two pictures are drawn from then on. The timeline zoom depends
  // on the width of the page, so the drop position comes from the width of a clip that is 10.033 s long.
  const longClip = await clip('ref-a.mp4', 'Video 1').first().boundingBox();
  const laneBox = await lane.boundingBox();
  const dropX = (longClip.x - laneBox.x) + (longClip.width / 10.033) * 3.2;
  await page
    .getByRole('list', { name: 'Project media' })
    .getByRole('listitem')
    .filter({ hasText: 'ref-b.mp4' })
    .dragTo(lane, { targetPosition: { x: dropX, y: 28 } });
  await clip('ref-b.mp4', 'Video 2').waitFor();
  await clip('ref-a.mp4', 'Video 1').nth(1).click();
  const select = page.getByLabel('Transition in', { exact: true });
  const kinds = await select.locator('option').evaluateAll((options) =>
    options.map((o) => ({ value: o.value, text: o.textContent ?? '' })),
  );
  const fade = kinds.find((k) => /cross|fade/i.test(k.text) && k.value !== '') ?? kinds[1];
  await select.selectOption(fade.value);
  console.log(`transition: ${fade.text}`);
  // The overlay clip on the second video track at 80% opacity, so both layers are really blended.
  await clip('ref-b.mp4', 'Video 2').click();
  await page.getByRole('slider', { name: 'Opacity' }).fill('80');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
});

const clockText = () => page.getByTestId('clock').textContent();

const machine = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    userAgent: navigator.userAgent,
    renderer: gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown',
    devicePixelRatio: window.devicePixelRatio,
  };
});

const results = [];
for (let run = 1; run <= RUNS; run += 1) {
  await page.keyboard.press('Home');
  await page.waitForTimeout(1500); // let the first picture decode
  await page.evaluate(
    ({ fps }) => {
      const parse = (text) => {
        const [h, m, s, f] = text.split(':').map(Number);
        return ((h * 60 + m) * 60 + s) * fps + f;
      };
      const output = document.querySelector('[data-testid="clock"]');
      const state = {
        presented: 0,
        dropped: 0,
        last: parse(output.textContent),
        first: parse(output.textContent),
        end: 0,
        startedAt: performance.now(),
        rafGaps: [],
        done: false,
      };
      new MutationObserver(() => {
        const frame = parse(output.textContent);
        if (frame === state.last) return;
        if (frame > state.last) {
          state.presented += 1;
          state.dropped += frame - state.last - 1;
        }
        state.last = frame;
        state.end = frame;
      }).observe(output, { childList: true, characterData: true, subtree: true });
      let previous = performance.now();
      const loop = (now) => {
        state.rafGaps.push(now - previous);
        previous = now;
        if (!state.done) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      window.__measure = state;
    },
    { fps: FPS },
  );
  await page.getByRole('button', { name: 'Play' }).click();
  const began = Date.now();
  // Playback stops itself at the end (20 s); give it up to 40 s.
  while (Date.now() - began < 40_000) {
    await page.waitForTimeout(500);
    if ((await page.getByRole('button', { name: 'Play' }).count()) > 0 && Date.now() - began > 2000) break;
  }
  const taken = await page.evaluate(() => {
    const state = window.__measure;
    state.done = true;
    const gaps = [...state.rafGaps].sort((a, b) => a - b);
    const at = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? 0;
    return {
      presented: state.presented,
      dropped: state.dropped,
      framesFrom: state.first,
      framesTo: state.end,
      seconds: (performance.now() - state.startedAt) / 1000,
      rafFrames: gaps.length,
      rafMedianMs: at(0.5),
      rafP99Ms: at(0.99),
      rafWorstMs: gaps[gaps.length - 1] ?? 0,
      rafOver50Ms: gaps.filter((g) => g > 50).length,
    };
  });
  const total = taken.presented + taken.dropped;
  const droppedPercent = total === 0 ? 0 : (taken.dropped / total) * 100;
  const entry = { run, ...taken, droppedPercent: Number(droppedPercent.toFixed(2)), clockAtEnd: await clockText() };
  results.push(entry);
  console.log(JSON.stringify(entry));
}

await browser.close();

const report = {
  date: new Date().toISOString(),
  base: BASE_URL,
  project: '1920x1080 30 fps; V1 2x10 s with a transition; V2 20 s from 3 s at 80% opacity; 3 s title; sound from the first video',
  machine: {
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryGB: Math.round(totalmem() / 2 ** 30),
    ...machine,
  },
  results,
  worstDroppedPercent: Math.max(...results.map((r) => r.droppedPercent)),
};
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${OUT}; worst dropped: ${report.worstDroppedPercent}% (limit 2%)`);
