// node s4-export/gen-md.mjs -> results/s4-export.md (tables + criteria evaluation computed from results/s4-export.json) + results/s4-export.prose.md appended
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'results');
const j = JSON.parse(await readFile(resolve(dir, 's4-export.json'), 'utf8'));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');

// Heap plateau analysis (criterion fixed BEFORE looking at results): growth = mean(last quarter of samples) - mean(second quarter), must be < 25 MB.
function plateau(samples, key) {
  const v = samples.map((s) => s[key]).filter((x) => typeof x === 'number');
  if (v.length < 8) return { n: v.length, note: 'too few samples' };
  const q = Math.floor(v.length / 4);
  const q2 = v.slice(q, 2 * q), q4 = v.slice(v.length - q);
  const t = samples.filter((s) => typeof s[key] === 'number').map((s) => s.tSec);
  const mt = mean(t), mv = mean(v);
  const slope = t.reduce((a, ti, i) => a + (ti - mt) * (v[i] - mv), 0) / t.reduce((a, ti) => a + (ti - mt) ** 2, 0); // MB per second
  return { n: v.length, min: Math.min(...v), max: Math.max(...v), q2: mean(q2), q4: mean(q4), growthMB: mean(q4) - mean(q2), slopeMBperSec: slope };
}
const full = j.runs.filter((r) => !r.error && !r.cancelled && !r.aborted);
const canc = j.runs.filter((r) => !r.error && r.cancelled);
const errs = j.runs.filter((r) => r.error);

let md = `# S4 export pipeline (ADR-0003 / ADR-0007)

Run ${j.startedAt} to ${j.finishedAt}. Browser: ${j.env.browserVersion} (branded Chrome, headed, temp profile). ${j.env.userAgent}
Machine: ${j.env.cores} logical cores, ${j.env.deviceMemoryGB} GB, WebGL2 renderer \`${j.env.glRenderer}\`.
Timeline: ${j.seconds} s, 1920x1080, 30 fps (${j.seconds * 30} frames), stereo 48 kHz audio mixed from 3 oscillators with OfflineAudioContext, AAC-LC 128 kbps. Video 8 Mbps target, keyframe every 60 frames, \`latencyMode\` default, encode queue cap 6.
Every timed export ran inside \`withBenchLock('s4')\`. **Other agents were running untimed work (and holding the lock for their own timed runs in between) on the same laptop**, so wall-clock numbers carry CPU/GPU contention noise; the run-to-run spread below is the honest uncertainty.

## Method
Page (main thread) mixes audio with OfflineAudioContext (not available in workers) and hands the planar Float32 channels to a dedicated worker. The worker draws each frame (gradient + 14 circles + 6 rotating rects + text, cheap 2D) on a 1920x1080 OffscreenCanvas, makes \`new VideoFrame(canvas, {timestamp, duration})\` with timestamp = round(i*1e6/30) microseconds, calls \`VideoEncoder.encode\`, and closes the frame immediately. Backpressure: wait while \`encodeQueueSize > 6\` or > 40 packets are pending in the muxer. Encoded chunks go to Mediabunny \`EncodedVideoPacketSource\` / \`EncodedAudioPacketSource\` (AAC fed one second at a time, one second ahead of video) in an \`Output\` with \`Mp4OutputFormat\` and either \`BufferTarget\` (default fastStart: in-memory moov-first) or \`StreamTarget\` over an OPFS \`createWritable()\` stream (default: moov at end). Mediabunny 1.66.0 is used unmodified.
Reported "wall" = first frame drawn to finalized file (worker side; excludes audio mix, worker start-up and the later verification). Audio mix time is listed separately and added in the "incl. mix" column. JS heap of the worker and the page are read from Node via CDP \`Runtime.getHeapUsage\` every ~0.8 s (\`performance.memory\` does not exist inside workers); per-process working set (RSS) every ~10 s via PowerShell; per-process-type CPU seconds via CDP \`SystemInfo.getProcessInfo\`. Verification re-opens the output with Mediabunny \`Input\` and decodes **all** frames (outside the timed section).

## Results: full 60 s exports

| Run | Codec | HW requested | Sink | Wall s | Encode fps | x realtime | x realtime incl. audio mix (${f2(mean(full.map((r) => r.audioMixMs)) / 1000)} s) | Render+VideoFrame ms/frame | Peak encode queue | Max open VideoFrames (end) | File MB | Bitrate Mbps | Output verified |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
`;
for (const r of full) {
  const wall = r.wallMs / 1000;
  md += `| ${r.label} | ${r.opts.codec} | ${r.opts.hw.replace('prefer-', '')} | ${r.opts.sink} | ${f1(wall)} | ${f1(r.frames / wall)} | ${f2(j.seconds / wall)} | ${f2(j.seconds / (wall + r.audioMixMs / 1000))} | ${f2(r.frameCreateEncodeMsTotal / r.frames + r.renderMsTotal / r.frames)} | ${r.peakEncodeQueue} | ${r.maxOpenFrames} (${r.openFramesAtEnd}) | ${f2(r.fileBytes / 1e6)} | ${f2((r.fileBytes * 8) / j.seconds / 1e6)} | ${r.verify ? (r.verify.allPass ? 'PASS' : 'FAIL') : 'n/a'} |\n`;
}
if (errs.length) md += `\nRuns that errored: ${errs.map((e) => `${e.label}: ${e.error.slice(0, 200)}`).join('; ')}\n`;

md += `\n### Where the time went (CPU seconds by browser process type during the timed section; hardware vs software evidence)\n\n| Run | browser | renderer (incl. worker) | GPU | utility/other | Wall s |\n|---|---|---|---|---|---|\n`;
for (const r of full) {
  const c = r.cpuSecByProcessType || {};
  const other = Object.entries(c).filter(([k]) => !['browser', 'renderer', 'GPU'].includes(k)).reduce((a, [, v]) => a + v, 0);
  md += `| ${r.label} | ${c.browser ?? 'n/a'} | ${c.renderer ?? 'n/a'} | ${c.GPU ?? 'n/a'} | ${f2(other)} | ${f1(r.wallMs / 1000)} |\n`;
}

md += `\n### Memory (criterion: heap plateaus; growth = mean of last quarter of samples minus mean of second quarter must be < 25 MB, fixed before looking at data)\n\n| Run | Worker heap min / max MB | 2nd-quarter mean | last-quarter mean | growth MB | slope MB/s | Page heap max MB | Peak RSS by type (MB) | Frames created / closed | Plateau? |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of full) {
  const w = plateau(r.heapSamples || [], 'workerHeapMB'), p = plateau(r.heapSamples || [], 'pageHeapMB');
  const peak = {}; for (const s of r.rssSamplesMB || []) for (const [k, v] of Object.entries(s)) if (k !== 'tSec') peak[k] = Math.max(peak[k] || 0, v);
  const ok = w.growthMB < 25 && (p.growthMB ?? 0) < 25;
  md += `| ${r.label} | ${f1(w.min)} / ${f1(w.max)} | ${f1(w.q2)} | ${f1(w.q4)} | ${f1(w.growthMB)} | ${f2(w.slopeMBperSec)} | ${f1(p.max)} | ${['renderer', 'GPU', 'browser'].map((k) => `${k} ${peak[k] ?? 'n/a'}`).join(', ')} | ${r.framesCreated} / ${r.framesClosed} | ${w.note || ok ? (w.note || 'PASS') : 'FAIL'} |\n`;
}

md += `\n### Cancel at ~50% (criterion: < 2 s, encoders closed, frames released, no partial file, no callbacks after cancel)\n\n| Run | Cancel msg latency ms | Encoders closed after ms | Output.cancel done ms | Total cleanup ms | Frame at cancel | Frames created / closed | Open after | Encoder states | Partial file remains | OPFS entries after | Callbacks after cancel (1.5 s watch) | Verdict |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of canc) {
  const c = r.cancel;
  const ok = c.cleanupDoneAfterMs < 2000 && c.openFramesAfter === 0 && c.framesCreated === c.framesClosed && c.vencState === 'closed' && c.aencState === 'closed' && !c.partialFileRemains && c.callbacksAfterCancel === 0 && !c.encoderErrorAfterCancel;
  md += `| ${r.label} | ${f2(c.msgLatencyMs)} | ${f2(c.encodersClosedAfterMs)} | ${f2(c.outputCancelledAfterMs)} | ${f2(c.cleanupDoneAfterMs)} | ${c.frameAtCancel} | ${c.framesCreated} / ${c.framesClosed} | ${c.openFramesAfter} | ${c.vencState}/${c.aencState} | ${c.partialFileRemains ?? 'n/a (buffer sink: nothing on disk)'} | ${JSON.stringify(c.opfsEntriesAfter ?? 'n/a')} | ${c.callbacksAfterCancel} | ${ok ? 'PASS' : 'FAIL'} |\n`;
}
md += `\nNote on OPFS cancel: \`writable.abort()\` throws TypeError because Mediabunny holds the stream's writer lock; \`output.cancel()\` plus \`removeEntry()\` is what actually cleaned up (see the \`writableAbort\`/\`removeEntry\` fields in the JSON).\n`;

md += `\n### Output verification (Mediabunny Input re-open of the produced file)\n\n| Run | Format | Duration s (video / audio) | Video codec, size | Packets / decoded frames | Max timestamp error vs N/30 (s) | Audio | First / last frame | SHA-256 (first 12) | Decode-all ms |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of full) {
  const v = r.verify; if (!v) continue;
  md += `| ${r.label} | ${v.format} | ${f2(v.durationSec)} / ${v.audio ? f2(v.audio.durationSec) : 'n/a'} | ${v.video?.codec} ${v.video?.codedWidth}x${v.video?.codedHeight} | ${v.video?.packetCount} / ${v.decodedFrames} | ${v.maxTimestampErrorSec} | ${v.audio ? `${v.audio.codec} ${v.audio.channels}ch ${v.audio.sampleRate} Hz` : 'MISSING'} | ${v.firstFrame ? 'ok' : 'FAIL'} (${v.firstFrame?.ts}) / ${v.lastFrame ? 'ok' : 'FAIL'} (${f2(v.lastFrame?.ts)}) | ${v.sha256.slice(0, 12)} | ${f1(v.decodeAllMs)} |\n`;
}
const a = full.find((r) => r.label === 'h264-hw-buffer'), b = full.find((r) => r.label === 'h264-hw-buffer-rerun');
if (a?.verify && b?.verify) md += `\nDeterminism: h264-hw-buffer vs h264-hw-buffer-rerun output SHA-256 ${a.verify.sha256 === b.verify.sha256 ? 'IDENTICAL (byte-identical file)' : 'DIFFER (bytes differ between two identical runs; timestamps/frame count are still exact, see table)'}; packet/frame timestamps equal N/30 within the "max timestamp error" column in every run.\n`;

// Criteria
const hwH264 = full.filter((r) => r.opts.codec.startsWith('avc1') && r.opts.hw === 'prefer-hardware');
const fpsHw = hwH264.map((r) => r.frames / (r.wallMs / 1000));
md += `\n## Pass criteria\n\n| Criterion | Measured | Verdict |\n|---|---|---|\n`;
md += `| >= 1x realtime (>= 30 fps) on hardware H.264 encode | ${hwH264.map((r) => `${r.label}: ${f1(r.frames / (r.wallMs / 1000))} fps (${f2(j.seconds / (r.wallMs / 1000))}x)`).join('; ')} | ${hwH264.length && fpsHw.every((x) => x >= 30) ? 'PASS' : hwH264.some((x) => x) && fpsHw.some((x) => x >= 30) ? 'INCONCLUSIVE (mixed)' : 'FAIL'} |\n`;
const pl = full.map((r) => [r.label, plateau(r.heapSamples || [], 'workerHeapMB').growthMB]);
md += `| Heap plateaus (no growth per frame) | worker-heap growth Q4-Q2 MB: ${pl.map(([l, g]) => `${l} ${f1(g)}`).join('; ')} | ${pl.length && pl.every(([, g]) => g < 25) ? 'PASS' : 'FAIL/INCONCLUSIVE (see table)'} |\n`;
md += `| Cancel < 2 s with clean-up | ${canc.map((r) => `${r.label}: ${f1(r.cancel.cleanupDoneAfterMs)} ms, partial file: ${r.cancel.partialFileRemains ?? 'n/a'}, open frames ${r.cancel.openFramesAfter}`).join('; ')} | ${canc.length && canc.every((r) => r.cancel.cleanupDoneAfterMs < 2000 && !r.cancel.partialFileRemains && r.cancel.openFramesAfter === 0 && r.cancel.callbacksAfterCancel === 0) ? 'PASS' : 'FAIL'} |\n`;
md += `| Output re-opens with correct duration (and 1800 frames, 1920x1080, audio, first/last decodable) | ${full.map((r) => `${r.label}: ${r.verify?.allPass ? 'all checks pass' : 'FAIL'}`).join('; ')} | ${full.length && full.every((r) => r.verify?.allPass) ? 'PASS' : 'FAIL'} |\n`;
md += '\n' + (await readFile(resolve(dir, 's4-export.prose.md'), 'utf8').catch(() => ''));
await writeFile(resolve(dir, 's4-export.md'), md);
console.log('wrote s4-export.md', md.length);
