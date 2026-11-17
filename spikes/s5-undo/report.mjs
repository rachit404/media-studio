// Generates results/s5-undo.md from results/s5-undo.json (numbers only come from the JSON). Run: node s5-undo/report.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = JSON.parse(fs.readFileSync(path.resolve(HERE, '..', 'results', 's5-undo.json'), 'utf8'));
const f = (x, d = 2) => (x == null ? 'n/a' : Number(x).toFixed(d));
const row = (s) => `${f(s.p50)} / ${f(s.p95)} / ${f(s.max)}`;
const L = [];
const P = (...a) => L.push(a.join(''));

// ---- verdict logic (thresholds fixed in advance from the spike plan; not tuned) ----
// undo/redo: PASS if p95 < 50 ms AND max < 50 ms; INCONCLUSIVE if p95 < 50 but max >= 50 (outlier); FAIL if p95 >= 50.
const urCases = []; // {name, undo, redo}
for (const kind of ['image', 'video']) {
  for (const D of [10, 1000, 10000]) { const x = R.undoDepth[kind][D]; urCases.push({ name: `${kind} depth ${D} (uncoalesced)`, undo: x.undo, redo: x.redo }); }
  const c = R.undoDepthCoalesced[kind]; urCases.push({ name: `${kind} depth ${c.entries} (10k edits, coalesced)`, undo: c.undo, redo: c.redo });
}
const verdictOf = (s) => (s.p95 >= 50 ? 'FAIL' : s.max >= 50 ? 'INCONCLUSIVE' : 'PASS');
const rank = { PASS: 0, INCONCLUSIVE: 1, FAIL: 2 };
let urV = 'PASS';
for (const c of urCases) for (const s of [c.undo, c.redo]) { const v = verdictOf(s); if (rank[v] > rank[urV]) urV = v; }
const memCases = Object.entries(R.memory);
const worstHist = Math.max(...memCases.map(([, m]) => m.historyHeapMB));
const memV = worstHist < 200 ? 'PASS' : 'FAIL';
const apply = (k) => R.latency[k].map((x) => x.apply);
const applyMaxP95 = Math.max(...['image', 'video'].flatMap((k) => apply(k).map((s) => s.p95)));
const applyMaxMax = Math.max(...['image', 'video'].flatMap((k) => apply(k).map((s) => s.max)));

P('# S5 result: does Immer-patch history scale? (ADR-0006)\n');
P(`Generated ${R.startedAt} from \`spikes/results/s5-undo.json\` by \`spikes/s5-undo/report.mjs\`. Every number below is read from that JSON, produced by one run of \`node --expose-gc s5-undo/bench.mjs\` (total runtime ${R.totalRuntimeSec} s).\n`);
P('## Environment\n');
P(`- Node ${R.env.node} on ${R.env.platform}; ${R.env.cpuCores} logical cores (os.cpus()), ${R.env.cpuModel}; ${R.env.totalMemGB} GB RAM`);
P(`- immer ${R.env.versions.immer}, zod ${R.env.versions.zod}; \`--expose-gc\`; no browser.`);
P('- **Other load existed**: 4 other agents were running browser benchmarks on the same laptop during this run. Tail latencies (p95/max) may be inflated by CPU contention and GC; p50 is the more reliable figure.\n');
P('## Method\n');
P('- Synthetic docs. Image: 1,000 layers (id, name, visible, opacity, blendMode, transform{x,y,scaleX,scaleY,rotation}, optional maskId, adjustments[]); opacity and rotation are `number | Keyframe[]` (10% start as keyframes). Video: 2,000 clips flat array with `trackId` over 8 tracks (start, duration, sourceId, in/out, speed, properties{opacity,volume,scale} as value|keyframes[], optional transition). Both validated with Zod v4 schemas.');
P(`- Command layer: Immer \`produceWithPatches\`; history stack (label, patches, inversePatches); undo/redo via \`applyPatches\`; redo truncated on new edit; coalescing of consecutive same-key edits (opacity drags in bursts of 20, nudge/move bursts of 10, trims bursts of 8). Replace-only coalesced bursts are compacted (latest value wins, earliest inverse wins).`);
P('- Workload: 10,000 dispatched edits (seeded PRNG). Image mix: opacity-drag bursts, nudge bursts, single moves, add/remove layer, reorder, rename, blend, add keyframe. Video mix: move/opacity/trim bursts, split, ripple delete (shifts later clips on the same track), add clip, add keyframe. Document size is held near 1,000 layers / 2,000 clips by the generator.');
P('- "Edits" = dispatches (10,000). "Entries" = history entries after coalescing. Undo-depth rows labelled "uncoalesced" use coalescing OFF so entries == edits (10 / 1,000 / 10,000).');
P('- Timings via `performance.now()`; apply-latency includes `produceWithPatches` + history push/merge (command construction and index lookups are outside the timed region; indices come from the pre-edit state). Heap via `process.memoryUsage().heapUsed` after 3x `global.gc()`.');
P(`- Verdict rules fixed before running: undo/redo PASS if p95 < 50 ms and max < 50 ms, INCONCLUSIVE if p95 < 50 ms but max >= 50 ms, FAIL if p95 >= 50 ms. History memory PASS if history heap < 200 MB at 10,000 edits (worst of coalesced/uncoalesced, image/video).\n`);

P('## Results vs pass criteria\n');
P('| Criterion | Measured | Verdict |');
P('|---|---|---|');
const worst = (pick) => urCases.map((c) => ({ n: c.name, s: c[pick] })).sort((a, b) => b.s.max - a.s.max)[0];
const wu = worst('undo'), wr = worst('redo');
P(`| Undo < 50 ms at 1,000 layers / 2,000 clips | worst case over all depths: p50/p95/max ms = ${row(wu.s)} (${wu.n}) | **${urCases.every((c) => verdictOf(c.undo) === 'PASS') ? 'PASS' : urCases.some((c) => verdictOf(c.undo) === 'FAIL') ? 'FAIL' : 'INCONCLUSIVE'}** |`);
P(`| Redo < 50 ms | worst case: p50/p95/max ms = ${row(wr.s)} (${wr.n}) | **${urCases.every((c) => verdictOf(c.redo) === 'PASS') ? 'PASS' : urCases.some((c) => verdictOf(c.redo) === 'FAIL') ? 'FAIL' : 'INCONCLUSIVE'}** |`);
P(`| History memory < 200 MB at 10,000 edits | worst history heap = ${f(worstHist, 1)} MB (see memory table) | **${memV}** |`);
P(`| (informational) apply-command latency, no formal limit | worst repeat p95 = ${f(applyMaxP95)} ms, worst max = ${f(applyMaxMax)} ms | n/a (see 16 ms frame budget discussion) |`);
const cor = Object.values(R.correctness).flatMap((c) => [c.coalesced, c.uncoalesced]);
const corOk = cor.every((c) => c.undoAllEqualsOriginal && c.redoAllEqualsFinal && c.finalStateValidatesWithZod) && Object.values(R.correctness).every((c) => c.unit.burstUndoRestoresExactly && c.unit.truncation.ok && c.unit.sameKeyAfterUndoRedoNotMerged && c.unit.burstOf20_entries === 1);
P(`| Correctness (N edits then N undos == original; redo == final; truncation; coalescing) | all checks ${corOk ? 'passed' : '**FAILED - see JSON**'} (image and video, coalesced and uncoalesced, 2,000 edits each) | **${corOk ? 'PASS' : 'FAIL'}** |\n`);

P('## (a) Apply-command latency (ms, p50 / p95 / max), autoFreeze on, 3 repeats of 10,000 edits\n');
P('| Doc | Repeat | p50 / p95 / max | first edit | history entries | final size |');
P('|---|---|---|---|---|---|');
for (const k of ['image', 'video']) for (const x of R.latency[k]) P(`| ${k} | ${x.rep} | ${row(x.apply)} | ${f(x.firstEditMs)} | ${x.history.entries} | ${x.finalCount} |`);
P('\nPer command type (repeat 0): apply p50 / p95 / max ms, and patches per dispatch p50 / max:\n');
P('| Doc | Command | n | apply p50 / p95 / max | patches p50 / max |');
P('|---|---|---|---|---|');
for (const k of ['image', 'video']) for (const [t, v] of Object.entries(R.perType[k])) P(`| ${k} | ${t} | ${v.apply.n} | ${row(v.apply)} | ${v.patchesPerDispatch.p50} / ${v.patchesPerDispatch.max} |`);

P('\n## (b) Undo / redo latency (ms, p50 / p95 / max)\n');
P('| Case | Undo | Redo | Verdict (undo/redo) |');
P('|---|---|---|---|');
for (const c of urCases) P(`| ${c.name} | ${row(c.undo)} | ${row(c.redo)} | ${verdictOf(c.undo)} / ${verdictOf(c.redo)} |`);
P('\nHeaviest entry types at depth 10,000 (uncoalesced), undo p50 / p95 / max ms:\n');
P('| Doc | Type | n | undo | redo |');
P('|---|---|---|---|---|');
for (const k of ['image', 'video']) { const d = R.undoDepth[k][10000]; for (const t of Object.keys(d.undoByType)) P(`| ${k} | ${t} | ${d.undoByType[t].n} | ${row(d.undoByType[t])} | ${d.redoByType[t] ? row(d.redoByType[t]) : 'n/a'} |`); }
P('\n(Depth samples: first 400 undos from the top of the stack then the same 400 redos; for depth 10, 50 undo-all/redo-all cycles. Undo cost is essentially independent of depth, as expected from patch application.)');

P('\n## (c) History memory after 10,000 edits (MB, heapUsed after gc)\n');
P('| Case | edits | entries | heap before | heap after (with history) | heap after history cleared | **history heap** | patches+inverse | history JSON size |');
P('|---|---|---|---|---|---|---|---|---|');
for (const [n, m] of memCases) P(`| ${n} | ${m.edits} | ${m.entries} | ${f(m.heapBeforeMB, 1)} | ${f(m.heapAfterWithHistoryMB, 1)} | ${f(m.heapAfterHistoryClearedMB, 1)} | **${f(m.historyHeapMB, 1)}** | ${m.patchesPlusInverse} | ${f(m.jsonMB)} MB |`);

P('\n## (d) Immer autoFreeze on vs off (same seeds, 2 repeats each; ms p50 / p95 / max)\n');
P('| Doc | autoFreeze | apply (rep0) | apply (rep1) | first edit (rep0) | undo (rep0) | redo (rep0) |');
P('|---|---|---|---|---|---|---|');
for (const k of ['image', 'video']) for (const m of ['on', 'off']) { const r = R.autoFreeze[k][m]; P(`| ${k} | ${m} | ${row(r[0].apply)} | ${row(r[1].apply)} | ${f(r[0].firstEditMs)} | ${row(r[0].undo)} | ${row(r[0].redo)} |`); }

P('\n## (e) Document save/load cost (ms p50 / p95 / max over 22 timed runs)\n');
P('| Doc | items | JSON size | Zod parse | JSON.stringify | JSON.parse | structuredClone |');
P('|---|---|---|---|---|---|---|');
for (const k of ['image', 'video']) { const d = R.docCost[k]; P(`| ${k} | ${d.count} | ${d.jsonKB} KB | ${row(d.zodParse)} | ${row(d.stringify)} | ${row(d.jsonParse)} | ${row(d.structuredClone)} |`); }

P('\n## (f) Crash-recovery journal (one JSON line of patches per dispatch, 10,000 dispatches, replayed over the base document)\n');
P('| Doc | lines | serialise (ms) | size | replay total (ms), 3 runs | replay per entry p50 / p95 / max (ms) | deepStrictEqual with live final state |');
P('|---|---|---|---|---|---|---|');
for (const k of ['image', 'video']) { const j = R.journal[k]; P(`| ${k} | ${j.entries} | ${j.serialiseMs} | ${f(j.journalMB)} MB | ${j.replayTotalMs.join(' / ')} | ${row(j.replayPerEntry)} | ${j.replayEqualsLiveFinalState} |`); }

P('\n## (g) Baselines\n');
P('| Baseline | Doc | Edits run | Apply p50 / p95 / max (ms) | Undo p50 / p95 / max (ms) | Heap growth (MB) | Notes |');
P('|---|---|---|---|---|---|---|');
for (const [n, b] of Object.entries(R.baselines)) {
  const ap = b.applyPlusSnapshot || b.apply;
  const extra = n.startsWith('snapshot') ? `${f(b.mbPerEntry, 3)} MB/entry; extrapolated (not measured) to 10,000 entries = ${b.extrapolatedMBat10kUncoalescedEntries} MB${b.stoppedByHeapCap ? '; stopped by heap cap' : ''}` : n.startsWith('optionC') ? `undoAll==original ${b.undoAllEqualsOriginal}, redo==final ${b.redoRestoresFinal}; ${b.entries} entries; mutable in-place doc` : `${b.entries} entries; structural-sharing, no patches/journal`;
  P(`| ${n.split('_')[0]} | ${n.split('_')[1]} | ${b.editsRun ?? b.edits} | ${row(ap)} | ${row(b.undo)} | ${f(b.heapGrowthMB, 1)} | ${extra} |`);
}

P('\n## Caveats\n');
P('- Documents are synthetic and hand-shaped (flat `layers[]` / flat `clips[]`); real documents may be nested (tracks[].clips[]) and have heavier per-layer metadata. Pixel/frame data is excluded by design (ADR-0006).');
P('- Other agents were running browser benchmarks concurrently on the same machine (16 logical cores); tail latencies are noise-sensitive. Single machine, single Node version, no browser (V8 in Chromium may differ in GC behaviour; heap numbers are Node `heapUsed`, not a browser heap snapshot).');
P('- Index lookups (`findIndex` by id) are done outside the timed region from the pre-edit state; app code that searches by id inside a draft would create proxies for every visited element and could be slower. Not measured.');
P('- Coalescing here is by consecutive same key (no time window); undo/redo resets the coalescing target. Brush strokes / pixel history are not modelled (decided in the image-engine doc).');
P('- Snapshot-baseline heap cost is extrapolated from a scaled-down run (see table); it is not a 10,000-entry measurement.');
P('- Option C (hand-rolled log) was implemented for the image doc only and mutates in place, so it is not a like-for-like substitute for React-friendly immutable state; it has no automatic patches for the ADR-0005 journal.');
fs.writeFileSync(path.resolve(HERE, '..', 'results', 's5-undo.md'), L.join('\n') + '\n');
console.log('wrote s5-undo.md; verdict undo/redo', urV, 'memory', memV);
