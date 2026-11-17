// Option A store: Immer produceWithPatches + history stack + coalescing. Throwaway.
import { produceWithPatches, applyPatches, enablePatches } from 'immer';
import { appliers } from './model.mjs';
enablePatches();

const allReplace = (a) => { for (const p of a) if (p.op !== 'replace') return false; return true; };

function mergeInto(e, patches, inverse) {
  if (allReplace(e.patches) && allReplace(patches) && allReplace(e.inverse) && allReplace(inverse)) {
    // compaction for replace-only bursts: latest value wins, earliest inverse wins
    const pm = new Map(); for (const p of e.patches) pm.set(p.path.join('/'), p); for (const p of patches) pm.set(p.path.join('/'), p);
    const im = new Map(); for (const p of e.inverse) im.set(p.path.join('/'), p); for (const p of inverse) if (!im.has(p.path.join('/'))) im.set(p.path.join('/'), p);
    e.patches = [...pm.values()]; e.inverse = [...im.values()];
  } else {
    e.patches = e.patches.concat(patches); e.inverse = inverse.concat(e.inverse);
  }
}

export function createStore(base, { coalesce = true } = {}) {
  const s = { state: base, undo: [], redo: [], last: null, coalesce };
  s.dispatch = (cmd) => {
    const [next, patches, inverse] = produceWithPatches(s.state, cmd.run);
    if (!patches.length) return patches; // no-op command
    s.state = next; s.redo.length = 0; // new edit truncates redo
    if (coalesce && cmd.key && s.last && s.last.key === cmd.key && s.last === s.undo[s.undo.length - 1]) mergeInto(s.last, patches, inverse);
    else { const e = { label: cmd.label, key: cmd.key, patches, inverse }; s.undo.push(e); s.last = e; }
    return patches;
  };
  s.doUndo = () => { const e = s.undo.pop(); if (!e) return null; s.state = applyPatches(s.state, e.inverse); s.redo.push(e); s.last = null; return e; };
  s.doRedo = () => { const e = s.redo.pop(); if (!e) return null; s.state = applyPatches(s.state, e.patches); s.undo.push(e); s.last = null; return e; };
  return s;
}

export function toCmd(kind, spec) {
  const ap = appliers[kind];
  return { label: spec.type, key: spec.key, run: (d) => { ap(d, spec); } };
}
