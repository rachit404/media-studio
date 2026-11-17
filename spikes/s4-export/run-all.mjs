// node s4-export/run-all.mjs : runs every config in its own fresh Chrome (a browser killed by other agents only loses one run), retries, merges into results/s4-export.json
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const res = resolve(here, '..', 'results');
const labels = ['h264-hw-buffer', 'h264-sw-buffer', 'h264-hw-opfs', 'h264-hw-buffer-rerun', 'vp9-hw-buffer', 'vp9-sw-buffer', 'cancel50-h264-hw-opfs', 'cancel50-h264-sw-buffer'];
const mainFile = resolve(res, 's4-export.json');
let merged = existsSync(mainFile) ? JSON.parse(readFileSync(mainFile, 'utf8')) : null;
const have = new Set((merged?.runs || []).filter((r) => !r.error).map((r) => r.label));
if (merged) merged.runs = merged.runs.filter((r) => !r.error);
for (const label of labels) {
  if (have.has(label)) { console.log('skip (already measured)', label); continue; }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const part = `s4-export.part-${label}`;
    console.log('RUN', label, 'attempt', attempt);
    spawnSync(process.execPath, [resolve(here, 'run.mjs'), `--only=${label}`, `--out=${part}`], { stdio: 'inherit' });
    const pf = resolve(res, part + '.json');
    if (!existsSync(pf)) continue;
    const p = JSON.parse(readFileSync(pf, 'utf8'));
    rmSync(pf);
    const r = p.runs[0];
    if (!r || r.error) { console.log('  failed:', r?.error?.slice(0, 120)); continue; }
    if (!merged) merged = { ...p, runs: [] };
    merged.runs.push(r); merged.finishedAt = new Date().toISOString();
    writeFileSync(mainFile, JSON.stringify(merged, null, 2));
    break;
  }
}
if (merged) { merged.finishedAt = new Date().toISOString(); writeFileSync(mainFile, JSON.stringify(merged, null, 2)); }
console.log('done; runs:', merged?.runs.map((r) => r.label).join(','));
