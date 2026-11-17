// node s6-probe/gen-md.mjs -> results/s6-probe.md (tables generated from results/s6-probe.json; prose is in the PROSE const)
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'results');
const r = JSON.parse(await readFile(resolve(dir, 's6-probe.json'), 'utf8'));
const names = Object.keys(r.targets);
const ok = (x) => (x === 'yes' ? 'Y' : x === 'no' ? '-' : x);
const hwStr = (o) => `${ok(o['prefer-hardware'])}/${ok(o['prefer-software'])}/${ok(o['no-preference'])}`;
const T = (t) => r.targets[t];
let md = `# S6 capability probe (ADR-0012)

Generated ${r.generatedAt} by \`spikes/s6-probe/run.mjs\` (page: \`spikes/s6-probe/index.html\`). Windows 11, Intel Iris Xe (no discrete GPU), 16 logical cores, 16 GB.
Other agents may have been running concurrently; this probe is capability-only (nothing here is a timing result except the tiny OPFS write figure, which is indicative only).

Browsers: ${names.map((n) => `**${n}** = ${T(n).error ? 'n/a' : T(n).platform.userAgent.match(/(Headless)?Chrome\/[\d.]+/)[0] + (T(n).platform.userAgent.includes('Edg/') ? ' (Edge)' : ' (branded Chrome)')} / launched ${n.includes('headless') ? 'with playwright headless:true on the branded executable (new headless)' : 'headed'}`).join('; ')}.

Cell legend for codec rows: \`prefer-hardware / prefer-software / no-preference\`, Y = isConfigSupported says supported, - = not supported. isConfigSupported is a *claim*; the round-trip table further down actually encodes frames.

## Environment cells

| Capability | ${names.join(' | ')} | Linux CI / GitHub Actions |
|---|${names.map(() => '---').join('|')}|---|
`;
const envRow = (label, f) => { md += `| ${label} | ${names.map((n) => (T(n).error ? 'n/a' : f(T(n)))).join(' | ')} | UNVERIFIED |\n`; };
envRow('isSecureContext on http://127.0.0.1', (t) => t.platform.isSecureContext);
envRow('crossOriginIsolated', (t) => t.platform.crossOriginIsolated);
envRow('SharedArrayBuffer (main / worker)', (t) => `${t.platform.sharedArrayBufferMainThread} / ${t.worker.sharedArrayBufferInWorker}`);
envRow('WebGL2', (t) => t.graphics.webgl2);
envRow('WebGL2 renderer (main)', (t) => '`' + t.graphics.webgl2Renderer + '`');
envRow('WebGL2 in OffscreenCanvas (worker)', (t) => t.worker.offscreenWebgl2);
envRow('OffscreenCanvas 2D in worker', (t) => t.worker.offscreen2d);
envRow('WebGPU API / adapter', (t) => `${t.graphics.webgpuApi} / ${t.graphics.webgpuAdapter ? `${t.graphics.webgpuAdapter.vendor} ${t.graphics.webgpuAdapter.architecture}` : 'null'}`);
envRow('OPFS getDirectory (main)', (t) => t.platform.opfsGetDirectoryMain);
envRow('OPFS createSyncAccessHandle in dedicated worker', (t) => t.worker.opfsSyncAccessHandle);
envRow('OPFS 16 MB sync write (MB/s, indicative)', (t) => t.worker.opfsWriteMBps_16MB);
envRow('showOpenFilePicker / showSaveFilePicker / showDirectoryPicker', (t) => `${t.platform.showOpenFilePicker} / ${t.platform.showSaveFilePicker} / ${t.platform.showDirectoryPicker}`);
envRow('navigator.storage.estimate quota', (t) => `${t.platform.storageEstimate.quotaMB} MB`);
envRow('navigator.storage.persist()', (t) => t.platform.storagePersist);
envRow('performance.memory (main)', (t) => t.platform.performanceMemory);
envRow('VideoEncoder / AudioEncoder in main; VideoEncoder in worker', (t) => `${t.platform.mainHasVideoEncoder} / ${t.platform.mainHasAudioEncoder}; ${t.worker.workerHasVideoEncoder}`);

md += `\n## Video codecs (encode | decode), cells = prefer-hardware / prefer-software / no-preference\n\n| Config | ${names.map((n) => n + ' enc | ' + n + ' dec').join(' | ')} |\n|---|${names.map(() => '---|---').join('|')}|\n`;
const labels = Object.keys(T(names.find((n) => !T(n).error)).video);
for (const l of labels) md += `| ${l} (\`${T(names[0]).video[l].codec}\`) | ${names.map((n) => (T(n).error ? 'n/a | n/a' : `${hwStr(T(n).video[l].encode)} | ${hwStr(T(n).video[l].decode)}`)).join(' | ')} |\n`;

md += `\n## Audio codecs (48 kHz stereo)\n\n| Codec | ${names.map((n) => n + ' enc / dec').join(' | ')} |\n|---|${names.map(() => '---').join('|')}|\n`;
for (const l of Object.keys(T(names[0]).audio)) md += `| ${l} | ${names.map((n) => (T(n).error ? 'n/a' : `${ok(T(n).audio[l].encode)} / ${ok(T(n).audio[l].decode)}`)).join(' | ')} |\n`;

md += `\n## ImageDecoder\n\n| Type | ${names.join(' | ')} |\n|---|${names.map(() => '---').join('|')}|\n`;
for (const l of Object.keys(T(names[0]).imageDecoder)) md += `| ${l} | ${names.map((n) => (T(n).error ? 'n/a' : T(n).imageDecoder[l])).join(' | ')} |\n`;

md += `\n## Real round-trip (1280x720, 30 frames / 1 s audio actually encoded; ok = all outputs produced, no error)\n\n| Test | ${names.join(' | ')} |\n|---|${names.map(() => '---').join('|')}|\n`;
for (const l of Object.keys(T(names[0]).roundTrip)) md += `| ${l} | ${names.map((n) => (T(n).error ? 'n/a' : T(n).roundTrip[l].ok ? `ok (${T(n).roundTrip[l].chunks} chunks)` : 'FAIL ' + (T(n).roundTrip[l].error || T(n).roundTrip[l].err))).join(' | ')} |\n`;

md += '\n' + (await readFile(resolve(dir, 's6-probe.prose.md'), 'utf8').catch(() => ''));
await writeFile(resolve(dir, 's6-probe.md'), md);
console.log('wrote s6-probe.md', md.length);
