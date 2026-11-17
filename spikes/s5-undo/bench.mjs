// S5 benchmark driver. Run: node --expose-gc s5-undo/bench.mjs   (from spikes/)
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setAutoFreeze, produce, applyPatches } from 'immer';
import { mulberry32, buildImageDoc, buildVideoDoc, gens, appliers, Schemas } from './model.mjs';
import { createStore, toCmd } from './store.mjs';

if (!global.gc) { console.error('run with node --expose-gc'); process.exit(1); }
const now = () => performance.now();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = path.resolve(HERE, '..', 'results');
const N_EDITS = 10000;
const builders = { image: () => buildImageDoc(1000), video: () => buildVideoDoc(2000) };
const log = (...a) => console.log(...a);
const gcAll = () => { for (let i = 0; i < 3; i++) global.gc(); };
const heapMB = () => { gcAll(); return process.memoryUsage().heapUsed / 1048576; };
const round = (x, d = 3) => (x == null ? x : Math.round(x * 10 ** d) / 10 ** d);
function stats(a) {
  if (!a.length) return { n: 0 };
  const s = Float64Array.from(a).sort(); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, p50: round(q(0.5)), p95: round(q(0.95)), p99: round(q(0.99)), max: round(s[s.length - 1]), mean: round(a.reduce((x, y) => x + y, 0) / a.length) };
}
const byTypeStats = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, stats(v)]));
const t0all = now();
const out = { startedAt: new Date().toISOString() };

// ---------- workload runner ----------
function runWorkload(kind, { n = N_EDITS, coalesce = true, seed = 1, journal = false, base } = {}) {
  const gen = gens[kind]; const store = createStore(base ?? builders[kind](), { coalesce });
  const rng = mulberry32(seed); const ctx = { n: 100000, burst: null };
  const lat = []; const byType = {}; const patchCounts = {}; const jr = journal ? [] : null; let first = null; let noops = 0;
  for (let i = 0; i < n; i++) {
    const spec = gen(store.state, rng, ctx); const cmd = toCmd(kind, spec);
    const t = now(); const patches = store.dispatch(cmd); const dt = now() - t;
    if (!patches.length) { noops++; }
    if (i === 0) first = dt;
    lat.push(dt); (byType[spec.type] ??= []).push(dt); (patchCounts[spec.type] ??= []).push(patches.length);
    if (jr) jr.push({ l: spec.type, p: patches });
  }
  return { store, lat, byType, patchCounts, jr, first, noops };
}
function historyStats(store) {
  let patches = 0, bytes = 0;
  for (const e of store.undo) { patches += e.patches.length + e.inverse.length; bytes += JSON.stringify(e.patches).length + JSON.stringify(e.inverse).length; }
  return { entries: store.undo.length, patchesPlusInverse: patches, jsonBytes: bytes, jsonMB: round(bytes / 1048576, 2) };
}
function timeUndoRedo(store, k, cycles = 1) {
  const undoT = [], redoT = [], undoBy = {}, redoBy = {};
  for (let c = 0; c < cycles; c++) {
    let done = 0;
    for (let i = 0; i < k && store.undo.length; i++) { const lab = store.undo[store.undo.length - 1].label; const t = now(); store.doUndo(); const dt = now() - t; undoT.push(dt); (undoBy[lab] ??= []).push(dt); done++; }
    for (let i = 0; i < done; i++) { const lab = store.redo[store.redo.length - 1].label; const t = now(); store.doRedo(); const dt = now() - t; redoT.push(dt); (redoBy[lab] ??= []).push(dt); }
  }
  return { undo: stats(undoT), redo: stats(redoT), undoByType: byTypeStats(undoBy), redoByType: byTypeStats(redoBy) };
}
const msum = (x) => ({ p50: x.p50, p95: x.p95, max: x.max });

// ---------- environment ----------
const cpus = os.cpus();
out.env = { node: process.version, platform: process.platform + ' ' + os.release(), cpuModel: cpus[0].model, cpuCores: cpus.length, totalMemGB: round(os.totalmem() / 2 ** 30, 1), loadavgNote: 'loadavg unavailable on Windows; other agents ran browser benchmarks concurrently' };
out.env.versions = { immer: JSON.parse(fs.readFileSync(path.resolve(HERE, '..', 'node_modules/immer/package.json'))).version, zod: JSON.parse(fs.readFileSync(path.resolve(HERE, '..', 'node_modules/zod/package.json'))).version };
log('env', out.env);

// ---------- (e) zod + JSON ----------
out.docCost = {};
for (const kind of ['image', 'video']) {
  const doc = builders[kind](); const schema = Schemas[kind];
  const json = JSON.stringify(doc);
  const ztimes = [], sTimes = [], pTimes = [], cTimes = [];
  for (let i = 0; i < 25; i++) {
    let t = now(); const r = schema.safeParse(doc); ztimes.push(now() - t); assert(r.success, 'zod fail ' + JSON.stringify(r.error?.issues?.slice(0, 2)));
    t = now(); JSON.stringify(doc); sTimes.push(now() - t);
    t = now(); JSON.parse(json); pTimes.push(now() - t);
    t = now(); structuredClone(doc); cTimes.push(now() - t);
  }
  const parsed = schema.parse(doc);
  let deepEq = true; try { assert.deepStrictEqual(parsed, doc); } catch { deepEq = false; }
  out.docCost[kind] = { jsonBytes: json.length, jsonKB: round(json.length / 1024, 1), zodParse: stats(ztimes.slice(3)), stringify: stats(sTimes.slice(3)), jsonParse: stats(pTimes.slice(3)), structuredClone: stats(cTimes.slice(3)), zodRoundTripDeepEqual: deepEq, count: kind === 'image' ? doc.layers.length : doc.clips.length };
  log('docCost', kind, JSON.stringify(out.docCost[kind]));
}

// ---------- (4) correctness ----------
out.correctness = {};
for (const kind of ['image', 'video']) {
  const res = {};
  for (const coalesce of [false, true]) {
    const base = builders[kind](); const snapshot = structuredClone(base);
    const { store } = runWorkload(kind, { n: 2000, coalesce, seed: 7, base });
    const finalState = structuredClone(store.state); const depth = store.undo.length;
    const zodOk = Schemas[kind].safeParse(store.state).success;
    while (store.undo.length) store.doUndo();
    let undoAll = true; try { assert.deepStrictEqual(store.state, snapshot); } catch (e) { undoAll = false; }
    while (store.redo.length) store.doRedo();
    let redoAll = true; try { assert.deepStrictEqual(store.state, finalState); } catch (e) { redoAll = false; }
    res[coalesce ? 'coalesced' : 'uncoalesced'] = { edits: 2000, entries: depth, undoAllEqualsOriginal: undoAll, redoAllEqualsFinal: redoAll, finalStateValidatesWithZod: zodOk };
  }
  // truncation + coalescing unit checks
  const base = builders[kind](); const store = createStore(base, { coalesce: true }); const rng = mulberry32(3); const ctx = { n: 5e5, burst: null };
  const d = (spec) => store.dispatch(toCmd(kind, spec));
  const idx = 5; const baseVal = kind === 'image' ? base.layers[idx].opacity : base.clips[idx].properties.opacity;
  const op = (v) => ({ type: 'opacity', idx, id: 'x', key: 'opacity:k', v, t: 0 });
  for (let i = 0; i < 20; i++) d(op(0.01 * (i + 1)));
  const burstEntries = store.undo.length;
  store.doUndo(); const restored = kind === 'image' ? store.state.layers[idx].opacity : store.state.clips[idx].properties.opacity;
  const burstRestoresExactly = JSON.stringify(restored) === JSON.stringify(baseVal);
  store.doRedo();
  // after undo/redo a same-key edit must NOT merge into the older entry
  d(op(0.9)); const afterRedoEntries = store.undo.length;
  // truncation
  const ren = (i) => kind === 'image' ? { type: 'rename', idx: i, name: 'N' + i } : { type: 'move', idx: i, dx: 1 + i };
  d(ren(1)); d(ren(2)); d(ren(3)); const before = store.undo.length;
  store.doUndo(); store.doUndo(); const redoAvail = store.redo.length;
  d(ren(4)); const afterNew = { undo: store.undo.length, redo: store.redo.length };
  res.unit = { burstOf20_entries: burstEntries, burstUndoRestoresExactly: burstRestoresExactly, sameKeyAfterUndoRedoNotMerged: afterRedoEntries === 2, truncation: { undoBefore: before, redoAfter2Undos: redoAvail, undoAfterNewEdit: afterNew.undo, redoAfterNewEdit: afterNew.redo, ok: afterNew.redo === 0 && afterNew.undo === before - 2 + 1 && redoAvail === 2 } };
  out.correctness[kind] = res; log('correctness', kind, JSON.stringify(res));
}

// ---------- (a)+(b) latency, 3 repeats, autoFreeze ON ----------
out.latency = { image: [], video: [] }; out.perType = {}; out.undoDepthCoalesced = {};
for (const kind of ['image', 'video']) {
  for (let rep = 0; rep < 3; rep++) {
    const r = runWorkload(kind, { seed: 100 + rep });
    const hs = historyStats(r.store);
    out.latency[kind].push({ rep, apply: stats(r.lat), firstEditMs: round(r.first), noopDispatches: r.noops, history: hs, finalCount: kind === 'image' ? r.store.state.layers.length : r.store.state.clips.length });
    if (rep === 0) {
      out.perType[kind] = {}; for (const t of Object.keys(r.byType)) out.perType[kind][t] = { apply: stats(r.byType[t]), patchesPerDispatch: stats(r.patchCounts[t]) };
      out.undoDepthCoalesced[kind] = { entries: r.store.undo.length, ...timeUndoRedo(r.store, 400) };
    }
    log('latency', kind, rep, JSON.stringify(msum(stats(r.lat))), 'entries', hs.entries);
  }
}

// ---------- (b) undo/redo at depths 10 / 1000 / 10000 (uncoalesced: depth == entries) ----------
out.undoDepth = { image: {}, video: {} };
for (const kind of ['image', 'video']) {
  for (const D of [10, 1000, 10000]) {
    const r = runWorkload(kind, { n: D, coalesce: false, seed: 200 + D });
    const k = D === 10 ? 10 : 400; const cycles = D === 10 ? 50 : 1;
    const t = timeUndoRedo(r.store, k, cycles);
    out.undoDepth[kind][D] = { entries: D, sampledUndosFromTop: k * cycles, ...t };
    log('undoDepth', kind, D, 'undo', JSON.stringify(msum(t.undo)), 'redo', JSON.stringify(msum(t.redo)));
  }
}

// ---------- (c) heap after 10k edits ----------
out.memory = {};
for (const kind of ['image', 'video']) {
  for (const coalesce of [true, false]) {
    let base = builders[kind](); const h0 = heapMB();
    let r = runWorkload(kind, { coalesce, seed: 300, base }); base = null; r.lat = null; r.byType = null;
    const h1 = heapMB(); const hs = historyStats(r.store);
    r.store.undo.length = 0; r.store.redo.length = 0; r.store.last = null; const h2 = heapMB();
    out.memory[kind + (coalesce ? '_coalesced' : '_uncoalesced')] = { edits: N_EDITS, heapBeforeMB: round(h0, 1), heapAfterWithHistoryMB: round(h1, 1), heapAfterHistoryClearedMB: round(h2, 1), historyHeapMB: round(h1 - h2, 1), totalGrowthMB: round(h1 - h0, 1), ...hs };
    log('memory', kind, coalesce, JSON.stringify(out.memory[kind + (coalesce ? '_coalesced' : '_uncoalesced')]));
    r = null;
  }
}

// ---------- (d) autoFreeze off ----------
out.autoFreeze = { image: {}, video: {} };
for (const kind of ['image', 'video']) {
  for (const on of [true, false]) {
    setAutoFreeze(on);
    const reps = [];
    for (let rep = 0; rep < 2; rep++) {
      const r = runWorkload(kind, { seed: 100 + rep }); // same seeds as autoFreeze-on latency run (reps 0,1)
      const u = timeUndoRedo(r.store, 400);
      reps.push({ apply: stats(r.lat), firstEditMs: round(r.first), undo: u.undo, redo: u.redo });
    }
    out.autoFreeze[kind][on ? 'on' : 'off'] = reps;
    log('autoFreeze', kind, on, JSON.stringify(reps.map((x) => ({ apply: msum(x.apply), undo: msum(x.undo) }))));
  }
  setAutoFreeze(true);
}

// ---------- (f) crash-recovery journal ----------
out.journal = {};
for (const kind of ['image', 'video']) {
  const base = builders[kind](); const baseSnap = structuredClone(base);
  const r = runWorkload(kind, { seed: 400, journal: true, base });
  let t = now(); const lines = r.jr.map((j) => JSON.stringify({ l: j.l, p: j.p })); const tStr = now() - t;
  const bytes = lines.reduce((a, l) => a + l.length + 1, 0);
  // replay (fresh unfrozen base copy; same autoFreeze setting as app default)
  const reps = []; let ok = true;
  for (let rep = 0; rep < 3; rep++) {
    let st = structuredClone(baseSnap);
    t = now();
    for (const line of lines) { const j = JSON.parse(line); st = applyPatches(st, j.p); }
    reps.push(now() - t);
    if (rep === 0) { try { assert.deepStrictEqual(st, r.store.state); } catch (e) { ok = false; } }
  }
  // per-entry replay cost percentiles (single run)
  const per = []; { let st = structuredClone(baseSnap); for (const line of lines) { const a = now(); const j = JSON.parse(line); st = applyPatches(st, j.p); per.push(now() - a); } }
  out.journal[kind] = { entries: lines.length, serialiseMs: round(tStr, 1), journalBytes: bytes, journalMB: round(bytes / 1048576, 2), replayTotalMs: reps.map((x) => round(x, 1)), replayPerEntry: stats(per), replayEqualsLiveFinalState: ok };
  log('journal', kind, JSON.stringify(out.journal[kind]));
}

// ---------- (g) baselines ----------
out.baselines = {};
// g1: naive full snapshot history (structuredClone per history entry), scaled down; stops if heap explodes
for (const kind of ['image', 'video']) {
  const gen = gens[kind]; const ap = appliers[kind]; const rng = mulberry32(500); const ctx = { n: 7e5, burst: null };
  let doc = builders[kind](); gcAll(); const h0 = heapMB();
  const hist = []; let lastKey = null; const lat = []; let edits = 0; let stoppedByHeap = false; const CAP_MB = 1500;
  for (let i = 0; i < 2000; i++) {
    const spec = gen(doc, rng, ctx);
    const t = now();
    if (!(spec.key && spec.key === lastKey)) hist.push(structuredClone(doc));
    lastKey = spec.key ?? null; ap(doc, spec); lat.push(now() - t); edits++;
    if (i % 50 === 49 && process.memoryUsage().heapUsed / 1048576 > CAP_MB) { stoppedByHeap = true; break; }
  }
  const h1 = heapMB(); const perEntry = (h1 - h0) / hist.length;
  const ut = []; for (let i = 0; i < 100 && hist.length; i++) { const t = now(); doc = hist.pop(); ut.push(now() - t); }
  out.baselines['snapshot_' + kind] = { editsRun: edits, entries: edits ? edits : 0, applyPlusSnapshot: stats(lat), undo: stats(ut), heapGrowthMB: round(h1 - h0, 1), mbPerEntry: round(perEntry, 3), stoppedByHeapCap: stoppedByHeap, extrapolatedMBat10kUncoalescedEntries: round(perEntry * 10000, 0), note: 'extrapolation = measured MB/entry x 10,000 entries; NOT measured at 10k' };
  log('snapshot', kind, JSON.stringify(out.baselines['snapshot_' + kind]));
  doc = null; hist.length = 0;
}
// g2: structural-sharing state history (Immer produce, no patches, keep previous states)
for (const kind of ['image', 'video']) {
  const gen = gens[kind]; const ap = appliers[kind]; const rng = mulberry32(600); const ctx = { n: 8e5, burst: null };
  let base = builders[kind](); const h0 = heapMB();
  let state = base; base = null; const hist = []; let lastKey = null; const lat = [];
  for (let i = 0; i < N_EDITS; i++) {
    const spec = gen(state, rng, ctx);
    const t = now(); const next = produce(state, (d) => { ap(d, spec); });
    if (!(spec.key && spec.key === lastKey)) hist.push(state);
    lastKey = spec.key ?? null; state = next; lat.push(now() - t);
  }
  const h1 = heapMB(); const ut = []; for (let i = 0; i < 400 && hist.length; i++) { const t = now(); state = hist.pop(); ut.push(now() - t); }
  out.baselines['stateRefs_' + kind] = { edits: N_EDITS, entries: hist.length + ut.length, apply: stats(lat), undo: stats(ut), heapGrowthMB: round(h1 - h0, 1), note: 'Immer produce without patches, history = previous immutable states (structural sharing). No patch/journal output.' };
  log('stateRefs', kind, JSON.stringify(out.baselines['stateRefs_' + kind]));
  state = null; hist.length = 0;
}
// g3: option C - hand-rolled command log with explicit inverses (image doc only, in-place mutable doc)
{
  const kind = 'image'; const gen = gens.image; const rng = mulberry32(700); const ctx = { n: 9e5, burst: null };
  const cl = (x) => structuredClone(x);
  const doCmd = (doc, s) => { // returns {undo, redo}
    const L = doc.layers;
    switch (s.type) {
      case 'move': { const t = L[s.idx].transform; const ox = t.x, oy = t.y; t.x += s.dx; t.y += s.dy; const nx = t.x, ny = t.y; return { undo: (d) => { const q = d.layers[s.idx].transform; q.x = ox; q.y = oy; }, redo: (d) => { const q = d.layers[s.idx].transform; q.x = nx; q.y = ny; } }; }
      case 'opacity': case 'addKeyframe': {
        const holder = s.type === 'addKeyframe' && s.prop === 'rotation' ? (d) => d.layers[s.idx].transform : (d) => d.layers[s.idx]; const key = s.type === 'addKeyframe' && s.prop === 'rotation' ? 'rotation' : 'opacity';
        const old = cl(holder(doc)[key]); appliers.image(doc, s); const nw = cl(holder(doc)[key]);
        return { undo: (d) => { holder(d)[key] = cl(old); }, redo: (d) => { holder(d)[key] = cl(nw); } };
      }
      case 'addLayer': { appliers.image(doc, s); return { undo: (d) => { d.layers.splice(s.idx, 1); }, redo: (d) => { d.layers.splice(s.idx, 0, s.layer); } }; }
      case 'removeLayer': { const rem = L[s.idx]; appliers.image(doc, s); return { undo: (d) => { d.layers.splice(s.idx, 0, rem); }, redo: (d) => { d.layers.splice(s.idx, 1); } }; }
      case 'reorder': { appliers.image(doc, s); return { undo: (d) => { const [x] = d.layers.splice(s.to, 1); d.layers.splice(s.idx, 0, x); }, redo: (d) => { const [x] = d.layers.splice(s.idx, 1); d.layers.splice(s.to, 0, x); } }; }
      case 'rename': { const o = L[s.idx].name; appliers.image(doc, s); return { undo: (d) => { d.layers[s.idx].name = o; }, redo: (d) => { d.layers[s.idx].name = s.name; } }; }
      case 'blend': { const o = L[s.idx].blendMode; appliers.image(doc, s); return { undo: (d) => { d.layers[s.idx].blendMode = o; }, redo: (d) => { d.layers[s.idx].blendMode = s.mode; } }; }
    }
  };
  let doc = builders[kind](); const snap0 = structuredClone(doc); const h0 = heapMB();
  const hist = []; const redo = []; const lat = []; let last = null;
  for (let i = 0; i < N_EDITS; i++) {
    const spec = gen(doc, rng, ctx); const t = now();
    const c = doCmd(doc, spec); redo.length = 0;
    if (spec.key && last && last.key === spec.key && last === hist[hist.length - 1]) last.redo = c.redo; // keep earliest undo, latest redo
    else { last = { key: spec.key, label: spec.type, undo: c.undo, redo: c.redo }; hist.push(last); }
    lat.push(now() - t);
  }
  const finalDoc = structuredClone(doc); const entries = hist.length;
  const h1 = heapMB(); const ut = [], rt = []; const undone = [];
  for (let i = 0; i < 400; i++) { const e = hist.pop(); const t = now(); e.undo(doc); ut.push(now() - t); undone.push(e); }
  for (let i = undone.length - 1; i >= 0; i--) { const e = undone[i]; const t = now(); e.redo(doc); rt.push(now() - t); hist.push(e); }
  let redoOk = true; try { assert.deepStrictEqual(doc, finalDoc); } catch { redoOk = false; }
  while (hist.length) hist.pop().undo(doc); let undoOk = true; try { assert.deepStrictEqual(doc, snap0); } catch { undoOk = false; }
  out.baselines.optionC_image = { edits: N_EDITS, entries, apply: stats(lat), undo: stats(ut), redo: stats(rt), heapGrowthMB: round(h1 - h0, 1), undoAllEqualsOriginal: undoOk, redoRestoresFinal: redoOk, note: 'Mutable in-place doc (no new references for React; would need a separate change-notification layer). Image doc only. Per-command explicit inverse closures; no auto-generated patches/journal.' };
  log('optionC', JSON.stringify(out.baselines.optionC_image));
}

out.totalRuntimeSec = round((now() - t0all) / 1000, 1);
fs.mkdirSync(RES, { recursive: true });
fs.writeFileSync(path.join(RES, 's5-undo.json'), JSON.stringify(out, null, 2));
log('written s5-undo.json in', out.totalRuntimeSec, 's');
