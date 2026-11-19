// Asks the installed Chrome which video encoder settings it accepts (by codec string, size and hardware preference).
// Run: node spikes/m7-export/probe.mjs
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:4273'); // any page on a secure origin: WebCodecs needs one
const results = await page.evaluate(async () => {
  const out = [];
  const base = { width: 1920, height: 1080, framerate: 30, bitrate: 11_000_000 };
  for (const codec of ['avc1.640028', 'avc1.64002A', 'avc1.4d0028', 'avc1.42001f', 'vp09.00.40.08', 'vp8']) {
    for (const hardwareAcceleration of ['no-preference', 'prefer-hardware', 'prefer-software']) {
      try {
        const r = await VideoEncoder.isConfigSupported({ codec, ...base, hardwareAcceleration });
        out.push(`${codec} ${hardwareAcceleration}: ${String(r.supported)}`);
      } catch (e) {
        out.push(`${codec} ${hardwareAcceleration}: ERROR ${String(e)}`);
      }
    }
  }
  for (const [w, h] of [[320, 240], [1280, 720], [1920, 1080], [1920, 1088]]) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: w, height: h, framerate: 30, bitrate: 5_000_000 });
      out.push(`avc ${w}x${h}: ${String(r.supported)}`);
    } catch (e) {
      out.push(`avc ${w}x${h}: ERROR ${String(e)}`);
    }
  }
  return out;
});
console.log(results.join('\n'));
await browser.close();
